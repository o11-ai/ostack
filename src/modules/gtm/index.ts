import type { ModuleCode } from "../types.ts";
import { checkCommand, leadsCommand } from "./leads-command.ts";
import { deferCommand, dueCommand, observeCommand, receiptCommand, reserveCommand, statusCommand, suppressCommand } from "./outreach-command.ts";
import { campaignsCommand } from "./campaigns-command.ts";
import { applySetting, readSettings, SETTING_KEYS, showSettings, storeSettings } from "./settings.ts";

const HELP = `Each run
  due --for outbound|follow-ups [--campaign] [--limit 10]   what that workflow should do next, in order
  status [--campaign <name>]                    lead counts and today's budget
  check --email|--linkedin|--domain <value>     history and suppression before researching
  campaigns                                    campaigns that have their own notes

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
          cold touches wait for the send_window setting; replies never do
  receipt --attempt <id> --outcome sent|drafted|not_sent|uncertain [--external-id] [--thread-id] [--evidence]
          [--next-in-days <n> | --last]        override the follow-up schedule for this lead (e.g. "ping me in two weeks")
  observe --lead <id> --type reply|bounce|opt_out|out_of_office|meeting|note|<your own>
          [--body|--body-file] [--external-id] [--until] [--occurred-at]
  defer --lead <id> --until <date> --reason <text>
  suppress --email|--domain|--linkedin <value> --reason <text>

Settings (ostack settings set gtm.<key> <value>)
  mode draft|send, new_per_day, touches_per_day, per_company,
  follow_up_days (days after the previous touch for each follow-up, e.g. 3,4,7, or none),
  send_window (when cold messages may go out, e.g. "weekdays 08:00-18:00", or any)`;

export const gtm: ModuleCode = {
  help: HELP,
  commands: {
    due: dueCommand,
    status: statusCommand,
    check: checkCommand,
    campaigns: campaignsCommand,
    leads: leadsCommand,
    reserve: reserveCommand,
    receipt: receiptCommand,
    observe: observeCommand,
    defer: deferCommand,
    suppress: suppressCommand,
  },
  settings: {
    keys: SETTING_KEYS,
    show: (raw) => showSettings(readSettings(raw)),
    apply: (raw, key, value) => storeSettings(applySetting(readSettings(raw), key, value)),
    initial: () => storeSettings(readSettings({})),
  },
};
