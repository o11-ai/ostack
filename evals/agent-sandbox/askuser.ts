// The simulated user. Logs the question and returns what Sam would say about that topic.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
const args = Bun.argv.slice(2);
const t = args.indexOf("--topic");
const topic = t >= 0 ? args[t + 1]! : "other";
const question = args.filter((_, i) => i !== t && i !== t + 1).join(" ");
const persona = JSON.parse(readFileSync(join(import.meta.dir, "persona.json"), "utf8"));
const extra = process.env.MOCK_DIR ? join(process.env.MOCK_DIR, "user-overrides.json") : "";
let overrides: Record<string, string> = {};
try { overrides = JSON.parse(readFileSync(extra, "utf8")); } catch {}
const answer = overrides[topic] ?? persona[topic] ?? persona.other;
appendFileSync(join(process.env.MOCK_DIR!, "questions.jsonl"), JSON.stringify({ at: new Date().toISOString(), topic, question, answer }) + "\n");
console.log(`Sam: ${answer}`);
