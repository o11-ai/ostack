import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { print } from "../../lib/output.ts";
import { CAMPAIGNS_DIR, loadWorkspace } from "../../lib/workspace.ts";

/** Campaigns with their own notes folder. The default campaign needs none. */
export async function campaignsCommand(): Promise<void> {
  const workspace = await loadWorkspace();
  const dir = join(workspace.root, CAMPAIGNS_DIR);
  const entries = existsSync(dir) ? await readdir(dir, { withFileTypes: true }) : [];
  print({ default: "main", with_notes: entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort() });
}
