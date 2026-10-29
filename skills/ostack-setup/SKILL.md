---
name: ostack-setup
description: Set up, schedule and customize ostack by talking to the user. Interviews them, writes plain-language notes that change how its workflows run (for gtm: their offer, voice, templates, lead sources, email tool, CRM, calendar, limits), tests each change for real, creates scheduled runs in Claude Desktop, Codex or cron in their timezone, saves corrections as lasting rules, and reviews what is new after an ostack upgrade. Use whenever someone wants to set up or change ostack or their outreach: "set up ostack", "schedule my outbound every morning", "run follow-ups every 30 minutes", "use my email template", "log everything in Lightfield/HubSpot", "send from my Outlook", "we sell to dentists now", "stop mentioning pricing", "remember this", "add a fundraising campaign", or "review ostack updates", even if they never say "ostack". Running a workflow itself belongs to that workflow's skill (ostack-outbound, ostack-follow-ups).
---

# ostack setup

ostack is a set of modules (gtm is the first), each a family of workflows made of named steps with defaults. Everything specific to a user lives in short notes and a few settings in their workspace, which the workflows read before every step. You set ostack up by asking questions, writing those notes, proving they work, and scheduling the workflows. The user never edits config.

Read [customizing.md](references/customizing.md) before writing any note.

## First, find out where things stand

1. If there is no workspace (no `ostack.json` in this folder or a parent), check the `known` workspaces the error lists; with none, ask where to create one (default `~/ostack`) and run `ostack init --dir <path>`. Work in that folder from then on (if your shell does not keep the folder between commands, start each with `cd <workspace> &&`).
2. Run `ostack setup status`. It lists the questions not yet asked (`pending_questions`: core ones such as `timezone`, then each module's, such as `gtm/about`; `new_since_setup` marks ones a newer release added), customized steps whose default changed since the user last reviewed (`changed_defaults`), and notes that need attention (`unknown_steps`, `renamed_steps`, `misplaced_notes`).
3. Run `ostack modules list` and `ostack context --files` to see what is enabled and already customized.

## The interview

Go through `pending_questions` in order. Core questions are in [questions.md](references/questions.md); a module's are in `modules/<id>/questions.md` in the ostack checkout (each question's full text is also in `setup status`). For each one:

- **Ask it conversationally**, one topic at a time. Offer the default so "the default is fine" is a quick answer. Reuse anything the user already said, and skip questions the answers already cover.
- **Write what they said** as the note the question names, in their words where possible. Keep notes short and specific.
- **Make it real.** When the answer names a tool (a CRM, a mail account, a calendar), check the tool is actually available. Run the question's check (create a test record and read it back, send a test draft to themselves, list calendar slots) and show the result. If the tool is missing, tell the user what to connect, write the note anyway, and come back to the check later.
- **Record it:** `ostack setup answer <id>`, or `ostack setup answer <id> --skip` when they decline. A skipped question is not asked again.

When the user wants something no question covers, write the note anyway. Every step can be customized, and general notes can say anything.

Checks are previews: they never add records to a ledger, reserve or send to anyone but the user. Clean up what a check created (delete the test draft or CRM record if the tool can; otherwise tell the user what to delete).

Finish a module's first setup with a real preview. For gtm: follow the find, qualify, research and write steps (`ostack context gtm/<step>`) by hand for two real leads in chat and show both drafted messages, without adding, reserving or sending. Ask plainly whether they are good to go, and adjust notes until the user says yes. Then schedule (below). Setup is complete when `ostack setup status` shows no `pending_questions`.

## Scheduling

Workflows can run on their own, in the workspace timezone (`ostack settings show`). ostack keeps the schedule; the user's agent app runs it.

1. Show `ostack schedule list`: each workflow with its suggested schedule and runs per day. Ask which should run and when, and change any with `ostack schedule set <workflow> --at HH:MM` or `--every <minutes> --from HH:MM --to HH:MM` (`--days weekdays|daily|mon-fri`). Turn on a suggestion as it is with `ostack schedule on <workflow>`.
2. Ask where runs should happen. It must be a machine that has the workspace and the user's mail, CRM and calendar tools, and that is on during those hours:
   - **Claude Desktop** (local scheduled tasks) or **Codex** (automations): run `ostack schedule spec <workflow> --host claude|codex`. If you are running inside that app and can create scheduled tasks or automations, create it exactly as `ask` says: same name, folder, schedule and instructions. Otherwise give the user the fields to enter (`where` says where). Then have them run it once (Run now) and approve the tools it uses with "always allow", so later runs never stall on a prompt.
   - **Neither** (a server, or another agent): `ostack schedule cron install --agent claude|codex` writes a crontab block that starts the agent headless. Show the lines first.
3. Record what you created: `ostack schedule installed <workflow> --host <host> --name <task name>`. `ostack doctor` warns about schedules that are on but not installed anywhere.
4. If `spec` returns a `timezone_note`, the computer's clock zone differs from the workspace's: fix one before relying on the times.

The task's instructions only call `ostack prompt <workflow>`, so they stay right after upgrades and setting changes. When a schedule's times change, update the task in each host listed under `installed` (the `set` output says which). Changing anything else needs no task edit.

## Changing things later

Any time the user says how something should work ("use this template", "never mention pricing", "log replies in Lightfield", "send from my other mailbox", "run outbound at 7"):

1. Work out which step it belongs to (`ostack steps` lists them, such as `gtm/write`), whether it is general, or whether it is a setting or a schedule.
2. Update the existing note, or write a new one. Keep the note to what the user wants, not a copy of the default. If it is a setting (`ostack settings show`), change it with `ostack settings set` and remove anything in the notes that contradicts it. If it is a schedule, follow "Scheduling".
3. Test it and show the result: for a tool, the interview's check; for how messages are written, one real draft; for who to reach, a qualify verdict on a real lead. `ostack context <step>` confirms the note loads.

When the user corrects you during a run ("don't open with a compliment", "that's not our ICP"), offer once to save it. If they agree, add it to the right step's note, or to `learnings.md` if it applies everywhere.

When the user wants another module ("also help me with recruiting"), `ostack modules list` shows what exists and `ostack modules add <id>` enables it; then interview its questions. Its notes, settings and ledger start empty, and nothing that exists changes.

## After an ostack upgrade ("review updates")

Run `ostack setup status` and walk the user through it:

- **What's new:** summarize `release_notes` in a few plain lines first.
- **New questions:** ask only those. The user's existing answers stand.
- **Changed defaults:** each has a `change` saying what the release changed. Read the user's note for that step (`ostack context <step>`). If the change makes part of the note redundant or wrong (such as day counts that now belong in a setting), propose the exact edit and make it once they agree. If the note is unaffected, say so in one line instead of asking.
- **Misplaced notes:** step notes from before modules sit directly in `custom/`. They keep working. Show the list from `ostack setup tidy --dry-run`, and once the user agrees, run `ostack setup tidy`.
- **Renamed steps:** rename the note files to the new step names (`renamed_steps`). They keep working meanwhile.
- **Unknown steps:** ask what each note was meant for, then move or delete it.

Then run `ostack setup reviewed`, which records that this release's changes were reviewed.

## Where notes go

- `custom/`: notes about the user and their company that every module reads (`about.md`, `voice.md`, `learnings.md`), meant to be committed to git.
- `custom/<module>/`: that module's step notes and its own general notes, such as `custom/gtm/write.md`.
- `custom.local/` and `custom.local/<module>/`: this person's own notes, gitignored, which take priority over the team's. Use them for personal things such as their own signature or mailbox, or when they say "just for me".
- `campaigns/<name>/`: gtm notes for one campaign (for example a fundraising push next to sales). Use `--campaign <name>` with the CLI.
- Packs (`ostack packs list`) are shared starting points for a module, such as a use case or a tool. Offer one when it matches what the user describes (`ostack packs add gtm/<name>`). Their own notes always win over packs.
