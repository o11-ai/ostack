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
  answered: Record<string, Answer>;
};

export const DEFAULT_LIMITS: Limits = { new_per_day: 20, touches_per_day: 60, per_company: 1, max_touches: 4 };

export function defaultState(version: string): State {
  return { reviewed: version, mode: "draft", limits: { ...DEFAULT_LIMITS }, packs: [], answered: {} };
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
  const state: State = {
    reviewed: typeof raw.reviewed === "string" ? raw.reviewed : "0.0.0",
    mode: raw.mode === "send" ? "send" : "draft",
    limits: Object.fromEntries(
      LIMIT_KEYS.map((key) => {
        const value = limits[key];
        return [key, typeof value === "number" && Number.isInteger(value) && value > 0 ? value : DEFAULT_LIMITS[key]];
      }),
    ) as Limits,
    packs: Array.isArray(raw.packs) ? raw.packs.filter((pack): pack is string => typeof pack === "string") : [],
    answered,
  };
  return state;
}

export async function writeState(root: string, state: State): Promise<void> {
  await Bun.write(join(root, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`);
}

/** Applies one `ostack settings set` change, keeping the limits consistent with each other. */
export function applySetting(state: State, key: string, value: string): State {
  if (key === "mode") {
    if (!(MODES as readonly string[]).includes(value)) throw new OstackError("invalid_flag", "mode must be draft or send.");
    return { ...state, mode: value as Mode };
  }
  if (!(LIMIT_KEYS as readonly string[]).includes(key)) {
    throw new OstackError("unknown_setting", `Unknown setting "${key}".`, { settings: ["mode", ...LIMIT_KEYS] });
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new OstackError("invalid_flag", `${key} must be a positive whole number.`);
  const limits = { ...state.limits, [key]: number };
  if (limits.touches_per_day < limits.new_per_day) {
    throw new OstackError("invalid_flag", "touches_per_day must be at least new_per_day, since every first message is also a touch.");
  }
  return { ...state, limits };
}
