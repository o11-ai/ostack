import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { OstackError } from "./errors.ts";
import { getModule } from "./modules.ts";
import { parseFrontmatter } from "./paths.ts";
import type { Step } from "./steps.ts";
import { CAMPAIGNS_DIR, CUSTOM_DIR, LOCAL_DIR, PACKS_DIR, type Workspace } from "./workspace.ts";

/**
 * Customizations are plain-language notes in folders stacked over a module's baseline, lowest priority first:
 * the module's packs, the team's custom/ (shared by every module) and custom/<module>/, the campaign's folder,
 * then the person's custom.local/ and custom.local/<module>/. A later layer refines the ones before it.
 */
export type Layer = { name: string; dir: string; scope: "shared" | "module" };

export type Note = { layer: string; file: string; path: string; text: string };

/** Files in a layer folder that describe it rather than customize anything. */
const META_FILES = new Set(["pack.md", "readme.md"]);

/** Before modules, gtm's step notes sat directly in custom/. They keep applying to gtm, and setup offers to move them. */
const LEGACY_OWNER = "gtm";

/**
 * Where a module's pack lives: a workspace copy wins over the shipped one, so a team can pin or edit its own.
 * Workspaces from before modules kept their copies in packs/<name>; those still count for gtm.
 */
export async function packDir(workspace: Workspace, module: string, name: string): Promise<string | null> {
  const candidates = [join(workspace.root, PACKS_DIR, module, name)];
  if (module === LEGACY_OWNER && name !== module) candidates.push(join(workspace.root, PACKS_DIR, name));
  candidates.push(join((await getModule(module)).dir, "packs", name));
  return candidates.find((dir) => existsSync(dir)) ?? null;
}

export async function layersFor(workspace: Workspace, module: string, campaign: string): Promise<Layer[]> {
  const layers: Layer[] = [];
  for (const pack of workspace.state.modules[module]?.packs ?? []) {
    const dir = await packDir(workspace, module, pack);
    if (!dir) throw new OstackError("pack_not_found", `Pack "${pack}" is installed but missing. Run "ostack packs remove ${pack}".`);
    layers.push({ name: `pack:${pack}`, dir, scope: "module" });
  }
  layers.push({ name: "custom", dir: join(workspace.root, CUSTOM_DIR), scope: "shared" });
  layers.push({ name: `custom/${module}`, dir: join(workspace.root, CUSTOM_DIR, module), scope: "module" });
  if (module === LEGACY_OWNER) layers.push({ name: `campaign:${campaign}`, dir: join(workspace.root, CAMPAIGNS_DIR, campaign), scope: "module" });
  layers.push({ name: "local", dir: join(workspace.root, LOCAL_DIR), scope: "shared" });
  layers.push({ name: `local/${module}`, dir: join(workspace.root, LOCAL_DIR, module), scope: "module" });
  return layers.filter((layer) => existsSync(layer.dir));
}

export async function readNotes(layer: Layer): Promise<Note[]> {
  const entries = await readdir(layer.dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !META_FILES.has(entry.name.toLowerCase()))
    .map((entry) => entry.name)
    .sort();
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

export type ClassifiedNote = { note: Note; target: NoteTarget; scope: Layer["scope"]; legacy: boolean };

/**
 * Every note that applies to a module, with what it customizes. In shared layers only general notes count,
 * except gtm's legacy step notes from before modules (marked `legacy`).
 */
export async function moduleNotes(workspace: Workspace, module: string, campaign: string, steps: Step[]): Promise<ClassifiedNote[]> {
  const ids = new Set(steps.map((step) => step.id));
  const aliases = stepAliases(steps);
  const result: ClassifiedNote[] = [];
  for (const layer of await layersFor(workspace, module, campaign)) {
    for (const note of await readNotes(layer)) {
      const target = classify(note.file, ids, aliases);
      if (layer.scope === "shared" && target.kind !== "general") {
        const known = "step" in target && ids.has(target.step);
        if (module === LEGACY_OWNER && known) result.push({ note, target, scope: layer.scope, legacy: true });
        else if (!known) result.push({ note, target: { kind: "general" }, scope: layer.scope, legacy: false });
        continue;
      }
      result.push({ note, target, scope: layer.scope, legacy: false });
    }
  }
  return result;
}

export type StepContext = { step: string; summary: string; default: string; before: Note[]; notes: Note[]; after: Note[] };

export async function stepContext(workspace: Workspace, campaign: string, step: Step, steps: Step[]): Promise<StepContext> {
  const context: StepContext = { step: step.ref, summary: step.summary, default: step.body, before: [], notes: [], after: [] };
  for (const { note, target } of await moduleNotes(workspace, step.module, campaign, steps)) {
    if (target.kind === "general" || target.step !== step.id) continue;
    context[target.kind === "step" ? "notes" : target.kind].push(note);
  }
  return context;
}

export async function generalNotes(workspace: Workspace, module: string, campaign: string, steps: Step[]): Promise<Note[]> {
  return (await moduleNotes(workspace, module, campaign, steps)).filter(({ target }) => target.kind === "general").map(({ note }) => note);
}

export type PackInfo = { name: string; module: string; description: string; kind: string; dir: string; shipped: boolean };

export async function describePack(dir: string, module: string, name: string, shipped: boolean): Promise<PackInfo> {
  const meta = join(dir, "pack.md");
  const { data }: { data: Record<string, unknown> } = existsSync(meta) ? parseFrontmatter(await Bun.file(meta).text()) : { data: {} };
  return {
    name,
    module,
    description: typeof data.description === "string" ? data.description : "",
    kind: typeof data.kind === "string" ? data.kind : "other",
    dir,
    shipped,
  };
}
