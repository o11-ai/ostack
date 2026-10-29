import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { OstackError } from "./errors.ts";
import { readState, STATE_FILE, writeState, type State } from "./state.ts";

export const CUSTOM_DIR = "custom";
export const LOCAL_DIR = "custom.local";
export const CAMPAIGNS_DIR = "campaigns";
export const PACKS_DIR = "packs";
export const DEFAULT_CAMPAIGN = "main";

export type Workspace = { root: string; state: State };

export function findWorkspaceRoot(start: string): string | null {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, STATE_FILE))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function loadWorkspace(): Promise<Workspace> {
  const start = process.env.OSTACK_WORKSPACE ?? process.cwd();
  const root = findWorkspaceRoot(start);
  if (!root) {
    const known = knownWorkspaces();
    const hint = known.length > 0 ? ` Known workspaces: ${known.join(", ")}. cd into one, or pass --workspace.` : ' Run "ostack init" or pass --workspace.';
    throw new OstackError("no_workspace", `No ${STATE_FILE} found in ${start} or its parents.${hint}`, { known });
  }
  const { state, migrated } = await readState(root);
  if (migrated) await writeState(root, state);
  rememberWorkspace(root);
  return { root, state };
}

export function enabledModules(workspace: Workspace): string[] {
  return Object.keys(workspace.state.modules).sort();
}

export function requireModule(workspace: Workspace, id: string): void {
  if (!workspace.state.modules[id]) {
    throw new OstackError("module_not_enabled", `The ${id} module is not enabled in this workspace. Run "ostack modules add ${id}".`);
  }
}

/** Each module keeps its own ledger. The 0.2/0.3 ledger.db belonged to gtm and is renamed on first use. */
export function ledgerPath(workspace: Workspace, module: string): string {
  const dir = join(workspace.root, ".ostack");
  const path = join(dir, `${module}.db`);
  const legacy = join(dir, "ledger.db");
  if (module === "gtm" && !existsSync(path) && existsSync(legacy)) {
    for (const suffix of ["", "-wal", "-shm"]) if (existsSync(legacy + suffix)) renameSync(legacy + suffix, path + suffix);
  }
  return path;
}

/** Workspaces created on this machine, so an agent opened elsewhere can find them. */
const REGISTRY = () => join(homedir(), ".ostack", "workspaces");

export function knownWorkspaces(): string[] {
  if (!existsSync(REGISTRY())) return [];
  const lines = readFileSync(REGISTRY(), "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
  return [...new Set(lines)].filter((root) => existsSync(join(root, STATE_FILE)));
}

export function rememberWorkspace(root: string): void {
  if (knownWorkspaces().includes(root)) return;
  mkdirSync(dirname(REGISTRY()), { recursive: true });
  appendFileSync(REGISTRY(), `${root}\n`);
}

export function checkName(value: string, what: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) {
    throw new OstackError("invalid_flag", `A ${what} name must be lowercase letters, numbers and dashes.`);
  }
  return value;
}
