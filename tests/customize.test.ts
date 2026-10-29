import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setupStatus } from "../src/commands/customize.ts";
import { classify, generalNotes, stepContext } from "../src/lib/layers.ts";
import { loadModules } from "../src/lib/modules.ts";
import { describeSchedule, parseSchedule, toCron, toRRule } from "../src/lib/schedule.ts";
import { defaultState, readState, writeState, type State } from "../src/lib/state.ts";
import { loadQuestions, loadSteps, type Step } from "../src/lib/steps.ts";
import { isOpen, nextOpen, parseWindow } from "../src/lib/time.ts";
import type { Workspace } from "../src/lib/workspace.ts";
import { applySetting, defaultSettings } from "../src/modules/gtm/settings.ts";

function workspace(state: Partial<State> = {}): Workspace {
  const root = mkdtempSync(join(tmpdir(), "ostack-ws-"));
  for (const dir of ["custom/gtm", "custom.local", "campaigns/fundraising", "packs/gtm/mine"]) mkdirSync(join(root, dir), { recursive: true });
  return { root, state: { ...defaultState("0.4.0", ["gtm"]), ...state } };
}

function note(ws: Workspace, path: string, text: string) {
  mkdirSync(dirname(join(ws.root, path)), { recursive: true });
  writeFileSync(join(ws.root, path), text);
}

describe("modules and customization", () => {
  test("every shipped module has workflows, steps with defaults, and questions that parse", async () => {
    const modules = await loadModules();
    expect(modules.map((module) => module.id)).toContain("gtm");
    for (const module of modules) {
      expect(module.workflows.length).toBeGreaterThan(0);
      for (const step of await loadSteps(module.id)) {
        expect(step.summary.length).toBeGreaterThan(0);
        expect(step.body.length).toBeGreaterThan(0);
      }
    }
    const questions = await loadQuestions(["gtm"]);
    const ids = questions.map((question) => question.id);
    expect(ids).toContain("gtm/crm");
    expect(ids).toContain("timezone");
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("note names decide when they apply", () => {
    const ids = new Set(["write", "record"]);
    expect(classify("write.md", ids)).toEqual({ kind: "step", step: "write" });
    expect(classify("after-record.md", ids)).toEqual({ kind: "after", step: "record" });
    expect(classify("about.md", ids)).toEqual({ kind: "general" });
    expect(classify("compose.md", ids, new Map([["compose", "write"]]))).toEqual({ kind: "step", step: "write" });
  });

  test("layers stack packs, shared and module notes, campaign and personal notes in priority order", async () => {
    const ws = workspace();
    ws.state.modules.gtm!.packs = ["gmail", "mine"];
    note(ws, "packs/gtm/mine/write.md", "pack rule");
    note(ws, "custom/gtm/write.md", "team template");
    note(ws, "custom/about.md", "we sell x");
    note(ws, "custom/gtm/icp.md", "who we reach");
    note(ws, "campaigns/fundraising/write.md", "investor tone");
    note(ws, "custom.local/gtm/write.md", "sign as a.");
    note(ws, "custom/gtm/after-record.md", "update lightfield");
    const steps = await loadSteps("gtm");
    const write = steps.find((step) => step.id === "write")!;
    const main = await stepContext(ws, "main", write, steps);
    expect(main.step).toBe("gtm/write");
    expect(main.notes.map((item) => item.layer)).toEqual(["pack:mine", "custom/gtm", "local/gtm"]);
    const fundraising = await stepContext(ws, "fundraising", write, steps);
    expect(fundraising.notes.map((item) => item.text)).toEqual(["pack rule", "team template", "investor tone", "sign as a."]);
    const record = await stepContext(ws, "main", steps.find((step) => step.id === "record")!, steps);
    expect(record.after.map((item) => item.text)).toEqual(["update lightfield"]);
    expect((await generalNotes(ws, "gtm", "main", steps)).map((item) => item.file)).toEqual(["about.md", "icp.md"]);
  });

  test("step notes from before modules keep applying and are flagged to move", async () => {
    const ws = workspace({ reviewed: "0.1.0", answered: { "gtm/about": { version: "0.3.0", skipped: false } } });
    note(ws, "custom/write.md", "template");
    note(ws, "custom/gtm/before-sned.md", "typo");
    const steps = await loadSteps("gtm");
    const context = await stepContext(ws, "main", steps.find((step) => step.id === "write")!, steps);
    expect(context.notes.map((item) => item.text)).toEqual(["template"]);
    const status = await setupStatus(ws);
    expect(status.pending_questions.some((question) => question.id === "gtm/about")).toBe(false);
    expect(status.pending_questions.find((question) => question.id === "gtm/crm")?.new_since_setup).toBe(true);
    expect(status.changed_defaults.map((item) => item.step)).toEqual(["gtm/write"]);
    expect(status.unknown_steps.map((item) => item.step)).toEqual(["gtm/sned"]);
    expect(status.misplaced_notes.map((item) => item.move_to)).toEqual([join(ws.root, "custom", "gtm", "write.md")]);
  });

  test("notes for a renamed step keep applying", async () => {
    const ws = workspace();
    note(ws, "custom/gtm/compose.md", "old name");
    const steps: Step[] = (await loadSteps("gtm")).map((step) => (step.id === "write" ? { ...step, renamed_from: ["compose"] } : step));
    const context = await stepContext(ws, "main", steps.find((step) => step.id === "write")!, steps);
    expect(context.notes.map((item) => item.text)).toEqual(["old name"]);
  });

  test("a 0.3 ostack.json moves into the gtm module without losing anything", async () => {
    const root = mkdtempSync(join(tmpdir(), "ostack-old-"));
    writeFileSync(
      join(root, "ostack.json"),
      JSON.stringify({ reviewed: "0.3.0", mode: "send", limits: { new_per_day: 5, touches_per_day: 20, per_company: 1, max_touches: 3 }, packs: ["gmail"], follow_up_days: [2, 5], answered: { about: { version: "0.3.0", skipped: false }, schedule: { version: "0.3.0", skipped: true } } }),
    );
    const { state, migrated } = await readState(root);
    expect(migrated).toBe(true);
    expect(state.modules.gtm!.packs).toEqual(["gmail"]);
    expect(Object.keys(state.answered).sort()).toEqual(["gtm/about", "schedule"]);
    expect(applySetting(defaultSettings(), "mode", "send").mode).toBe("send");
    await writeState(root, state);
    const again = await readState(root);
    expect(again.migrated).toBe(false);
    expect(again.state.modules.gtm!.settings).toMatchObject({ mode: "send", follow_up_days: [2, 5], send_window: null });
  });

  test("gtm settings keep limits consistent", () => {
    const settings = defaultSettings();
    expect(applySetting(settings, "new_per_day", "10").limits.new_per_day).toBe(10);
    expect(() => applySetting(settings, "new_per_day", "500")).toThrow();
    expect(() => applySetting(settings, "colour", "blue")).toThrow();
    expect(applySetting(settings, "send_window", "any").send_window).toBeNull();
  });
});

describe("schedules and windows", () => {
  test("schedules translate to cron and RRULE in local time", () => {
    const morning = parseSchedule({ days: "weekdays", at: "08:40" });
    expect(toCron(morning)).toBe("40 8 * * 1,2,3,4,5");
    expect(toRRule(morning)).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=8;BYMINUTE=40");
    const often = parseSchedule({ days: "weekdays", every_minutes: 30, from: "08:00", to: "18:00", offset: 7 });
    expect(toCron(often)).toBe("7,37 8,9,10,11,12,13,14,15,16,17 * * 1,2,3,4,5");
    expect(describeSchedule(often, "Europe/London")).toBe("weekdays, every 30 minutes from 08:00 to 18:00 (Europe/London)");
    expect(() => parseSchedule({ every_minutes: 7 })).toThrow();
  });

  test("send windows follow the workspace timezone", () => {
    const window = parseWindow("weekdays 08:00-18:00");
    // 2026-11-02 is a Monday. 13:30 UTC is 08:30 in New York but 05:30 in Los Angeles.
    const at = new Date("2026-11-02T13:30:00Z");
    expect(isOpen(window, "America/New_York", at)).toBe(true);
    expect(isOpen(window, "America/Los_Angeles", at)).toBe(false);
    expect(nextOpen(window, "America/Los_Angeles", at)?.toISOString()).toBe("2026-11-02T16:00:00.000Z");
    expect(() => parseWindow("weekdays 18:00-08:00")).toThrow();
  });
});
