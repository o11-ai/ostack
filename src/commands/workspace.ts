import { existsSync } from "node:fs";
import { appendFile, cp, mkdir, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { optional, required, type Args } from "../lib/args.ts";
import { OstackError } from "../lib/errors.ts";
import { describePack, packDir, SHIPPED_PACKS_DIR, type PackInfo } from "../lib/layers.ts";
import { print, printText } from "../lib/output.ts";
import { defaultState, STATE_FILE, writeState } from "../lib/settings.ts";
import { readVersion } from "../lib/version.ts";
import {
  checkName,
  CUSTOM_DIR,
  findWorkspaceRoot,
  listCampaigns,
  loadWorkspace,
  LOCAL_DIR,
  PACKS_DIR,
} from "../lib/workspace.ts";
import { campaignOf } from "./context.ts";

const IGNORED = [".ostack/", `${LOCAL_DIR}/`];

/** Creates an empty workspace. Everything specific to the user is added later by the ostack-setup interview. */
export async function initCommand(args: Args): Promise<void> {
  const root = resolve(optional(args, "dir") ?? process.cwd());
  const existing = findWorkspaceRoot(root);
  if (existing) throw new OstackError("workspace_exists", `${existing} is already an ostack workspace.`, { root: existing });
  await mkdir(join(root, CUSTOM_DIR), { recursive: true });
  await mkdir(join(root, LOCAL_DIR), { recursive: true });
  const state = defaultState(await readVersion());
  const packs = (optional(args, "packs") ?? "").split(",").map((pack) => pack.trim()).filter(Boolean);
  for (const pack of packs) {
    if (!existsSync(join(SHIPPED_PACKS_DIR, checkName(pack, "pack")))) {
      throw new OstackError("pack_not_found", `No pack named "${pack}".`, { packs: await shippedPacks() });
    }
  }
  await writeState(root, { ...state, packs });
  const gitignore = join(root, ".gitignore");
  const ignored = existsSync(gitignore) ? await readFile(gitignore, "utf8") : "";
  const missing = IGNORED.filter((line) => !ignored.split("\n").includes(line));
  if (missing.length > 0) await appendFile(gitignore, `${ignored && !ignored.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`);
  print({
    workspace: root,
    packs,
    files: [join(root, STATE_FILE), join(root, CUSTOM_DIR), join(root, LOCAL_DIR)],
    next: 'Ask your agent to "set up ostack" so it can interview you and write your customizations.',
  });
}

async function shippedPacks(): Promise<string[]> {
  const entries = await readdir(SHIPPED_PACKS_DIR, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

export async function packsCommand(args: Args): Promise<void> {
  const sub = args.positionals[1] ?? "list";
  const workspace = await loadWorkspace();
  const installed = workspace.state.packs;
  if (sub === "list") {
    const available: PackInfo[] = await Promise.all(
      (await shippedPacks()).map((name) => describePack(join(SHIPPED_PACKS_DIR, name), name, true)),
    );
    print({ installed, available });
    return;
  }
  const name = checkName(args.positionals[2] ?? required(args, "name"), "pack");
  if (sub === "add") {
    const from = optional(args, "from");
    if (from) {
      const destination = join(workspace.root, PACKS_DIR, name);
      if (existsSync(destination)) throw new OstackError("pack_exists", `${destination} already exists.`);
      await cp(resolve(from), destination, { recursive: true });
    }
    if (!packDir(workspace, name)) throw new OstackError("pack_not_found", `No pack named "${name}". Pass --from <folder> for your own.`);
    const packs = [...installed.filter((pack) => pack !== name), name];
    await writeState(workspace.root, { ...workspace.state, packs });
    print({ installed: packs, note: "Later packs take priority over earlier ones; your own notes take priority over every pack." });
    return;
  }
  if (sub === "remove") {
    if (!installed.includes(name)) throw new OstackError("pack_not_installed", `Pack "${name}" is not installed.`, { installed });
    const packs = installed.filter((pack) => pack !== name);
    await writeState(workspace.root, { ...workspace.state, packs });
    print({ installed: packs });
    return;
  }
  if (sub === "show") {
    const dir = packDir(workspace, name);
    if (!dir) throw new OstackError("pack_not_found", `No pack named "${name}".`);
    const files = (await readdir(dir)).filter((file) => file.endsWith(".md")).sort();
    print({
      ...(await describePack(dir, name, dir.startsWith(SHIPPED_PACKS_DIR))),
      files: await Promise.all(files.map(async (file) => ({ file, text: await Bun.file(join(dir, file)).text() }))),
    });
    return;
  }
  throw new OstackError("unknown_command", "Use: ostack packs list|add|remove|show <name>.");
}

export async function campaignsCommand(): Promise<void> {
  const workspace = await loadWorkspace();
  print({ default: "main", with_notes: await listCampaigns(workspace) });
}

const SKILLS = ["outbound", "follow-ups"] as const;

/** The instruction a scheduler (Claude, Codex, cron) passes to the agent each run. */
export async function promptCommand(args: Args): Promise<void> {
  const skill = args.positionals[1] ?? "outbound";
  if (!(SKILLS as readonly string[]).includes(skill)) {
    throw new OstackError("invalid_flag", `Use: ostack prompt ${SKILLS.join("|")} [--campaign <name>].`);
  }
  const workspace = await loadWorkspace();
  const campaign = campaignOf(args);
  printText(
    [
      `Use the ${skill} skill for the "${campaign}" campaign in ${workspace.root} (mode: ${workspace.state.mode}).`,
      campaign === "main" ? "Work in that folder." : `Work in that folder and pass --campaign ${campaign} to every ostack command that takes it.`,
      "This is a scheduled run: do not ask questions mid-run. Defer problem leads with a reason and continue.",
      "Finish with the counts the skill asks for, plus anything unresolved.",
    ].join("\n"),
  );
}
