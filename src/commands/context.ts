import type { Database } from "bun:sqlite";
import { optional, type Args } from "../lib/args.ts";
import { openLedger } from "../lib/db.ts";
import { checkName, DEFAULT_CAMPAIGN, loadWorkspace, type Workspace } from "../lib/workspace.ts";

export type Context = { workspace: Workspace; db: Database };

export async function openContext(): Promise<Context> {
  const workspace = await loadWorkspace();
  return { workspace, db: openLedger(workspace.ledgerPath) };
}

export function campaignOf(args: Args): string {
  return checkName(optional(args, "campaign") ?? DEFAULT_CAMPAIGN, "campaign");
}
