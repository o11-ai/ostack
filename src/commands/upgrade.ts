import { join } from "node:path";
import { OstackError } from "../lib/errors.ts";
import { print } from "../lib/output.ts";
import { REPO_ROOT } from "../lib/workspace.ts";

export async function readVersion(): Promise<string> {
  const pkg: unknown = await Bun.file(join(REPO_ROOT, "package.json")).json();
  return typeof pkg === "object" && pkg !== null && "version" in pkg && typeof pkg.version === "string" ? pkg.version : "unknown";
}

/** Skills and the CLI are symlinked from this checkout, so a fast-forward pull upgrades every agent at once. */
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
  print({
    root: REPO_ROOT,
    from: before,
    to: await readVersion(),
    git: pull.stdout.toString().trim(),
    relinked: setup.exitCode === 0,
  });
}
