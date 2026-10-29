// Moves a ledger N days into the past, so "3 days later" can be tested now. Also shifts the mock mailbox.
import { Database } from "bun:sqlite";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const [ledger, daysArg, mockDir] = Bun.argv.slice(2);
const ms = Number(daysArg) * 864e5;
const shift = (v: unknown) => typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(Date.parse(v) - ms).toISOString() : v;
const db = new Database(ledger!);
for (const { name } of db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'").all()) {
  const cols = db.query<{ name: string }, []>(`PRAGMA table_info(${name})`).all().map((c) => c.name).filter((c) => /_at$|_until$/.test(c));
  if (!cols.length) continue;
  const key = db.query<{ name: string; pk: number }, []>(`PRAGMA table_info(${name})`).all().find((c) => c.pk)?.name ?? "rowid";
  for (const row of db.query<Record<string, unknown>, []>(`SELECT ${key} AS k, ${cols.join(",")} FROM ${name}`).all()) {
    db.run(`UPDATE ${name} SET ${cols.map((c) => `${c} = ?`).join(",")} WHERE ${key} = ?`, [...cols.map((c) => shift(row[c]) as string), row.k as string]);
  }
}
for (const f of ["sent.jsonl", "drafts.jsonl", "inbox.jsonl"]) {
  const p = join(mockDir!, f); if (!existsSync(p)) continue;
  writeFileSync(p, readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => { const r = JSON.parse(l); r.at = shift(r.at); return JSON.stringify(r); }).join("\n") + "\n");
}
console.log("shifted", daysArg, "days");
