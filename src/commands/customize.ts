import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { optional, required, type Args } from "../lib/args.ts";
import { REPO_ROOT } from "../lib/paths.ts";
import { OstackError } from "../lib/errors.ts";
import { generalNotes, moduleNotes, stepAliases, stepContext } from "../lib/layers.ts";
import { print } from "../lib/output.ts";
import { writeState } from "../lib/state.ts";
import { findStep, loadQuestions, loadSteps, type SetupQuestion } from "../lib/steps.ts";
import { checkTimeZone, localTime } from "../lib/time.ts";
import { compareVersions, readVersion } from "../lib/version.ts";
import { checkName, CUSTOM_DIR, DEFAULT_CAMPAIGN, enabledModules, loadWorkspace, requireModule, type Workspace } from "../lib/workspace.ts";
import { MODULE_CODE } from "../modules/index.ts";

function campaignOf(args: Args): string {
  return checkName(optional(args, "campaign") ?? DEFAULT_CAMPAIGN, "campaign");
}

/** The module a command is about: --module, the prefix of a qualified ref, or the only enabled one. */
function moduleOf(workspace: Workspace, args: Args, ref?: string): string {
  const named = optional(args, "module") ?? (ref?.includes("/") ? ref.split("/")[0] : undefined);
  if (named) {
    requireModule(workspace, named);
    return named;
  }
  const enabled = enabledModules(workspace);
  if (enabled.length === 1) return enabled[0]!;
  throw new OstackError("module_required", "More than one module is enabled. Pass --module <id>.", { modules: enabled });
}

/**
 * `ostack context` returns everything the agent should know before a run of a module: shared and module notes,
 * settings, steps. `ostack context <step>` returns that step's default plus every customization of it, in priority order.
 */
export async function contextCommand(args: Args): Promise<void> {
  const workspace = await loadWorkspace();
  const campaign = campaignOf(args);
  const ref = args.positionals[1];
  if (ref) {
    const step = await findStep(ref, optional(args, "module") ? [moduleOf(workspace, args)] : enabledModules(workspace));
    if (step) {
      print({ campaign, ...(await stepContext(workspace, campaign, step, await loadSteps(step.module))) });
      return;
    }
    // A general note, such as `ostack context about`, in every layer that has one.
    const module = moduleOf(workspace, args, ref);
    const name = ref.split("/").pop();
    const named = (await generalNotes(workspace, module, campaign, await loadSteps(module))).filter((note) => note.file === `${name}.md`);
    if (named.length > 0) return print({ module, campaign, note: name, notes: named });
    throw new OstackError("unknown_step", `No step or general note named "${ref}".`, {
      steps: (await Promise.all(enabledModules(workspace).map(loadSteps))).flat().map((step) => step.ref),
    });
  }
  const module = moduleOf(workspace, args);
  const steps = await loadSteps(module);
  const notes = await moduleNotes(workspace, module, campaign, steps);
  const customized = new Set(notes.flatMap(({ target }) => ("step" in target ? [target.step] : [])));
  print({
    module,
    campaign,
    timezone: workspace.state.timezone,
    settings: MODULE_CODE[module]?.settings?.show(workspace.state.modules[module]!.settings) ?? {},
    packs: workspace.state.modules[module]!.packs,
    notes: notes
      .filter(({ target }) => target.kind === "general")
      .map(({ note }) => (args.flags.files === true ? { layer: note.layer, file: note.file, path: note.path } : note)),
    steps: steps.map((step) => ({ id: step.ref, summary: step.summary, used_by: step.used_by, customized: customized.has(step.id) })),
  });
}

export async function stepsCommand(args: Args): Promise<void> {
  const workspace = await loadWorkspace();
  const modules = optional(args, "module") ? [moduleOf(workspace, args)] : enabledModules(workspace);
  const steps = (await Promise.all(modules.map(loadSteps))).flat();
  print(steps.map(({ ref, summary, used_by, changed, renamed_from }) => ({ id: ref, summary, used_by, changed, renamed_from })));
}

/** `timezone` is shared; everything else belongs to a module: `gtm.mode`, or `mode` when only one module has that key. */
export async function settingsCommand(args: Args): Promise<void> {
  const workspace = await loadWorkspace();
  const sub = args.positionals[1] ?? "show";
  const show = () => ({
    timezone: workspace.state.timezone,
    local_time: localTime(new Date(), workspace.state.timezone).text,
    modules: Object.fromEntries(
      enabledModules(workspace).map((module) => [module, MODULE_CODE[module]?.settings?.show(workspace.state.modules[module]!.settings) ?? {}]),
    ),
  });
  if (sub === "show") return print(show());
  if (sub !== "set") throw new OstackError("unknown_command", "Use: ostack settings show | ostack settings set <key> <value>.");
  const key = args.positionals[2] ?? required(args, "key");
  const value = args.positionals[3] ?? required(args, "value");
  if (key === "timezone") {
    workspace.state.timezone = checkTimeZone(value);
  } else {
    const [module, setting] = key.includes(".") ? (key.split(".", 2) as [string, string]) : [settingOwner(workspace, key), key];
    requireModule(workspace, module);
    const code = MODULE_CODE[module]?.settings;
    if (!code) throw new OstackError("unknown_setting", `The ${module} module has no settings.`);
    workspace.state.modules[module]!.settings = code.apply(workspace.state.modules[module]!.settings, setting, value);
  }
  await writeState(workspace.root, workspace.state);
  print({ set: key, ...show() });
}

function settingOwner(workspace: Workspace, key: string): string {
  const owners = enabledModules(workspace).filter((module) => MODULE_CODE[module]?.settings?.keys.includes(key));
  if (owners.length === 1) return owners[0]!;
  throw new OstackError("unknown_setting", owners.length === 0 ? `Unknown setting "${key}".` : `Several modules have "${key}"; use <module>.${key}.`, {
    settings: ["timezone", ...enabledModules(workspace).flatMap((module) => (MODULE_CODE[module]?.settings?.keys ?? []).map((item) => `${module}.${item}`))],
  });
}

export type SetupStatus = Awaited<ReturnType<typeof setupStatus>>;

/**
 * What the setup interview still needs to cover: questions never answered (including ones a newer release or a newly
 * added module brought), defaults that changed since the last review on steps the user customized, and notes to tidy.
 */
export async function setupStatus(workspace: Workspace) {
  const version = await readVersion();
  const modules = enabledModules(workspace);
  const questions = await loadQuestions(modules);
  const reviewed = workspace.state.reviewed;
  const changed: { step: string; changed: string; change: string }[] = [];
  const unknown: { path: string; step: string }[] = [];
  const renamed: { path: string; old: string; current: string }[] = [];
  const misplaced: { path: string; move_to: string }[] = [];
  for (const module of modules) {
    const steps = await loadSteps(module);
    const ids = new Set(steps.map((step) => step.id));
    const aliases = stepAliases(steps);
    const notes = (await moduleNotes(workspace, module, "main", steps)).filter(({ note }) => !note.layer.startsWith("pack:"));
    const customized = new Set(notes.flatMap(({ target }) => ("step" in target ? [target.step] : [])));
    for (const step of steps) {
      if (customized.has(step.id) && compareVersions(step.changed, reviewed) > 0) changed.push({ step: step.ref, changed: step.changed, change: step.change });
    }
    for (const { note, target, legacy } of notes) {
      if ("step" in target && !ids.has(target.step)) unknown.push({ path: note.path, step: `${module}/${target.step}` });
      const old = note.file.slice(0, -3).replace(/^(before|after)-/, "");
      const current = aliases.get(old);
      if (current) renamed.push({ path: note.path, old, current });
      if (legacy) misplaced.push({ path: note.path, move_to: join(workspace.root, note.layer === "local" ? "custom.local" : CUSTOM_DIR, module, note.file) });
    }
  }
  return {
    version,
    reviewed,
    release_notes: await releaseNotes(reviewed),
    modules,
    timezone: workspace.state.timezone,
    pending_questions: questions
      .filter((question) => !workspace.state.answered[question.id])
      .map((question) => ({ ...question, new_since_setup: compareVersions(question.since, reviewed) > 0 })),
    changed_defaults: changed,
    // Notes around a step that does not exist (a typo, or a step a release removed).
    unknown_steps: unknown,
    // Notes still named for a step's old name. They keep working; renaming the file keeps things tidy.
    renamed_steps: renamed,
    // Step notes from before modules, still in custom/. They keep working; moving them into the module's folder keeps things tidy.
    misplaced_notes: misplaced,
  };
}

/** The changelog sections newer than the version this workspace last reviewed. */
async function releaseNotes(reviewed: string): Promise<{ version: string; notes: string }[]> {
  const path = join(REPO_ROOT, "CHANGELOG.md");
  if (!existsSync(path)) return [];
  return (await Bun.file(path).text())
    .split(/^## /m)
    .slice(1)
    .map((section) => {
      const [heading = "", ...rest] = section.split("\n");
      return { version: heading.trim(), notes: rest.join("\n").trim() };
    })
    .filter((entry) => compareVersions(entry.version, reviewed) > 0);
}

async function findQuestion(workspace: Workspace, id: string): Promise<SetupQuestion> {
  const questions = await loadQuestions(enabledModules(workspace));
  const matches = questions.filter((question) => question.id === id || (!id.includes("/") && question.id.endsWith(`/${id}`)));
  const exact = matches.find((question) => question.id === id);
  if (exact) return exact;
  if (matches.length === 1) return matches[0]!;
  throw new OstackError("unknown_question", `No single setup question "${id}".`, { questions: questions.map((question) => question.id) });
}

export async function setupCommand(args: Args): Promise<void> {
  const workspace = await loadWorkspace();
  const sub = args.positionals[1] ?? "status";
  const version = await readVersion();
  if (sub === "status") return print(await setupStatus(workspace));
  if (sub === "answer") {
    const question = await findQuestion(workspace, args.positionals[2] ?? required(args, "question"));
    workspace.state.answered[question.id] = { version, skipped: args.flags.skip === true };
    await writeState(workspace.root, workspace.state);
    print({ answered: question.id, skipped: args.flags.skip === true });
    return;
  }
  if (sub === "tidy") {
    // Moves step notes from before modules into their module's folder. Never overwrites a note already there.
    const moved: { from: string; to: string }[] = [];
    const kept: { path: string; reason: string }[] = [];
    for (const { path, move_to } of (await setupStatus(workspace)).misplaced_notes) {
      if (existsSync(move_to)) {
        kept.push({ path, reason: `${move_to} already exists; merge them by hand` });
        continue;
      }
      if (args.flags["dry-run"] !== true) {
        mkdirSync(dirname(move_to), { recursive: true });
        renameSync(path, move_to);
      }
      moved.push({ from: path, to: move_to });
    }
    print({ dry_run: args.flags["dry-run"] === true, moved, kept });
    return;
  }
  if (sub === "reviewed") {
    workspace.state.reviewed = version;
    await writeState(workspace.root, workspace.state);
    print({ reviewed: version });
    return;
  }
  if (sub === "reset") {
    const id = optional(args, "question");
    if (id) delete workspace.state.answered[(await findQuestion(workspace, id)).id];
    else workspace.state.answered = {};
    await writeState(workspace.root, workspace.state);
    print({ reset: id ?? "all" });
    return;
  }
  throw new OstackError("unknown_command", "Use: ostack setup status|answer <question> [--skip]|tidy [--dry-run]|reviewed|reset [--question <id>].");
}
