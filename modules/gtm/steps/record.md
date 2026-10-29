---
summary: What else to do after something is recorded in the ledger (a send, a reply, a meeting, an opt-out).
used_by: [outbound, follow-ups]
changed: 0.2.0
---
By default the local ledger is the only record, and `reserve`, `receipt` and `observe` already keep it. Nothing else is required.

When the user wants another system kept in step (a CRM, a spreadsheet, Notion, Slack), their notes for this step say which tool, what to write and when. Follow these rules for any such system:
- The ledger stays the source of truth. Update the other system after the ledger, never instead of it.
- Save the other system's record ID on the lead: `ostack gtm leads update --id <id> --fields '{"crm_id":"..."}'`. Update that record next time instead of creating a duplicate.
- Log what you synced with `ostack gtm observe --lead <id> --type <system>_synced --external-id <their id or a stable key>`. Repeating an observe with the same ID is ignored, so a retry never double-logs.
- If the other system is down or refuses, note it in the run report and carry on. It never blocks sending, replies or opt-outs.
