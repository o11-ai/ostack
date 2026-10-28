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
  context [<step>] [--campaign <name>]         what to know before a run, or one step's default plus every customization of it
  steps                                        the named steps customizations attach to
  settings show | settings set <key> <value>   mode (draft|send), new_per_day, touches_per_day, per_company, max_touches
  setup status | answer <question> [--skip] | reviewed | reset [--question <id>]
  packs list | add <name> [--from <folder>] | remove <name> | show <name>
  campaigns                                    campaigns that have their own notes
  doctor                                       check install, workspace and customizations
  prompt outbound|follow-ups [--campaign]      the instruction for a scheduled run
  upgrade                                      pull the latest ostack (your workspace is never touched)

Each run
  due [--campaign <name>] [--limit 10]          what to do next, in order
  status [--campaign <name>]                    lead counts and today's budget
  check --email|--linkedin|--domain <value>     history and suppression before researching

Leads
  leads add --input-file <file.json|file.csv|-> [--campaign <name>]   unknown columns are kept in fields
  leads list [--campaign] [--status] [--search] [--limit]
  leads show --id <lead>
  leads update --id <lead> [--email] [--linkedin-url] [--name] [--title] [--company] [--domain] [--research|--research-file] [--fields '<json>']
  leads qualify --id <lead> --status qualified|disqualified --reason <text> --evidence <urls and facts>
  leads close --id <lead> --status meeting|completed|stopped --reason <text>

Messages (every one: reserve, send, receipt)
  reserve --lead <id> --kind touch|reply --channel <email|linkedin|...> [--subject] --body|--body-file
  receipt --attempt <id> --outcome sent|drafted|not_sent|uncertain [--external-id] [--thread-id] [--evidence]
          [--next-in-days <n> | --last]        required when a touch is sent
  observe --lead <id> --type reply|bounce|opt_out|out_of_office|meeting|note|<your own> [--body] [--external-id] [--until]
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
  if (!command || command === "help" || args.flags.help === true) return printText(HELP);
  if (command === "version" || args.flags.version === true) return printText(await readVersion());
  const handler = COMMANDS[command];
  if (!handler) throw new OstackError("unknown_command", `Unknown command "${command}". Run "ostack help".`);
  await handler(args);
}

main().catch(printError);
