import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { OstackError } from "./errors.ts";
import { readState, STATE_FILE, type State } from "./settings.ts";

export const CUSTOM_DIR = "custom";
export const LOCAL_DIR = "custom.local";
export const CAMPAIGNS_DIR = "campaigns";
export const PACKS_DIR = "packs";
export const DEFAULT_CAMPAIGN = "main";

export type Workspace = { root: string; ledgerPath: string; state: State };

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
  const state = await readState(root);
  rememberWorkspace(root);
  return { root, ledgerPath: join(root, ".ostack", "ledger.db"), state };
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

/** Campaigns with their own notes folder. The default campaign needs none. */
export async function listCampaigns(workspace: Workspace): Promise<string[]> {
  const dir = join(workspace.root, CAMPAIGNS_DIR);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}
