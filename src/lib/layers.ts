import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { OstackError } from "./errors.ts";
import { parseFrontmatter, REPO_ROOT } from "./paths.ts";
import type { Step } from "./steps.ts";
import { CAMPAIGNS_DIR, CUSTOM_DIR, LOCAL_DIR, PACKS_DIR, type Workspace } from "./workspace.ts";

/**
 * Customizations are plain-language notes in folders stacked over the baseline, lowest priority first:
 * packs (in install order), the team's custom/, the campaign's folder, then the person's custom.local/.
 * A later layer refines the ones before it and wins where they conflict.
 */
export type Layer = { name: string; dir: string };

export type Note = { layer: string; file: string; path: string; text: string };

/** Files in a layer folder that describe it rather than customize anything. */
const META_FILES = new Set(["pack.md", "readme.md"]);

export const SHIPPED_PACKS_DIR = join(REPO_ROOT, "packs");

/** A workspace copy of a pack wins over the shipped one, so a team can pin or edit its own. */
export function packDir(workspace: Workspace, name: string): string | null {
  const local = join(workspace.root, PACKS_DIR, name);
  if (existsSync(local)) return local;
  const shipped = join(SHIPPED_PACKS_DIR, name);
  return existsSync(shipped) ? shipped : null;
}

export function layersFor(workspace: Workspace, campaign: string): Layer[] {
  const layers: Layer[] = [];
  for (const pack of workspace.state.packs) {
    const dir = packDir(workspace, pack);
    if (!dir) throw new OstackError("pack_not_found", `Pack "${pack}" is installed but missing. Run "ostack packs remove ${pack}".`);
    layers.push({ name: `pack:${pack}`, dir });
  }
  layers.push({ name: "custom", dir: join(workspace.root, CUSTOM_DIR) });
  layers.push({ name: `campaign:${campaign}`, dir: join(workspace.root, CAMPAIGNS_DIR, campaign) });
  layers.push({ name: "local", dir: join(workspace.root, LOCAL_DIR) });
  return layers.filter((layer) => existsSync(layer.dir));
}

export async function readNotes(layer: Layer): Promise<Note[]> {
  const files = (await readdir(layer.dir)).filter((file) => file.endsWith(".md") && !META_FILES.has(file.toLowerCase())).sort();
  return Promise.all(
    files.map(async (file) => {
      const path = join(layer.dir, file);
      return { layer: layer.name, file, path, text: (await Bun.file(path).text()).trim() };
    }),
  );
}

export type NoteTarget = { kind: "step" | "before" | "after"; step: string } | { kind: "general" };

/**
 * `write.md` changes the write step, `before-send.md` and `after-record.md` run around one, anything else is general context.
 * `aliases` maps old step names to current ones, so notes keep applying after a step is renamed.
 */
export function classify(file: string, stepIds: Set<string>, aliases: Map<string, string> = new Map()): NoteTarget {
  const name = file.slice(0, -3);
  if (stepIds.has(name)) return { kind: "step", step: name };
  const renamed = aliases.get(name);
  if (renamed) return { kind: "step", step: renamed };
  const around = name.match(/^(before|after)-(.+)$/);
  if (around) return { kind: around[1] as "before" | "after", step: aliases.get(around[2]!) ?? around[2]! };
  return { kind: "general" };
}

export function stepAliases(steps: Step[]): Map<string, string> {
  return new Map(steps.flatMap((step) => step.renamed_from.map((old): [string, string] => [old, step.id])));
}

export type StepContext = {
  step: string;
  summary: string;
  default: string;
  before: Note[];
  notes: Note[];
  after: Note[];
};

export async function allNotes(workspace: Workspace, campaign: string): Promise<Note[]> {
  const notes = await Promise.all(layersFor(workspace, campaign).map(readNotes));
  return notes.flat();
}

export async function stepContext(workspace: Workspace, campaign: string, step: Step, steps: Step[]): Promise<StepContext> {
  const ids = new Set(steps.map((item) => item.id));
  const aliases = stepAliases(steps);
  const context: StepContext = { step: step.id, summary: step.summary, default: step.body, before: [], notes: [], after: [] };
  for (const note of await allNotes(workspace, campaign)) {
    const target = classify(note.file, ids, aliases);
    if (target.kind === "general" || target.step !== step.id) continue;
    const bucket = target.kind === "step" ? context.notes : context[target.kind];
    bucket.push(note);
  }
  return context;
}

export async function generalNotes(workspace: Workspace, campaign: string, steps: Step[]): Promise<Note[]> {
  const ids = new Set(steps.map((item) => item.id));
  const aliases = stepAliases(steps);
  return (await allNotes(workspace, campaign)).filter((note) => classify(note.file, ids, aliases).kind === "general");
}

export type PackInfo = { name: string; description: string; kind: string; dir: string; shipped: boolean };

export async function describePack(dir: string, name: string, shipped: boolean): Promise<PackInfo> {
  const meta = join(dir, "pack.md");
  const { data } = existsSync(meta) ? parseFrontmatter(await Bun.file(meta).text()) : { data: {} };
  return {
    name,
    description: typeof data.description === "string" ? data.description : "",
    kind: typeof data.kind === "string" ? data.kind : "other",
    dir,
    shipped,
  };
}
