import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { oneOf, optional, required, type Args } from "../lib/args.ts";
import { OstackError } from "../lib/errors.ts";
import { findWorkflow, loadModules, type Workflow } from "../lib/modules.ts";
import { print } from "../lib/output.ts";
import { describeSchedule, isDue, parseSchedule, runsPerDay, shiftSchedule, toCron, toRRule, zoneOffset, type ScheduleSpec } from "../lib/schedule.ts";
import { writeState } from "../lib/state.ts";
import { systemTimeZone } from "../lib/time.ts";
import { enabledModules, loadWorkspace, type Workspace } from "../lib/workspace.ts";

export const HOSTS = ["claude", "codex", "cron"] as const;
type Host = (typeof HOSTS)[number];

async function workflows(workspace: Workspace): Promise<Workflow[]> {
  const enabled = enabledModules(workspace);
  return (await loadModules()).filter((module) => enabled.includes(module.id)).flatMap((module) => module.workflows);
}

/** The schedule a workflow runs on: the user's own, or the module's default until they set one. */
function effective(workspace: Workspace, workflow: Workflow): { spec: ScheduleSpec | null; enabled: boolean; source: "custom" | "default" } {
  const own = workspace.state.schedules[workflow.ref];
  if (own) return { spec: own.spec, enabled: own.enabled, source: "custom" };
  return { spec: workflow.schedule, enabled: false, source: "default" };
}

function taskName(workflow: Workflow): string {
  return `ostack-${workflow.module}-${workflow.id}`;
}

/** The whole instruction a scheduled task stores. It only calls `ostack prompt`, so upgrades never require editing the task. */
function instruction(workspace: Workspace, workflow: Workflow): string {
  return `Run \`ostack prompt ${workflow.ref}\` in ${workspace.root} and follow the instructions it prints exactly.`;
}

function view(workspace: Workspace, workflow: Workflow) {
  const { spec, enabled, source } = effective(workspace, workflow);
  const timezone = workspace.state.timezone;
  return {
    workflow: workflow.ref,
    summary: workflow.summary,
    enabled,
    source,
    schedule: spec ? describeSchedule(spec, timezone) : null,
    runs_per_day: spec ? runsPerDay(spec) : 0,
    cron: spec ? toCron(spec) : null,
    rrule: spec ? toRRule(spec) : null,
    installed: workspace.state.schedules[workflow.ref]?.installed ?? {},
  };
}

/** What to create in each host, so the agent creates exactly the same task wherever it runs. */
function hostSpec(workspace: Workspace, workflow: Workflow, host: Host) {
  const { spec } = effective(workspace, workflow);
  if (!spec) throw new OstackError("no_schedule", `${workflow.ref} has no schedule. Set one with "ostack schedule set ${workflow.ref}".`);
  const timezone = workspace.state.timezone;
  const base = { workflow: workflow.ref, name: taskName(workflow), folder: workspace.root, instructions: instruction(workspace, workflow), schedule: describeSchedule(spec, timezone) };
  const machine = systemTimeZone();
  // Claude Desktop and Codex read schedules in the computer's clock. When it differs from the workspace's, convert,
  // and rely on the run guard for the hour daylight saving can shift it by.
  const offset = machine === timezone ? 0 : zoneOffset(timezone, machine, new Date());
  const local = shiftSchedule(spec, offset);
  const timezoneNote =
    machine === timezone
      ? null
      : `This computer's clock is ${machine}, the workspace's is ${timezone}. The times below are converted to this computer's clock (${describeSchedule(local, machine)}). Each run checks the workspace time itself, so a daylight-saving shift never makes it act at the wrong hour.`;
  if (host === "claude") {
    return {
      ...base,
      host,
      where: "Claude Desktop, Code tab, Scheduled (a local task, so it can reach the workspace and your connectors)",
      cron: toCron(local),
      permission_mode: "Auto, or Accept edits with ostack and your mail/CRM tools always allowed after the first Run now",
      ask: `Create a local scheduled task named "${base.name}" in the folder ${base.folder}, running on the cron schedule "${toCron(local)}" in local time, with these instructions: ${base.instructions}`,
      after: `Click Run now once, approve each tool with "always allow", then run: ostack schedule installed ${workflow.ref} --host claude --name ${base.name}`,
      timezone_note: timezoneNote,
    };
  }
  if (host === "codex") {
    return {
      ...base,
      host,
      where: "Codex app, Automations (a standalone, local project automation on this folder, not a worktree)",
      rrule: toRRule(local),
      sandbox: "workspace-write with network access, so the run can reach your mail and CRM tools",
      ask: `Create a standalone automation named "${base.name}" for the project ${base.folder}, running locally (not in a worktree) on the schedule ${toRRule(local)}, with these instructions: ${base.instructions}`,
      after: `Run it once from the Automations page and check its result, then run: ostack schedule installed ${workflow.ref} --host codex --name ${base.name}`,
      timezone_note: timezoneNote,
    };
  }
  return { ...base, host, cron: toCron(spec), install: "ostack schedule cron install", timezone_note: timezoneNote };
}

const CRON_BEGIN = (root: string) => `# >>> ostack ${root}`;
const CRON_END = (root: string) => `# <<< ostack ${root}`;

/** The crontab block for every enabled schedule in this workspace. Each run starts the agent headless with the workspace prompt. */
async function cronBlock(workspace: Workspace, agent: "claude" | "codex"): Promise<string[]> {
  const ostack = Bun.which("ostack");
  const binary = Bun.which(agent);
  if (!ostack) throw new OstackError("not_on_path", "ostack is not on PATH. Run the ostack setup script first.");
  if (!binary) throw new OstackError("not_on_path", `${agent} is not on PATH, so cron cannot start it.`);
  const logs = join(workspace.root, ".ostack", "logs");
  const lines = [CRON_BEGIN(workspace.root), `CRON_TZ=${workspace.state.timezone}`, `PATH=${process.env.PATH ?? "/usr/bin:/bin"}`];
  for (const workflow of await workflows(workspace)) {
    const { spec, enabled } = effective(workspace, workflow);
    if (!spec || !enabled) continue;
    const prompt = `"$(${ostack} prompt ${workflow.ref} --workspace ${workspace.root})"`;
    const run =
      agent === "claude"
        ? `${binary} -p ${prompt} --permission-mode auto --permission-prompts none`
        : `${binary} exec --cd ${workspace.root} --sandbox workspace-write ${prompt}`;
    lines.push(`${toCron(spec)} cd ${workspace.root} && ${run} >> ${join(logs, `${taskName(workflow)}.log`)} 2>&1`);
  }
  lines.push(CRON_END(workspace.root));
  return lines;
}

function readCrontab(): string {
  const result = Bun.spawnSync(["crontab", "-l"], { stdout: "pipe", stderr: "pipe" });
  return result.exitCode === 0 ? result.stdout.toString() : "";
}

function withoutBlock(crontab: string, root: string): string[] {
  const lines = crontab.trim() === "" ? [] : crontab.replace(/\n+$/, "").split("\n");
  const start = lines.indexOf(CRON_BEGIN(root));
  const end = lines.indexOf(CRON_END(root));
  return start >= 0 && end > start ? [...lines.slice(0, start), ...lines.slice(end + 1)] : lines;
}

function writeCrontab(lines: string[]): void {
  const text = `${lines.join("\n").replace(/\n+$/, "")}\n`;
  const result = Bun.spawnSync(["crontab", "-"], { stdin: new TextEncoder().encode(text), stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new OstackError("cron_failed", `crontab refused the change: ${result.stderr.toString().trim()}`);
}

export async function scheduleCommand(args: Args): Promise<void> {
  const workspace = await loadWorkspace();
  const sub = args.positionals[1] ?? "list";
  if (sub === "list") {
    print({ timezone: workspace.state.timezone, workflows: (await workflows(workspace)).map((workflow) => view(workspace, workflow)) });
    return;
  }
  if (sub === "cron") {
    const action = args.positionals[2] ?? "show";
    const agent = (optional(args, "agent") ?? "claude") as "claude" | "codex";
    if (!["claude", "codex"].includes(agent)) throw new OstackError("invalid_flag", "--agent must be claude or codex.");
    if (action === "show") return print({ lines: await cronBlock(workspace, agent) });
    if (action === "install") {
      const block = await cronBlock(workspace, agent);
      mkdirSync(join(workspace.root, ".ostack", "logs"), { recursive: true });
      writeCrontab([...withoutBlock(readCrontab(), workspace.root), ...block]);
      const at = new Date().toISOString();
      for (const workflow of await workflows(workspace)) {
        const entry = workspace.state.schedules[workflow.ref];
        if (entry?.enabled) entry.installed.cron = { name: `crontab (${agent})`, at };
      }
      await writeState(workspace.root, workspace.state);
      print({ installed: block.length - 4, lines: block });
      return;
    }
    if (action === "remove") {
      writeCrontab(withoutBlock(readCrontab(), workspace.root));
      for (const entry of Object.values(workspace.state.schedules)) delete entry.installed.cron;
      await writeState(workspace.root, workspace.state);
      print({ removed: true });
      return;
    }
    throw new OstackError("unknown_command", "Use: ostack schedule cron show|install|remove [--agent claude|codex].");
  }
  const workflow = await findWorkflow(args.positionals[2] ?? required(args, "workflow"), enabledModules(workspace));
  const current = effective(workspace, workflow);
  const entry = (workspace.state.schedules[workflow.ref] ??= {
    spec: current.spec ?? parseSchedule({ days: "weekdays", at: "09:00" }),
    enabled: current.enabled,
    installed: {},
  });
  if (sub === "set") {
    const days = optional(args, "days") ?? "weekdays";
    const at = optional(args, "at");
    const every = optional(args, "every");
    if ((at === undefined) === (every === undefined)) throw new OstackError("missing_flag", "Pass --at HH:MM, or --every <minutes> [--from HH:MM --to HH:MM].");
    entry.spec = at
      ? parseSchedule({ days, at })
      : parseSchedule({ days, every_minutes: every, from: optional(args, "from") ?? "08:00", to: optional(args, "to") ?? "18:00", offset: optional(args, "offset") ?? 7 });
    entry.enabled = true;
  } else if (sub === "on" || sub === "off") {
    entry.enabled = sub === "on";
  } else if (sub === "spec") {
    print(hostSpec(workspace, workflow, oneOf(args, "host", HOSTS)));
    return;
  } else if (sub === "installed") {
    entry.installed[oneOf(args, "host", HOSTS)] = { name: required(args, "name"), at: new Date().toISOString() };
  } else if (sub === "uninstalled") {
    delete entry.installed[oneOf(args, "host", HOSTS)];
  } else {
    throw new OstackError("unknown_command", "Use: ostack schedule list | set|on|off|spec|installed|uninstalled <workflow> | cron show|install|remove.");
  }
  await writeState(workspace.root, workspace.state);
  const result = view(workspace, workflow);
  const hosts = Object.keys(result.installed);
  print({ ...result, ...(hosts.length > 0 && sub !== "installed" && sub !== "uninstalled" ? { update_hosts: `Also update the task in: ${hosts.join(", ")} (ostack schedule spec ${workflow.ref} --host <host>).` } : {}) });
}

const STALE_HOURS = 3;

/** One run per workflow at a time: a lock folder in the workspace, taken atomically and released at the end. */
export async function runCommand(args: Args): Promise<void> {
  const workspace = await loadWorkspace();
  const sub = args.positionals[1];
  const workflow = await findWorkflow(args.positionals[2] ?? required(args, "workflow"), enabledModules(workspace));
  const dir = join(workspace.root, ".ostack", "runs");
  const lock = join(dir, `${workflow.module}-${workflow.id}.lock`);
  mkdirSync(dir, { recursive: true });
  if (sub === "start") {
    if (args.flags.scheduled === true) {
      const { spec } = effective(workspace, workflow);
      if (spec && !isDue(spec, workspace.state.timezone, new Date())) {
        throw new OstackError("not_due", `${workflow.ref} runs ${describeSchedule(spec, workspace.state.timezone)}, and this run fired outside that. Do nothing and stop.`);
      }
    }
    if (existsSync(lock)) {
      const started = readFileSync(join(lock, "started"), "utf8").trim();
      const age = (Date.now() - Date.parse(started)) / 36e5;
      if (age < STALE_HOURS) {
        throw new OstackError("run_in_progress", `Another ${workflow.ref} run started at ${started} and has not ended. Stop this run.`, { started_at: started });
      }
      rmSync(lock, { recursive: true, force: true });
    }
    try {
      mkdirSync(lock);
    } catch {
      throw new OstackError("run_in_progress", `Another ${workflow.ref} run just started. Stop this run.`);
    }
    const at = new Date().toISOString();
    writeFileSync(join(lock, "started"), `${at}\n`);
    print({ workflow: workflow.ref, started_at: at, end_with: `ostack run end ${workflow.ref}` });
    return;
  }
  if (sub === "end") {
    const started = existsSync(lock) ? readFileSync(join(lock, "started"), "utf8").trim() : null;
    rmSync(lock, { recursive: true, force: true });
    print({ workflow: workflow.ref, started_at: started, ended_at: new Date().toISOString() });
    return;
  }
  throw new OstackError("unknown_command", "Use: ostack run start <workflow> [--scheduled] | ostack run end <workflow>.");
}
