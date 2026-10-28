# ostack

Open-source go-to-market skills for coding agents, from [o11](https://o11.ai).

ostack is a baseline you shape by talking to your agent. Install it, say **"set up ostack"**, and your agent interviews you: what you sell, who to reach, how you write, which mailbox to send from, whether to keep your CRM in step, how to book meetings. It writes your answers down as short plain-language notes, tests each one against your real tools, and from then on runs outbound and follow-ups your way. Updates improve the baseline without touching anything you customized.

There is no hosted backend and no account. Your agent works through the mail, LinkedIn, calendar and CRM tools it already has. ostack provides the method, and a local ledger guarantees nobody is contacted twice and opt-outs stick.

## Install

Requires [Bun](https://bun.sh) 1.2.21+ and git.

```bash
git clone --depth 1 https://github.com/o11-ai/ostack.git ~/ostack
~/ostack/setup                 # Claude Code; or --host codex|cursor|gemini|auto
```

`setup` symlinks the skills into your agent's skills folder and links `ostack` into `~/.local/bin`. Run `./setup --status` to see what is installed, and `./setup --uninstall` to remove it.

## Quick start

```bash
mkdir ~/gtm && cd ~/gtm && ostack init
```

Then talk to your agent:

> set up ostack

> use this template for first emails: ...

> keep Lightfield in step with everything through its MCP

> run my outbound

> check my replies

## Skills

| Skill | Does | Typical schedule |
| --- | --- | --- |
| `outbound` | find → qualify → research → write → send → record | Weekday mornings |
| `follow-ups` | inbox → reply / follow-up → book → send → record | Hourly |
| `ostack-setup` | Interviews you, writes and tests customizations, reviews updates | When you want to change something |

## How customization works

Each skill is made of **named steps** (`ostack steps`): `find`, `qualify`, `research`, `write`, `send`, `record`, `inbox`, `reply`, `follow-up`, `book` and `report`. Every step ships with a sensible default. Before each step, the agent runs `ostack context <step>`, which returns the default plus your notes for that step.

Your notes are markdown files in your workspace, written by the agent from what you tell it:

```
~/gtm/
  ostack.json            managed by the CLI: mode, limits, packs, which setup questions were asked
  custom/                your team's notes (commit these)
    about.md             what you sell, the one ask, proof, never-claim
    voice.md             how you write, real samples, signature
    write.md             e.g. "always use this template: ..."
    send.md              e.g. "send from sam@ in Outlook web"
    after-record.md      e.g. "update Lightfield: stages ..."
    learnings.md         corrections you asked the agent to remember
  custom.local/          your personal notes, gitignored, which win over the team's
  campaigns/<name>/      notes for one campaign, e.g. fundraising next to sales
  .ostack/ledger.db      every lead, message, reply and opt-out (SQLite)
```

- A note named after a step (`write.md`) refines that step. `before-<step>.md` and `after-<step>.md` run around it. Any other note is context for every run.
- Layers stack, lowest priority first: step defaults, then **packs** (shared starting points such as `b2b-founders`, `recruiting`, `fundraising`, `gmail`, `outlook-web`), then `custom/`, then the campaign, then `custom.local/`. Later layers win.
- Notes hold only what differs from the default, so improvements to everything else keep arriving.
- Anything can be customized, including adding tools ostack has never heard of. Where a customization needs code (an email API, a webhook), the agent puts a small script in your workspace and a note saying when to run it.

## Updates

```bash
ostack upgrade
```

This pulls the new baseline: skills, step defaults, packs and the CLI. Your workspace is never touched. The ledger upgrades itself, after making a backup. Then tell your agent **"review ostack updates"**. `ostack setup status` lists what it covers:
- only the setup questions that are new
- steps you customized whose default changed, so you can keep, change or drop your note
- notes for steps that were renamed or removed

Notes for a renamed step keep working until you rename them.

## Guarantees

These hold whatever your notes say, because the CLI enforces them rather than the prompts:

- Every message is **reserved** with its exact text, sent, then **receipted** with the provider's ID. A lead never has two unfinished messages.
- If an outcome is unknown, it is checked against the real mailbox. It is never resent blindly.
- A person is never added twice, and the people-per-company limit holds across campaigns.
- Bounces and opt-outs block the address permanently.
- A reply pauses that person's sequence.
- Daily limits and `max_touches` are hard ceilings.
- Messages with unfilled placeholders are rejected.

## CLI

`ostack help` lists every command. Every command prints JSON for the agent. The ones you might run yourself are `ostack doctor`, `ostack status`, `ostack context`, `ostack settings show`, `ostack leads list` and `ostack suppress --email <x> --reason <why>`.

## Upgrading from 0.1

0.1 used `playbooks/` and `ostack.yaml`. To move a 0.1 workspace:
- Run `ostack init` in the same folder, then "set up ostack". The agent can read your old playbook files to answer most questions.
- Your ledger migrates automatically, and old leads keep their playbook name as their campaign.

## Responsible use

You are responsible for following the law where you and your recipients are (CAN-SPAM, GDPR, CASL and others) and each platform's terms, including LinkedIn's. Start in draft mode, keep volumes low, honor every opt-out, and only send what you would send by hand.

## Development

```bash
bun test ./tests
bun run src/cli.ts help
```

- Skills (`skills/`) and step defaults (`steps/`) are plain Markdown.
- Step ids and setup question ids are the stable surface customizations attach to. Rename a step only with `renamed_from` in its frontmatter. When a step's default changes meaningfully, bump its `changed` version.
- New setup questions go in [`questions.md`](skills/ostack-setup/references/questions.md) with a `Since` version.
- New packs are welcome in `packs/`.

## License

MIT
