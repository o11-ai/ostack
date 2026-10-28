import type { Database } from "bun:sqlite";
import { optional, type Args } from "../lib/args.ts";
import { openLedger } from "../lib/db.ts";
import { loadPlaybook, type LoadedPlaybook } from "../lib/playbook.ts";
import { loadWorkspace, resolvePlaybookName, type Workspace } from "../lib/workspace.ts";

export type Context = { workspace: Workspace; db: Database };

export async function openContext(): Promise<Context> {
  const workspace = await loadWorkspace();
  return { workspace, db: openLedger(workspace.ledgerPath) };
}

export async function selectedPlaybook(context: Context, args: Args): Promise<LoadedPlaybook> {
  const name = await resolvePlaybookName(context.workspace, optional(args, "playbook"));
  return loadPlaybook(context.workspace, name);
}
