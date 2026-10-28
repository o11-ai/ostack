# Setup questions

Each `## <id>` section is one topic. `Since` is the release that added it, so after an upgrade only new topics are asked. Releases may add sections, but never rename or remove an id.

## about
Since: 0.2.0
Ask: What do you do, who is it for, and what should outreach lead to? (a call, a demo, a reply, an intro) Any proof you can share: customers, results, notable users? Anything we must never claim?
Default: None. This one is needed.
Writes: `custom/about.md`, with sections for what you offer, who it is for, proof, the one ask, and never claim.
Check: Read it back in two sentences and ask whether it is right.

## who
Since: 0.2.0
Ask: Who exactly should we reach? Role, company type and size, location, and anything that rules someone out (existing customers, competitors, agencies, ...).
Default: Inferred from `about.md`, which is rarely sharp enough. Push for specifics.
Writes: `custom/qualify.md` as provable rules and exclusions.
Check: Qualify two or three real leads against the rules in chat (do not add them to the ledger) and show each verdict with its evidence. Ask about any borderline case you hit, such as a role or size close to the line, and add the answer to the note.

## sources
Since: 0.2.0
Ask: Where do good leads come from? A list or CSV, a CRM view, a data tool (Apollo, Clay, ...), or should I research the web? Any places to look or avoid?
Default: Web research, as described in the find step.
Writes: `custom/find.md`. If they name a tool, include how to reach it.
Check: Find three real candidates and show them without adding them.

## voice
Since: 0.2.0
Ask: How do you write? Paste two to five real messages you sent that got replies, or describe your style. Do you have a template I should always follow? How do you sign off?
Default: Short, plain and specific, per the write step.
Writes: `custom/voice.md` (style, samples, signature). If they have a template, `custom/write.md` (see customizing.md).
Check: Draft one message for a real lead and ask what to change. Repeat until they like it.

## sending
Since: 0.2.0
Ask: Which account should messages go out from, and through what? (a Gmail or Outlook connector, the browser, an email API like Resend, LinkedIn in the browser) Draft-only for now, or should I send?
Default: Draft mode, through whichever connected mail tool fits.
Writes: `custom/send.md` with the account and tool for each channel, and `custom/inbox.md` with how to read replies the same way. Offer the matching pack (`gmail`, `outlook-web`) when one fits. Set the mode with `ostack settings set mode draft|send`. The mode setting alone decides draft or send: leave every mention of drafting or sending first (even "start in draft mode") out of the notes, so a later switch cannot leave a stale note behind.
Check: Confirm the signed-in account, and create a test draft to the user themselves (never to a lead).

## follow-ups
Since: 0.2.0
Ask: If someone does not reply, how many follow-ups, how far apart, and on which channel?
Default: Three follow-ups after the first message, at 3, 4 and 7 days, in the same thread.
Writes: `ostack settings set follow_up_days <days before each follow-up>`, such as `2,5` for two follow-ups, or `none`. This also sets how many touches a lead can get. Put anything else (channel, content, "skip weekends") in `custom/follow-up.md`.
Check: Restate the schedule as dates for a message sent today.

## crm
Since: 0.2.0
Ask: Should I keep a CRM or tracker in step with everything (leads, messages, replies, meetings, opt-outs)? Which one, and how do I reach it (its connector or MCP, the browser, an API)? What are your pipeline stages?
Default: Only the local ledger.
Writes: `custom/after-record.md`, mapping each event to what to create or update and which stage to set (see customizing.md).
Check: Create a clearly labeled test record, read it back, then delete it or ask the user to.

## meetings
Since: 0.2.0
Ask: When someone says yes, how should we book? A booking link, or should I offer times from your calendar and send the invite? How long are meetings, and in what timezone?
Default: Offer two or three times from the connected calendar; invite only after they agree.
Writes: `custom/book.md`.
Check: List three real open slots from their calendar, or show the booking link.

## limits
Since: 0.2.0
Ask: How many new people per day at most, and how many messages per day in total? How many people at the same company?
Default: 20 new, 60 total, 1 per company. Start lower on a new mailbox.
Writes: `ostack settings set new_per_day <n>`, `touches_per_day <n>`, `per_company <n>`.
Check: `ostack settings show`.

## report
Since: 0.2.0
Ask: After each run, is a summary in chat enough, or should I also post it somewhere (Slack, email, a doc)?
Default: A summary in chat.
Writes: `custom/after-report.md` if they want it posted somewhere.
Check: Post a test summary there.

## schedule
Since: 0.2.0
Ask: Should outbound and follow-ups run on their own? Outbound usually runs on weekday mornings and follow-ups hourly.
Default: Not scheduled.
Writes: Nothing in the workspace. Create the schedules with the agent's scheduler (Claude's `/schedule` or scheduled tasks, a Codex automation, or cron), using `ostack prompt outbound` and `ostack prompt follow-ups` as the instructions. Scheduled runs need the same tools (mail, browser, calendar, CRM) available where they run.
Check: List the schedules you created.
