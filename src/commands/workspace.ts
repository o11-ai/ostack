import { existsSync } from "node:fs";
import { appendFile, cp, mkdir, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { optional, required, type Args } from "../lib/args.ts";
import { OstackError } from "../lib/errors.ts";
import { describePack, packDir, type PackInfo } from "../lib/layers.ts";
import { findWorkflow, getModule, loadModules } from "../lib/modules.ts";
import { print, printText } from "../lib/output.ts";
import { defaultState, STATE_FILE, writeState, type State } from "../lib/state.ts";
import { checkTimeZone } from "../lib/time.ts";
import { readVersion } from "../lib/version.ts";
import { checkName, CUSTOM_DIR, enabledModules, findWorkspaceRoot, loadWorkspace, LOCAL_DIR, PACKS_DIR, rememberWorkspace, type Workspace } from "../lib/workspace.ts";
import { MODULE_CODE } from "../modules/index.ts";

const IGNORED = [".ostack/", `${LOCAL_DIR}/`];

/** Creates an empty workspace. Everything specific to the user is added later by the ostack-setup interview. */
export async function initCommand(args: Args): Promise<void> {
  const root = resolve(optional(args, "dir") ?? process.cwd());
  const existing = findWorkspaceRoot(root);
  if (existing) throw new OstackError("workspace_exists", `${existing} is already an ostack workspace.`, { root: existing });
  const shipped = (await loadModules()).map((module) => module.id);
  const modules = list(optional(args, "modules")) ?? shipped;
  for (const module of modules) await getModule(module);
  await mkdir(join(root, CUSTOM_DIR), { recursive: true });
  await mkdir(join(root, LOCAL_DIR), { recursive: true });
  const state = defaultState(await readVersion(), modules);
  for (const module of modules) state.modules[module]!.settings = MODULE_CODE[module]?.settings?.initial() ?? {};
  const timezone = optional(args, "timezone");
  if (timezone) state.timezone = checkTimeZone(timezone);
  for (const name of list(optional(args, "packs")) ?? []) {
    const { module, pack } = await resolvePack({ root, state }, name);
    state.modules[module]!.packs.push(pack);
  }
  await writeState(root, state);
  rememberWorkspace(root);
  const gitignore = join(root, ".gitignore");
  const ignored = existsSync(gitignore) ? await readFile(gitignore, "utf8") : "";
  const missing = IGNORED.filter((line) => !ignored.split("\n").includes(line));
  if (missing.length > 0) await appendFile(gitignore, `${ignored && !ignored.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`);
  print({
    workspace: root,
    modules,
    timezone: state.timezone,
    files: [join(root, STATE_FILE), join(root, CUSTOM_DIR), join(root, LOCAL_DIR)],
    next: `Agents: work in ${root} (cd there), then run "ostack setup status". People: ask your agent to "set up ostack" so it can interview you.`,
  });
}

function list(value: string | undefined): string[] | undefined {
  return value?.split(",").map((item) => item.trim()).filter(Boolean);
}

/** "gtm/gmail", or "gmail" when exactly one enabled module ships or holds a pack by that name. */
async function resolvePack(workspace: Pick<Workspace, "root" | "state">, name: string): Promise<{ module: string; pack: string }> {
  const [first, second] = name.split("/");
  if (second) return { module: first!, pack: checkName(second, "pack") };
  const hits: string[] = [];
  for (const module of Object.keys(workspace.state.modules)) {
    if (await packDir(workspace as Workspace, module, checkName(first!, "pack"))) hits.push(module);
  }
  if (hits.length === 1) return { module: hits[0]!, pack: first! };
  throw new OstackError(hits.length === 0 ? "pack_not_found" : "ambiguous_pack", `No single pack named "${name}". Use <module>/<pack>.`, {
    packs: await shippedPacks(Object.keys(workspace.state.modules)),
  });
}

async function shippedPacks(modules: string[]): Promise<string[]> {
  const names: string[] = [];
  for (const module of await loadModules()) {
    if (!modules.includes(module.id)) continue;
    const dir = join(module.dir, "packs");
    if (!existsSync(dir)) continue;
    for (const entry of await readdir(dir, { withFileTypes: true })) if (entry.isDirectory()) names.push(`${module.id}/${entry.name}`);
  }
  return names.sort();
}

export async function packsCommand(args: Args): Promise<void> {
  const sub = args.positionals[1] ?? "list";
  const workspace = await loadWorkspace();
  const modules = enabledModules(workspace);
  if (sub === "list") {
    const available: PackInfo[] = [];
    for (const ref of await shippedPacks(modules)) {
      const [module, name] = ref.split("/") as [string, string];
      available.push(await describePack(join((await getModule(module)).dir, "packs", name), module, name, true));
    }
    const installed = Object.fromEntries(modules.map((module) => [module, workspace.state.modules[module]!.packs]));
    print({ installed, available });
    return;
  }
  const { module, pack } = await resolvePack(workspace, args.positionals[2] ?? required(args, "name"));
  const state = workspace.state.modules[module];
  if (!state) throw new OstackError("module_not_enabled", `The ${module} module is not enabled. Run "ostack modules add ${module}".`);
  if (sub === "add") {
    const from = optional(args, "from");
    if (from) {
      const destination = join(workspace.root, PACKS_DIR, module, pack);
      if (existsSync(destination)) throw new OstackError("pack_exists", `${destination} already exists.`);
      await cp(resolve(from), destination, { recursive: true });
    }
    if (!(await packDir(workspace, module, pack))) throw new OstackError("pack_not_found", `No pack named "${pack}". Pass --from <folder> for your own.`);
    state.packs = [...state.packs.filter((item) => item !== pack), pack];
    await writeState(workspace.root, workspace.state);
    print({ module, installed: state.packs, note: "Later packs take priority over earlier ones; your own notes take priority over every pack." });
    return;
  }
  if (sub === "remove") {
    if (!state.packs.includes(pack)) throw new OstackError("pack_not_installed", `Pack "${pack}" is not installed.`, { installed: state.packs });
    state.packs = state.packs.filter((item) => item !== pack);
    await writeState(workspace.root, workspace.state);
    print({ module, installed: state.packs });
    return;
  }
  if (sub === "show") {
    const dir = await packDir(workspace, module, pack);
    if (!dir) throw new OstackError("pack_not_found", `No pack named "${pack}".`);
    const files = (await readdir(dir)).filter((file) => file.endsWith(".md")).sort();
    print({
      ...(await describePack(dir, module, pack, dir.startsWith((await getModule(module)).dir))),
      files: await Promise.all(files.map(async (file) => ({ file, text: await Bun.file(join(dir, file)).text() }))),
    });
    return;
  }
  throw new OstackError("unknown_command", "Use: ostack packs list|add|remove|show <name>.");
}

/** Which modules this workspace uses. Adding one is additive: its notes, settings and ledger start empty. */
export async function modulesCommand(args: Args): Promise<void> {
  const sub = args.positionals[1] ?? "list";
  const workspace = await loadWorkspace();
  const state: State = workspace.state;
  if (sub === "list") {
    const all = await loadModules();
    print({
      enabled: enabledModules(workspace),
      available: all.map((module) => ({ id: module.id, name: module.name, summary: module.summary, workflows: module.workflows.map((workflow) => workflow.ref) })),
    });
    return;
  }
  const id = args.positionals[2] ?? required(args, "name");
  await getModule(id);
  if (sub === "add") {
    state.modules[id] ??= { packs: [], settings: MODULE_CODE[id]?.settings?.initial() ?? {} };
    await writeState(workspace.root, state);
    print({ enabled: enabledModules(workspace), next: `Ask your agent to "set up ostack" to answer the ${id} questions.` });
    return;
  }
  if (sub === "remove") {
    // Its ledger, notes and schedules stay on disk, so adding it back picks up where it left off.
    delete state.modules[id];
    await writeState(workspace.root, state);
    print({ enabled: enabledModules(workspace), kept: [join(workspace.root, ".ostack", `${id}.db`), join(workspace.root, CUSTOM_DIR, id)] });
    return;
  }
  throw new OstackError("unknown_command", "Use: ostack modules list|add <id>|remove <id>.");
}

/**
 * The instruction a scheduled run follows. Schedulers store only a short line that calls this, so the instruction
 * stays current after an upgrade without editing any scheduled task.
 */
export async function promptCommand(args: Args): Promise<void> {
  const workspace = await loadWorkspace();
  const workflow = await findWorkflow(args.positionals[1] ?? required(args, "workflow"), enabledModules(workspace));
  const campaign = optional(args, "campaign") ?? "main";
  const settings = workspace.state.modules[workflow.module]?.settings ?? {};
  const mode = typeof settings.mode === "string" ? ` (mode: ${settings.mode})` : "";
  printText(
    [
      `Use the ${workflow.skill} skill for the "${campaign}" campaign in ${workspace.root}${mode}.`,
      campaign === "main" ? "Work in that folder." : `Work in that folder and pass --campaign ${campaign} to every ostack command that takes it.`,
      `This is a scheduled run of ${workflow.ref}. Nobody is present: do not ask questions. Defer problem items with a reason and continue.`,
      `Start with \`ostack run start ${workflow.ref} --scheduled\`. If it reports run_in_progress or not_due, stop and report only that line. Otherwise end with \`ostack run end ${workflow.ref}\`.`,
      "Finish with the report the skill asks for, plus anything unresolved.",
    ].join("\n"),
  );
}
