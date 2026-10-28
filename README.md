# ostack

Open-source go-to-market skills for coding agents, from [o11](https://o11.ai).

The first skill is **cold outbound** you can configure. You describe your offer, who to reach, how you write, where leads come from and how often to follow up. Your agent (Claude Code, Codex, Cursor, Gemini) then runs the same loop every day: source, qualify, research, write, send, follow up, and answer replies. A local ledger guarantees that no one is contacted twice and that opt-outs stick.

There is no hosted backend and no account. Your agent sends through the mail, LinkedIn and calendar tools it already has, and ostack keeps the method and the record.

## Install

Requires [Bun](https://bun.sh) 1.2.21+ and git.

```bash
git clone --depth 1 https://github.com/o11-ai/ostack.git ~/ostack
~/ostack/setup                 # Claude Code; or --host codex|cursor|gemini|auto
```

`setup` symlinks the skills into your agent's skills folder and links `ostack` into `~/.local/bin`. Nothing is copied, so `ostack upgrade` (a `git pull`) updates every agent at once. To see what is installed, run `./setup --status`. To remove it, run `./setup --uninstall`.

## Quick start

```bash
mkdir ~/gtm && cd ~/gtm
ostack init --from b2b-founders          # or recruiting, fundraising; see: ostack templates
```

Then ask your agent to **"set up my outbound playbook"**. The `ostack-setup` skill interviews you, writes the playbook, and drafts two real example messages for you to approve. After that:

> run my outbound

For a daily run, schedule the output of `ostack prompt` with Claude's `/schedule`, a Codex automation, or cron.

## How it fits together

```
skills/cold-outbound     the method: same for everyone
skills/ostack-setup      turns an interview into a playbook
playbooks/<name>/        yours: playbook.yaml, offer.md, voice.md
.ostack/ledger.db        yours: every lead, message, reply and opt-out (SQLite)
ostack CLI               the only thing that writes the ledger
```

A workspace is any folder with an `ostack.yaml`. It can hold several playbooks, for example `sales-founders`, `recruiting-backend` and `fundraising-seed`. They share one ledger, so a person or company contacted by one playbook is not contacted again by another.

### The playbook

Everything specific to you lives in `playbooks/<name>/`. See the [full reference](skills/ostack-setup/references/playbook.md).

| Field | Controls |
| --- | --- |
| `mode` | `draft` (you approve every message) or `send` |
| `sender` | Who messages go out as, and the signature |
| `target` | Who fits: rules to prove, exclusions, the role to contact |
| `sources` | Where leads come from: your CSV, web research queries, or connected tools (Apollo, Clay, a CRM MCP) |
| `sequence` | Steps, channels (email, LinkedIn), wait days, and a brief for each touch |
| `limits` | First touches per day, total touches per day, people per company, research per run |
| `writing` | Word limit, banned phrases (enforced), style rules |

`offer.md` holds what you offer, your proof and your one ask. `voice.md` holds real messages you sent, so drafts sound like you.

### What every run does

`ostack due` returns the work in order: **reconcile** messages whose outcome is unknown, answer **replies**, send due **follow-ups**, send **new** first touches, **qualify** researched leads, then **source** more. The agent repeats until the daily budget is used or the sources run dry.

### Guarantees, enforced by the CLI rather than by prompts

- Every message is **reserved** with its exact text, sent, then **receipted** with the provider's ID. A lead can never have two unfinished attempts.
- If an outcome is unknown, it is reconciled against the real mailbox and never resent.
- Duplicate people across playbooks are rejected, and the people-per-company limit holds across all playbooks.
- Bounces and opt-outs suppress the address permanently.
- A human reply pauses the sequence.
- Daily limits count everything that might have gone out.
- Banned phrases, unfilled placeholders and over-long messages are rejected before sending.

## CLI

```bash
ostack help
```

Every command prints JSON for the agent. The commands you are most likely to run yourself are `ostack status`, `ostack leads list`, `ostack leads show --id <id>`, `ostack suppress --email <x> --reason <why>` and `ostack doctor`.

## Responsible use

You are responsible for following the law where you and your recipients are (CAN-SPAM, GDPR, CASL and others) and each platform's terms, including LinkedIn's. Start in `draft` mode, keep volumes low, honor every opt-out, and only send what you would send by hand.

## Development

```bash
bun test ./tests
bun run src/cli.ts help
```

Skills are plain Markdown in `skills/`. Keep them generic: anything specific to one company belongs in a playbook. Starter playbooks live in `playbooks/`, and new templates for other use cases are welcome.

## License

MIT
