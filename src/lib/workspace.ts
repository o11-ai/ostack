import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
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
    throw new OstackError("no_workspace", `No ${STATE_FILE} found in ${start} or its parents. Run "ostack init" or pass --workspace.`);
  }
  return { root, ledgerPath: join(root, ".ostack", "ledger.db"), state: await readState(root) };
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
