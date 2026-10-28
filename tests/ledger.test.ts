import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { receipt, reserve } from "../src/lib/attempts.ts";
import { openLedger } from "../src/lib/db.ts";
import { due } from "../src/lib/due.ts";
import { OstackError } from "../src/lib/errors.ts";
import { observe } from "../src/lib/events.ts";
import { addLeads, getLead, parseFields, qualifyLead, suppress, updateLead } from "../src/lib/leads.ts";
import { DEFAULT_LIMITS, defaultState, type Limits } from "../src/lib/settings.ts";

function setup(limits: Partial<Limits> = {}) {
  const state = defaultState("0.2.0");
  state.limits = { ...DEFAULT_LIMITS, ...limits };
  return { db: openLedger(":memory:"), state, limits: state.limits };
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
  test("dedupes people across campaigns, keeps extra fields and honors suppressions", () => {
    const { db } = setup();
    const first = addLeads(db, "main", [{ email: "Sam@Acme.io", name: "Sam", fields: { crm_id: "c1" } }]);
    expect(first.added).toHaveLength(1);
    expect(parseFields(getLead(db, first.added[0]!).fields)).toEqual({ crm_id: "c1" });
    const again = addLeads(db, "fundraising", [{ email: "sam@acme.io" }, { linkedin_url: "linkedin.com/in/Pat/" }, {}]);
    expect(again.duplicates).toHaveLength(1);
    expect(again.added).toHaveLength(1);
    expect(again.invalid).toHaveLength(1);
    const updated = updateLead(db, first.added[0]!, { fields: { stage: "Contacted", crm_id: null } });
    expect(parseFields(updated.fields)).toEqual({ stage: "Contacted" });
    suppress(db, "domain", "blocked.com", "asked not to be contacted");
    expect(addLeads(db, "main", [{ email: "a@blocked.com" }]).suppressed).toHaveLength(1);
  });

  test("reserve, receipt and follow-up timing chosen by the agent", () => {
    const { db, state, limits } = setup();
    const [id] = addLeads(db, "main", [{ email: "sam@acme.io", name: "Sam" }]).added;
    expect(code(() => reserve(db, limits, { leadId: id!, kind: "touch", channel: "email", subject: "q", body: BODY }))).toBe("not_qualified");
    qualifyLead(db, id!, "qualified", "fits", "acme.io/customers");
    expect(due(db, state, "main", 10).next).toBe("new");

    const attempt = reserve(db, limits, { leadId: id!, kind: "touch", channel: "email", subject: "billing for agencies?", body: BODY });
    expect(code(() => reserve(db, limits, { leadId: id!, kind: "touch", channel: "email", subject: "x", body: BODY }))).toBe("open_attempt");
    expect(code(() => receipt(db, limits, { attemptId: attempt.id, outcome: "sent" }))).toBe("evidence_required");
    expect(code(() => receipt(db, limits, { attemptId: attempt.id, outcome: "sent", externalId: "m1" }))).toBe("next_required");

    const now = new Date();
    receipt(db, limits, { attemptId: attempt.id, outcome: "sent", externalId: "msg-1", threadId: "t-1", next: { inDays: 5 } }, now);
    const lead = getLead(db, id!);
    expect(lead.status).toBe("active");
    expect(lead.step).toBe(1);
    expect(code(() => reserve(db, limits, { leadId: id!, kind: "touch", channel: "email", body: BODY }))).toBe("not_due");

    const later = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000 + 1000);
    const queue = due(db, state, "main", 10, later);
    expect(queue.follow_ups[0]?.thread?.thread_id).toBe("t-1");
    expect(queue.follow_ups[0]?.touch).toBe(2);
    const second = reserve(db, limits, { leadId: id!, kind: "touch", channel: "email", body: BODY }, later);
    receipt(db, limits, { attemptId: second.id, outcome: "sent", externalId: "msg-2", next: null }, later);
    expect(getLead(db, id!).status).toBe("completed");
  });

  test("max_touches is a hard ceiling and channels are open-ended", () => {
    const { db, limits } = setup({ max_touches: 1 });
    const [id] = addLeads(db, "main", [{ email: "sam@acme.io", linkedin_url: "linkedin.com/in/sam" }]).added;
    qualifyLead(db, id!, "qualified", "fits", "evidence");
    expect(code(() => reserve(db, limits, { leadId: id!, kind: "touch", channel: "Not A Channel", body: BODY }))).toBe("invalid_flag");
    const attempt = reserve(db, limits, { leadId: id!, kind: "touch", channel: "sms", body: BODY });
    receipt(db, limits, { attemptId: attempt.id, outcome: "sent", externalId: "s1", next: { inDays: 3 } });
    expect(getLead(db, id!).status).toBe("completed");
  });

  test("uncertain attempts block resends until reconciled", () => {
    const { db, limits, state } = setup();
    const [id] = addLeads(db, "main", [{ email: "sam@acme.io" }]).added;
    qualifyLead(db, id!, "qualified", "fits", "evidence");
    const attempt = reserve(db, limits, { leadId: id!, kind: "touch", channel: "email", subject: "q", body: BODY });
    receipt(db, limits, { attemptId: attempt.id, outcome: "uncertain", evidence: "browser crashed" });
    expect(due(db, state, "main", 10).next).toBe("reconcile");
    expect(code(() => reserve(db, limits, { leadId: id!, kind: "touch", channel: "email", subject: "q", body: BODY }))).toBe("open_attempt");
    receipt(db, limits, { attemptId: attempt.id, outcome: "not_sent", evidence: "not in sent folder" });
    expect(reserve(db, limits, { leadId: id!, kind: "touch", channel: "email", subject: "q", body: BODY }).status).toBe("reserved");
  });

  test("placeholders, company limit and a daily limit shared across campaigns", () => {
    const { db, limits } = setup({ new_per_day: 1, touches_per_day: 5, per_company: 1 });
    const ids = addLeads(db, "main", [{ email: "a@acme.io" }, { email: "b@acme.io" }]).added;
    const [other] = addLeads(db, "fundraising", [{ email: "c@other.io" }]).added;
    for (const id of [...ids, other!]) qualifyLead(db, id, "qualified", "fits", "evidence");
    expect(code(() => reserve(db, limits, { leadId: ids[0]!, kind: "touch", channel: "email", subject: "q", body: "hi {{first_name}}" }))).toBe("message_rejected");
    const attempt = reserve(db, limits, { leadId: ids[0]!, kind: "touch", channel: "email", subject: "q", body: BODY });
    receipt(db, limits, { attemptId: attempt.id, outcome: "sent", externalId: "m1", next: { inDays: 3 } });
    expect(code(() => reserve(db, limits, { leadId: ids[1]!, kind: "touch", channel: "email", subject: "q", body: BODY }))).toBe("company_limit");
    expect(code(() => reserve(db, limits, { leadId: other!, kind: "touch", channel: "email", subject: "q", body: BODY }))).toBe("daily_limit");
  });

  test("replies pause the sequence, custom events are recorded, opt-outs suppress", () => {
    const { db, limits, state } = setup();
    const [id] = addLeads(db, "main", [{ email: "sam@acme.io" }]).added;
    qualifyLead(db, id!, "qualified", "fits", "evidence");
    const attempt = reserve(db, limits, { leadId: id!, kind: "touch", channel: "email", subject: "q", body: BODY });
    receipt(db, limits, { attemptId: attempt.id, outcome: "sent", externalId: "m1", next: { inDays: 3 } });

    observe(db, { leadId: id!, type: "reply", externalId: "in-1", body: "tell me more" });
    expect(observe(db, { leadId: id!, type: "reply", externalId: "in-1" }).duplicate).toBe(true);
    expect(getLead(db, id!).status).toBe("replied");
    expect(due(db, state, "main", 10).next).toBe("replies");
    const answer = reserve(db, limits, { leadId: id!, kind: "reply", channel: "email", body: "happy to share more details." });
    receipt(db, limits, { attemptId: answer.id, outcome: "sent", externalId: "m2" });
    expect(getLead(db, id!).status).toBe("conversation");

    expect(observe(db, { leadId: id!, type: "crm_synced", externalId: "lf-1" }).lead.status).toBe("conversation");
    observe(db, { leadId: id!, type: "opt_out", externalId: "in-2" });
    expect(getLead(db, id!).status).toBe("stopped");
    expect(addLeads(db, "other", [{ email: "sam@acme.io" }]).duplicates).toHaveLength(1);
  });

  test("a version 1 ledger migrates and keeps its data, with a backup", () => {
    const dir = mkdtempSync(join(tmpdir(), "ostack-"));
    const path = join(dir, "ledger.db");
    const old = new Database(path, { create: true });
    old.exec(`
      CREATE TABLE leads (id TEXT PRIMARY KEY, playbook TEXT NOT NULL, status TEXT NOT NULL, name TEXT, title TEXT, company TEXT,
        domain TEXT, email TEXT UNIQUE, linkedin_url TEXT UNIQUE, source TEXT, research TEXT, reason TEXT, evidence TEXT,
        step INTEGER NOT NULL DEFAULT 0, next_due_at TEXT, defer_until TEXT, defer_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX leads_playbook_status ON leads (playbook, status);
      CREATE TABLE attempts (id TEXT PRIMARY KEY, lead_id TEXT NOT NULL, playbook TEXT NOT NULL, kind TEXT NOT NULL, step INTEGER,
        channel TEXT NOT NULL, status TEXT NOT NULL, subject TEXT, body TEXT NOT NULL, reserved_at TEXT NOT NULL, expires_at TEXT NOT NULL,
        completed_at TEXT, external_id TEXT, thread_id TEXT, evidence TEXT);
      CREATE INDEX attempts_playbook_reserved ON attempts (playbook, reserved_at);
      INSERT INTO leads (id, playbook, status, email, created_at, updated_at) VALUES ('ld_1', 'sales', 'new', 'a@b.io', 'x', 'x');
      PRAGMA user_version = 1;
    `);
    old.close();
    const db = openLedger(path);
    expect(getLead(db, "ld_1").campaign).toBe("sales");
    expect(Bun.file(`${path}.v1-backup`).size).toBeGreaterThan(0);
  });
});

describe("due scopes", () => {
  test("each skill sees only its own queues, and drafts never block", () => {
    const { db, state, limits } = setup();
    const [replied, fresh] = addLeads(db, "main", [{ email: "a@one.io" }, { email: "b@two.io" }]).added;
    for (const id of [replied!, fresh!]) qualifyLead(db, id, "qualified", "fits", "evidence");
    const first = reserve(db, limits, { leadId: replied!, kind: "touch", channel: "email", subject: "q", body: BODY });
    receipt(db, limits, { attemptId: first.id, outcome: "sent", externalId: "m1", next: { inDays: 3 } });
    observe(db, { leadId: replied!, type: "reply", externalId: "in-1" });

    expect(due(db, state, "main", 10, new Date(), "all").next).toBe("replies");
    expect(due(db, state, "main", 10, new Date(), "outbound").next).toBe("new");
    expect(due(db, state, "main", 10, new Date(), "outbound").replies).toHaveLength(0);

    const draft = reserve(db, limits, { leadId: fresh!, kind: "touch", channel: "email", subject: "q", body: BODY });
    receipt(db, limits, { attemptId: draft.id, outcome: "drafted" });
    const outbound = due(db, state, "main", 10, new Date(), "outbound");
    expect(outbound.drafts.map((item) => item.id)).toEqual([draft.id]);
    expect(outbound.next).toBe("find");
    observe(db, { leadId: replied!, type: "meeting", externalId: "ev-1" });
    expect(due(db, state, "main", 10, new Date(), "follow-ups").next).toBe("done");
  });
});
