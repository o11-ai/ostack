# Writing customization notes

A note is a short markdown file in plain language. Where it lives decides which workflows read it, and its file name decides when:

| File | Read |
| --- | --- |
| `custom/<any name>.md`, such as `about.md`, `voice.md`, `learnings.md` | By every module, at the start of every run, as general context |
| `custom/<module>/<step>.md`, such as `custom/gtm/write.md` | Every time that step runs, after the step's default |
| `custom/<module>/before-<step>.md`, `after-<step>.md` | Right before or after that step, such as `custom/gtm/after-record.md` for a CRM |
| `custom/<module>/<any other name>.md`, such as `custom/gtm/pricing.md` | By that module only, at the start of every run |

`ostack steps` lists the step names (`gtm/write`). `ostack context <step>` shows exactly what the agent will read for a step, which is the best way to check a note.

## Layers

Notes stack, lowest priority first:
1. the step defaults that ship with the module
2. the module's installed packs
3. `custom/`, then `custom/<module>/`
4. `campaigns/<name>/` (gtm)
5. `custom.local/`, then `custom.local/<module>/`

A later layer refines the earlier ones and wins where they conflict. To replace a default completely, say so in the note: "Ignore the default shape; always use this template."

## How to write them

- **Write only what differs from the default.** Never copy the default into a note. A copy freezes today's behavior and hides every later improvement to that step.
- Use the user's words. Be concrete: name tools, accounts, stages, numbers and examples.
- One topic per note, and each fact in one place: who to reach lives in `custom/gtm/qualify.md`, the offer in `custom/about.md`. Other notes point to them ("see qualify.md") instead of restating them, so one edit changes everything. Put rules about everything in `learnings.md` or another general note.
- Never repeat a setting or a schedule in a note (mode, daily limits, the follow-up days, the send window, when a workflow runs). `ostack settings` holds those, and a copy in a note goes stale the day the setting changes.
- Never put passwords, API keys or tokens in notes. Point to where they live instead, for example "the key is in RESEND_API_KEY in .env". Make sure `.env` is gitignored.
- If a customization needs code (an API call, a small script), put the script in the workspace, for example `scripts/send-resend.ts`, and have the note say when and how to run it.

## Examples

These show the shape of a good note. They are not defaults: write what the user said, never these rules.

`custom/gtm/after-record.md`:
```
Keep Lightfield in step using the Lightfield MCP.
- First touch sent: create the person and their company if missing, and set the stage to "Contacted".
- Reply: set the stage to "Replied" and add the reply text as a note.
- Meeting: set the stage to "Meeting booked".
- Opt-out: set the stage to "Closed - not interested".
Store the Lightfield person id in the lead's fields as lightfield_id.
```

`custom/gtm/write.md`:
```
Always use this template. Fill the bracketed parts from research, and never send a bracket.

subject: [their product] + [our product]?

hey [first name], saw [specific recent thing]. [one line connecting it to what we do].
worth 15 min next week?

sam
```

`custom/gtm/send.md`:
```
Send email from sam@yourcompany.com in Outlook web through the browser. Check the signed-in account first.
Never use Gmail for outreach.
```

`custom.local/voice.md`:
```
Sign off as "a." and keep everything lowercase.
```
