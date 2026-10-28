import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { OstackError } from "./errors.ts";

export const WORKSPACE_FILE = "ostack.yaml";
export const PLAYBOOKS_DIR = "playbooks";

/** Root of the ostack checkout, used for templates and upgrades. */
export const REPO_ROOT = resolve(import.meta.dir, "../..");

export type Workspace = {
  root: string;
  defaultPlaybook: string | null;
  ledgerPath: string;
};

export function findWorkspaceRoot(start: string): string | null {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, WORKSPACE_FILE))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function loadWorkspace(): Promise<Workspace> {
  const start = process.env.OSTACK_WORKSPACE ?? process.cwd();
  const root = findWorkspaceRoot(start);
  if (!root) {
    throw new OstackError(
      "no_workspace",
      `No ${WORKSPACE_FILE} found in ${start} or its parents. Run "ostack init" or pass --workspace.`,
    );
  }
  const raw = Bun.YAML.parse(await Bun.file(join(root, WORKSPACE_FILE)).text());
  const config = isRecord(raw) ? raw : {};
  const ledger = typeof config.ledger === "string" ? config.ledger : ".ostack/ledger.db";
  const defaultPlaybook = typeof config.default_playbook === "string" ? config.default_playbook : null;
  return { root, defaultPlaybook, ledgerPath: resolve(root, ledger) };
}

export async function listPlaybooks(workspace: Workspace): Promise<string[]> {
  const dir = join(workspace.root, PLAYBOOKS_DIR);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, "playbook.yaml")))
    .map((entry) => entry.name)
    .sort();
}

export async function resolvePlaybookName(workspace: Workspace, requested?: string): Promise<string> {
  const available = await listPlaybooks(workspace);
  const name = requested ?? workspace.defaultPlaybook ?? (available.length === 1 ? available[0] : undefined);
  if (!name) {
    throw new OstackError("playbook_required", "Pass --playbook; this workspace has several.", { available });
  }
  if (!available.includes(name)) {
    throw new OstackError("playbook_not_found", `No playbook named "${name}".`, { available });
  }
  return name;
}

export function playbookDir(workspace: Workspace, name: string): string {
  return join(workspace.root, PLAYBOOKS_DIR, name);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
