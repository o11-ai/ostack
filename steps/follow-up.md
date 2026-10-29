---
summary: Cold follow-ups to people who have not replied, and when they are due.
used_by: [follow-ups]
changed: 0.3.0
change: Timing now lives in the follow_up_days setting and receipt schedules each touch. Upgraded workspaces start with 3,4,7 cut to their max_touches, so move any day counts from the note into `ostack settings set follow_up_days`.
---
Each lead in `follow_ups` is due for touch number `touch`. Send it in the same thread (`thread.thread_id`) from the same sender, on the same channel unless the user's notes say otherwise.

Timing comes from the workspace's `follow_up_days` setting, shown by `ostack context` (out of the box `3,4,7`: touch 2 three days after the first, touch 3 four days later, touch 4 a week after that). `ostack receipt` schedules the next touch from it, and `due` lists a lead only when its touch is due, so you never compute dates. Pass `--next-in-days <n>` or `--last` only to override it for one lead, such as "try me after the holidays".

Content: each follow-up adds one new useful thing (a sharper question, a relevant detail from the research notes, a smaller ask). Never resend the whole pitch, never guilt-trip, and close the loop politely on the last one. Send at most one touch per lead per run.
