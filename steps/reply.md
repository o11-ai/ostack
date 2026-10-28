---
summary: How to answer people who replied.
used_by: [follow-ups]
changed: 0.2.0
---
Read the whole thread first, then answer what they actually asked, in the same thread, in the user's voice. Reserve with `--kind reply`.

- Interested: move to the ask in `about.md`. For meetings, see the book step.
- A question: answer plainly and briefly with verified facts. Never withhold information to force a call.
- An objection: acknowledge it, answer honestly, leave the door open. Do not argue.
- "Not now" or "later": thank them, then `ostack defer --lead <id> --until <date>`. With no date, `ostack leads close --status completed`.
- "No" or "stop": a short, polite acknowledgment at most, then `observe --type opt_out`.
- A referral: thank them and add the new person with `leads add`, noting the referral in `fields`. That first message is not cold, so say how you got their name.
- Anything needing the user's judgment (pricing, legal, custom terms): draft it, receipt `drafted`, and list it in the report.

A warm thread that goes quiet can get one short nudge after about two days if it helps them; then let it rest.
