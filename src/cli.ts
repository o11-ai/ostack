import { resolve } from "node:path";
import { optional, parseArgs, type Args } from "./lib/args.ts";
import { OstackError } from "./lib/errors.ts";
import { printError, printText } from "./lib/output.ts";
import { readVersion } from "./lib/version.ts";
import { contextCommand, settingsCommand, setupCommand, stepsCommand } from "./commands/customize.ts";
import { doctorCommand } from "./commands/doctor.ts";
import { checkCommand, leadsCommand } from "./commands/leads.ts";
import {
  deferCommand,
  dueCommand,
  observeCommand,
  receiptCommand,
  reserveCommand,
  statusCommand,
  suppressCommand,
} from "./commands/outreach.ts";
import { upgradeCommand } from "./commands/upgrade.ts";
import { campaignsCommand, initCommand, packsCommand, promptCommand } from "./commands/workspace.ts";

const HELP = `ostack: a customizable go-to-market baseline for coding agents

Workspace and customization
  init [--dir <path>] [--packs a,b]            create an empty workspace (then ask your agent to "set up ostack")
  context [<step>|<note>] [--campaign <name>] [--files]   what to know before a run (--files: note names only),
                                               or one step's default plus every customization of it
  steps                                        the named steps customizations attach to
  settings show | settings set <key> <value>     mode (draft|send), new_per_day, touches_per_day, per_company,
                                               follow_up_days (days after the previous touch for each follow-up, e.g. 3,4,7, or none)
  setup status | answer <question> [--skip] | reviewed | reset [--question <id>]
  packs list | add <name> [--from <folder>] | remove <name> | show <name>   (or --name <name>)
  campaigns                                    campaigns that have their own notes
  doctor                                       check install, workspace and customizations
  prompt outbound|follow-ups [--campaign]      the instruction for a scheduled run
  upgrade                                      pull the latest ostack (your workspace is never touched)

Each run
  due --for outbound|follow-ups [--campaign] [--limit 10]   what that skill should do next, in order
  status [--campaign <name>]                    lead counts and today's budget
  check --email|--linkedin|--domain <value>     history and suppression before researching

Leads
  leads add --input-file <file.json|file.csv|-> [--source <where they came from>] [--campaign <name>] [--dry-run]
          JSON: [{"name","email","linkedin_url","company","domain","title","source", ...}]; CSV: a header row.
          email or linkedin_url is required; any other key is kept in the lead's fields
  leads list [--campaign] [--status] [--search] [--limit]
  leads show --id <lead>
  leads update --id <lead> [--email] [--linkedin-url] [--name] [--title] [--company] [--domain] [--research|--research-file] [--fields '<json>']
  leads qualify --id <lead> --status qualified|disqualified --reason <text> --evidence <urls and facts>
  leads close --id <lead> --status meeting|completed|stopped --reason <text>
  leads remove --id <lead>                      undo a mistaken import (only leads never messaged)

Messages (every one: reserve, send, receipt)
  reserve --lead <id> --kind touch|reply --channel <email|linkedin|...> [--subject] --body|--body-file
  receipt --attempt <id> --outcome sent|drafted|not_sent|uncertain [--external-id] [--thread-id] [--evidence]
          [--next-in-days <n> | --last]        override the follow-up schedule for this lead (e.g. "ping me in two weeks")
  observe --lead <id> --type reply|bounce|opt_out|out_of_office|meeting|note|<your own>
          [--body|--body-file] [--external-id] [--until] [--occurred-at]
  defer --lead <id> --until <date> --reason <text>
  suppress --email|--domain|--linkedin <value> --reason <text>

Global: --workspace <path> (or OSTACK_WORKSPACE). All commands print JSON.`;

const COMMANDS: Record<string, (args: Args) => Promise<void>> = {
  init: initCommand,
  context: contextCommand,
  steps: stepsCommand,
  settings: settingsCommand,
  setup: setupCommand,
  packs: packsCommand,
  campaigns: campaignsCommand,
  doctor: doctorCommand,
  prompt: promptCommand,
  upgrade: upgradeCommand,
  due: dueCommand,
  status: statusCommand,
  check: checkCommand,
  leads: leadsCommand,
  reserve: reserveCommand,
  receipt: receiptCommand,
  observe: observeCommand,
  defer: deferCommand,
  suppress: suppressCommand,
};

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  const command = args.positionals[0];
  const workspace = optional(args, "workspace");
  if (workspace) process.env.OSTACK_WORKSPACE = resolve(workspace);
  if (command === "version" || args.flags.version === true) return printText(await readVersion());
  if (!command || command === "help") return printText(HELP);
  if (args.flags.help === true || args.positionals.slice(1).includes("help")) return printText(helpFor(command));
  const handler = COMMANDS[command];
  if (!handler) throw new OstackError("unknown_command", `Unknown command "${command}". Run "ostack help".`);
  checkFlags(command, args);
  await handler(args);
}

const GLOBAL_FLAGS = ["workspace", "help", "version"];

/** Rejects flags a command does not take, so a typo or an imagined flag (--dry-run) never runs the real thing. */
function checkFlags(command: string, args: Args): void {
  const help = helpFor(command);
  const known = new Set([...GLOBAL_FLAGS, ...[...help.matchAll(/--([a-z][a-z-]*)/g)].map((match) => match[1]!)]);
  const unknown = Object.keys(args.flags).filter((flag) => !known.has(flag));
  if (unknown.length > 0) {
    throw new OstackError("unknown_flag", `ostack ${command} does not take ${unknown.map((flag) => `--${flag}`).join(", ")}. Nothing was changed.`, {
      usage: help.split("\n").map((line) => line.trim()),
    });
  }
}

/** The help lines for one command, with their continuation lines. */
function helpFor(command: string): string {
  const lines = HELP.split("\n");
  const picked = lines.filter((line, index) => {
    const own = (text: string) => text.trimStart().split(/\s/)[0] === command;
    if (own(line)) return true;
    for (let back = index; back > 0 && /^\s{6,}/.test(lines[back]!); back--) if (own(lines[back - 1]!)) return true;
    return false;
  });
  return picked.length > 0 ? picked.join("\n") : HELP;
}

main().catch(printError);
