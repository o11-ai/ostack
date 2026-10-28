import type { Database } from "bun:sqlite";
import { budget, lastSent, type Attempt, type Budget } from "./attempts.ts";
import type { Lead } from "./leads.ts";
import type { Playbook } from "./playbook.ts";

export type DueLead = {
  id: string;
  name: string | null;
  title: string | null;
  company: string | null;
  domain: string | null;
  email: string | null;
  linkedin_url: string | null;
  status: string;
  next_step?: { step: number; channel: string; brief: string };
  thread?: { subject: string | null; thread_id: string | null; external_id: string | null; channel: string };
};

export type NextAction = "reconcile" | "replies" | "follow_ups" | "new" | "qualify" | "source" | "done";

export type Due = {
  playbook: string;
  mode: Playbook["mode"];
  budget: Budget;
  next: NextAction;
  reconcile: Pick<Attempt, "id" | "lead_id" | "status" | "channel" | "subject" | "reserved_at" | "expires_at">[];
  replies: DueLead[];
  follow_ups: DueLead[];
  new: DueLead[];
  to_qualify: DueLead[];
};

/** The work queue for one run, in the order it should be handled. */
export function due(db: Database, playbook: Playbook, limit: number, now = new Date()): Due {
  const at = now.toISOString();
  const name = playbook.name;
  const current = budget(db, playbook, now);
  const ready = `(defer_until IS NULL OR defer_until <= $now)
    AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.lead_id = leads.id AND a.status IN ('reserved', 'drafted', 'uncertain'))`;
  const select = (where: string, order: string, take: number) =>
    take <= 0
      ? []
      : db
          .query<Lead, { playbook: string; now: string; limit: number }>(
            `SELECT * FROM leads WHERE playbook = $playbook AND ${where} ORDER BY ${order} LIMIT $limit`,
          )
          .all({ playbook: name, now: at, limit: take });

  const reconcile = db
    .query<Due["reconcile"][number], { playbook: string; now: string }>(
      `SELECT id, lead_id, status, channel, subject, reserved_at, expires_at FROM attempts
       WHERE playbook = $playbook AND (status IN ('uncertain', 'drafted') OR (status = 'reserved' AND expires_at <= $now))
       ORDER BY reserved_at`,
    )
    .all({ playbook: name, now: at });

  const replies = select(`status = 'replied' AND ${ready}`, "updated_at", limit);
  const followUps = select(
    `status = 'active' AND next_due_at <= $now AND ${ready}`,
    "next_due_at",
    Math.min(limit, current.remaining_touches),
  );
  const fresh = select(
    `status = 'qualified' AND step = 0 AND ${ready}`,
    "updated_at",
    Math.min(limit, current.remaining_new, current.remaining_touches - followUps.length),
  );
  const toQualify = select(`status = 'new' AND (defer_until IS NULL OR defer_until <= $now)`, "created_at", limit);

  const withStep = (lead: Lead): DueLead => {
    const planned = playbook.sequence[lead.step];
    const view = project(db, lead);
    return planned ? { ...view, next_step: { step: lead.step + 1, ...planned } } : view;
  };

  const queues = {
    reconcile,
    replies: replies.map((lead) => project(db, lead)),
    follow_ups: followUps.map(withStep),
    new: fresh.map(withStep),
    to_qualify: toQualify.map((lead) => project(db, lead)),
  };
  return {
    playbook: name,
    mode: playbook.mode,
    budget: current,
    next: nextAction(queues, current),
    ...queues,
  };
}

function project(db: Database, lead: Lead): DueLead {
  const view: DueLead = {
    id: lead.id,
    name: lead.name,
    title: lead.title,
    company: lead.company,
    domain: lead.domain,
    email: lead.email,
    linkedin_url: lead.linkedin_url,
    status: lead.status,
  };
  const sent = lead.step > 0 ? lastSent(db, lead.id) : null;
  if (sent) {
    view.thread = { subject: sent.subject, thread_id: sent.thread_id, external_id: sent.external_id, channel: sent.channel };
  }
  return view;
}

function nextAction(queues: Omit<Due, "playbook" | "mode" | "budget" | "next">, current: Budget): NextAction {
  if (queues.reconcile.length > 0) return "reconcile";
  if (queues.replies.length > 0) return "replies";
  if (queues.follow_ups.length > 0) return "follow_ups";
  if (queues.new.length > 0) return "new";
  if (current.remaining_new === 0) return "done";
  if (queues.to_qualify.length > 0) return "qualify";
  return "source";
}
