import { join } from "node:path";
import { OstackError } from "./errors.ts";
import { isRecord } from "./paths.ts";

/** The one file the CLI owns in a workspace. People and agents change it through commands, never by hand. */
export const STATE_FILE = "ostack.json";

export const MODES = ["draft", "send"] as const;
export type Mode = (typeof MODES)[number];

export type Limits = {
  new_per_day: number;
  touches_per_day: number;
  per_company: number;
  max_touches: number;
};

export const LIMIT_KEYS = ["new_per_day", "touches_per_day", "per_company", "max_touches"] as const;

export type Answer = { version: string; skipped: boolean };

export type State = {
  /** The ostack version whose changes the user has reviewed with ostack-setup. */
  reviewed: string;
  mode: Mode;
  limits: Limits;
  /** Installed packs, lowest priority first. */
  packs: string[];
  /** Days to wait before each follow-up, in order. Its length plus the first message is max_touches. */
  follow_up_days: number[];
  answered: Record<string, Answer>;
};

export const DEFAULT_LIMITS: Limits = { new_per_day: 20, touches_per_day: 60, per_company: 1, max_touches: 4 };
export const DEFAULT_FOLLOW_UP_DAYS = [3, 4, 7];

export function defaultState(version: string): State {
  return {
    reviewed: version,
    mode: "draft",
    limits: { ...DEFAULT_LIMITS },
    packs: [],
    follow_up_days: [...DEFAULT_FOLLOW_UP_DAYS],
    answered: {},
  };
}

/** Keeps max_touches and the follow-up schedule in step: the schedule is cut or extended (repeating its last gap) to fit. */
export function fitSchedule(days: number[], maxTouches: number): number[] {
  const wanted = Math.max(0, maxTouches - 1);
  const fill = days.at(-1) ?? DEFAULT_FOLLOW_UP_DAYS.at(-1)!;
  return Array.from({ length: wanted }, (_, index) => days[index] ?? fill);
}

/** Days until the touch after `touch`, or null when `touch` is the last one. */
export function nextGap(state: Pick<State, "follow_up_days" | "limits">, touch: number): number | null {
  if (touch >= state.limits.max_touches) return null;
  return state.follow_up_days[touch - 1] ?? null;
}

export async function readState(root: string): Promise<State> {
  const path = join(root, STATE_FILE);
  let raw: unknown;
  try {
    raw = await Bun.file(path).json();
  } catch {
    throw new OstackError("invalid_workspace", `${path} is not valid JSON. Restore it from git or run "ostack init" again.`);
  }
  if (!isRecord(raw)) throw new OstackError("invalid_workspace", `${path} must be a JSON object.`);
  const limits = isRecord(raw.limits) ? raw.limits : {};
  const answered: Record<string, Answer> = {};
  if (isRecord(raw.answered)) {
    for (const [id, value] of Object.entries(raw.answered)) {
      if (isRecord(value) && typeof value.version === "string") {
        answered[id] = { version: value.version, skipped: value.skipped === true };
      }
    }
  }
  const parsedLimits = Object.fromEntries(
    LIMIT_KEYS.map((key) => {
      const value = limits[key];
      return [key, typeof value === "number" && Number.isInteger(value) && value > 0 ? value : DEFAULT_LIMITS[key]];
    }),
  ) as Limits;
  // Workspaces from 0.2.0 have no schedule yet: they get the default gaps, fitted to their max_touches.
  const days = Array.isArray(raw.follow_up_days) ? raw.follow_up_days.filter(isGap) : DEFAULT_FOLLOW_UP_DAYS;
  const state: State = {
    reviewed: typeof raw.reviewed === "string" ? raw.reviewed : "0.0.0",
    mode: raw.mode === "send" ? "send" : "draft",
    limits: parsedLimits,
    packs: Array.isArray(raw.packs) ? raw.packs.filter((pack): pack is string => typeof pack === "string") : [],
    follow_up_days: fitSchedule(days, parsedLimits.max_touches),
    answered,
  };
  return state;
}

export async function writeState(root: string, state: State): Promise<void> {
  await Bun.write(join(root, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`);
}

function isGap(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export const SETTING_KEYS = ["mode", ...LIMIT_KEYS, "follow_up_days"] as const;

/** Applies one `ostack settings set` change, keeping the limits consistent with each other. */
export function applySetting(state: State, key: string, value: string): State {
  if (key === "follow_up_days") {
    const days = value === "none" || value === "0" ? [] : value.split(",").map((part) => Number(part.trim()));
    if (!days.every(isGap)) {
      throw new OstackError("invalid_flag", 'follow_up_days is the days before each follow-up, such as "3,4,7", or "none" for no follow-ups.');
    }
    return { ...state, follow_up_days: days, limits: { ...state.limits, max_touches: days.length + 1 } };
  }
  if (key === "mode") {
    if (!(MODES as readonly string[]).includes(value)) throw new OstackError("invalid_flag", "mode must be draft or send.");
    return { ...state, mode: value as Mode };
  }
  if (!(LIMIT_KEYS as readonly string[]).includes(key)) {
    throw new OstackError("unknown_setting", `Unknown setting "${key}".`, { settings: SETTING_KEYS });
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new OstackError("invalid_flag", `${key} must be a positive whole number.`);
  const limits = { ...state.limits, [key]: number };
  if (limits.touches_per_day < limits.new_per_day) {
    throw new OstackError("invalid_flag", "touches_per_day must be at least new_per_day, since every first message is also a touch.");
  }
  return { ...state, limits, follow_up_days: fitSchedule(state.follow_up_days, limits.max_touches) };
}
