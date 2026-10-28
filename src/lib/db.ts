import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  campaign TEXT NOT NULL,
  status TEXT NOT NULL,
  name TEXT,
  title TEXT,
  company TEXT,
  domain TEXT,
  email TEXT UNIQUE,
  linkedin_url TEXT UNIQUE,
  source TEXT,
  research TEXT,
  reason TEXT,
  evidence TEXT,
  fields TEXT,
  step INTEGER NOT NULL DEFAULT 0,
  next_due_at TEXT,
  defer_until TEXT,
  defer_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (email IS NOT NULL OR linkedin_url IS NOT NULL)
);
CREATE INDEX leads_campaign_status ON leads (campaign, status);
CREATE INDEX leads_domain ON leads (domain);

CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads (id),
  campaign TEXT NOT NULL,
  kind TEXT NOT NULL,
  step INTEGER,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  reserved_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  external_id TEXT,
  thread_id TEXT,
  evidence TEXT
);
CREATE UNIQUE INDEX attempts_one_open_per_lead ON attempts (lead_id)
  WHERE status IN ('reserved', 'drafted', 'uncertain');
CREATE INDEX attempts_reserved ON attempts (reserved_at);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads (id),
  type TEXT NOT NULL,
  body TEXT,
  external_id TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (lead_id, external_id)
);

CREATE TABLE suppressions (
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (kind, value)
);
`;

/** Upgrades from each older schema version to the next. Releases only ever add entries here. */
const MIGRATIONS: Record<number, string> = {
  1: `
ALTER TABLE leads RENAME COLUMN playbook TO campaign;
ALTER TABLE attempts RENAME COLUMN playbook TO campaign;
ALTER TABLE leads ADD COLUMN fields TEXT;
DROP INDEX leads_playbook_status;
CREATE INDEX leads_campaign_status ON leads (campaign, status);
DROP INDEX attempts_playbook_reserved;
CREATE INDEX attempts_reserved ON attempts (reserved_at);
`,
};

export function openLedger(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  const row = db.query<{ user_version: number }, []>("PRAGMA user_version").get();
  const version = row?.user_version ?? 0;
  if (version > SCHEMA_VERSION) {
    throw new Error(`Ledger schema ${version} is newer than this ostack (${SCHEMA_VERSION}). Run "ostack upgrade".`);
  }
  if (version === 0) {
    db.transaction(() => {
      db.exec(SCHEMA);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    })();
  } else if (version < SCHEMA_VERSION) {
    if (path !== ":memory:") db.exec(`VACUUM INTO '${backupPath(path, version).replaceAll("'", "''")}'`);
    db.transaction(() => {
      for (let from = version; from < SCHEMA_VERSION; from++) db.exec(MIGRATIONS[from]!);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    })();
  }
  return db;
}

function backupPath(path: string, version: number): string {
  const base = `${path}.v${version}-backup`;
  return existsSync(base) ? `${base}-${Date.now()}` : base;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
