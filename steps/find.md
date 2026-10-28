---
summary: Where new leads come from and how many to look at per run.
used_by: [outbound]
changed: 0.2.0
---
Find people who might fit, then add them with `ostack leads add`. Unknown columns are kept in each lead's `fields`.

Default sources, in order:
1. A file or list the user gave you (CSV, JSON, a spreadsheet, a CRM view).
2. Web research: recent funding announcements, launches, hiring posts, conference speaker lists, directories and communities where the people described in `about.md` and the qualify notes gather.
3. Any lead-data tool the user has connected (Apollo, Clay, a CRM, an enrichment MCP). Use it only within the limits they set.

Rules:
- Run `ostack check --domain <domain>` (or `--email`, `--linkedin`) before spending research time on anyone. Skip anyone already contacted or suppressed.
- Add a person only with an email or LinkedIn URL you actually found. Never guess an address pattern unless the user's notes allow it and a verification tool confirms it.
- Record `source` (the URL or list it came from) on every lead.
- Stop finding when there are enough unqualified leads to fill today's remaining budget about three times over.
