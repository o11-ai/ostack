import type { Database } from "bun:sqlite";
import { newId } from "./db.ts";
import { OstackError } from "./errors.ts";
import { companyDomainFromEmail, normalizeDomain, normalizeEmail, normalizeLinkedin } from "./normalize.ts";

export const LEAD_STATUSES = [
  "new", // added, not yet researched
  "qualified", // passed the campaign's rules, ready for the first touch
  "disqualified",
  "active", // in sequence
  "replied", // a human replied and is waiting on us
  "conversation", // we answered; waiting on them
  "meeting",
  "completed", // sequence finished without a reply
  "stopped", // opt-out, bounce or manual stop
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export type Lead = {
  id: string;
  campaign: string;
  status: LeadStatus;
  name: string | null;
  title: string | null;
  company: string | null;
  domain: string | null;
  email: string | null;
  linkedin_url: string | null;
  source: string | null;
  research: string | null;
  reason: string | null;
  evidence: string | null;
  /** JSON object of anything else worth keeping: a CRM record id, a referral, custom columns. */
  fields: string | null;
  step: number;
  next_due_at: string | null;
  defer_until: string | null;
  defer_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type LeadInput = {
  name?: string;
  title?: string;
  company?: string;
  domain?: string;
  email?: string;
  linkedin_url?: string;
  source?: string;
  research?: string;
  fields?: Record<string, unknown>;
};

export type AddResult = {
  added: string[];
  duplicates: { index: number; existing_id: string; campaign: string; status: LeadStatus }[];
  suppressed: { index: number; kind: string; reason: string }[];
  invalid: { index: number; error: string }[];
};

type Identity = { email: string | null; linkedin: string | null; domain: string | null };
type Suppression = { kind: string; value: string; reason: string };

export function getLead(db: Database, id: string): Lead {
  const lead = db.query<Lead, { id: string }>("SELECT * FROM leads WHERE id = $id").get({ id });
  if (!lead) throw new OstackError("lead_not_found", `No lead with id ${id}.`);
  return lead;
}

export function findLead(db: Database, email: string | null, linkedin: string | null): Lead | null {
  if (!email && !linkedin) return null;
  return db
    .query<Lead, { email: string | null; linkedin: string | null }>(
      "SELECT * FROM leads WHERE email = $email OR linkedin_url = $linkedin LIMIT 1",
    )
    .get({ email, linkedin });
}

export function findSuppression(db: Database, identity: Identity): Suppression | null {
  return db
    .query<Suppression, Identity>(
      `SELECT kind, value, reason FROM suppressions
       WHERE (kind = 'email' AND value = $email)
          OR (kind = 'linkedin' AND value = $linkedin)
          OR (kind = 'domain' AND value = $domain)
       LIMIT 1`,
    )
    .get(identity);
}

export function leadIdentity(lead: Lead): Identity {
  return { email: lead.email, linkedin: lead.linkedin_url, domain: lead.domain };
}

export function addLeads(db: Database, campaign: string, inputs: LeadInput[], now = new Date()): AddResult {
  const result: AddResult = { added: [], duplicates: [], suppressed: [], invalid: [] };
  const timestamp = now.toISOString();
  const insert = db.query(
    `INSERT INTO leads (id, campaign, status, name, title, company, domain, email, linkedin_url, source, research, fields, created_at, updated_at)
     VALUES ($id, $campaign, 'new', $name, $title, $company, $domain, $email, $linkedin, $source, $research, $fields, $now, $now)`,
  );
  db.transaction(() => {
    inputs.forEach((input, index) => {
      let identity: Identity;
      try {
        const email = normalizeEmail(input.email);
        identity = {
          email,
          linkedin: normalizeLinkedin(input.linkedin_url),
          domain: normalizeDomain(input.domain) ?? companyDomainFromEmail(email),
        };
      } catch (error) {
        result.invalid.push({ index, error: error instanceof Error ? error.message : String(error) });
        return;
      }
      if (!identity.email && !identity.linkedin) {
        result.invalid.push({ index, error: "A lead needs an email or a linkedin_url." });
        return;
      }
      const existing = findLead(db, identity.email, identity.linkedin);
      if (existing) {
        result.duplicates.push({ index, existing_id: existing.id, campaign: existing.campaign, status: existing.status });
        return;
      }
      const suppression = findSuppression(db, identity);
      if (suppression) {
        result.suppressed.push({ index, kind: suppression.kind, reason: suppression.reason });
        return;
      }
      const id = newId("ld");
      insert.run({
        id,
        campaign,
        name: clean(input.name),
        title: clean(input.title),
        company: clean(input.company),
        domain: identity.domain,
        email: identity.email,
        linkedin: identity.linkedin,
        source: clean(input.source),
        research: clean(input.research),
        fields: mergeFields(null, input.fields ?? {}),
        now: timestamp,
      });
      result.added.push(id);
    });
  })();
  return result;
}

export type LeadUpdate = Partial<Omit<LeadInput, "source">>;

/** Merges new keys into a lead's fields; a null value removes the key. */
export function mergeFields(current: string | null, update: Record<string, unknown>): string | null {
  const fields: Record<string, unknown> = { ...parseFields(current) };
  for (const [key, value] of Object.entries(update)) {
    if (value === null) delete fields[key];
    else fields[key] = value;
  }
  return Object.keys(fields).length > 0 ? JSON.stringify(fields) : null;
}

export function parseFields(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

/** The lead as printed: fields as an object rather than a JSON string. */
export function present(lead: Lead) {
  return { ...lead, fields: parseFields(lead.fields) };
}

export function updateLead(db: Database, id: string, update: LeadUpdate, now = new Date()): Lead {
  return db.transaction(() => {
    const lead = getLead(db, id);
    const email = update.email !== undefined ? normalizeEmail(update.email) : lead.email;
    const linkedin = update.linkedin_url !== undefined ? normalizeLinkedin(update.linkedin_url) : lead.linkedin_url;
    if (!email && !linkedin) throw new OstackError("invalid_lead", "A lead needs an email or a linkedin_url.");
    const clash = db
      .query<{ id: string }, { email: string | null; linkedin: string | null; id: string }>(
        "SELECT id FROM leads WHERE (email = $email OR linkedin_url = $linkedin) AND id != $id LIMIT 1",
      )
      .get({ email, linkedin, id });
    if (clash) throw new OstackError("duplicate_lead", "Another lead already has this email or LinkedIn URL.", { existing_id: clash.id });
    const domain = update.domain !== undefined ? normalizeDomain(update.domain) : lead.domain ?? companyDomainFromEmail(email);
    if (lead.step > 0 && (email !== lead.email || linkedin !== lead.linkedin_url)) {
      throw new OstackError("lead_contacted", "Contact details cannot change after the first touch; add a new lead instead.");
    }
    db.query(
      `UPDATE leads SET email = $email, linkedin_url = $linkedin, domain = $domain,
         name = $name, title = $title, company = $company, research = $research, fields = $fields, updated_at = $now
       WHERE id = $id`,
    ).run({
      id,
      email,
      linkedin,
      domain,
      name: update.name !== undefined ? clean(update.name) : lead.name,
      title: update.title !== undefined ? clean(update.title) : lead.title,
      company: update.company !== undefined ? clean(update.company) : lead.company,
      research: update.research !== undefined ? clean(update.research) : lead.research,
      fields: update.fields ? mergeFields(lead.fields, update.fields) : lead.fields,
      now: now.toISOString(),
    });
    return getLead(db, id);
  })();
}

export function qualifyLead(
  db: Database,
  id: string,
  status: "qualified" | "disqualified",
  reason: string,
  evidence: string,
  now = new Date(),
): Lead {
  const lead = getLead(db, id);
  if (!["new", "qualified", "disqualified"].includes(lead.status) || lead.step > 0) {
    throw new OstackError("lead_contacted", `Lead is ${lead.status}; qualification only applies before the first touch.`);
  }
  if (status === "qualified" && findSuppression(db, leadIdentity(lead))) {
    throw new OstackError("suppressed", "This lead is suppressed and cannot be qualified.");
  }
  db.query(
    "UPDATE leads SET status = $status, reason = $reason, evidence = $evidence, defer_until = NULL, defer_reason = NULL, updated_at = $now WHERE id = $id",
  ).run({ id, status, reason, evidence, now: now.toISOString() });
  return getLead(db, id);
}

/** Undoes a mistaken import. Anyone we ever reserved a message for, or recorded anything about, stays: the ledger is what prevents a second contact. */
export function removeLead(db: Database, id: string): { removed: string } {
  return db.transaction(() => {
    const lead = getLead(db, id);
    const touched = db
      .query<{ n: number }, { id: string }>(
        "SELECT (SELECT COUNT(*) FROM attempts WHERE lead_id = $id) + (SELECT COUNT(*) FROM events WHERE lead_id = $id) AS n",
      )
      .get({ id: lead.id });
    if ((touched?.n ?? 0) > 0) {
      throw new OstackError("lead_has_history", "This lead has messages or events, so it stays in the ledger. Use leads close instead.");
    }
    db.query("DELETE FROM leads WHERE id = $id").run({ id: lead.id });
    return { removed: lead.id };
  })();
}

export const CLOSING_STATUSES = ["meeting", "completed", "stopped"] as const;

export function closeLead(db: Database, id: string, status: (typeof CLOSING_STATUSES)[number], reason: string, now = new Date()): Lead {
  getLead(db, id);
  db.query("UPDATE leads SET status = $status, reason = $reason, next_due_at = NULL, updated_at = $now WHERE id = $id").run({
    id,
    status,
    reason,
    now: now.toISOString(),
  });
  return getLead(db, id);
}

export function deferLead(db: Database, id: string, until: Date, reason: string, now = new Date()): Lead {
  getLead(db, id);
  db.query("UPDATE leads SET defer_until = $until, defer_reason = $reason, updated_at = $now WHERE id = $id").run({
    id,
    until: until.toISOString(),
    reason,
    now: now.toISOString(),
  });
  return getLead(db, id);
}

export const SUPPRESSION_KINDS = ["email", "domain", "linkedin"] as const;
export type SuppressionKind = (typeof SUPPRESSION_KINDS)[number];

/** Suppressions are permanent: they block adding, qualifying and contacting matching leads in every campaign. */
export function suppress(db: Database, kind: SuppressionKind, rawValue: string, reason: string, now = new Date()) {
  const value =
    kind === "email" ? normalizeEmail(rawValue) : kind === "linkedin" ? normalizeLinkedin(rawValue) : normalizeDomain(rawValue);
  if (!value) throw new OstackError("invalid_flag", `A ${kind} value is required.`);
  const column = kind === "email" ? "email" : kind === "linkedin" ? "linkedin_url" : "domain";
  return db.transaction(() => {
    db.query("INSERT OR IGNORE INTO suppressions (kind, value, reason, created_at) VALUES ($kind, $value, $reason, $now)").run({
      kind,
      value,
      reason,
      now: now.toISOString(),
    });
    const stopped = db
      .query(
        `UPDATE leads SET status = 'stopped', reason = $reason, next_due_at = NULL, updated_at = $now
         WHERE ${column} = $value AND status != 'stopped'`,
      )
      .run({ value, reason, now: now.toISOString() });
    return { kind, value, reason, leads_stopped: stopped.changes };
  })();
}

/** Everything known about a person or company before spending research time on them. */
export function checkContact(db: Database, raw: { email?: string; linkedin?: string; domain?: string }) {
  const email = normalizeEmail(raw.email);
  const linkedin = normalizeLinkedin(raw.linkedin);
  const domain = normalizeDomain(raw.domain) ?? companyDomainFromEmail(email);
  const leads = db
    .query<Pick<Lead, "id" | "campaign" | "status" | "step" | "name">, Identity>(
      `SELECT id, campaign, status, step, name FROM leads
       WHERE email = $email OR linkedin_url = $linkedin OR domain = $domain`,
    )
    .all({ email, linkedin, domain });
  return {
    email,
    linkedin,
    domain,
    suppressed: findSuppression(db, { email, linkedin, domain }),
    leads,
    company_contacted: leads.filter((lead) => lead.step > 0).length,
  };
}

export function listLeads(db: Database, filter: { campaign?: string; status?: string; search?: string; limit: number }) {
  const search = filter.search ? `%${filter.search.toLowerCase()}%` : null;
  return db
    .query<Lead, { campaign: string | null; status: string | null; search: string | null; limit: number }>(
      `SELECT * FROM leads
       WHERE ($campaign IS NULL OR campaign = $campaign)
         AND ($status IS NULL OR status = $status)
         AND ($search IS NULL OR lower(coalesce(name, '') || ' ' || coalesce(company, '') || ' ' || coalesce(email, '') || ' ' || coalesce(domain, '') || ' ' || coalesce(linkedin_url, '')) LIKE $search)
       ORDER BY updated_at DESC LIMIT $limit`,
    )
    .all({ campaign: filter.campaign ?? null, status: filter.status ?? null, search, limit: filter.limit });
}

export function countByStatus(db: Database, campaign: string): Record<string, number> {
  const rows = db
    .query<{ status: string; n: number }, { campaign: string }>(
      "SELECT status, COUNT(*) AS n FROM leads WHERE campaign = $campaign GROUP BY status",
    )
    .all({ campaign });
  return Object.fromEntries(rows.map((row) => [row.status, row.n]));
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
