import { basename, extname } from "node:path";
import { integer, oneOf, optional, readFileOrStdin, required, textInput, type Args } from "../../lib/args.ts";
import { listEvents } from "./events.ts";
import { parseCsv } from "./csv.ts";
import { OstackError } from "../../lib/errors.ts";
import {
  addLeads,
  checkContact,
  CLOSING_STATUSES,
  closeLead,
  getLead,
  LEAD_STATUSES,
  listLeads,
  present,
  qualifyLead,
  removeLead,
  updateLead,
  type LeadInput,
  type LeadUpdate,
} from "./leads.ts";
import { print } from "../../lib/output.ts";
import { isRecord } from "../../lib/paths.ts";
import { campaignOf, openContext } from "./context.ts";

const LEAD_FIELDS = ["name", "title", "company", "domain", "email", "linkedin_url", "source", "research"] as const;
const KNOWN = new Set<string>(LEAD_FIELDS);

/** Column names common in CRM and lead-tool exports, mapped to lead fields. */
const ALIASES: Record<string, (typeof LEAD_FIELDS)[number]> = {
  full_name: "name",
  email_address: "email",
  work_email: "email",
  linkedin: "linkedin_url",
  linkedin_profile: "linkedin_url",
  person_linkedin_url: "linkedin_url",
  company_name: "company",
  organization: "company",
  job_title: "title",
  website: "domain",
  company_domain: "domain",
};

export async function leadsCommand(args: Args): Promise<void> {
  const sub = args.positionals[1];
  const context = await openContext();
  const { db } = context;
  switch (sub) {
    case "add": {
      const campaign = campaignOf(args);
      const file = required(args, "input-file");
      const inputs = parseLeadFile(await readFileOrStdin(file), file).map((lead) => ({ ...lead, source: lead.source ?? optional(args, "source") ?? (file === "-" ? undefined : `file:${basename(file)}`) }));
      if (args.flags["dry-run"] === true) {
        // Runs the real import, then rolls it back: the result shows exactly what would be added.
        db.run("BEGIN");
        const preview = addLeads(db, campaign, inputs);
        db.run("ROLLBACK");
        print({ campaign, dry_run: true, ...preview });
        return;
      }
      print({ campaign, ...addLeads(db, campaign, inputs) });
      return;
    }
    case "list": {
      const status = optional(args, "status");
      if (status && !(LEAD_STATUSES as readonly string[]).includes(status)) {
        throw new OstackError("invalid_flag", `--status must be one of: ${LEAD_STATUSES.join(", ")}.`);
      }
      const campaign = optional(args, "campaign");
      print(listLeads(db, { campaign, status, search: optional(args, "search"), limit: integer(args, "limit", 50) }).map(present));
      return;
    }
    case "show": {
      const lead = getLead(db, required(args, "id"));
      const attempts = db.query("SELECT * FROM attempts WHERE lead_id = $lead ORDER BY reserved_at").all({ lead: lead.id });
      print({ lead: present(lead), attempts, events: listEvents(db, lead.id) });
      return;
    }
    case "update": {
      const update: LeadUpdate = {};
      for (const field of LEAD_FIELDS) {
        if (field === "source") continue;
        const value = field === "research" ? await textInput(args, "research") : optional(args, field.replace("_", "-"));
        if (value !== undefined) update[field] = value;
      }
      const fields = optional(args, "fields");
      if (fields !== undefined) update.fields = parseObject(fields, "--fields");
      print(present(updateLead(db, required(args, "id"), update)));
      return;
    }
    case "qualify": {
      const status = oneOf(args, "status", ["qualified", "disqualified"] as const);
      print(present(qualifyLead(db, required(args, "id"), status, required(args, "reason"), required(args, "evidence"))));
      return;
    }
    case "close": {
      const status = oneOf(args, "status", CLOSING_STATUSES);
      print(present(closeLead(db, required(args, "id"), status, required(args, "reason"))));
      return;
    }
    case "remove": {
      print(removeLead(db, required(args, "id")));
      return;
    }
    default:
      throw new OstackError("unknown_command", "Use: ostack leads add|list|show|update|qualify|close|remove.");
  }
}

export async function checkCommand(args: Args): Promise<void> {
  const email = optional(args, "email");
  const linkedin = optional(args, "linkedin");
  const domain = optional(args, "domain");
  if (!email && !linkedin && !domain) throw new OstackError("missing_flag", "Pass --email, --linkedin or --domain.");
  const { db } = await openContext();
  print(checkContact(db, { email, linkedin, domain }));
}

function parseLeadFile(text: string, path: string): LeadInput[] {
  const rows: unknown[] =
    extname(path).toLowerCase() === ".csv" || (path === "-" && !text.trimStart().startsWith("[")) ? parseCsv(text) : parseJson(text);
  return rows.map((row, index) => {
    if (!isRecord(row)) throw new OstackError("invalid_input", `Row ${index} is not an object.`);
    const lead: LeadInput = {};
    const extra: Record<string, unknown> = isRecord(row.fields) ? { ...row.fields } : {};
    for (const [rawKey, value] of Object.entries(row)) {
      if (value === undefined || value === null || value === "" || rawKey === "fields") continue;
      const key = KNOWN.has(rawKey) ? rawKey : ALIASES[rawKey];
      if (key && lead[key as (typeof LEAD_FIELDS)[number]] === undefined) {
        lead[key as (typeof LEAD_FIELDS)[number]] = typeof value === "string" ? value : JSON.stringify(value);
      } else extra[rawKey] = value;
    }
    // Exports often split names.
    if (!lead.name && typeof row.first_name === "string" && row.first_name) {
      lead.name = [row.first_name, typeof row.last_name === "string" ? row.last_name : ""].join(" ").trim();
    }
    if (Object.keys(extra).length > 0) lead.fields = extra;
    return lead;
  });
}

function parseObject(text: string, flag: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new OstackError("invalid_flag", `${flag} must be a JSON object, for example '{"crm_id":"123"}'.`);
  }
  if (!isRecord(parsed)) throw new OstackError("invalid_flag", `${flag} must be a JSON object.`);
  return parsed;
}

function parseJson(text: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new OstackError("invalid_input", "Lead input must be a JSON array or a CSV file.");
  }
  if (!Array.isArray(parsed)) throw new OstackError("invalid_input", "Lead input must be a JSON array.");
  return parsed;
}
