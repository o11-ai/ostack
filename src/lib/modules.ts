import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { OstackError } from "./errors.ts";
import { isRecord, parseFrontmatter, REPO_ROOT } from "./paths.ts";
import { parseSchedule, type ScheduleSpec } from "./schedule.ts";

/**
 * A module is one family of workflows (gtm is the first). Each lives in modules/<id>/ with its own skills, step defaults,
 * setup questions, packs and ledger, so adding one never moves anything that already exists.
 */
export type Workflow = { id: string; ref: string; module: string; skill: string; summary: string; schedule: ScheduleSpec | null };

export type Module = { id: string; name: string; summary: string; dir: string; workflows: Workflow[] };

export const MODULES_DIR = join(REPO_ROOT, "modules");

let cache: Module[] | undefined;

export async function loadModules(): Promise<Module[]> {
  if (cache) return cache;
  const entries = await readdir(MODULES_DIR, { withFileTypes: true });
  const modules: Module[] = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = join(MODULES_DIR, entry.name);
    const manifest = join(dir, "module.md");
    if (!existsSync(manifest)) continue;
    const { data } = parseFrontmatter(await Bun.file(manifest).text());
    const id = typeof data.id === "string" ? data.id : entry.name;
    const workflows = (Array.isArray(data.workflows) ? data.workflows : []).filter(isRecord).map((item) => ({
      id: String(item.id),
      ref: `${id}/${String(item.id)}`,
      module: id,
      skill: String(item.skill),
      summary: typeof item.summary === "string" ? item.summary : "",
      schedule: isRecord(item.schedule) ? parseSchedule(item.schedule) : null,
    }));
    modules.push({
      id,
      name: typeof data.name === "string" ? data.name : id,
      summary: typeof data.summary === "string" ? data.summary : "",
      dir,
      workflows,
    });
  }
  cache = modules;
  return modules;
}

export async function getModule(id: string): Promise<Module> {
  const module = (await loadModules()).find((item) => item.id === id);
  if (!module) throw new OstackError("unknown_module", `No module named "${id}".`, { modules: (await loadModules()).map((item) => item.id) });
  return module;
}

/** Finds a workflow by "gtm/outbound", or by "outbound" when only one enabled module has it. */
export async function findWorkflow(ref: string, enabled: string[]): Promise<Workflow> {
  const all = (await loadModules()).filter((module) => enabled.includes(module.id)).flatMap((module) => module.workflows);
  const matches = ref.includes("/") ? all.filter((workflow) => workflow.ref === ref) : all.filter((workflow) => workflow.id === ref);
  if (matches.length === 1) return matches[0]!;
  throw new OstackError(matches.length === 0 ? "unknown_workflow" : "ambiguous_workflow", `No single workflow named "${ref}".`, {
    workflows: all.map((workflow) => workflow.ref),
  });
}
