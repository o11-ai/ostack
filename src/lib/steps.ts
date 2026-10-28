import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter, REPO_ROOT } from "./paths.ts";

/**
 * A named point in a workflow that customizations attach to. Step ids are ostack's stable surface:
 * renaming one lists the old id in `renamed_from` so existing notes can be found and moved.
 */
export type Step = {
  id: string;
  summary: string;
  used_by: string[];
  /** The version whose release last changed this step's default. */
  changed: string;
  renamed_from: string[];
  path: string;
  body: string;
};

export const STEPS_DIR = join(REPO_ROOT, "steps");

export async function loadSteps(): Promise<Step[]> {
  const files = (await readdir(STEPS_DIR)).filter((file) => file.endsWith(".md")).sort();
  return Promise.all(
    files.map(async (file) => {
      const path = join(STEPS_DIR, file);
      const { data, body } = parseFrontmatter(await Bun.file(path).text());
      return {
        id: file.slice(0, -3),
        summary: typeof data.summary === "string" ? data.summary : "",
        used_by: strings(data.used_by),
        changed: typeof data.changed === "string" ? data.changed : "0.0.0",
        renamed_from: strings(data.renamed_from),
        path,
        body: body.trim(),
      };
    }),
  );
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export type SetupQuestion = { id: string; since: string; text: string };

export const QUESTIONS_PATH = join(REPO_ROOT, "skills", "ostack-setup", "references", "questions.md");

/** Setup questions are `## <id>` sections with a `Since: <version>` line, so a release can add new ones. */
export async function loadQuestions(): Promise<SetupQuestion[]> {
  const text = await Bun.file(QUESTIONS_PATH).text();
  const sections = text.split(/^## /m).slice(1);
  return sections.map((section) => {
    const [heading = "", ...rest] = section.split("\n");
    const body = rest.join("\n").trim();
    const since = body.match(/^Since:\s*(\S+)/m)?.[1] ?? "0.0.0";
    return { id: heading.trim(), since, text: body };
  });
}
