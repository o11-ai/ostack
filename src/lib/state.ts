import { join } from "node:path";
import { OstackError } from "./errors.ts";
import { isRecord } from "./paths.ts";
import { parseSchedule, storeSchedule, type ScheduleSpec } from "./schedule.ts";
import { checkTimeZone, systemTimeZone } from "./time.ts";

/** The one file the CLI owns in a workspace. People and agents change it through commands, never by hand. */
export const STATE_FILE = "ostack.json";
export const STATE_FORMAT = 2;

export type Answer = { version: string; skipped: boolean };

/** Each enabled module's own corner of ostack.json. Core never interprets `settings`; the module does. */
export type ModuleState = { packs: string[]; settings: Record<string, unknown> };

/** A host (claude, codex, cron) where a schedule was created, so status can say what exists and where. */
export type Installed = { name: string; at: string };

export type ScheduleState = { spec: ScheduleSpec; enabled: boolean; installed: Record<string, Installed> };

export type State = {
  format: number;
  /** The ostack version whose changes the user has reviewed with ostack-setup. */
  reviewed: string;
  /** IANA timezone that schedules and send windows use. */
  timezone: string;
  /** Setup questions answered, by id: core ones bare ("timezone"), module ones qualified ("gtm/about"). */
  answered: Record<string, Answer>;
  modules: Record<string, ModuleState>;
  /** Workflow schedules by ref ("gtm/outbound"). A workflow without an entry uses its module's default, unscheduled. */
  schedules: Record<string, ScheduleState>;
};

export function defaultState(version: string, modules: string[]): State {
  return {
    format: STATE_FORMAT,
    reviewed: version,
    timezone: systemTimeZone(),
    answered: {},
    modules: Object.fromEntries(modules.map((id) => [id, { packs: [], settings: {} }])),
    schedules: {},
  };
}

/** Core setup questions that existed before modules, so their answers keep their bare id. */
const CORE_QUESTIONS = new Set(["schedule", "timezone"]);

/**
 * Reads ostack.json, upgrading the flat 0.2/0.3 layout (mode, limits, packs and answers at the top) into the gtm module.
 * `migrated` tells the caller to write the new layout back.
 */
export async function readState(root: string): Promise<{ state: State; migrated: boolean }> {
  const path = join(root, STATE_FILE);
  let raw: unknown;
  try {
    raw = await Bun.file(path).json();
  } catch {
    throw new OstackError("invalid_workspace", `${path} is not valid JSON. Restore it from git or run "ostack init" again.`);
  }
  if (!isRecord(raw)) throw new OstackError("invalid_workspace", `${path} must be a JSON object.`);
  const legacy = raw.format === undefined;
  const answered: Record<string, Answer> = {};
  if (isRecord(raw.answered)) {
    for (const [id, value] of Object.entries(raw.answered)) {
      if (!isRecord(value) || typeof value.version !== "string") continue;
      const key = legacy && !CORE_QUESTIONS.has(id) ? `gtm/${id}` : id;
      answered[key] = { version: value.version, skipped: value.skipped === true };
    }
  }
  const modules: Record<string, ModuleState> = {};
  if (legacy) {
    modules.gtm = {
      packs: strings(raw.packs),
      settings: { mode: raw.mode, limits: raw.limits, follow_up_days: raw.follow_up_days, send_window: null },
    };
  } else if (isRecord(raw.modules)) {
    for (const [id, value] of Object.entries(raw.modules)) {
      const module = isRecord(value) ? value : {};
      modules[id] = { packs: strings(module.packs), settings: isRecord(module.settings) ? module.settings : {} };
    }
  }
  const schedules: Record<string, ScheduleState> = {};
  if (isRecord(raw.schedules)) {
    for (const [ref, value] of Object.entries(raw.schedules)) {
      if (!isRecord(value) || !isRecord(value.spec)) continue;
      const installed: Record<string, Installed> = {};
      if (isRecord(value.installed)) {
        for (const [host, entry] of Object.entries(value.installed)) {
          if (isRecord(entry) && typeof entry.name === "string") installed[host] = { name: entry.name, at: String(entry.at ?? "") };
        }
      }
      schedules[ref] = { spec: parseSchedule(value.spec), enabled: value.enabled !== false, installed };
    }
  }
  const state: State = {
    format: STATE_FORMAT,
    reviewed: typeof raw.reviewed === "string" ? raw.reviewed : "0.0.0",
    timezone: typeof raw.timezone === "string" ? checkTimeZone(raw.timezone) : systemTimeZone(),
    answered,
    modules,
    schedules,
  };
  return { state, migrated: legacy };
}

export async function writeState(root: string, state: State): Promise<void> {
  const schedules = Object.fromEntries(
    Object.entries(state.schedules).map(([ref, entry]) => [ref, { ...entry, spec: storeSchedule(entry.spec) }]),
  );
  await Bun.write(join(root, STATE_FILE), `${JSON.stringify({ ...state, schedules }, null, 2)}\n`);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
