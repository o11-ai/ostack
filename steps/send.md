---
summary: How a message leaves, through which account and tool.
used_by: [outbound, follow-ups]
changed: 0.3.0
change: The mode setting alone decides draft or send, and a failed send is checked in the Sent folder before choosing uncertain. Remove draft/send rules from the note.
---
Use whatever tool the user's notes name for this channel (a mail MCP, a browser session, an API script). Without a note, use a connected mail or LinkedIn tool if exactly one fits; otherwise stop and ask the user (or, in a scheduled run, report it).

Every message, without exception:
1. `ostack reserve --lead <id> --kind touch|reply --channel <channel> [--subject <s>] --body-file -` with the exact final text. If it refuses, follow the error; never work around it.
2. Before the first send of a run, confirm the signed-in account is the sender the user configured. On a mismatch, stop sending and report it.
3. In `send` mode, send exactly the reserved text. In `draft` mode, create it as a draft (or show it in chat if no tool can hold drafts). The mode in `ostack context` decides this; if a note seems to say otherwise, follow the mode and mention the conflict in the report.
4. Immediately run `ostack receipt --attempt <id> --outcome sent|drafted|not_sent|uncertain` with the provider's message and thread IDs. The next follow-up is scheduled for you.
5. If the send errors or times out, look in the Sent folder (or thread) now. Found it: receipt `sent` with its IDs. Clearly not there and the tool said it failed: receipt `not_sent` with how you checked. Cannot tell: receipt `uncertain`. Never send again to "fix" it; the next run reconciles uncertain ones.

Reconcile items (`next: reconcile`): open the real Sent folder, thread or conversation, then receipt `sent` (with IDs) or `not_sent` (with how you checked).

Drafts (`drafts` in `due`, draft mode): once per run, check whether the user sent each one. Receipt a sent one `sent` with its IDs. Receipt a deleted one `not_sent`. Leave one still sitting in drafts as it is. Drafts never hold up the rest of the queue.
