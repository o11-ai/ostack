import { resolve } from "node:path";
import { optional, parseArgs, type Args } from "./lib/args.ts";
import { OstackError } from "./lib/errors.ts";
import { printError, printText } from "./lib/output.ts";
import { readVersion } from "./lib/version.ts";
import { contextCommand, settingsCommand, setupCommand, stepsCommand } from "./commands/customize.ts";
import { doctorCommand } from "./commands/doctor.ts";
import { runCommand, scheduleCommand } from "./commands/schedule.ts";
import { upgradeCommand } from "./commands/upgrade.ts";
import { initCommand, modulesCommand, packsCommand, promptCommand } from "./commands/workspace.ts";
import { MODULE_CODE } from "./modules/index.ts";

const HELP = `ostack: workflows for coding agents that you customize by talking

Workspace and customization
  init [--dir <path>] [--modules gtm] [--packs gtm/gmail] [--timezone <IANA name>]   create an empty workspace
  modules list | add <id> | remove <id>        which modules (families of workflows) this workspace uses
  context [<step>|<note>] [--module <id>] [--campaign <name>] [--files]   what to know before a run (--files: note names only),
                                               or one step's default plus every customization of it
  steps [--module <id>]                        the named steps customizations attach to, such as gtm/write
  settings show | settings set <key> <value>   timezone, or a module's own, such as gtm.mode (see "ostack gtm help")
  setup status | answer <question> [--skip] | tidy [--dry-run] | reviewed | reset [--question <id>]
                                               tidy moves step notes from before modules into custom/<module>/
  packs list | add <name> [--from <folder>] | remove <name> | show <name>   (or --name <name>); names like gtm/gmail
  doctor                                       check install, workspace and customizations
  upgrade                                      pull the latest ostack (your workspace is never touched)

Schedules (in the workspace timezone)
  schedule list                                every workflow, its schedule and where it is installed
  schedule set <workflow> --at HH:MM | --every <minutes> [--from HH:MM] [--to HH:MM] [--offset <minutes>] [--days weekdays]
  schedule on|off <workflow>
  schedule spec <workflow> --host claude|codex|cron   exactly what to create in that scheduler
  schedule installed|uninstalled <workflow> --host claude|codex|cron [--name <task name>]
  schedule cron show|install|remove [--agent claude|codex]   for agents without a scheduler
  prompt <workflow> [--campaign <name>]        the instruction a scheduled run follows
  run start <workflow> [--scheduled] | run end <workflow>   one run at a time; --scheduled also stops a run that fired
                                               outside its schedule (a catch-up after sleep, a daylight-saving shift)

Module commands: ostack <module> <command>. "ostack gtm help" lists gtm's.

Global: --workspace <path> (or OSTACK_WORKSPACE). All commands print JSON.`;

const COMMANDS: Record<string, (args: Args) => Promise<void>> = {
  init: initCommand,
  modules: modulesCommand,
  context: contextCommand,
  steps: stepsCommand,
  settings: settingsCommand,
  setup: setupCommand,
  packs: packsCommand,
  doctor: doctorCommand,
  upgrade: upgradeCommand,
  schedule: scheduleCommand,
  prompt: promptCommand,
  run: runCommand,
};

/** Before modules, gtm's commands sat at the top level (`ostack due`). They keep working. */
const LEGACY_MODULE = "gtm";

async function main(): Promise<void> {
  let args = parseArgs(Bun.argv.slice(2));
  const workspace = optional(args, "workspace");
  if (workspace) process.env.OSTACK_WORKSPACE = resolve(workspace);
  let command = args.positionals[0];
  if (command === "version" || args.flags.version === true) return printText(await readVersion());
  if (!command || command === "help") return printText(HELP);
  let help = HELP;
  let prefix = "";
  const module = MODULE_CODE[command] ? command : MODULE_CODE[LEGACY_MODULE]?.commands[command] && !COMMANDS[command] ? LEGACY_MODULE : null;
  if (module) {
    if (command === module) args = { ...args, positionals: args.positionals.slice(1) };
    command = args.positionals[0];
    help = MODULE_CODE[module]!.help;
    prefix = `${module} `;
    if (!command || command === "help") return printText(`ostack ${module} commands\n\n${help}`);
  }
  if (args.flags.help === true || args.positionals.slice(1).includes("help")) return printText(helpFor(help, command!));
  const handler = module ? MODULE_CODE[module]!.commands[command!] : COMMANDS[command!];
  if (!handler) throw new OstackError("unknown_command", `Unknown command "${prefix}${command}". Run "ostack ${prefix}help".`);
  checkFlags(help, `${prefix}${command}`, command!, args);
  await handler(args);
}

const GLOBAL_FLAGS = ["workspace", "help", "version"];

/** Rejects flags a command does not take, so a typo or an imagined flag (--dry-run) never runs the real thing. */
function checkFlags(help: string, name: string, command: string, args: Args): void {
  const usage = helpFor(help, command);
  const known = new Set([...GLOBAL_FLAGS, ...[...usage.matchAll(/--([a-z][a-z-]*)/g)].map((match) => match[1]!)]);
  const unknown = Object.keys(args.flags).filter((flag) => !known.has(flag));
  if (unknown.length > 0) {
    throw new OstackError("unknown_flag", `ostack ${name} does not take ${unknown.map((flag) => `--${flag}`).join(", ")}. Nothing was changed.`, {
      usage: usage.split("\n").map((line) => line.trim()),
    });
  }
}

/** The help lines for one command, with their continuation lines. */
function helpFor(help: string, command: string): string {
  const lines = help.split("\n");
  const picked = lines.filter((line, index) => {
    const own = (text: string) => text.trimStart().split(/\s/)[0] === command;
    if (own(line)) return true;
    for (let back = index; back > 0 && /^\s{6,}/.test(lines[back]!); back--) if (own(lines[back - 1]!)) return true;
    return false;
  });
  return picked.length > 0 ? picked.join("\n") : help;
}

main().catch(printError);
