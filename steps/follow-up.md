---
summary: Cold follow-ups to people who have not replied, and when they are due.
used_by: [follow-ups]
changed: 0.2.0
---
Each lead in `follow_ups` is due for touch number `touch`. Send it in the same thread (`thread.thread_id`) from the same sender, on the same channel unless the user's notes say otherwise.

Default timing: touch 2 three days after the first, touch 3 four days later, touch 4 a week after that, then stop. When you receipt a sent touch, pass when the next one is due: `--next-in-days 3`, `4`, `7`, or `--last` on the final one. `max_touches` (a setting) is a hard ceiling either way.

Content: each follow-up adds one new useful thing (a sharper question, a relevant detail from the research notes, a smaller ask). Never resend the whole pitch, never guilt-trip, and close the loop politely on the last one. Send at most one touch per lead per run.
