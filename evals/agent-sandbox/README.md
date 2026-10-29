# Agent sandbox

A sandbox for watching a real agent (any model) set up and run ostack, end to end, without contacting anyone. It is how ostack's skills are tested: give a small model the skills and a realistic request, then read what it did and where it got lost.

Each run gets its own `HOME` with ostack installed and stand-ins for the tools an agent would really use:

| Tool | Stands in for |
| --- | --- |
| `mail` | A connected mailbox: send, draft, send-draft, delete-draft, sent, inbox, thread. A file named `fail-next-send` in the run's `mock/` makes the next send go out but report a timeout. |
| `crm` | A CRM with fixed stages |
| `cal` | A calendar with open slots |
| `web` | Search and fetch over the fictional sites in `fixtures/sites` (one hides a prompt injection) |
| `askuser` | The user. Answers by topic from `persona.json`; `mock/user-overrides.json` changes an answer for one run |

Every company, person and address in `fixtures/` is fictional and uses `.example` domains.

## A test round

```bash
cd evals/agent-sandbox
./new-run.sh setup-1                                  # fresh machine
./prompt.sh setup-1 "set up ostack"                   # paste this as the agent's prompt

./new-run.sh outbound-1 --from setup-1 --cwd ostack      # continue from that workspace
touch runs/outbound-1/mock/fail-next-send
./prompt.sh outbound-1 "the previews looked good. switch to sending and run my outbound"

./new-run.sh replies-1 --from outbound-1 --cwd ostack
bun timewarp.ts runs/replies-1/home/ostack/.ostack/gtm.db 2.1 runs/replies-1/mock   # two days later
bun inject-replies.ts runs/replies-1 '[{"to":"dana@ledgerly.example","from":"Dana <dana@ledgerly.example>","body":"happy to chat, what times work?"}]'
./prompt.sh replies-1 "did anyone reply?"
```

For a scheduled run, give the agent the output of `ostack prompt follow-ups` instead of a user message, and drop the `askuser` line from the prompt.

## What to read afterwards

- The agent's final message: the preamble asks for a report and an honest friction log.
- `mock/ostack-calls.jsonl`: every ostack command, its exit code and output. Non-zero exits are the first place to look.
- `mock/sent.jsonl`, `drafts.jsonl`, `crm.json`, `events.jsonl`: what actually reached the outside world. Check that nobody got two messages, opt-outs got nothing, and repliers got no cold follow-up.
- `mock/questions.jsonl`: what the agent asked the user, in order.
- `home/ostack/custom/`: the notes setup wrote. Look for settings copied into notes and facts stated twice.

`askuser` answers by topic, so a follow-up question on the same topic gets the same answer. Agents sometimes report that as the user repeating themselves; it is a limit of the stand-in, not of the skills.

Fix what the run exposed, then run the same round again.
