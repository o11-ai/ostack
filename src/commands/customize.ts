import { optional, required, type Args } from "../lib/args.ts";
import { OstackError } from "../lib/errors.ts";
import { allNotes, classify, generalNotes, stepAliases, stepContext } from "../lib/layers.ts";
import { print } from "../lib/output.ts";
import { applySetting, writeState } from "../lib/settings.ts";
import { loadQuestions, loadSteps } from "../lib/steps.ts";
import { compareVersions, readVersion } from "../lib/version.ts";
import { loadWorkspace, type Workspace } from "../lib/workspace.ts";
import { campaignOf } from "./context.ts";

/**
 * `ostack context` returns everything the agent should know before a run (general notes, mode, limits, steps).
 * `ostack context <step>` returns that step's default plus every customization of it, in priority order.
 */
export async function contextCommand(args: Args): Promise<void> {
  const workspace = await loadWorkspace();
  const campaign = campaignOf(args);
  const steps = await loadSteps();
  const id = args.positionals[1];
  if (id) {
    const step = steps.find((item) => item.id === id);
    if (!step) throw new OstackError("unknown_step", `No step named "${id}".`, { steps: steps.map((item) => item.id) });
    print({ campaign, ...(await stepContext(workspace, campaign, step, steps)) });
    return;
  }
  const notes = await allNotes(workspace, campaign);
  const ids = new Set(steps.map((step) => step.id));
  const aliases = stepAliases(steps);
  const customized = new Set(notes.map((note) => classify(note.file, ids, aliases)).flatMap((target) => ("step" in target ? [target.step] : [])));
  print({
    campaign,
    mode: workspace.state.mode,
    limits: workspace.state.limits,
    packs: workspace.state.packs,
    notes: await generalNotes(workspace, campaign, steps),
    steps: steps.map((step) => ({ id: step.id, summary: step.summary, used_by: step.used_by, customized: customized.has(step.id) })),
  });
}

export async function stepsCommand(): Promise<void> {
  const steps = await loadSteps();
  print(steps.map(({ id, summary, used_by, changed, renamed_from }) => ({ id, summary, used_by, changed, renamed_from })));
}

export async function settingsCommand(args: Args): Promise<void> {
  const workspace = await loadWorkspace();
  const sub = args.positionals[1] ?? "show";
  if (sub === "show") {
    print({ mode: workspace.state.mode, limits: workspace.state.limits });
    return;
  }
  if (sub === "set") {
    const key = args.positionals[2] ?? required(args, "key");
    const value = args.positionals[3] ?? required(args, "value");
    const state = applySetting(workspace.state, key, value);
    await writeState(workspace.root, state);
    print({ mode: state.mode, limits: state.limits });
    return;
  }
  throw new OstackError("unknown_command", "Use: ostack settings show | ostack settings set <key> <value>.");
}

export type SetupStatus = Awaited<ReturnType<typeof setupStatus>>;

/**
 * What the setup interview still needs to cover: questions never answered (including ones a newer release added),
 * defaults that changed since the user last reviewed while they customize that step, and notes whose step was renamed or removed.
 */
export async function setupStatus(workspace: Workspace) {
  const version = await readVersion();
  const [steps, questions] = await Promise.all([loadSteps(), loadQuestions()]);
  const ids = new Set(steps.map((step) => step.id));
  const notes = await allNotes(workspace, "main");
  const aliases = stepAliases(steps);
  const targets = notes.map((note) => ({ note, target: classify(note.file, ids, aliases) }));
  const customized = new Set(targets.flatMap(({ target }) => ("step" in target ? [target.step] : [])));
  const reviewed = workspace.state.reviewed;
  return {
    version,
    reviewed,
    pending_questions: questions
      .filter((question) => !workspace.state.answered[question.id])
      .map((question) => ({ ...question, new_since_setup: compareVersions(question.since, reviewed) > 0 })),
    changed_defaults: steps
      .filter((step) => customized.has(step.id) && compareVersions(step.changed, reviewed) > 0)
      .map((step) => ({ step: step.id, changed: step.changed })),
    // Notes around a step that does not exist (a typo, or a step a release removed).
    unknown_steps: targets
      .filter(({ target }) => "step" in target && !ids.has(target.step))
      .map(({ note, target }) => ({ path: note.path, step: "step" in target ? target.step : "" })),
    // Notes still named for a step's old name. They keep working; renaming the file keeps things tidy.
    renamed_steps: notes.flatMap((note) => {
      const old = note.file.slice(0, -3).replace(/^(before|after)-/, "");
      const current = aliases.get(old);
      return current ? [{ path: note.path, old, current }] : [];
    }),
  };
}

export async function setupCommand(args: Args): Promise<void> {
  const workspace = await loadWorkspace();
  const sub = args.positionals[1] ?? "status";
  const version = await readVersion();
  if (sub === "status") {
    print(await setupStatus(workspace));
    return;
  }
  if (sub === "answer") {
    const id = args.positionals[2] ?? required(args, "question");
    const questions = await loadQuestions();
    if (!questions.some((question) => question.id === id)) {
      throw new OstackError("unknown_question", `No setup question "${id}".`, { questions: questions.map((question) => question.id) });
    }
    const answered = { ...workspace.state.answered, [id]: { version, skipped: args.flags.skip === true } };
    await writeState(workspace.root, { ...workspace.state, answered });
    print({ answered: id, skipped: args.flags.skip === true });
    return;
  }
  if (sub === "reviewed") {
    await writeState(workspace.root, { ...workspace.state, reviewed: version });
    print({ reviewed: version });
    return;
  }
  if (sub === "reset") {
    const id = optional(args, "question");
    const answered = { ...workspace.state.answered };
    if (id) delete answered[id];
    await writeState(workspace.root, { ...workspace.state, answered: id ? answered : {} });
    print({ reset: id ?? "all" });
    return;
  }
  throw new OstackError("unknown_command", "Use: ostack setup status|answer <question> [--skip]|reviewed|reset [--question <id>].");
}
