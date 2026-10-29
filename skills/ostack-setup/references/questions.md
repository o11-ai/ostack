# Core setup questions

These apply to the whole workspace, whatever modules it uses. Each module adds its own in `modules/<id>/questions.md`, with ids `<module>/<id>`. Each `## <id>` section is one topic. `Since` is the release that added it, so after an upgrade only new topics are asked. Releases may add sections, but never rename or remove an id.

## timezone
Since: 0.4.0
Ask: Which timezone do you work in? Schedules and sending hours use it.
Default: The computer's timezone, which `ostack init` already set (`ostack settings show`). Confirm it rather than asking cold.
Writes: `ostack settings set timezone <IANA name>`, such as America/New_York.
Check: Say the current local time in that timezone and ask whether it is right.

## schedule
Since: 0.2.0
Ask: Should your workflows run on their own? Show `ostack schedule list`: each workflow with its suggested schedule (gtm's outbound on weekday mornings, follow-ups every 30 minutes in working hours). Which should run, and when? Which app should run them: Claude Desktop, Codex, or neither (cron)?
Default: Nothing scheduled.
Writes: `ostack schedule set <workflow> --at HH:MM` or `--every <minutes> --from HH:MM --to HH:MM`, or `ostack schedule on <workflow>` to keep the suggestion. Then create each task as described in SKILL.md ("Scheduling").
Check: `ostack schedule list` shows every chosen workflow as installed, and one test run (Run now) finished without stalling on a permission prompt.
