import { integer, oneOf, optional, parseDate, required, textInput, type Args } from "../lib/args.ts";
import { ATTEMPT_KINDS, budget, getAttempt, OUTCOMES, receipt, reserve } from "../lib/attempts.ts";
import { due } from "../lib/due.ts";
import { OstackError } from "../lib/errors.ts";
import { EVENT_TYPES, observe } from "../lib/events.ts";
import { countByStatus, deferLead, getLead, suppress, SUPPRESSION_KINDS } from "../lib/leads.ts";
import { print } from "../lib/output.ts";
import { CHANNELS, loadPlaybook } from "../lib/playbook.ts";
import { openContext, selectedPlaybook } from "./context.ts";

export async function dueCommand(args: Args): Promise<void> {
  const context = await openContext();
  const { playbook } = await selectedPlaybook(context, args);
  print(due(context.db, playbook, integer(args, "limit", 10)));
}

export async function statusCommand(args: Args): Promise<void> {
  const context = await openContext();
  const { playbook } = await selectedPlaybook(context, args);
  print({
    playbook: playbook.name,
    mode: playbook.mode,
    leads: countByStatus(context.db, playbook.name),
    budget: budget(context.db, playbook),
    limits: playbook.limits,
  });
}

export async function reserveCommand(args: Args): Promise<void> {
  const context = await openContext();
  const lead = getLead(context.db, required(args, "lead"));
  const { playbook } = await loadPlaybook(context.workspace, lead.playbook);
  const body = await textInput(args, "body");
  if (!body) throw new OstackError("missing_flag", "--body or --body-file is required.");
  const attempt = reserve(context.db, playbook, {
    leadId: lead.id,
    kind: oneOf(args, "kind", ATTEMPT_KINDS),
    channel: oneOf(args, "channel", CHANNELS),
    subject: optional(args, "subject"),
    body,
  });
  print({
    attempt,
    next:
      playbook.mode === "draft"
        ? `Create this exact message as a draft, then run: ostack receipt --attempt ${attempt.id} --outcome drafted`
        : `Send this exact message now, then run: ostack receipt --attempt ${attempt.id} --outcome sent --external-id <message id>`,
  });
}

export async function receiptCommand(args: Args): Promise<void> {
  const context = await openContext();
  const attempt = getAttempt(context.db, required(args, "attempt"));
  const { playbook } = await loadPlaybook(context.workspace, attempt.playbook);
  print(
    receipt(context.db, playbook, {
      attemptId: attempt.id,
      outcome: oneOf(args, "outcome", OUTCOMES),
      externalId: optional(args, "external-id"),
      threadId: optional(args, "thread-id"),
      evidence: optional(args, "evidence"),
    }),
  );
}

export async function observeCommand(args: Args): Promise<void> {
  const { db } = await openContext();
  const occurredAt = optional(args, "occurred-at");
  const until = optional(args, "until");
  print(
    observe(db, {
      leadId: required(args, "lead"),
      type: oneOf(args, "type", EVENT_TYPES),
      body: await textInput(args, "body"),
      externalId: optional(args, "external-id"),
      occurredAt: occurredAt ? parseDate(occurredAt, "occurred-at") : undefined,
      until: until ? parseDate(until, "until") : undefined,
    }),
  );
}

export async function deferCommand(args: Args): Promise<void> {
  const { db } = await openContext();
  print(deferLead(db, required(args, "lead"), parseDate(required(args, "until"), "until"), required(args, "reason")));
}

export async function suppressCommand(args: Args): Promise<void> {
  const kinds = SUPPRESSION_KINDS.filter((kind) => optional(args, kind) !== undefined);
  if (kinds.length !== 1) throw new OstackError("missing_flag", "Pass exactly one of --email, --domain or --linkedin.");
  const kind = kinds[0]!;
  const { db } = await openContext();
  print(suppress(db, kind, required(args, kind), required(args, "reason")));
}
