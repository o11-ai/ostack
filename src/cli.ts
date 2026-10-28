import { resolve } from "node:path";
import { optional, parseArgs, type Args } from "./lib/args.ts";
import { OstackError } from "./lib/errors.ts";
import { printError, printText } from "./lib/output.ts";
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
import { readVersion, upgradeCommand } from "./commands/upgrade.ts";
import { initCommand, playbookCommand, promptCommand, templatesCommand } from "./commands/workspace.ts";

const HELP = `ostack: configurable cold outbound for coding agents

Setup
  init [--from <template>] [--playbook <name>] [--dir <path>]   create a workspace and playbook
  templates                                                     list starter playbooks
  playbook list|check|show [--playbook <name>]                  validate or print a playbook
  doctor                                                        check install, workspace and playbooks
  prompt [--playbook <name>]                                    print the instruction for a scheduled run
  upgrade                                                       pull the latest ostack

Each run
  due [--playbook <name>] [--limit 10]          what to do next, in order
  status [--playbook <name>]                    lead counts and today's budget
  check --email|--linkedin|--domain <value>     history and suppression before researching

Leads
  leads add --input-file <file.json|file.csv|-> [--playbook <name>]
  leads list [--playbook] [--status] [--search] [--limit]
  leads show --id <lead>
  leads update --id <lead> [--email] [--linkedin-url] [--name] [--title] [--company] [--domain] [--research|--research-file]
  leads qualify --id <lead> --status qualified|disqualified --reason <text> --evidence <urls and facts>
  leads close --id <lead> --status meeting|completed|stopped --reason <text>

Sending (every message: reserve, send, receipt)
  reserve --lead <id> --kind touch|reply --channel email|linkedin [--subject] --body|--body-file
  receipt --attempt <id> --outcome sent|drafted|not_sent|uncertain [--external-id] [--thread-id] [--evidence]
  observe --lead <id> --type reply|bounce|opt_out|out_of_office|meeting|note [--body|--body-file] [--external-id] [--until]
  defer --lead <id> --until <date> --reason <text>
  suppress --email|--domain|--linkedin <value> --reason <text>

Global: --workspace <path> (or OSTACK_WORKSPACE). All commands print JSON.`;

const COMMANDS: Record<string, (args: Args) => Promise<void>> = {
  init: initCommand,
  templates: templatesCommand,
  playbook: playbookCommand,
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
