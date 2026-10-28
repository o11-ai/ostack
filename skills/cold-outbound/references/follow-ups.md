# Follow-ups and replies

## Read the inbox first

Before sending follow-ups, check the configured sender's inbox (and LinkedIn messages if a LinkedIn step exists) for anything new from leads in this playbook. Use `ostack leads list --search <email or name>` to match messages to leads, then record each one with `ostack observe` and the provider's message ID. Re-reading is safe because duplicate IDs are ignored. Observe before acting so a reply that arrived since the last run is never followed by a cold nudge.

| What arrived | Record as |
| --- | --- |
| A human answer, including "not now" or a question | `reply` |
| An auto-reply with a return date | `out_of_office --until <date>` |
| A delivery failure | `bounce` |
| "Remove me", "not interested, stop", unsubscribe | `opt_out` |
| A booked meeting | `meeting` |

## Cold follow-ups (`follow_ups`)

Each item has `next_step` (step, channel, brief) and `thread` (the last message's subject and IDs).

- **Email:** reply in the same thread (`thread.thread_id`) from the same sender. Reserve without `--subject`, or with the original subject if your tool needs one.
- **LinkedIn:** message the same profile. If the step is a connection request and you are already connected, send a message instead and say so in `--evidence`.
- Follow the step's `brief`. Each follow-up adds one new useful thing: a sharper question, a relevant detail from the research notes, or a smaller ask. Never resend the full pitch, and never guilt-trip.
- The last step should close the loop politely.
- Send at most one step per lead per run. The ledger schedules the next one.

## Replies (`replies`)

- Read the whole thread first. Answer what they actually asked before anything else.
- Interested: move to the ask in `offer.md`. When proposing times, read the user's real calendar if a calendar tool is connected, offer two or three concrete slots with a timezone, and only book after they agree. Then `observe --type meeting`.
- Asked for information: give it plainly and briefly. Do not withhold it to force a call.
- Objection: acknowledge it, answer honestly with only verified facts, and leave the door open. Do not argue.
- "Not now" or "later": thank them, then `defer --until <requested date>`. Use `leads close --status completed` if no date was given.
- "No" or "stop": a short, polite acknowledgment at most, then `observe --type opt_out`.
- Referral to someone else: thank them, then add the new person with `leads add`, noting the referral in `research`. Mention the referrer in the first touch. It is no longer a cold message, so be clear about how you got their name.

Reserve every reply with `--kind reply` and receipt it like any other message. If a reply needs the user's judgment (pricing, legal, a custom deal), draft it, receipt `drafted`, and list it in the run report instead of sending.
