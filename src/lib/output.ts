import { OstackError } from "./errors.ts";

export function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printText(value: string): void {
  process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
}

export function printError(error: unknown): never {
  const body =
    error instanceof OstackError
      ? { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) }
      : { code: "internal_error", message: error instanceof Error ? error.message : String(error) };
  process.stderr.write(`${JSON.stringify({ error: body }, null, 2)}\n`);
  process.exit(1);
}
