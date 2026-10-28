import { join } from "node:path";
import { OstackError } from "../lib/errors.ts";
import { print } from "../lib/output.ts";
import { REPO_ROOT } from "../lib/paths.ts";
import { readVersion } from "../lib/version.ts";

/**
 * Skills, steps and shipped packs are symlinked or read from this checkout, so a fast-forward pull upgrades every agent
 * at once. Nothing in a workspace is touched: the next run notices what changed and the setup skill reviews it with the user.
 */
export async function upgradeCommand(): Promise<void> {
  const before = await readVersion();
  const pull = Bun.spawnSync(["git", "-C", REPO_ROOT, "pull", "--ff-only"], { stdout: "pipe", stderr: "pipe" });
  if (pull.exitCode !== 0) {
    throw new OstackError("upgrade_failed", "git pull --ff-only failed in the ostack checkout.", {
      root: REPO_ROOT,
      stderr: pull.stderr.toString().trim(),
    });
  }
  const setup = Bun.spawnSync([join(REPO_ROOT, "setup"), "--relink"], { stdout: "pipe", stderr: "pipe" });
  const after = await readVersion();
  print({
    root: REPO_ROOT,
    from: before,
    to: after,
    git: pull.stdout.toString().trim(),
    relinked: setup.exitCode === 0,
    next: before === after ? "Already up to date." : 'In each workspace, ask your agent to "review ostack updates" (ostack setup status lists what is new).',
  });
}
