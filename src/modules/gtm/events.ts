import type { Database } from "bun:sqlite";
import { newId } from "./db.ts";
import { OstackError } from "../../lib/errors.ts";
import { getLead, suppress, type Lead } from "./leads.ts";

/** Event types with built-in effects on the lead. Any other lowercase type (crm_synced, call_logged, ...) is recorded as-is. */
export const EVENT_TYPES = ["reply", "bounce", "opt_out", "out_of_office", "meeting", "note"] as const;

export function checkEventType(value: string): string {
  const type = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]*$/.test(type)) {
    throw new OstackError("invalid_flag", "--type must be lowercase letters, numbers and underscores, such as reply or crm_synced.");
  }
  return type;
}

export type ObserveInput = {
  leadId: string;
  type: string;
  body?: string;
  externalId?: string;
  occurredAt?: Date;
  until?: Date;
};

export type LeadEvent = {
  id: string;
  lead_id: string;
  type: string;
  body: string | null;
  external_id: string | null;
  occurred_at: string;
  created_at: string;
};

/** Records something that happened. Replies pause the sequence; bounces and opt-outs stop it everywhere. */
export function observe(db: Database, input: ObserveInput, now = new Date()): { duplicate: boolean; lead: Lead } {
  if (input.type === "out_of_office" && !input.until) {
    throw new OstackError("missing_flag", "--until is required for out_of_office; use the return date from the auto-reply.");
  }
  return db
    .transaction(() => {
      const lead = getLead(db, input.leadId);
      if (input.externalId) {
        const seen = db
          .query<{ id: string }, { lead: string; external: string }>(
            "SELECT id FROM events WHERE lead_id = $lead AND external_id = $external",
          )
          .get({ lead: lead.id, external: input.externalId });
        if (seen) return { duplicate: true, lead };
      }
      const timestamp = now.toISOString();
      db.query(
        `INSERT INTO events (id, lead_id, type, body, external_id, occurred_at, created_at)
         VALUES ($id, $lead, $type, $body, $external, $occurred, $now)`,
      ).run({
        id: newId("ev"),
        lead: lead.id,
        type: input.type,
        body: input.body?.trim() || null,
        external: input.externalId ?? null,
        occurred: (input.occurredAt ?? now).toISOString(),
        now: timestamp,
      });
      const update = (status: string) =>
        db.query("UPDATE leads SET status = $status, next_due_at = NULL, updated_at = $now WHERE id = $id").run({
          id: lead.id,
          status,
          now: timestamp,
        });
      switch (input.type) {
        case "reply":
          if (lead.status !== "stopped") update("replied");
          break;
        case "meeting":
          if (lead.status !== "stopped") update("meeting");
          break;
        case "bounce":
          if (lead.email) suppress(db, "email", lead.email, "bounced", now);
          update("stopped");
          break;
        case "opt_out":
          if (lead.email) suppress(db, "email", lead.email, "opted out", now);
          if (lead.linkedin_url) suppress(db, "linkedin", lead.linkedin_url, "opted out", now);
          update("stopped");
          break;
        case "out_of_office":
          db.query("UPDATE leads SET defer_until = $until, defer_reason = 'out of office', updated_at = $now WHERE id = $id").run({
            id: lead.id,
            until: input.until!.toISOString(),
            now: timestamp,
          });
          break;
        default:
          break;
      }
      return { duplicate: false, lead: getLead(db, lead.id) };
    })
    .immediate();
}

export function listEvents(db: Database, leadId: string): LeadEvent[] {
  return db
    .query<LeadEvent, { lead: string }>("SELECT * FROM events WHERE lead_id = $lead ORDER BY occurred_at")
    .all({ lead: leadId });
}
