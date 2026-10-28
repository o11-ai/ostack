# Running on a schedule

Outbound works best as a small daily run: replies and follow-ups first, then new leads up to the playbook's limits. `ostack prompt --playbook <name>` prints the instruction to schedule. Every run starts from the ledger, so a crashed or skipped run loses nothing.

Suggested cadence:

- **Daily, on weekday mornings in the sender's timezone:** the full run.
- **Optionally every few hours during the workday:** the same prompt. Runs with nothing due finish quickly, and the ledger prevents double-sends even when two runs overlap.

## Where to schedule

- **Claude Code:** use `/schedule` (cloud routines) or the desktop app's scheduled tasks, pasting the output of `ostack prompt`. Cloud runs need the connectors (mail, LinkedIn browser, calendar) available to that environment, and the workspace (`ostack.yaml`, `playbooks/`, `.ostack/`) must be on a machine the run can reach. For cloud runs, keep the workspace in a private repo and accept that the ledger then lives in that checkout. Local scheduled tasks are simpler.
- **Codex:** create an automation in the workspace folder with the prompt text.
- **cron / launchd:** run your agent's non-interactive mode in the workspace folder with the prompt, for example `cd ~/my-gtm && claude -p "$(ostack prompt)"`. Check your agent's docs for the current headless flags and tool permissions.

## In a scheduled run

- Never ask questions mid-run. Defer what you cannot resolve, then report it.
- If the mail or LinkedIn session is signed out or on the wrong account, stop sending, receipt nothing new, and report it.
- End with the counts from SKILL.md. When nothing was due, say so in one line.
