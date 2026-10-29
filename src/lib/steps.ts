import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { OstackError } from "./errors.ts";
import { getModule, loadModules } from "./modules.ts";
import { parseFrontmatter, REPO_ROOT } from "./paths.ts";

/**
 * A named point in a module's workflows that customizations attach to. Step ids are ostack's stable surface:
 * renaming one lists the old id in `renamed_from` so existing notes can be found and moved.
 */
export type Step = {
  /** The id inside its module, such as "write". Notes are named after it. */
  id: string;
  module: string;
  /** The qualified id, such as "gtm/write". */
  ref: string;
  summary: string;
  used_by: string[];
  /** The version whose release last changed this step's default. */
  changed: string;
  /** What that release changed, so a review can say what to check in the user's note. */
  change: string;
  renamed_from: string[];
  path: string;
  body: string;
};

export async function loadSteps(module: string): Promise<Step[]> {
  const dir = join((await getModule(module)).dir, "steps");
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((file) => file.endsWith(".md")).sort();
  return Promise.all(
    files.map(async (file) => {
      const path = join(dir, file);
      const { data, body } = parseFrontmatter(await Bun.file(path).text());
      const id = file.slice(0, -3);
      return {
        id,
        module,
        ref: `${module}/${id}`,
        summary: typeof data.summary === "string" ? data.summary : "",
        used_by: strings(data.used_by),
        changed: typeof data.changed === "string" ? data.changed : "0.0.0",
        change: typeof data.change === "string" ? data.change : "",
        renamed_from: strings(data.renamed_from),
        path,
        body: body.trim(),
      };
    }),
  );
}

/** Finds a step by "gtm/write", or by "write" when only one enabled module has it. */
export async function findStep(ref: string, modules: string[]): Promise<Step | null> {
  const all = (await Promise.all(modules.map(loadSteps))).flat();
  const matches = ref.includes("/") ? all.filter((step) => step.ref === ref) : all.filter((step) => step.id === ref);
  if (matches.length > 1) {
    throw new OstackError("ambiguous_step", `More than one module has a step named "${ref}".`, { steps: matches.map((step) => step.ref) });
  }
  return matches[0] ?? null;
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** A setup question: `id` is bare for core questions ("timezone") and qualified for module ones ("gtm/about"). */
export type SetupQuestion = { id: string; module: string | null; since: string; text: string };

export const CORE_QUESTIONS_PATH = join(REPO_ROOT, "skills", "ostack-setup", "references", "questions.md");

/** Core questions first, then each enabled module's. Each is a `## <id>` section with a `Since: <version>` line. */
export async function loadQuestions(modules: string[]): Promise<SetupQuestion[]> {
  const files: { module: string | null; path: string }[] = [{ module: null, path: CORE_QUESTIONS_PATH }];
  for (const module of await loadModules()) {
    if (modules.includes(module.id)) files.push({ module: module.id, path: join(module.dir, "questions.md") });
  }
  const questions: SetupQuestion[] = [];
  for (const file of files) {
    if (!existsSync(file.path)) continue;
    const sections = (await Bun.file(file.path).text()).split(/^## /m).slice(1);
    for (const section of sections) {
      const [heading = "", ...rest] = section.split("\n");
      const body = rest.join("\n").trim();
      const id = heading.trim();
      questions.push({
        id: file.module ? `${file.module}/${id}` : id,
        module: file.module,
        since: body.match(/^Since:\s*(\S+)/m)?.[1] ?? "0.0.0",
        text: body,
      });
    }
  }
  return questions;
}
