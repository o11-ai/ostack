import { gtm } from "./gtm/index.ts";
import type { ModuleCode } from "./types.ts";

/** Modules that ship code. Every module also needs a modules/<id>/module.md. */
export const MODULE_CODE: Record<string, ModuleCode> = { gtm };
