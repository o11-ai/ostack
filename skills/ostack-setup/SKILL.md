---
name: ostack-setup
description: Create or change an ostack outbound playbook by interviewing the user about their offer, ideal customer, voice, sender accounts, lead sources, sequence and limits, then writing and validating the playbook files. Use when someone wants to set up ostack, start doing cold outbound for a new product, audience or use case (sales, recruiting, fundraising, partnerships, hiring), change who they target, rewrite their messaging or voice, change cadence or limits, or switch a playbook between draft and send mode.
---

# ostack setup

A playbook is three files in `<workspace>/playbooks/<name>/`:

- `playbook.yaml`: goal, mode, sender, target rules, sources, sequence, limits, writing rules. The schema is in [playbook.md](references/playbook.md).
- `offer.md`: what is offered, to whom, the proof, and the one ask.
- `voice.md`: how the sender writes, with real samples.

The cold-outbound skill reads these on every run, so getting them right is the whole job.

## Steps

1. **Find or create the workspace.** If no `ostack.yaml` exists in the current folder or its parents, ask where to keep it (suggest a new folder such as `~/gtm`). Then run `ostack templates` and `ostack init --dir <folder> --from <closest template> --playbook <short-name>`. Use one playbook per audience and offer. A new use case gets a new playbook, not edits to an old one.
2. **Interview briefly.** Ask in two or three grouped messages, never one question at a time. Reuse anything already known from the conversation or their website instead of asking:
   - **Offer:** What do you offer, and what changes for the customer? Who has bought or used it (real names only if public)? What is the one ask (a 15-minute call, a reply, a demo)?
   - **Target:** Which companies or people are a fit? What must be true for them (size, industry, stage, role, signals), and who is never a fit? Which role do you contact?
   - **Sender:** Name, title and signature. The email address and/or LinkedIn profile they will send from.
   - **Voice:** Paste two to five messages you have actually sent that got replies. What should never appear (phrases, em dashes, exclamation marks)?
   - **Sources:** Do you have a lead list (CSV)? Which data tools are connected (Apollo, Clay, a CRM MCP, and so on)? Otherwise, use web research with queries we agree on.
   - **Cadence:** Which channels? How many first touches per day? Start in draft mode (you approve each message) or send mode?
3. **Write the files.** Put facts only in `offer.md`. If they have no customers or proof yet, the offer says so plainly and leans on the specific problem. Put their real samples in `voice.md` and describe the patterns you see. Keep the default `sequence` unless they want changes: three to four steps, with the briefs written for their offer. Remove every `ostack:example` marker.
4. **Validate.** Run `ostack playbook check --playbook <name>` and fix each reported problem, then run `ostack doctor`.
5. **Prove it on two leads.** Find two real leads matching the target, research them, and show complete draft messages in chat (see the cold-outbound skill's writing guide). Do not reserve or send. Adjust `offer.md`, `voice.md` or the briefs until the user is happy with the drafts.
6. **Hand off.** Tell them how to run it ("run my outbound", or the cold-outbound skill) and offer to schedule it with the output of `ostack prompt --playbook <name>`. Recommend `mode: draft` for the first week, then `send` once the drafts consistently need no edits.

## Changing an existing playbook

Edit only what they asked for, run `ostack playbook check`, and show one before-and-after draft when the change affects messaging. Changing `target` affects only future qualification; leads already contacted keep their history. Never delete `.ostack/ledger.db`, because it holds opt-outs and send history.
