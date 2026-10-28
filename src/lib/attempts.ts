import type { Database } from "bun:sqlite";
import { addDays, newId } from "./db.ts";
import { OstackError } from "./errors.ts";
import { findSuppression, getLead, leadIdentity, type Lead } from "./leads.ts";
import { checkMessage } from "./message-check.ts";
import type { Limits } from "./settings.ts";

export const RESERVATION_MINUTES = 30;
export const OPEN_STATUSES = ["reserved", "drafted", "uncertain"] as const;
export const OUTCOMES = ["sent", "not_sent", "uncertain", "drafted"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const ATTEMPT_KINDS = ["touch", "reply"] as const;
export type AttemptKind = (typeof ATTEMPT_KINDS)[number];

/** Channels are open-ended (email, linkedin, sms, x, ...); only email and linkedin have contact checks. */
export function checkChannel(value: string): string {
  const channel = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]*$/.test(channel)) {
    throw new OstackError("invalid_flag", "--channel must be a short lowercase name such as email or linkedin.");
  }
  return channel;
}

export type Attempt = {
  id: string;
  lead_id: string;
  campaign: string;
  kind: AttemptKind;
  step: number | null;
  channel: string;
  status: "reserved" | "drafted" | "sent" | "not_sent" | "uncertain";
  subject: string | null;
  body: string;
  reserved_at: string;
  expires_at: string;
  completed_at: string | null;
  external_id: string | null;
  thread_id: string | null;
  evidence: string | null;
};

export type Budget = {
  window: "rolling 24 hours";
  touches: number;
  new: number;
  remaining_touches: number;
  remaining_new: number;
};

/**
 * Limits protect the sender, so they count every campaign in the workspace, and every touch
 * that may have gone out, so unknown outcomes never let a run exceed them.
 */
export function budget(db: Database, limits: Limits, now = new Date()): Budget {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const row = db
    .query<{ touches: number; new: number | null }, { since: string }>(
      `SELECT COUNT(*) AS touches, SUM(CASE WHEN step = 1 THEN 1 ELSE 0 END) AS new
       FROM attempts
       WHERE kind = 'touch' AND status != 'not_sent' AND reserved_at >= $since`,
    )
    .get({ since });
  const touches = row?.touches ?? 0;
  const fresh = row?.new ?? 0;
  const remainingTouches = Math.max(0, limits.touches_per_day - touches);
  return {
    window: "rolling 24 hours",
    touches,
    new: fresh,
    remaining_touches: remainingTouches,
    remaining_new: Math.max(0, Math.min(limits.new_per_day - fresh, remainingTouches)),
  };
}

export function getAttempt(db: Database, id: string): Attempt {
  const attempt = db.query<Attempt, { id: string }>("SELECT * FROM attempts WHERE id = $id").get({ id });
  if (!attempt) throw new OstackError("attempt_not_found", `No attempt with id ${id}.`);
  return attempt;
}

export function openAttempt(db: Database, leadId: string): Attempt | null {
  return db
    .query<Attempt, { lead: string }>(
      "SELECT * FROM attempts WHERE lead_id = $lead AND status IN ('reserved', 'drafted', 'uncertain')",
    )
    .get({ lead: leadId });
}

/** The latest message we sent this lead, whose thread later touches and replies should continue. */
export function lastSent(db: Database, leadId: string): Attempt | null {
  return db
    .query<Attempt, { lead: string }>(
      "SELECT * FROM attempts WHERE lead_id = $lead AND status = 'sent' ORDER BY completed_at DESC LIMIT 1",
    )
    .get({ lead: leadId });
}

export type ReserveInput = { leadId: string; kind: AttemptKind; channel: string; subject?: string; body: string };

export function reserve(db: Database, limits: Limits, input: ReserveInput, now = new Date()): Attempt {
  return db
    .transaction(() => {
      const lead = getLead(db, input.leadId);
      const suppression = findSuppression(db, leadIdentity(lead));
      if (suppression) throw new OstackError("suppressed", `This ${suppression.kind} is suppressed: ${suppression.reason}.`);
      const open = openAttempt(db, lead.id);
      if (open) {
        const how =
          open.status === "drafted"
            ? `It is a draft: if the user sent it, run ostack receipt --attempt ${open.id} --outcome sent with its IDs; if it was deleted or should be replaced, delete the draft and run ostack receipt --attempt ${open.id} --outcome not_sent --evidence "<how you checked>".`
            : `Check the Sent folder, then run ostack receipt --attempt ${open.id} with what actually happened.`;
        throw new OstackError("open_attempt", `This lead has an unfinished ${open.status} attempt. ${how}`, {
          attempt: { id: open.id, status: open.status, reserved_at: open.reserved_at, channel: open.channel },
        });
      }
      if (lead.defer_until && lead.defer_until > now.toISOString()) {
        throw new OstackError("deferred", `Lead is deferred until ${lead.defer_until}: ${lead.defer_reason ?? "no reason"}.`);
      }
      const channel = checkChannel(input.channel);
      if (channel === "email" && !lead.email) throw new OstackError("no_contact", "Lead has no email address.");
      if (channel === "linkedin" && !lead.linkedin_url) throw new OstackError("no_contact", "Lead has no LinkedIn URL.");
      const step = input.kind === "touch" ? checkTouch(db, limits, lead, now) : checkReply(lead);
      const problems = checkMessage({ channel, subject: input.subject, body: input.body, needsSubject: step === 1 });
      if (problems.length > 0) throw new OstackError("message_rejected", "Fix the message and reserve again.", { problems });
      const id = newId("at");
      db.query(
        `INSERT INTO attempts (id, lead_id, campaign, kind, step, channel, status, subject, body, reserved_at, expires_at)
         VALUES ($id, $lead, $campaign, $kind, $step, $channel, 'reserved', $subject, $body, $now, $expires)`,
      ).run({
        id,
        lead: lead.id,
        campaign: lead.campaign,
        kind: input.kind,
        step,
        channel,
        subject: input.subject?.trim() || null,
        body: input.body.trim(),
        now: now.toISOString(),
        expires: new Date(now.getTime() + RESERVATION_MINUTES * 60 * 1000).toISOString(),
      });
      return getAttempt(db, id);
    })
    .immediate();
}

function checkTouch(db: Database, limits: Limits, lead: Lead, now: Date): number {
  const step = lead.step + 1;
  if (step > limits.max_touches) {
    throw new OstackError("sequence_complete", `This lead already had ${lead.step} touches; max_touches is ${limits.max_touches}.`);
  }
  if (step === 1 && lead.status !== "qualified") {
    throw new OstackError("not_qualified", `Lead is ${lead.status}; qualify it before the first touch.`);
  }
  if (step > 1 && lead.status !== "active") {
    throw new OstackError("not_active", `Lead is ${lead.status}; follow-ups only go to leads still in sequence.`);
  }
  if (step > 1 && lead.next_due_at && lead.next_due_at > now.toISOString()) {
    throw new OstackError("not_due", `Touch ${step} is due at ${lead.next_due_at}.`);
  }
  // The company limit is a lasting fact about this lead, so report it before the temporary daily limit.
  if (step === 1 && lead.domain) {
    const contacted = db
      .query<{ n: number }, { domain: string; lead: string }>(
        `SELECT COUNT(DISTINCT a.lead_id) AS n FROM attempts a JOIN leads l ON l.id = a.lead_id
         WHERE l.domain = $domain AND a.lead_id != $lead AND a.status != 'not_sent'`,
      )
      .get({ domain: lead.domain, lead: lead.id });
    if ((contacted?.n ?? 0) >= limits.per_company) {
      throw new OstackError("company_limit", `${lead.domain} already has ${contacted?.n} contacted lead(s); the limit is ${limits.per_company}.`);
    }
  }
  const current = budget(db, limits, now);
  if (current.remaining_touches === 0 || (step === 1 && current.remaining_new === 0)) {
    throw new OstackError("daily_limit", "The daily limit is reached.", { budget: current });
  }
  return step;
}

const REPLYABLE = ["replied", "conversation", "meeting"];

function checkReply(lead: Lead): null {
  if (!REPLYABLE.includes(lead.status)) {
    throw new OstackError("no_conversation", `Lead is ${lead.status}; replies are for leads already in a conversation.`);
  }
  return null;
}

export type ReceiptInput = {
  attemptId: string;
  outcome: Outcome;
  externalId?: string;
  threadId?: string;
  evidence?: string;
  /** For a sent touch: when the next one is due, or null when this was the last. */
  next?: { inDays: number } | null;
};

export function receipt(db: Database, limits: Limits, input: ReceiptInput, now = new Date()) {
  return db
    .transaction(() => {
      const attempt = getAttempt(db, input.attemptId);
      if (!(OPEN_STATUSES as readonly string[]).includes(attempt.status)) {
        throw new OstackError("attempt_closed", `Attempt is already ${attempt.status}.`);
      }
      if (input.outcome === "sent" && !input.externalId && !input.evidence) {
        throw new OstackError("evidence_required", "A sent receipt needs --external-id or --evidence from the sent message.");
      }
      if (input.outcome === "not_sent" && !input.evidence) {
        throw new OstackError("evidence_required", "Say how you confirmed nothing was sent (--evidence).");
      }
      if (input.outcome === "sent" && attempt.kind === "touch" && input.next === undefined) {
        throw new OstackError("next_required", "Say when the next touch is due (--next-in-days <n>) or that this was the last (--last).");
      }
      const finished = input.outcome === "sent" || input.outcome === "not_sent";
      db.query(
        `UPDATE attempts SET status = $status, completed_at = $completed,
           external_id = coalesce($external, external_id), thread_id = coalesce($thread, thread_id),
           evidence = coalesce($evidence, evidence)
         WHERE id = $id`,
      ).run({
        id: attempt.id,
        status: input.outcome,
        completed: finished ? now.toISOString() : null,
        external: input.externalId ?? null,
        thread: input.threadId ?? null,
        evidence: input.evidence ?? null,
      });
      if (input.outcome === "sent") applySent(db, limits, attempt, input.next ?? null, now);
      return { attempt: getAttempt(db, attempt.id), lead: getLead(db, attempt.lead_id) };
    })
    .immediate();
}

function applySent(db: Database, limits: Limits, attempt: Attempt, next: { inDays: number } | null, now: Date): void {
  const lead = getLead(db, attempt.lead_id);
  let status = lead.status;
  let step = lead.step;
  let nextDue: string | null = lead.next_due_at;
  if (attempt.kind === "touch" && attempt.step !== null) {
    step = Math.max(step, attempt.step);
    if (lead.status === "qualified" || lead.status === "active") {
      const more = next !== null && step < limits.max_touches;
      status = more ? "active" : "completed";
      nextDue = more ? addDays(now, next.inDays).toISOString() : null;
    }
  } else if (lead.status === "replied") {
    status = "conversation";
  }
  db.query("UPDATE leads SET status = $status, step = $step, next_due_at = $next, updated_at = $now WHERE id = $id").run({
    id: lead.id,
    status,
    step,
    next: nextDue,
    now: now.toISOString(),
  });
}
