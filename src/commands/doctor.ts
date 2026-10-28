import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { openLedger } from "../lib/db.ts";
import { OstackError } from "../lib/errors.ts";
import { print } from "../lib/output.ts";
import { EXAMPLE_MARKER, loadPlaybook } from "../lib/playbook.ts";
import { listPlaybooks, loadWorkspace, REPO_ROOT } from "../lib/workspace.ts";

type Check = { check: string; status: "ok" | "warn" | "fail"; detail: string };

export const SKILL_HOSTS: Record<string, string> = {
  claude: ".claude/skills",
  codex: ".codex/skills",
  cursor: ".cursor/skills",
  gemini: ".gemini/skills",
};

const MIN_BUN = [1, 2, 21];

export async function doctorCommand(): Promise<void> {
  const checks: Check[] = [];
  const bun = Bun.version.split(".").map(Number);
  const bunOk = compare(bun, MIN_BUN) >= 0;
  checks.push({ check: "bun", status: bunOk ? "ok" : "fail", detail: `${Bun.version} (needs ${MIN_BUN.join(".")}+)` });

  const onPath = Bun.which("ostack");
  checks.push({
    check: "cli on PATH",
    status: onPath ? "ok" : "warn",
    detail: onPath ?? `Not found. Run ${join(REPO_ROOT, "setup")} or add ~/.local/bin to PATH.`,
  });

  const hosts = Object.entries(SKILL_HOSTS)
    .filter(([, dir]) => existsSync(join(homedir(), dir, "cold-outbound", "SKILL.md")))
    .map(([host]) => host);
  checks.push({
    check: "skills installed",
    status: hosts.length > 0 ? "ok" : "warn",
    detail: hosts.length > 0 ? hosts.join(", ") : `No agent has the skills. Run ${join(REPO_ROOT, "setup")}.`,
  });

  try {
    const workspace = await loadWorkspace();
    checks.push({ check: "workspace", status: "ok", detail: workspace.root });
    try {
      openLedger(workspace.ledgerPath).close();
      checks.push({ check: "ledger", status: "ok", detail: workspace.ledgerPath });
    } catch (error) {
      checks.push({ check: "ledger", status: "fail", detail: message(error) });
    }
    const playbooks = await listPlaybooks(workspace);
    if (playbooks.length === 0) checks.push({ check: "playbooks", status: "fail", detail: 'None. Run "ostack init".' });
    for (const name of playbooks) {
      try {
        const loaded = await loadPlaybook(workspace, name);
        const untouched = [];
        for (const path of [join(loaded.dir, "playbook.yaml"), loaded.offerPath, loaded.voicePath]) {
          if ((await readFile(path, "utf8")).includes(EXAMPLE_MARKER)) untouched.push(path.split("/").pop());
        }
        checks.push({
          check: `playbook ${name}`,
          status: untouched.length > 0 ? "warn" : "ok",
          detail: untouched.length > 0 ? `Still the template: edit ${untouched.join(", ")}.` : `valid, mode ${loaded.playbook.mode}`,
        });
      } catch (error) {
        const details = error instanceof OstackError ? error.details?.errors : undefined;
        checks.push({ check: `playbook ${name}`, status: "fail", detail: Array.isArray(details) ? details.join(" ") : message(error) });
      }
    }
  } catch (error) {
    checks.push({ check: "workspace", status: "warn", detail: message(error) });
  }

  print({ ok: checks.every((check) => check.status !== "fail"), checks });
  if (checks.some((check) => check.status === "fail")) process.exitCode = 1;
}

function compare(a: number[], b: number[]): number {
  for (let index = 0; index < b.length; index++) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
