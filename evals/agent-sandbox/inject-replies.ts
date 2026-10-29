// Puts replies into a sandbox inbox, threaded onto the last message sent to each address.
// Usage: bun inject-replies.ts <run dir> '<json: [{"to":"dana@ledgerly.example","from":"Dana <dana@...>","body":"...","hours_ago":5}]>'
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Reply = { to: string; from: string; body: string; hours_ago?: number; subject?: string };
const [run, json] = Bun.argv.slice(2);
const mock = join(run!, "mock");
const sent = readFileSync(join(mock, "sent.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
for (const reply of JSON.parse(json!) as Reply[]) {
  const last = sent.filter((message) => message.to === reply.to).pop();
  if (!last) {
    console.error(`nothing was sent to ${reply.to}; skipped`);
    continue;
  }
  const at = new Date(Date.now() - (reply.hours_ago ?? 1) * 36e5).toISOString();
  const message = { message_id: `in_${crypto.randomUUID().slice(0, 8)}`, thread_id: last.thread_id, from: reply.from, to: last.from, subject: reply.subject ?? `Re: ${last.subject}`, body: reply.body, at };
  appendFileSync(join(mock, "inbox.jsonl"), `${JSON.stringify(message)}\n`);
  console.log(`queued reply from ${reply.from}`);
}
