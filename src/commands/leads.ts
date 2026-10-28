import { extname } from "node:path";
import { integer, oneOf, optional, readFileOrStdin, required, textInput, type Args } from "../lib/args.ts";
import { listEvents } from "../lib/events.ts";
import { parseCsv } from "../lib/csv.ts";
import { OstackError } from "../lib/errors.ts";
import {
  addLeads,
  checkContact,
  CLOSING_STATUSES,
  closeLead,
  getLead,
  LEAD_STATUSES,
  listLeads,
  qualifyLead,
  updateLead,
  type LeadInput,
} from "../lib/leads.ts";
import { print } from "../lib/output.ts";
import { isRecord } from "../lib/workspace.ts";
import { openContext, selectedPlaybook } from "./context.ts";

const LEAD_FIELDS = ["name", "title", "company", "domain", "email", "linkedin_url", "source", "research"] as const;

export async function leadsCommand(args: Args): Promise<void> {
  const sub = args.positionals[1];
  const context = await openContext();
  const { db } = context;
  switch (sub) {
    case "add": {
      const { playbook } = await selectedPlaybook(context, args);
      const file = required(args, "input-file");
      const inputs = parseLeadFile(await readFileOrStdin(file), file);
      print({ playbook: playbook.name, ...addLeads(db, playbook.name, inputs) });
      return;
    }
    case "list": {
      const status = optional(args, "status");
      if (status && !(LEAD_STATUSES as readonly string[]).includes(status)) {
        throw new OstackError("invalid_flag", `--status must be one of: ${LEAD_STATUSES.join(", ")}.`);
      }
      print(listLeads(db, { playbook: optional(args, "playbook"), status, search: optional(args, "search"), limit: integer(args, "limit", 50) }));
      return;
    }
    case "show": {
      const lead = getLead(db, required(args, "id"));
      const attempts = db.query("SELECT * FROM attempts WHERE lead_id = $lead ORDER BY reserved_at").all({ lead: lead.id });
      print({ lead, attempts, events: listEvents(db, lead.id) });
      return;
    }
    case "update": {
      const update: Partial<Record<(typeof LEAD_FIELDS)[number], string>> = {};
      for (const field of LEAD_FIELDS) {
        if (field === "source") continue;
        const value = field === "research" ? await textInput(args, "research") : optional(args, field.replace("_", "-"));
        if (value !== undefined) update[field] = value;
      }
      print(updateLead(db, required(args, "id"), update));
      return;
    }
    case "qualify": {
      const status = oneOf(args, "status", ["qualified", "disqualified"] as const);
      print(qualifyLead(db, required(args, "id"), status, required(args, "reason"), required(args, "evidence")));
      return;
    }
    case "close": {
      const status = oneOf(args, "status", CLOSING_STATUSES);
      print(closeLead(db, required(args, "id"), status, required(args, "reason")));
      return;
    }
    default:
      throw new OstackError("unknown_command", "Use: ostack leads add|list|show|update|qualify|close.");
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
    for (const field of LEAD_FIELDS) {
      const value = row[field];
      if (value === undefined || value === null || value === "") continue;
      lead[field] = typeof value === "string" ? value : JSON.stringify(value);
    }
    return lead;
  });
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
