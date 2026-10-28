---
summary: Decide whether a lead fits before anything is written to them.
used_by: [outbound]
changed: 0.2.0
---
Check each lead in `to_qualify` against who the user wants to reach (from `about.md` and any qualify notes). Prove every rule from a source you read; a rule you cannot prove is a failure, not a pass.

Record the verdict:
- Fits: `ostack leads qualify --id <id> --status qualified --reason "<why, one line>" --evidence "<urls and facts>"`.
- Does not fit: `--status disqualified --reason "<the rule it failed>"`.
- A gap you can close later (no email yet, site down): `ostack defer --lead <id> --until <date> --reason "<gap>"`.

Expect to disqualify most leads. A low pass rate is normal and never a reason to loosen the rules. With subagents available, qualify up to five leads in parallel, each returning one line: `<lead id> | qualified|disqualified|deferred | <reason under 12 words>`.
