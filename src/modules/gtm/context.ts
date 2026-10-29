import type { Database } from "bun:sqlite";
import { optional, type Args } from "../../lib/args.ts";
import { checkName, DEFAULT_CAMPAIGN, ledgerPath, loadWorkspace, requireModule, type Workspace } from "../../lib/workspace.ts";
import { openLedger } from "./db.ts";
import { readSettings, type GtmSettings } from "./settings.ts";

export type Context = { workspace: Workspace; db: Database; settings: GtmSettings };

export async function openContext(): Promise<Context> {
  const workspace = await loadWorkspace();
  requireModule(workspace, "gtm");
  const settings = readSettings(workspace.state.modules.gtm!.settings);
  return { workspace, db: openLedger(ledgerPath(workspace, "gtm")), settings };
}

export function campaignOf(args: Args): string {
  return checkName(optional(args, "campaign") ?? DEFAULT_CAMPAIGN, "campaign");
}
