import { existsSync } from "node:fs";
import { join } from "node:path";
import { OstackError } from "./errors.ts";
import { isRecord, playbookDir, type Workspace } from "./workspace.ts";

export const CHANNELS = ["email", "linkedin"] as const;
export type Channel = (typeof CHANNELS)[number];
export const MODES = ["draft", "send"] as const;
export type Mode = (typeof MODES)[number];
export const SOURCE_TYPES = ["csv", "web", "tool"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export type Step = { channel: Channel; wait_days: number; brief: string };
export type Source = { type: SourceType; path?: string; query?: string; name?: string; notes?: string };

export type Playbook = {
  name: string;
  mode: Mode;
  goal: string;
  sender: { name: string; title?: string; email?: string; linkedin?: string; signature?: string };
  target: { who: string; contact: string; qualify: string[]; exclude: string[] };
  sources: Source[];
  sequence: Step[];
  limits: { new_per_day: number; touches_per_day: number; per_company: number; research_per_run: number };
  writing: { max_words: number; banned: string[]; rules: string[] };
};

export type LoadedPlaybook = { playbook: Playbook; dir: string; offerPath: string; voicePath: string };

/** Marker left in template files so `doctor` can flag playbooks nobody has edited yet. */
export const EXAMPLE_MARKER = "ostack:example";

class Collector {
  readonly errors: string[] = [];

  record(value: unknown, path: string): Record<string, unknown> {
    if (isRecord(value)) return value;
    this.errors.push(`${path} must be a mapping.`);
    return {};
  }

  text(source: Record<string, unknown>, key: string, path: string, needed: boolean): string | undefined {
    const value = source[key];
    if (value === undefined || value === null) {
      if (needed) this.errors.push(`${path}.${key} is required.`);
      return undefined;
    }
    if (typeof value !== "string" || value.trim() === "") {
      this.errors.push(`${path}.${key} must be non-empty text.`);
      return undefined;
    }
    return value.trim();
  }

  list(source: Record<string, unknown>, key: string, path: string): string[] {
    const value = source[key];
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      this.errors.push(`${path}.${key} must be a list of text.`);
      return [];
    }
    return value as string[];
  }

  count(source: Record<string, unknown>, key: string, path: string, fallback: number, min: number): number {
    const value = source[key];
    if (value === undefined || value === null) return fallback;
    if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
      this.errors.push(`${path}.${key} must be a whole number of at least ${min}.`);
      return fallback;
    }
    return value;
  }

  choice<T extends string>(value: unknown, allowed: readonly T[], path: string, fallback?: T): T {
    if (value === undefined && fallback !== undefined) return fallback;
    if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
    this.errors.push(`${path} must be one of: ${allowed.join(", ")}.`);
    return fallback ?? allowed[0]!;
  }
}

export function validatePlaybook(raw: unknown, expectedName: string): { playbook: Playbook; errors: string[] } {
  const c = new Collector();
  const root = c.record(raw, "playbook");
  const name = c.text(root, "name", "playbook", true) ?? expectedName;
  if (name !== expectedName) c.errors.push(`playbook.name "${name}" must match its folder "${expectedName}".`);

  const sender = c.record(root.sender, "sender");
  const target = c.record(root.target, "target");
  const limits = c.record(root.limits ?? {}, "limits");
  const writing = c.record(root.writing ?? {}, "writing");

  const sources: Source[] = [];
  if (!Array.isArray(root.sources) || root.sources.length === 0) c.errors.push("sources needs at least one entry.");
  else
    root.sources.forEach((value, index) => {
      const path = `sources[${index}]`;
      const entry = c.record(value, path);
      const type = c.choice(entry.type, SOURCE_TYPES, `${path}.type`);
      const source: Source = { type };
      const field = type === "csv" ? "path" : type === "web" ? "query" : "name";
      source[field] = c.text(entry, field, path, true);
      const notes = c.text(entry, "notes", path, false);
      if (notes) source.notes = notes;
      sources.push(source);
    });

  const sequence: Step[] = [];
  if (!Array.isArray(root.sequence) || root.sequence.length === 0) c.errors.push("sequence needs at least one step.");
  else
    root.sequence.forEach((value, index) => {
      const path = `sequence[${index}]`;
      const entry = c.record(value, path);
      const waitDays = c.count(entry, "wait_days", path, 0, 0);
      if (index === 0 && waitDays !== 0) c.errors.push("sequence[0].wait_days must be 0; the first touch goes out when the lead is ready.");
      if (index > 0 && waitDays < 1) c.errors.push(`${path}.wait_days must be at least 1.`);
      sequence.push({
        channel: c.choice(entry.channel, CHANNELS, `${path}.channel`),
        wait_days: waitDays,
        brief: c.text(entry, "brief", path, true) ?? "",
      });
    });

  const playbook: Playbook = {
    name,
    mode: c.choice(root.mode, MODES, "mode", "draft"),
    goal: c.text(root, "goal", "playbook", true) ?? "",
    sender: {
      name: c.text(sender, "name", "sender", true) ?? "",
      title: c.text(sender, "title", "sender", false),
      email: c.text(sender, "email", "sender", false),
      linkedin: c.text(sender, "linkedin", "sender", false),
      signature: c.text(sender, "signature", "sender", false),
    },
    target: {
      who: c.text(target, "who", "target", true) ?? "",
      contact: c.text(target, "contact", "target", true) ?? "",
      qualify: c.list(target, "qualify", "target"),
      exclude: c.list(target, "exclude", "target"),
    },
    sources,
    sequence,
    limits: {
      new_per_day: c.count(limits, "new_per_day", "limits", 20, 1),
      touches_per_day: c.count(limits, "touches_per_day", "limits", 50, 1),
      per_company: c.count(limits, "per_company", "limits", 1, 1),
      research_per_run: c.count(limits, "research_per_run", "limits", 25, 1),
    },
    writing: {
      max_words: c.count(writing, "max_words", "writing", 150, 10),
      banned: c.list(writing, "banned", "writing"),
      rules: c.list(writing, "rules", "writing"),
    },
  };

  if (playbook.target.qualify.length === 0) c.errors.push("target.qualify needs at least one rule.");
  if (playbook.limits.touches_per_day < playbook.limits.new_per_day) {
    c.errors.push("limits.touches_per_day must be at least limits.new_per_day.");
  }
  const channels = new Set(playbook.sequence.map((step) => step.channel));
  if (channels.has("email") && !playbook.sender.email) c.errors.push("sender.email is required for email steps.");
  if (channels.has("linkedin") && !playbook.sender.linkedin) c.errors.push("sender.linkedin is required for linkedin steps.");
  return { playbook, errors: c.errors };
}

export async function loadPlaybook(workspace: Workspace, name: string): Promise<LoadedPlaybook> {
  const dir = playbookDir(workspace, name);
  const raw = Bun.YAML.parse(await Bun.file(join(dir, "playbook.yaml")).text());
  const { playbook, errors } = validatePlaybook(raw, name);
  const offerPath = join(dir, "offer.md");
  const voicePath = join(dir, "voice.md");
  if (!existsSync(offerPath)) errors.push("offer.md is missing.");
  if (!existsSync(voicePath)) errors.push("voice.md is missing.");
  if (errors.length > 0) {
    throw new OstackError("invalid_playbook", `Playbook "${name}" has ${errors.length} problem(s).`, { errors });
  }
  return { playbook, dir, offerPath, voicePath };
}
