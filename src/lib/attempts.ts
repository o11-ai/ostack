import type { Database } from "bun:sqlite";
import { addDays, newId } from "./db.ts";
import { OstackError } from "./errors.ts";
import { findSuppression, getLead, leadIdentity, type Lead } from "./leads.ts";
import { checkMessage } from "./message-check.ts";
import type { Channel, Playbook } from "./playbook.ts";

export const RESERVATION_MINUTES = 30;
export const OPEN_STATUSES = ["reserved", "drafted", "uncertain"] as const;
export const OUTCOMES = ["sent", "not_sent", "uncertain", "drafted"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const ATTEMPT_KINDS = ["touch", "reply"] as const;
export type AttemptKind = (typeof ATTEMPT_KINDS)[number];

export type Attempt = {
  id: string;
  lead_id: string;
  playbook: string;
  kind: AttemptKind;
  step: number | null;
  channel: Channel;
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

/** Counts every touch that may have gone out, so unknown outcomes never let a run exceed its limits. */
export function budget(db: Database, playbook: Playbook, now = new Date()): Budget {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const row = db
    .query<{ touches: number; new: number | null }, { playbook: string; since: string }>(
      `SELECT COUNT(*) AS touches, SUM(CASE WHEN step = 1 THEN 1 ELSE 0 END) AS new
       FROM attempts
       WHERE playbook = $playbook AND kind = 'touch' AND status != 'not_sent' AND reserved_at >= $since`,
    )
    .get({ playbook: playbook.name, since });
  const touches = row?.touches ?? 0;
  const fresh = row?.new ?? 0;
  const remainingTouches = Math.max(0, playbook.limits.touches_per_day - touches);
  return {
    window: "rolling 24 hours",
    touches,
    new: fresh,
    remaining_touches: remainingTouches,
    remaining_new: Math.max(0, Math.min(playbook.limits.new_per_day - fresh, remainingTouches)),
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

export type ReserveInput = { leadId: string; kind: AttemptKind; channel: Channel; subject?: string; body: string };

export function reserve(db: Database, playbook: Playbook, input: ReserveInput, now = new Date()): Attempt {
  return db
    .transaction(() => {
      const lead = getLead(db, input.leadId);
      if (lead.playbook !== playbook.name) {
        throw new OstackError("wrong_playbook", `Lead belongs to playbook "${lead.playbook}".`);
      }
      const suppression = findSuppression(db, leadIdentity(lead));
      if (suppression) throw new OstackError("suppressed", `This ${suppression.kind} is suppressed: ${suppression.reason}.`);
      const open = openAttempt(db, lead.id);
      if (open) {
        throw new OstackError("open_attempt", "This lead has an unfinished attempt. Check what actually happened and record it with ostack receipt before trying again.", {
          attempt: { id: open.id, status: open.status, reserved_at: open.reserved_at, channel: open.channel },
        });
      }
      if (lead.defer_until && lead.defer_until > now.toISOString()) {
        throw new OstackError("deferred", `Lead is deferred until ${lead.defer_until}: ${lead.defer_reason ?? "no reason"}.`);
      }
      if (input.channel === "email" && !lead.email) throw new OstackError("no_contact", "Lead has no email address.");
      if (input.channel === "linkedin" && !lead.linkedin_url) throw new OstackError("no_contact", "Lead has no LinkedIn URL.");
      const step = input.kind === "touch" ? checkTouch(db, playbook, lead, input.channel, now) : checkReply(lead);
      const problems = checkMessage(playbook, {
        channel: input.channel,
        subject: input.subject,
        body: input.body,
        needsSubject: step === 1,
      });
      if (problems.length > 0) throw new OstackError("message_rejected", "Fix the message and reserve again.", { problems });
      const id = newId("at");
      db.query(
        `INSERT INTO attempts (id, lead_id, playbook, kind, step, channel, status, subject, body, reserved_at, expires_at)
         VALUES ($id, $lead, $playbook, $kind, $step, $channel, 'reserved', $subject, $body, $now, $expires)`,
      ).run({
        id,
        lead: lead.id,
        playbook: playbook.name,
        kind: input.kind,
        step,
        channel: input.channel,
        subject: input.subject?.trim() || null,
        body: input.body.trim(),
        now: now.toISOString(),
        expires: new Date(now.getTime() + RESERVATION_MINUTES * 60 * 1000).toISOString(),
      });
      return getAttempt(db, id);
    })
    .immediate();
}

function checkTouch(db: Database, playbook: Playbook, lead: Lead, channel: Channel, now: Date): number {
  const step = lead.step + 1;
  const planned = playbook.sequence[step - 1];
  if (!planned) throw new OstackError("sequence_complete", "Every step in this sequence has been sent.");
  if (step === 1 && lead.status !== "qualified") {
    throw new OstackError("not_qualified", `Lead is ${lead.status}; qualify it before the first touch.`);
  }
  if (step > 1 && lead.status !== "active") {
    throw new OstackError("not_active", `Lead is ${lead.status}; follow-ups only go to leads still in sequence.`);
  }
  if (step > 1 && lead.next_due_at && lead.next_due_at > now.toISOString()) {
    throw new OstackError("not_due", `Step ${step} is due at ${lead.next_due_at}.`);
  }
  if (channel !== planned.channel) {
    throw new OstackError("wrong_channel", `Step ${step} uses ${planned.channel}.`);
  }
  // The company limit is a lasting fact about this lead, so report it before the temporary daily limit.
  if (step === 1 && lead.domain) {
    const contacted = db
      .query<{ n: number }, { domain: string; lead: string }>(
        `SELECT COUNT(DISTINCT a.lead_id) AS n FROM attempts a JOIN leads l ON l.id = a.lead_id
         WHERE l.domain = $domain AND a.lead_id != $lead AND a.status != 'not_sent'`,
      )
      .get({ domain: lead.domain, lead: lead.id });
    if ((contacted?.n ?? 0) >= playbook.limits.per_company) {
      throw new OstackError("company_limit", `${lead.domain} already has ${contacted?.n} contacted lead(s); the limit is ${playbook.limits.per_company}.`);
    }
  }
  const current = budget(db, playbook, now);
  if (current.remaining_touches === 0 || (step === 1 && current.remaining_new === 0)) {
    throw new OstackError("daily_limit", "The playbook's daily limit is reached.", { budget: current });
  }
  return step;
}

function checkReply(lead: Lead): null {
  if (lead.status !== "replied") {
    throw new OstackError("no_reply_pending", `Lead is ${lead.status}; replies are for leads waiting on an answer.`);
  }
  return null;
}

export type ReceiptInput = { attemptId: string; outcome: Outcome; externalId?: string; threadId?: string; evidence?: string };

export function receipt(db: Database, playbook: Playbook, input: ReceiptInput, now = new Date()) {
  return db
    .transaction(() => {
      const attempt = getAttempt(db, input.attemptId);
      if (attempt.playbook !== playbook.name) throw new OstackError("wrong_playbook", `Attempt belongs to "${attempt.playbook}".`);
      if (!(OPEN_STATUSES as readonly string[]).includes(attempt.status)) {
        throw new OstackError("attempt_closed", `Attempt is already ${attempt.status}.`);
      }
      if (input.outcome === "sent" && !input.externalId && !input.evidence) {
        throw new OstackError("evidence_required", "A sent receipt needs --external-id or --evidence from the sent message.");
      }
      if (input.outcome === "not_sent" && !input.evidence) {
        throw new OstackError("evidence_required", "Say how you confirmed nothing was sent (--evidence).");
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
      if (input.outcome === "sent") applySent(db, playbook, attempt, now);
      return { attempt: getAttempt(db, attempt.id), lead: getLead(db, attempt.lead_id) };
    })
    .immediate();
}

function applySent(db: Database, playbook: Playbook, attempt: Attempt, now: Date): void {
  const lead = getLead(db, attempt.lead_id);
  let status = lead.status;
  let step = lead.step;
  let nextDue: string | null = lead.next_due_at;
  if (attempt.kind === "touch" && attempt.step !== null) {
    step = Math.max(step, attempt.step);
    const following = playbook.sequence[attempt.step];
    if (lead.status === "qualified" || lead.status === "active") {
      status = following ? "active" : "completed";
      nextDue = following ? addDays(now, following.wait_days).toISOString() : null;
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
