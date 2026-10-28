import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { receipt, reserve } from "../src/lib/attempts.ts";
import { openLedger } from "../src/lib/db.ts";
import { due } from "../src/lib/due.ts";
import { OstackError } from "../src/lib/errors.ts";
import { observe } from "../src/lib/events.ts";
import { addLeads, getLead, qualifyLead, suppress } from "../src/lib/leads.ts";
import { validatePlaybook } from "../src/lib/playbook.ts";

const TEMPLATE = join(import.meta.dir, "../playbooks/b2b-founders/playbook.yaml");

async function setup(overrides: Record<string, unknown> = {}) {
  const raw = Bun.YAML.parse(await Bun.file(TEMPLATE).text()) as Record<string, unknown>;
  const { playbook, errors } = validatePlaybook({ ...raw, ...overrides }, "b2b-founders");
  expect(errors).toEqual([]);
  return { db: openLedger(":memory:"), playbook };
}

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof OstackError) return error.code;
    throw error;
  }
  return undefined;
}

const BODY = "hey sam, saw you launched the new billing api for agencies. how are you finding them today?";

describe("ledger", () => {
  test("templates validate", async () => {
    for (const name of ["b2b-founders", "recruiting", "fundraising"]) {
      const raw = Bun.YAML.parse(await Bun.file(join(import.meta.dir, `../playbooks/${name}/playbook.yaml`)).text());
      expect(validatePlaybook(raw, name).errors).toEqual([]);
    }
  });

  test("dedupes people across playbooks and honors suppressions", async () => {
    const { db } = await setup();
    const first = addLeads(db, "b2b-founders", [{ email: "Sam@Acme.io", name: "Sam" }]);
    expect(first.added).toHaveLength(1);
    const again = addLeads(db, "other", [{ email: "sam@acme.io" }, { linkedin_url: "linkedin.com/in/Pat/" }, {}]);
    expect(again.duplicates).toHaveLength(1);
    expect(again.added).toHaveLength(1);
    expect(again.invalid).toHaveLength(1);
    suppress(db, "domain", "blocked.com", "asked not to be contacted");
    expect(addLeads(db, "b2b-founders", [{ email: "a@blocked.com" }]).suppressed).toHaveLength(1);
  });

  test("reserve, receipt and follow-up scheduling", async () => {
    const { db, playbook } = await setup();
    const [id] = addLeads(db, playbook.name, [{ email: "sam@acme.io", name: "Sam" }]).added;
    expect(code(() => reserve(db, playbook, { leadId: id!, kind: "touch", channel: "email", subject: "q", body: BODY }))).toBe("not_qualified");
    qualifyLead(db, id!, "qualified", "fits", "acme.io/customers");
    expect(due(db, playbook, 10).next).toBe("new");

    const attempt = reserve(db, playbook, { leadId: id!, kind: "touch", channel: "email", subject: "billing for agencies?", body: BODY });
    expect(code(() => reserve(db, playbook, { leadId: id!, kind: "touch", channel: "email", subject: "x", body: BODY }))).toBe("open_attempt");
    expect(code(() => receipt(db, playbook, { attemptId: attempt.id, outcome: "sent" }))).toBe("evidence_required");

    const now = new Date();
    receipt(db, playbook, { attemptId: attempt.id, outcome: "sent", externalId: "msg-1", threadId: "t-1" }, now);
    const lead = getLead(db, id!);
    expect(lead.status).toBe("active");
    expect(lead.step).toBe(1);
    expect(code(() => reserve(db, playbook, { leadId: id!, kind: "touch", channel: "email", body: BODY }))).toBe("not_due");

    const later = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);
    const queue = due(db, playbook, 10, later);
    expect(queue.follow_ups[0]?.thread?.thread_id).toBe("t-1");
    expect(queue.follow_ups[0]?.next_step?.step).toBe(2);
  });

  test("uncertain attempts block resends until reconciled", async () => {
    const { db, playbook } = await setup();
    const [id] = addLeads(db, playbook.name, [{ email: "sam@acme.io" }]).added;
    qualifyLead(db, id!, "qualified", "fits", "evidence");
    const attempt = reserve(db, playbook, { leadId: id!, kind: "touch", channel: "email", subject: "q", body: BODY });
    receipt(db, playbook, { attemptId: attempt.id, outcome: "uncertain", evidence: "browser crashed" });
    expect(due(db, playbook, 10).next).toBe("reconcile");
    expect(code(() => reserve(db, playbook, { leadId: id!, kind: "touch", channel: "email", subject: "q", body: BODY }))).toBe("open_attempt");
    receipt(db, playbook, { attemptId: attempt.id, outcome: "not_sent", evidence: "not in sent folder" });
    expect(reserve(db, playbook, { leadId: id!, kind: "touch", channel: "email", subject: "q", body: BODY }).status).toBe("reserved");
  });

  test("message checks, company limit and daily limit", async () => {
    const { db, playbook } = await setup({ limits: { new_per_day: 1, touches_per_day: 5, per_company: 1 } });
    const ids = addLeads(db, playbook.name, [{ email: "a@acme.io" }, { email: "b@acme.io" }, { email: "c@other.io" }]).added;
    for (const id of ids) qualifyLead(db, id, "qualified", "fits", "evidence");
    expect(code(() => reserve(db, playbook, { leadId: ids[0]!, kind: "touch", channel: "email", subject: "q", body: "hi {{first_name}}" }))).toBe("message_rejected");
    expect(code(() => reserve(db, playbook, { leadId: ids[0]!, kind: "touch", channel: "email", subject: "q", body: "just checking in" }))).toBe("message_rejected");
    const attempt = reserve(db, playbook, { leadId: ids[0]!, kind: "touch", channel: "email", subject: "q", body: BODY });
    receipt(db, playbook, { attemptId: attempt.id, outcome: "sent", externalId: "m1" });
    expect(code(() => reserve(db, playbook, { leadId: ids[1]!, kind: "touch", channel: "email", subject: "q", body: BODY }))).toBe("company_limit");
    expect(code(() => reserve(db, playbook, { leadId: ids[2]!, kind: "touch", channel: "email", subject: "q", body: BODY }))).toBe("daily_limit");
  });

  test("replies pause the sequence and opt-outs suppress", async () => {
    const { db, playbook } = await setup();
    const [id] = addLeads(db, playbook.name, [{ email: "sam@acme.io" }]).added;
    qualifyLead(db, id!, "qualified", "fits", "evidence");
    const attempt = reserve(db, playbook, { leadId: id!, kind: "touch", channel: "email", subject: "q", body: BODY });
    receipt(db, playbook, { attemptId: attempt.id, outcome: "sent", externalId: "m1" });

    observe(db, { leadId: id!, type: "reply", externalId: "in-1", body: "tell me more" });
    expect(observe(db, { leadId: id!, type: "reply", externalId: "in-1" }).duplicate).toBe(true);
    expect(getLead(db, id!).status).toBe("replied");
    expect(due(db, playbook, 10).next).toBe("replies");
    const answer = reserve(db, playbook, { leadId: id!, kind: "reply", channel: "email", body: "happy to share more details." });
    receipt(db, playbook, { attemptId: answer.id, outcome: "sent", externalId: "m2" });
    expect(getLead(db, id!).status).toBe("conversation");

    observe(db, { leadId: id!, type: "opt_out", externalId: "in-2" });
    expect(getLead(db, id!).status).toBe("stopped");
    expect(addLeads(db, "other", [{ email: "sam@acme.io" }]).duplicates).toHaveLength(1);
  });
});
