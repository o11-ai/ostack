import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { openLedger } from "../modules/gtm/db.ts";
import { print } from "../lib/output.ts";
import { REPO_ROOT } from "../lib/paths.ts";
import { compareVersions } from "../lib/version.ts";
import { CUSTOM_DIR, enabledModules, ledgerPath, loadWorkspace } from "../lib/workspace.ts";
import { setupStatus } from "./customize.ts";

type Check = { check: string; status: "ok" | "warn" | "fail"; detail: string };

export const SKILL_HOSTS: Record<string, string> = {
  claude: ".claude/skills",
  codex: ".codex/skills",
  cursor: ".cursor/skills",
  gemini: ".gemini/skills",
};

const MIN_BUN = "1.2.21";

export async function doctorCommand(): Promise<void> {
  const checks: Check[] = [];
  const bunOk = compareVersions(Bun.version, MIN_BUN) >= 0;
  checks.push({ check: "bun", status: bunOk ? "ok" : "fail", detail: `${Bun.version} (needs ${MIN_BUN}+)` });

  const onPath = Bun.which("ostack");
  checks.push({
    check: "cli on PATH",
    status: onPath ? "ok" : "warn",
    detail: onPath ?? `Not found. Run ${join(REPO_ROOT, "setup")} or add ~/.local/bin to PATH.`,
  });

  const hosts = Object.entries(SKILL_HOSTS)
    .filter(([, dir]) => existsSync(join(homedir(), dir, "ostack-setup", "SKILL.md")))
    .map(([host]) => host);
  checks.push({
    check: "skills installed",
    status: hosts.length > 0 ? "ok" : "warn",
    detail: hosts.length > 0 ? hosts.join(", ") : `No agent has the skills. Run ${join(REPO_ROOT, "setup")}.`,
  });

  try {
    const workspace = await loadWorkspace();
    checks.push({ check: "workspace", status: "ok", detail: workspace.root });
    checks.push({ check: "modules", status: "ok", detail: enabledModules(workspace).join(", ") || "none" });
    if (workspace.state.modules.gtm) {
      try {
        openLedger(ledgerPath(workspace, "gtm")).close();
        checks.push({ check: "gtm ledger", status: "ok", detail: ledgerPath(workspace, "gtm") });
      } catch (error) {
        checks.push({ check: "gtm ledger", status: "fail", detail: message(error) });
      }
    }
    if (!existsSync(join(workspace.root, CUSTOM_DIR, "about.md"))) {
      checks.push({ check: "setup", status: "warn", detail: 'No custom/about.md yet. Ask your agent to "set up ostack".' });
    }
    const status = await setupStatus(workspace);
    const open = [
      status.pending_questions.length > 0 && `${status.pending_questions.length} setup question(s) to ask`,
      status.changed_defaults.length > 0 && `${status.changed_defaults.length} customized step(s) whose default changed`,
      status.unknown_steps.length > 0 && `${status.unknown_steps.length} note(s) for unknown steps`,
      status.misplaced_notes.length > 0 && `${status.misplaced_notes.length} note(s) to move into their module's folder`,
    ].filter(Boolean);
    checks.push({
      check: "customizations",
      status: open.length > 0 ? "warn" : "ok",
      detail: open.length > 0 ? `${open.join("; ")}. Run the ostack-setup skill to review.` : `up to date with ${status.version}`,
    });
    const uninstalled = Object.entries(workspace.state.schedules).filter(([, entry]) => entry.enabled && Object.keys(entry.installed).length === 0);
    checks.push({
      check: "schedules",
      status: uninstalled.length > 0 ? "warn" : "ok",
      detail:
        uninstalled.length > 0
          ? `${uninstalled.map(([ref]) => ref).join(", ")} scheduled but not created in Claude, Codex or cron yet. Run "ostack schedule spec <workflow> --host <host>".`
          : `${Object.values(workspace.state.schedules).filter((entry) => entry.enabled).length} enabled (${workspace.state.timezone})`,
    });
  } catch (error) {
    checks.push({ check: "workspace", status: "warn", detail: message(error) });
  }

  print({ ok: checks.every((check) => check.status !== "fail"), checks });
  if (checks.some((check) => check.status === "fail")) process.exitCode = 1;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
