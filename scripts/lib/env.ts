// Tiny dotenv parser/serializer with idempotent updates. We avoid pulling in
// the full `dotenv` package because we only need a handful of operations and
// want to preserve comments and ordering when round-tripping.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export type EnvFile = {
  path: string;
  lines: EnvLine[];
};

type EnvLine =
  | { type: "blank" }
  | { type: "comment"; raw: string }
  | { type: "kv"; key: string; value: string; raw: string };

const KV_RE = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i;

export function parseEnv(content: string): EnvLine[] {
  return content.split(/\r?\n/).map((raw) => {
    if (raw.trim() === "") return { type: "blank" } as const;
    if (raw.trimStart().startsWith("#")) return { type: "comment", raw } as const;
    const m = KV_RE.exec(raw);
    if (!m) return { type: "comment", raw } as const;
    let value = m[2];
    // Strip surrounding quotes if balanced.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return { type: "kv", key: m[1], value, raw } as const;
  });
}

export function serializeEnv(lines: EnvLine[]): string {
  return `${lines
    .map((l) => {
      if (l.type === "blank") return "";
      if (l.type === "comment") return l.raw;
      // Quote values that contain whitespace, quotes, or backslashes.
      const needsQuotes = /[\s"'\\]/.test(l.value);
      const value = needsQuotes ? `"${l.value.replace(/"/g, '\\"')}"` : l.value;
      return `${l.key}=${value}`;
    })
    .join("\n")
    .replace(/\n+$/, "")}\n`;
}

export function loadEnv(path: string): EnvFile {
  const content = existsSync(path) ? readFileSync(path, "utf8") : "";
  return { path, lines: parseEnv(content) };
}

export function saveEnv(file: EnvFile): void {
  writeFileSync(file.path, serializeEnv(file.lines));
}

export function getEnv(file: EnvFile, key: string): string | undefined {
  for (const line of file.lines) {
    if (line.type === "kv" && line.key === key) return line.value;
  }
  return undefined;
}

/** Idempotent: replaces an existing value, otherwise appends. */
export function setEnv(file: EnvFile, key: string, value: string): void {
  for (const line of file.lines) {
    if (line.type === "kv" && line.key === key) {
      // Mutate in place so ordering + comments are preserved.
      (line as { value: string; raw: string }).value = value;
      (line as { value: string; raw: string }).raw = `${key}=${value}`;
      return;
    }
  }
  if (file.lines.length > 0 && file.lines[file.lines.length - 1].type !== "blank") {
    file.lines.push({ type: "blank" });
  }
  file.lines.push({ type: "kv", key, value, raw: `${key}=${value}` });
}

export function setEnvMany(file: EnvFile, entries: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(entries)) {
    if (v !== undefined && v !== "") setEnv(file, k, v);
  }
}

/** Convenience: returns a plain { KEY: value } map of all key=value pairs. */
export function envToObject(file: EnvFile): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of file.lines) {
    if (line.type === "kv") out[line.key] = line.value;
  }
  return out;
}
