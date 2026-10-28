import { integer, oneOf, optional, parseDate, required, textInput, type Args } from "../lib/args.ts";
import { ATTEMPT_KINDS, budget, getAttempt, OUTCOMES, receipt, reserve } from "../lib/attempts.ts";
import { due, DUE_SCOPES } from "../lib/due.ts";
import { OstackError } from "../lib/errors.ts";
import { checkEventType, observe } from "../lib/events.ts";
import { countByStatus, deferLead, getLead, present, suppress, SUPPRESSION_KINDS } from "../lib/leads.ts";
import { print } from "../lib/output.ts";
import { nextGap } from "../lib/settings.ts";
import { campaignOf, openContext } from "./context.ts";

export async function dueCommand(args: Args): Promise<void> {
  const { workspace, db } = await openContext();
  const scope = optional(args, "for") === undefined ? "all" : oneOf(args, "for", DUE_SCOPES);
  print(due(db, workspace.state, campaignOf(args), integer(args, "limit", 10), new Date(), scope));
}

export async function statusCommand(args: Args): Promise<void> {
  const { workspace, db } = await openContext();
  const campaign = campaignOf(args);
  print({
    campaign,
    mode: workspace.state.mode,
    leads: countByStatus(db, campaign),
    budget: budget(db, workspace.state.limits),
    limits: workspace.state.limits,
  });
}

export async function reserveCommand(args: Args): Promise<void> {
  const { workspace, db } = await openContext();
  const lead = getLead(db, required(args, "lead"));
  const body = await textInput(args, "body");
  if (!body) throw new OstackError("missing_flag", "--body or --body-file is required.");
  const attempt = reserve(db, workspace.state.limits, {
    leadId: lead.id,
    kind: oneOf(args, "kind", ATTEMPT_KINDS),
    channel: required(args, "channel"),
    subject: optional(args, "subject"),
    body,
  });
  print({
    attempt,
    next:
      workspace.state.mode === "draft"
        ? `Create this exact message as a draft, then run: ostack receipt --attempt ${attempt.id} --outcome drafted`
        : `Send this exact message now, then run: ostack receipt --attempt ${attempt.id} --outcome sent --external-id <message id> --thread-id <thread id>`,
  });
}

export async function receiptCommand(args: Args): Promise<void> {
  const { workspace, db } = await openContext();
  const last = args.flags.last === true;
  const days = optional(args, "next-in-days");
  if (last && days !== undefined) throw new OstackError("invalid_flag", "Use --next-in-days or --last, not both.");
  const attemptId = required(args, "attempt");
  let next: { inDays: number } | null | undefined;
  if (last) next = null;
  else if (days !== undefined) next = { inDays: integer(args, "next-in-days", 1) };
  else {
    // Without an override, the next touch follows the workspace's follow-up schedule.
    const attempt = getAttempt(db, attemptId);
    if (attempt.kind === "touch" && attempt.step !== null) {
      const gap = nextGap(workspace.state, attempt.step);
      next = gap === null ? null : { inDays: gap };
    }
  }
  const result = receipt(db, workspace.state.limits, {
      attemptId,
      outcome: oneOf(args, "outcome", OUTCOMES),
      externalId: optional(args, "external-id"),
      threadId: optional(args, "thread-id"),
      evidence: optional(args, "evidence"),
      next,
    });
  print({ attempt: result.attempt, lead: present(result.lead), next_touch_due: result.lead.next_due_at });
}

export async function observeCommand(args: Args): Promise<void> {
  const { db } = await openContext();
  const occurredAt = optional(args, "occurred-at");
  const until = optional(args, "until");
  const result = observe(db, {
    leadId: required(args, "lead"),
    type: checkEventType(required(args, "type")),
    body: await textInput(args, "body"),
    externalId: optional(args, "external-id"),
    occurredAt: occurredAt ? parseDate(occurredAt, "occurred-at") : undefined,
    until: until ? parseDate(until, "until") : undefined,
  });
  print({ duplicate: result.duplicate, lead: present(result.lead) });
}

export async function deferCommand(args: Args): Promise<void> {
  const { db } = await openContext();
  print(present(deferLead(db, required(args, "lead"), parseDate(required(args, "until"), "until"), required(args, "reason"))));
}

export async function suppressCommand(args: Args): Promise<void> {
  const kinds = SUPPRESSION_KINDS.filter((kind) => optional(args, kind) !== undefined);
  if (kinds.length !== 1) throw new OstackError("missing_flag", "Pass exactly one of --email, --domain or --linkedin.");
  const kind = kinds[0]!;
  const { db } = await openContext();
  print(suppress(db, kind, required(args, kind), required(args, "reason")));
}
