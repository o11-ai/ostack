# Sourcing and qualification

The playbook's `target` says who fits. `target.qualify` lists what must be proven, `target.exclude` lists what rules a lead out, and `target.contact` names the role to reach. This file covers how to prove it.

## Sourcing (`next: source`)

Work through `sources` in the playbook in order, taking at most `limits.research_per_run` new companies per run:

- `csv`: read the file at `path` (relative to the playbook folder or workspace) and pass it to `ostack leads add --input-file <path>`. The ledger skips rows already seen, so re-adding is safe.
- `web`: run the `query` as web searches and read the actual pages (funding announcements, directories, launch lists, job posts). Snippets are not evidence.
- `tool`: use the named tool if it is connected (an MCP server, CLI or API the user set up). Follow its own docs for inputs, and confirm cost before paid lookups if the tool charges per call. If it is not connected, say so in the run report and use the next source.

For each company: run `ostack check --domain <domain>`, then find the person matching `target.contact`, then `leads add` them with `source` set to where you found them. A source is exhausted when it returns nothing new twice in a row. Rotate queries (industry, region, stage) before calling a web source exhausted.

Select companies before looking for a persuasive angle. Do not cherry-pick companies that make the offer look good.

## Qualification (`next: qualify`)

Check each item in `target.qualify`, cheapest source first, and stop at the first thing that disproves the lead:

1. **Company:** the homepage, pricing, customers and about pages show what they sell and to whom.
2. **Size and stage:** a team page, the LinkedIn company page size bucket, or a data provider record. Record the exact source.
3. **Person:** confirm current role from two sources (their LinkedIn profile, plus the company's team or about page, a press release or a recent post). A name on an old page is not enough.
4. **Exclusions:** check every item in `target.exclude`.
5. **Contact:** for email, use an address you found published or that a verification tool returned as valid. Never guess a pattern and send to it. For LinkedIn, use the profile URL itself.

Then record the verdict:

- Everything is proven: `leads qualify --status qualified --evidence "<fact (url); fact (url)>"`, and save research notes with `leads update --research-file`.
- Something disproves the lead: `leads qualify --status disqualified --reason "<which rule>"`.
- A gap you can close later (no email yet, site down): `ostack defer --until <date> --reason "<gap>"`. Do not guess.

Expect many disqualifications. A low rate is normal; it is not a reason to loosen the rules. With subagents available, research up to five leads in parallel, each returning one line: `<lead id> | qualified|disqualified|deferred | <reason under 12 words>`.

## What to save for writing

In the research notes, keep observed facts separate from your inference:

- **They sell:** what, to whom (the paying buyer, not just the user).
- **Observed:** one concrete commercial fact (a named customer, a launched offer, a hiring push, a pricing change), with its URL.
- **Angle:** why the offer in `offer.md` helps with that specific situation.
- **Unknowns:** what you could not confirm.

The next run, a follow-up or a human should be able to explain why this person was contacted using only these notes.
