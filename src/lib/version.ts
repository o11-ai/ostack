import { join } from "node:path";
import { REPO_ROOT } from "./paths.ts";

/** Compares dotted versions numerically: negative when a < b, zero when equal. */
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function readVersion(): Promise<string> {
  const pkg: unknown = await Bun.file(join(REPO_ROOT, "package.json")).json();
  return typeof pkg === "object" && pkg !== null && "version" in pkg && typeof pkg.version === "string" ? pkg.version : "0.0.0";
}
