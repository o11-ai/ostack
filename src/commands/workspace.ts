import { existsSync } from "node:fs";
import { appendFile, cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { optional, type Args } from "../lib/args.ts";
import { OstackError } from "../lib/errors.ts";
import { print, printText } from "../lib/output.ts";
import { loadPlaybook } from "../lib/playbook.ts";
import {
  findWorkspaceRoot,
  listPlaybooks,
  loadWorkspace,
  PLAYBOOKS_DIR,
  REPO_ROOT,
  resolvePlaybookName,
  WORKSPACE_FILE,
} from "../lib/workspace.ts";

const TEMPLATES_DIR = join(REPO_ROOT, "playbooks");

export async function listTemplates(): Promise<string[]> {
  const entries = await readdir(TEMPLATES_DIR, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

export async function templatesCommand(): Promise<void> {
  print(await listTemplates());
}

/** Creates a workspace (if needed) and a playbook copied from a template. */
export async function initCommand(args: Args): Promise<void> {
  const target = resolve(optional(args, "dir") ?? process.cwd());
  const root = findWorkspaceRoot(target) ?? target;
  const template = optional(args, "from") ?? "b2b-founders";
  const name = optional(args, "playbook") ?? template;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new OstackError("invalid_flag", "--playbook must be lowercase letters, numbers and dashes.");
  }
  const templates = await listTemplates();
  if (!templates.includes(template)) {
    throw new OstackError("template_not_found", `No template named "${template}".`, { templates });
  }
  const destination = join(root, PLAYBOOKS_DIR, name);
  if (existsSync(destination)) throw new OstackError("playbook_exists", `${destination} already exists.`);

  await mkdir(root, { recursive: true });
  const workspaceFile = join(root, WORKSPACE_FILE);
  const createdWorkspace = !existsSync(workspaceFile);
  if (createdWorkspace) {
    await writeFile(workspaceFile, `# ostack workspace\ndefault_playbook: ${name}\nledger: .ostack/ledger.db\n`);
  }
  const gitignore = join(root, ".gitignore");
  const ignored = existsSync(gitignore) ? await readFile(gitignore, "utf8") : "";
  if (!ignored.split("\n").includes(".ostack/")) {
    await appendFile(gitignore, `${ignored && !ignored.endsWith("\n") ? "\n" : ""}.ostack/\n`);
  }
  await cp(join(TEMPLATES_DIR, template), destination, { recursive: true });
  const playbookFile = join(destination, "playbook.yaml");
  const yaml = await readFile(playbookFile, "utf8");
  await writeFile(playbookFile, yaml.replace(/^name: .*$/m, `name: ${name}`));
  print({
    workspace: root,
    created_workspace: createdWorkspace,
    playbook: name,
    template,
    files: ["playbook.yaml", "offer.md", "voice.md"].map((file) => join(destination, file)),
    next: "Edit the three files (or run the ostack-setup skill), then run: ostack playbook check",
  });
}

export async function playbookCommand(args: Args): Promise<void> {
  const sub = args.positionals[1];
  const workspace = await loadWorkspace();
  if (sub === "list") {
    print({ default: workspace.defaultPlaybook, playbooks: await listPlaybooks(workspace) });
    return;
  }
  const name = await resolvePlaybookName(workspace, optional(args, "playbook"));
  const loaded = await loadPlaybook(workspace, name);
  if (sub === "check") {
    print({ ok: true, playbook: loaded.playbook });
    return;
  }
  if (sub === "show") {
    print({
      ...loaded.playbook,
      offer: await readFile(loaded.offerPath, "utf8"),
      voice: await readFile(loaded.voicePath, "utf8"),
    });
    return;
  }
  throw new OstackError("unknown_command", "Use: ostack playbook list|check|show.");
}

/** The instruction a scheduler (Claude, Codex, cron) passes to the agent each run. */
export async function promptCommand(args: Args): Promise<void> {
  const workspace = await loadWorkspace();
  const name = await resolvePlaybookName(workspace, optional(args, "playbook"));
  const { playbook } = await loadPlaybook(workspace, name);
  printText(
    [
      `Use the cold-outbound skill to run the "${name}" playbook in ${workspace.root} (mode: ${playbook.mode}).`,
      `Work in that folder. Start with "ostack due --playbook ${name}" and handle each queue it returns until next is "done" or every source is exhausted.`,
      "This is a scheduled run: do not ask questions mid-run. Defer problem leads with a reason and continue.",
      "Finish with counts: replies handled, follow-ups, new touches, leads qualified and disqualified, and anything unresolved.",
    ].join("\n"),
  );
}
