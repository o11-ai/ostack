---
summary: How a message leaves, through which account and tool.
used_by: [outbound, follow-ups]
changed: 0.2.0
---
Use whatever tool the user's notes name for this channel (a mail MCP, a browser session, an API script). Without a note, use a connected mail or LinkedIn tool if exactly one fits; otherwise stop and ask the user (or, in a scheduled run, report it).

Every message, without exception:
1. `ostack reserve --lead <id> --kind touch|reply --channel <channel> [--subject <s>] --body-file -` with the exact final text. If it refuses, follow the error; never work around it.
2. Before the first send of a run, confirm the signed-in account is the sender the user configured. On a mismatch, stop sending and report it.
3. In `send` mode, send exactly the reserved text. In `draft` mode, create it as a draft (or show it in chat if no tool can hold drafts).
4. Immediately run `ostack receipt --attempt <id> --outcome sent|drafted|not_sent|uncertain` with the provider's message and thread IDs. A sent touch also needs `--next-in-days <n>` or `--last` (see the follow-up step).
5. If anything fails mid-send and you cannot prove what happened, receipt `uncertain`. Never send again to "fix" it; the next run reconciles it against the real Sent folder.

Reconcile items (`next: reconcile`): open the real Sent folder, thread or conversation, then receipt `sent` (with IDs) or `not_sent` (with how you checked). Drafts the user sent themselves count as `sent`.
