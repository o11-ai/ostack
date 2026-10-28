---
summary: Turning a yes into a meeting on the calendar.
used_by: [follow-ups]
changed: 0.2.0
---
When someone agrees to talk:
- If the user gave a booking link, offer it, plus two or three concrete times if they prefer.
- Otherwise read the user's real calendar (if a calendar tool is connected) and offer two or three open slots with a timezone.
- Create an invite only after they pick a time, from the user's calendar, with a clear title and the thread's context in the description.
- Then `ostack observe --lead <id> --type meeting --external-id <event id>`.

Never book without their agreement, and never double-book the user.
