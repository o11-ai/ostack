import type { Args } from "../lib/args.ts";

/** What a module with code adds to the CLI. Modules made only of skills and notes need none. */
export type ModuleCode = {
  /** Help lines for `ostack <module> <command>`, each command line starting with two spaces and its name. */
  help: string;
  commands: Record<string, (args: Args) => Promise<void>>;
  /** The module's settings live in ostack.json under modules.<id>.settings; core only stores them. */
  settings?: {
    keys: readonly string[];
    show: (raw: Record<string, unknown>) => unknown;
    apply: (raw: Record<string, unknown>, key: string, value: string) => Record<string, unknown>;
    /** What a new workspace starts with. */
    initial: () => Record<string, unknown>;
  };
};
