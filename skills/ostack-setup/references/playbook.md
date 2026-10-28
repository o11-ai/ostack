# playbook.yaml reference

```yaml
name: b2b-founders            # must match the folder name
mode: draft                   # draft (you approve every message) | send
goal: book 15 minute intro calls with founders who need X

sender:
  name: Jane Doe              # required
  title: founder              # optional
  email: jane@acme.com        # required if any step uses email
  linkedin: https://www.linkedin.com/in/janedoe   # required if any step uses linkedin
  signature: |                # appended exactly as written
    jane
    acme.com

target:
  who: Founders of B2B software companies with 1-50 employees in the US   # one-line summary
  contact: founder or CEO                                                # role to reach
  qualify:                   # every item must be proven with a source before the first touch
    - sells to businesses
    - 1-50 employees
  exclude:                   # any one rules a lead out
    - agencies and consultancies

sources:                     # tried in order; at least one
  - type: csv                # a list the user already has
    path: leads.csv
  - type: web                # agent web research
    query: seed-stage B2B SaaS funding announcements in the last 90 days
  - type: tool               # a connected MCP server, CLI or API
    name: apollo
    notes: people search filtered to founder titles; confirm cost before bulk lookups

sequence:                    # step 1 must have wait_days 0; later steps wait after the previous send
  - channel: email           # email | linkedin
    wait_days: 0
    brief: first touch built on one observed fact; ask for a 15 minute call
  - channel: email
    wait_days: 3
    brief: same thread; one sharper question from the research notes
  - channel: linkedin
    wait_days: 2
    brief: connection note under 200 characters referencing the email topic
  - channel: email
    wait_days: 7
    brief: same thread; close the loop politely

limits:
  new_per_day: 20            # first touches per rolling 24 hours (default 20)
  touches_per_day: 50        # all sequence touches per rolling 24 hours (default 50; replies are not counted)
  per_company: 1             # people contacted per company domain, across playbooks (default 1)
  research_per_run: 25       # new companies to research per run (default 25)

writing:
  max_words: 120             # body word limit (default 150)
  banned: ["—", "synergy", "just checking in"]   # rejected by reserve, case-insensitive
  rules:                     # guidance the agent follows when writing
    - mostly lowercase, casual, short paragraphs
    - no links in the first email
```

## Choosing values

- **Limits:** start low (10–20 new per day per mailbox). New domains and mailboxes need warming, and LinkedIn enforces its own weekly invitation limits.
- **per_company:** use 1 for sales to small companies. Raise it for account-based plays where you contact several roles at the same company.
- **Sequence:** three to four touches over about two weeks is typical. Mixing channels helps when the email address is uncertain.
- **Banned:** add anything the user hates seeing in their own outbound. `reserve` enforces it on every message.
