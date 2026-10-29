// Sandboxed stand-ins for a mailbox, CRM, calendar and the web. Nothing leaves this machine.
// Usage: mock.ts <tool> <command> [--flag value ...]. State lives in $MOCK_DIR.
import { appendFileSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.MOCK_DIR!;
mkdirSync(dir, { recursive: true });
const [tool, cmd, ...rest] = Bun.argv.slice(2);
const flags: Record<string, string> = {};
const pos: string[] = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i]!;
  if (a.startsWith("--")) {
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) flags[a.slice(2)] = "true";
    else { flags[a.slice(2)] = next; i++; }
  } else pos.push(a);
}
const log = (file: string, row: object) => appendFileSync(join(dir, file), JSON.stringify(row) + "\n");
const rows = (file: string): Record<string, string>[] =>
  existsSync(join(dir, file)) ? readFileSync(join(dir, file), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const out = (value: unknown) => console.log(JSON.stringify(value, null, 2));
const fail = (msg: string, code = 1) => { console.error(JSON.stringify({ error: msg })); process.exit(code); };
const id = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;
const body = async () => {
  if (flags["body-file"] === "-") return await Bun.stdin.text();
  if (flags["body-file"]) return readFileSync(flags["body-file"], "utf8");
  return flags.body ?? "";
};
const ACCOUNT = process.env.MOCK_ACCOUNT ?? "sam@tracewell.example";
log("calls.jsonl", { at: new Date().toISOString(), tool, cmd, flags, pos });

const HELP: Record<string, string> = {
  mail: `mail (connected mailbox for ${ACCOUNT})
  mail whoami
  mail send --to <email> --subject <s> (--body <text> | --body-file <file|->) [--thread <thread_id>]   -> message_id, thread_id
  mail draft --to <email> --subject <s> (--body | --body-file) [--thread <thread_id>]                    -> draft_id
  mail drafts                      list drafts still unsent
  mail send-draft <draft_id>       send a draft as is            -> message_id, thread_id
  mail delete-draft <draft_id>
  mail sent [--to <email>]         list sent messages
  mail inbox [--since <iso>]       list received messages
  mail thread <thread_id>          every message in a thread`,
  crm: `crm (Pipedrift CRM)
  crm stages
  crm create --name <n> --email <e> --company <c> [--stage <s>]   -> the record as JSON (its id is .id)
  crm get <id> | crm search <text> | crm list
  crm update <id> [--stage <s>] [--note <text>]
  crm delete <id>`,
  cal: `cal (Google Calendar for ${ACCOUNT})
  cal slots [--days 5] [--minutes 15]      open slots (America/New_York)
  cal invite --to <email> --start <iso> --minutes <n> --title <t> [--description <d>]   -> event_id
  cal events`,
  scheduler: `scheduler (Claude Desktop scheduled tasks on this computer)
  scheduler create --name <kebab-name> --folder <path> --cron "<5-field cron, local time>" --instructions <text>
  scheduler list
  scheduler run <name>        run it once now (prints what the run would start with)
  scheduler delete <name>`,
  web: `web (internet access in this sandbox)
  web search <query>      search results
  web fetch <url>         page text`,
};

if (!cmd || cmd === "help") { console.log(HELP[tool!] ?? "unknown tool"); process.exit(0); }

if (tool === "mail") {
  if (cmd === "whoami") out({ account: ACCOUNT });
  else if (cmd === "send" || cmd === "draft") {
    if (!flags.to || !flags.subject) fail("--to and --subject are required");
    const text = await body();
    if (!text.trim()) fail("empty body");
    if (cmd === "draft") {
      const draft = { draft_id: id("draft"), to: flags.to, subject: flags.subject, body: text, thread_id: flags.thread ?? null, at: new Date().toISOString() };
      log("drafts.jsonl", draft); out({ draft_id: draft.draft_id });
    } else {
      const thread = flags.thread ?? id("thr");
      const msg = { message_id: id("msg"), thread_id: thread, from: ACCOUNT, to: flags.to, subject: flags.subject, body: text, at: new Date().toISOString() };
      log("sent.jsonl", msg);
      // Fault injection: the send goes through but the tool reports a timeout.
      const faults = join(dir, "fail-next-send");
      if (existsSync(faults)) { unlinkSync(faults); fail("network timeout while waiting for the server response", 75); }
      out({ message_id: msg.message_id, thread_id: msg.thread_id });
    }
  } else if (cmd === "send-draft" || cmd === "delete-draft") {
    const d = rows("drafts.jsonl").find((r) => r.draft_id === pos[0]);
    const gone = new Set(rows("drafts-sent.jsonl").map((r) => r.draft_id));
    if (!d || gone.has(d.draft_id!)) fail("no such draft");
    log("drafts-sent.jsonl", { draft_id: d!.draft_id, action: cmd });
    if (cmd === "delete-draft") out({ deleted: d!.draft_id });
    else {
      const msg = { message_id: id("msg"), thread_id: d!.thread_id ?? id("thr"), from: ACCOUNT, to: d!.to, subject: d!.subject, body: d!.body, at: new Date().toISOString() };
      log("sent.jsonl", msg); out({ message_id: msg.message_id, thread_id: msg.thread_id });
    }
  } else if (cmd === "drafts") {
    const sentDrafts = new Set(rows("drafts-sent.jsonl").map((r) => r.draft_id));
    out(rows("drafts.jsonl").filter((d) => !sentDrafts.has(d.draft_id!)));
  } else if (cmd === "sent") out(rows("sent.jsonl").filter((m) => !flags.to || m.to === flags.to));
  else if (cmd === "inbox") out(rows("inbox.jsonl").filter((m) => !flags.since || m.at! >= flags.since));
  else if (cmd === "thread") {
    const t = pos[0] ?? fail("thread id needed");
    out([...rows("sent.jsonl"), ...rows("inbox.jsonl")].filter((m) => m.thread_id === t).sort((a, b) => a.at!.localeCompare(b.at!)));
  } else fail(`unknown mail command ${cmd}`);
} else if (tool === "crm") {
  const file = join(dir, "crm.json");
  const db: Record<string, Record<string, unknown>> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const save = () => writeFileSync(file, JSON.stringify(db, null, 2));
  const STAGES = ["Lead", "Contacted", "Replied", "Meeting", "Won", "Lost"];
  if (cmd === "stages") out(STAGES);
  else if (cmd === "create") {
    if (!flags.name || !flags.email) fail("--name and --email are required");
    if (flags.stage && !STAGES.includes(flags.stage)) fail(`unknown stage; use one of ${STAGES.join(", ")}`);
    const rec = { id: id("p"), name: flags.name, email: flags.email, company: flags.company ?? null, stage: flags.stage ?? "Lead", notes: [] as string[] };
    db[rec.id] = rec; save(); out(rec);
  } else if (cmd === "get") out(db[pos[0]!] ?? fail("not found"));
  else if (cmd === "list") out(Object.values(db));
  else if (cmd === "search") out(Object.values(db).filter((r) => JSON.stringify(r).toLowerCase().includes((pos[0] ?? "").toLowerCase())));
  else if (cmd === "update") {
    const rec = db[pos[0]!] ?? fail("not found");
    if (flags.stage) { if (!STAGES.includes(flags.stage)) fail(`unknown stage; use one of ${STAGES.join(", ")}`); rec.stage = flags.stage; }
    if (flags.note) (rec.notes as string[]).push(flags.note);
    save(); out(rec);
  } else if (cmd === "delete") { delete db[pos[0]!]; save(); out({ deleted: pos[0] }); }
  else fail(`unknown crm command ${cmd}`);
} else if (tool === "cal") {
  if (cmd === "slots") {
    const days = Number(flags.days ?? 5);
    const slots: string[] = [];
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    for (let d = 1; d <= days; d++) {
      const day = new Date(start.getTime() + d * 864e5);
      if ([0, 6].includes(day.getUTCDay())) continue;
      for (const h of [14, 16, 19]) slots.push(new Date(day.getTime() + h * 36e5).toISOString());
    }
    out({ timezone: "America/New_York", minutes: Number(flags.minutes ?? 15), slots });
  } else if (cmd === "invite") {
    if (!flags.to || !flags.start) fail("--to and --start are required");
    const ev = { event_id: id("evt"), ...flags };
    log("events.jsonl", ev); out({ event_id: ev.event_id });
  } else if (cmd === "events") out(rows("events.jsonl"));
  else fail(`unknown cal command ${cmd}`);
} else if (tool === "scheduler") {
  const file = join(dir, "scheduled.json");
  const tasks: Record<string, Record<string, string>> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const save = () => writeFileSync(file, JSON.stringify(tasks, null, 2));
  if (cmd === "create") {
    for (const key of ["name", "folder", "cron", "instructions"]) if (!flags[key]) fail(`--${key} is required`);
    if (!/^[a-z0-9-]+$/.test(flags.name!)) fail("name must be lowercase kebab-case");
    if (flags.cron!.trim().split(/\s+/).length !== 5) fail("cron must have 5 fields");
    if (tasks[flags.name!]) fail("a task with that name exists; delete it first");
    tasks[flags.name!] = { name: flags.name!, folder: flags.folder!, cron: flags.cron!, instructions: flags.instructions!, created: new Date().toISOString() };
    save(); out(tasks[flags.name!]);
  } else if (cmd === "list") out(Object.values(tasks));
  else if (cmd === "run") { const task = tasks[pos[0]!] ?? fail("no such task"); out({ started: task!.name, prompt: task!.instructions, folder: task!.folder }); }
  else if (cmd === "delete") { delete tasks[pos[0]!]; save(); out({ deleted: pos[0] }); }
  else fail(`unknown scheduler command ${cmd}`);
} else if (tool === "web") {
  const sites = join(import.meta.dir, "fixtures", "sites");
  const pages = readdirSync(sites).map((f) => ({ url: `https://${f.replace(/\.md$/, "")}`, text: readFileSync(join(sites, f), "utf8") }));
  if (cmd === "search") {
    const words = pos.join(" ").toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const hits = pages
      .map((p) => ({ ...p, score: words.filter((w) => p.text.toLowerCase().includes(w)).length }))
      .filter((p) => p.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
    out(hits.map((h) => ({ url: h.url, snippet: h.text.split("\n").filter(Boolean).slice(0, 2).join(" ").slice(0, 200) })));
  } else if (cmd === "fetch") {
    const url = (pos[0] ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
    const page = pages.find((p) => p.url === `https://${url}`);
    if (!page) fail("404 not found");
    console.log(page!.text);
  } else fail(`unknown web command ${cmd}`);
} else fail(`unknown tool ${tool}`);
