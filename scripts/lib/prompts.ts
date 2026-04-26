import * as p from "@clack/prompts";
import pc from "picocolors";

export { p };

export function header(title: string, subtitle?: string): void {
  console.log("");
  console.log(pc.bold(pc.cyan(`▎ ${title}`)));
  if (subtitle) console.log(pc.dim(`  ${subtitle}`));
  console.log("");
}

export function note(message: string, title = "note"): void {
  p.note(message, title);
}

export function success(message: string): void {
  p.log.success(message);
}

export function info(message: string): void {
  p.log.info(message);
}

export function warn(message: string): void {
  p.log.warn(message);
}

export function fail(message: string): never {
  p.log.error(message);
  p.outro(pc.red("Setup aborted."));
  process.exit(1);
}

export async function exitOnCancel<T>(value: T | symbol): Promise<T> {
  if (p.isCancel(value)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  return value as T;
}
