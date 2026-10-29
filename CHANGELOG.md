# Changelog

`ostack setup status` shows the sections newer than the version a workspace last reviewed, so the agent can say what changed. Keep each entry to what a user would notice.

## 0.4.0
- Modules: everything outreach-related is now the **gtm** module. Its step notes belong in `custom/gtm/` (old ones in `custom/` keep working; `ostack setup tidy` moves them), its settings are `gtm.*`, and its ledger is `.ostack/gtm.db` (renamed automatically).
- Schedules: workflows can run on their own in your timezone, from Claude Desktop, Codex or cron (`ostack schedule list`). Say "schedule my workflows".
- Sending hours: cold messages wait for `gtm.send_window` (new workspaces: weekdays 08:00-18:00). Upgraded workspaces start with no window; setup asks.
- Runs of the same workflow never overlap.
- Skills renamed `ostack-outbound` and `ostack-follow-ups`. Commands such as `ostack due` are now `ostack gtm due`; the old ones still work.

## 0.3.0
- Follow-up timing is a setting (`follow_up_days`), unknown flags are refused, imports can be previewed with `--dry-run`, and unfilled template slots are rejected.
