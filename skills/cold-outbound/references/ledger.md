# Ledger commands

Every command prints JSON. Errors print `{"error":{"code","message","details"}}` on stderr and exit 1. Branch on `code`. Pass `--playbook <name>` when the workspace has more than one. Write long inputs to files under `.ostack/tmp/` and pass `--*-file <path>` (or `-` for stdin).

## Before research

- `ostack check --domain acme.com` (or `--email`, `--linkedin`) shows existing leads, `company_contacted`, and any suppression. Skip the company if it is suppressed, or if `company_contacted` has reached the playbook's `limits.per_company`.

## Leads

- `ostack leads add --input-file leads.json` takes a JSON array or a `.csv` with a header row. Fields: `name`, `title`, `company`, `domain`, `email`, `linkedin_url`, `source`, `research`. A lead needs `email` or `linkedin_url`. Add a person once you know who they are. The response splits rows into `added`, `duplicates` (already in the ledger, in any playbook), `suppressed` and `invalid`. Duplicates are never re-added; leave them alone.
- `ostack leads update --id <id> --email <found email>` adds details found during research. Contact details lock after the first touch.
- `ostack leads update --id <id> --research-file notes.md` saves the research the message and follow-ups will reuse: what they sell, to whom, the observed fact, its URL, and the angle.
- `ostack leads qualify --id <id> --status qualified|disqualified --reason "<short>" --evidence "<facts with URLs>"` records the verdict. Disqualified leads stay in the ledger so nobody researches them again.
- `ostack leads show --id <id>` shows the lead with every attempt and event.
- `ostack leads close --id <id> --status meeting|completed|stopped --reason "<short>"` ends a conversation.
- `ostack defer --lead <id> --until 2026-11-10 --reason "<gap and retry path>"` hides a lead from `due` until the date.

## Sending

1. `ostack reserve --lead <id> --kind touch --channel email --subject "<subject>" --body-file msg.txt`
   - `touch` is the next sequence step. `reply` answers a lead in `replies`. Follow-ups usually omit `--subject` because they stay in the thread.
   - The CLI checks that the lead is due, the channel matches the step, the daily budget and company limit allow it, nothing is open for this lead, nothing is suppressed, and the text has no banned phrases, unfilled placeholders or excess words. On `message_rejected`, fix the text and reserve again.
   - It returns `attempt.id`. The reservation holds for 30 minutes.
2. Send or draft **exactly** the reserved subject and body.
3. `ostack receipt --attempt <id> --outcome sent --external-id <provider message id> --thread-id <thread id>`
   - `drafted` means it was created as a draft and stays open until the next run reconciles it.
   - `not_sent --evidence "<how you confirmed>"` means it provably did not go out (for example, the compose failed).
   - `uncertain --evidence "<what happened>"` means you could not tell. Never resend; reconcile later.
   - `sent` advances the sequence and schedules the next step from the playbook's `wait_days`.

## Inbound

`ostack observe --lead <id> --type <type> --external-id <provider message id> [--body-file reply.txt] [--until <date>]`

- `reply`: a human answered. This pauses the sequence and puts the lead in `replies`.
- `out_of_office`: needs `--until` (the return date). It does not count as interest.
- `bounce` and `opt_out` stop the lead and suppress the address permanently.
- `meeting`: a call was booked.
- `note`: anything worth keeping.

Repeating the same `--external-id` is ignored, so re-reading an inbox is safe. Use `ostack suppress --domain acme.com --reason "<why>"` when a whole company asks not to be contacted.
