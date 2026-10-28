import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupStatus } from "../src/commands/customize.ts";
import { classify, generalNotes, stepContext } from "../src/lib/layers.ts";
import { applySetting, defaultState, type State } from "../src/lib/settings.ts";
import { loadQuestions, loadSteps, type Step } from "../src/lib/steps.ts";
import type { Workspace } from "../src/lib/workspace.ts";

function workspace(state: Partial<State> = {}): Workspace {
  const root = mkdtempSync(join(tmpdir(), "ostack-ws-"));
  for (const dir of ["custom", "custom.local", "campaigns/fundraising", "packs/mine"]) mkdirSync(join(root, dir), { recursive: true });
  return { root, ledgerPath: join(root, ".ostack", "ledger.db"), state: { ...defaultState("0.2.0"), ...state } };
}

function note(ws: Workspace, path: string, text: string) {
  writeFileSync(join(ws.root, path), text);
}

describe("customization", () => {
  test("every shipped step has a summary and a default, and questions parse", async () => {
    const steps = await loadSteps();
    expect(steps.map((step) => step.id)).toContain("write");
    for (const step of steps) {
      expect(step.summary.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
      expect(step.used_by.length).toBeGreaterThan(0);
    }
    const questions = await loadQuestions();
    expect(questions.map((question) => question.id)).toContain("crm");
    expect(new Set(questions.map((question) => question.id)).size).toBe(questions.length);
  });

  test("note names decide when they apply", () => {
    const ids = new Set(["write", "record"]);
    expect(classify("write.md", ids)).toEqual({ kind: "step", step: "write" });
    expect(classify("after-record.md", ids)).toEqual({ kind: "after", step: "record" });
    expect(classify("about.md", ids)).toEqual({ kind: "general" });
    expect(classify("compose.md", ids, new Map([["compose", "write"]]))).toEqual({ kind: "step", step: "write" });
  });

  test("layers stack packs, team, campaign and personal notes in priority order", async () => {
    const ws = workspace({ packs: ["gmail", "mine"] });
    note(ws, "packs/mine/write.md", "pack rule");
    note(ws, "custom/write.md", "team template");
    note(ws, "custom/about.md", "we sell x");
    note(ws, "campaigns/fundraising/write.md", "investor tone");
    note(ws, "custom.local/write.md", "sign as a.");
    note(ws, "custom/after-record.md", "update lightfield");
    const steps = await loadSteps();
    const write = steps.find((step) => step.id === "write")!;
    const main = await stepContext(ws, "main", write, steps);
    expect(main.notes.map((item) => item.layer)).toEqual(["pack:mine", "custom", "local"]);
    const fundraising = await stepContext(ws, "fundraising", write, steps);
    expect(fundraising.notes.map((item) => item.text)).toEqual(["pack rule", "team template", "investor tone", "sign as a."]);
    const record = await stepContext(ws, "main", steps.find((step) => step.id === "record")!, steps);
    expect(record.after.map((item) => item.text)).toEqual(["update lightfield"]);
    expect((await generalNotes(ws, "main", steps)).map((item) => item.file)).toEqual(["about.md"]);
  });

  test("setup status lists new questions, changed defaults and notes needing attention", async () => {
    const ws = workspace({ reviewed: "0.1.0", answered: { about: { version: "0.2.0", skipped: false } } });
    note(ws, "custom/write.md", "template");
    note(ws, "custom/before-sned.md", "typo");
    const status = await setupStatus(ws);
    expect(status.pending_questions.some((question) => question.id === "about")).toBe(false);
    expect(status.pending_questions.find((question) => question.id === "crm")?.new_since_setup).toBe(true);
    expect(status.changed_defaults.map((item) => item.step)).toEqual(["write"]);
    expect(status.unknown_steps.map((item) => item.step)).toEqual(["sned"]);
  });

  test("notes for a renamed step keep applying", async () => {
    const ws = workspace();
    note(ws, "custom/compose.md", "old name");
    const steps: Step[] = (await loadSteps()).map((step) => (step.id === "write" ? { ...step, renamed_from: ["compose"] } : step));
    const context = await stepContext(ws, "main", steps.find((step) => step.id === "write")!, steps);
    expect(context.notes.map((item) => item.text)).toEqual(["old name"]);
  });

  test("settings keep limits consistent", () => {
    const state = defaultState("0.2.0");
    expect(applySetting(state, "mode", "send").mode).toBe("send");
    expect(applySetting(state, "new_per_day", "10").limits.new_per_day).toBe(10);
    expect(() => applySetting(state, "new_per_day", "500")).toThrow();
    expect(() => applySetting(state, "colour", "blue")).toThrow();
  });
});
