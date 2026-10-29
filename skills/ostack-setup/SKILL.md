---
name: ostack-setup
description: Set up and customize ostack by talking to the user. Interviews them, writes plain-language notes that change how outbound and follow-ups work (their offer, voice, templates, lead sources, email tool, CRM, calendar, limits), tests each change for real, saves corrections as lasting rules, and reviews what is new after an ostack upgrade. Use whenever someone wants to set up or change their outreach: "set up ostack", "use my email template", "log everything in Lightfield/HubSpot", "send from my Outlook", "we sell to dentists now", "stop mentioning pricing", "remember this", "add a fundraising campaign", or "review ostack updates", even if they never say "ostack". Running outreach itself belongs to the outbound and follow-ups skills.
---

# ostack setup

ostack's skills are a baseline: named steps with defaults. Everything specific to a user lives in short notes in their workspace, which the skills read before every step. You set ostack up by asking questions, writing those notes, and proving they work. The user never edits config.

Read [customizing.md](references/customizing.md) before writing any note.

## First, find out where things stand

1. If there is no workspace (no `ostack.json` in this folder or a parent), check the `known` workspaces the error lists; with none, ask where to create one (default `~/gtm`) and run `ostack init --dir <path>`. Work in that folder from then on (if your shell does not keep the folder between commands, start each with `cd <workspace> &&`).
2. Run `ostack setup status`. It lists the questions not yet asked (`pending_questions`, with `new_since_setup` marking ones a newer release added), customized steps whose default changed since the user last reviewed (`changed_defaults`), and notes that need attention (`unknown_steps`, `renamed_steps`).
3. Run `ostack context` to see what is already customized.

## The interview

Go through `pending_questions` in order, using the full text in [questions.md](references/questions.md). For each one:

- **Ask it conversationally**, one topic at a time. Offer the default so "the default is fine" is a quick answer. Reuse anything the user already said, and skip questions the answers already cover.
- **Write what they said** as the note the question names, in their words where possible. Keep notes short and specific.
- **Make it real.** When the answer names a tool (a CRM, a mail account, a calendar), check the tool is actually available. Run the question's check (create a test record and read it back, send a test draft to themselves, list calendar slots) and show the result. If the tool is missing, tell the user what to connect, write the note anyway, and come back to the check later.
- **Record it:** `ostack setup answer <id>`, or `ostack setup answer <id> --skip` when they decline. A skipped question is not asked again.

When the user wants something no question covers, write the note anyway. Every step can be customized, and general notes can say anything.

Checks are previews: they never add leads to the ledger, reserve or send to anyone but the user. Clean up what a check created (delete the test draft or CRM record if the tool can; otherwise tell the user what to delete).

Finish the first setup with a real preview: follow the find, qualify, research and write steps (`ostack context <step>`) by hand for two real leads in chat and show both drafted messages, without adding, reserving or sending. Ask plainly whether they are good to go, adjust notes until the user says yes, and offer to schedule runs (the `schedule` question). Setup is complete when `ostack setup status` shows no `pending_questions`.

## Changing things later

Any time the user says how something should work ("use this template", "never mention pricing", "log replies in Lightfield", "send from my other mailbox"):

1. Work out which step it belongs to (`ostack steps` lists them) or whether it is general.
2. Update the existing note, or write a new one. Keep the note to what the user wants, not a copy of the default. If it is a setting (mode, limits, follow-up schedule), change it with `ostack settings set` and remove anything in the notes that contradicts it.
3. Test it and show the result: for a tool, the interview's check; for how messages are written, one real draft; for who to reach, a qualify verdict on a real lead. `ostack context <step>` confirms the note loads.

When the user corrects you during a run ("don't open with a compliment", "that's not our ICP"), offer once to save it. If they agree, add it to the right step's note, or to `learnings.md` if it applies everywhere.

## After an ostack upgrade ("review updates")

Run `ostack setup status` and walk the user through it:

- **New questions:** ask only those. The user's existing answers stand.
- **Changed defaults:** each has a `change` saying what the release changed. Read the user's note for that step (`ostack context <step>`). If the change makes part of the note redundant or wrong (such as day counts that now belong in a setting), propose the exact edit and make it once they agree. If the note is unaffected, say so in one line instead of asking.
- **Renamed steps:** rename the note files to the new step names (`renamed_steps`). They keep working meanwhile.
- **Unknown steps:** ask what each note was meant for, then move or delete it.

Then run `ostack setup reviewed`, which records that this release's changes were reviewed.

## Where notes go

- `custom/`: the team's notes, meant to be committed to git.
- `custom.local/`: this person's own notes, gitignored, which take priority over the team's. Use it for personal things such as their own signature or mailbox, or when they say "just for me".
- `campaigns/<name>/`: notes for one campaign (for example a fundraising push next to sales). Use `--campaign <name>` with the CLI.
- Packs (`ostack packs list`) are shared starting points, such as a use case or a tool. Offer one when it matches what the user describes (`ostack packs add <name>`). Their own notes always win over packs.
