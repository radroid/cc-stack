// Spawn helpers. Bun's $ is great for one-liners; for streaming Convex/Wrangler
// we want full inheritance of stdio so the user sees their browser-OAuth prompts.
import { spawn } from "node:child_process";

type RunOptions = {
  cwd?: string;
  /** Overlay merged on top of `process.env` for the child. */
  env?: Record<string, string | undefined>;
  /** Stream stdio to the parent terminal — needed for interactive CLIs. */
  inherit?: boolean;
  /** Pipe a string to the child's stdin. */
  stdin?: string;
};

export type RunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export async function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: opts.inherit ? "inherit" : ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    if (!opts.inherit) {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    if (opts.stdin && child.stdin) {
      child.stdin.write(opts.stdin);
      child.stdin.end();
    }

    child.on("error", reject);
    child.on("close", (code, signal) => {
      // If the child was killed by a signal (OOM, SIGKILL, etc.), Node passes
      // code=null. Treat that as a non-zero exit so runOrFail surfaces it
      // rather than silently masquerading as success.
      const exitCode = code ?? (signal ? 128 + signalNumber(signal) : 1);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

/**
 * Treat any arg following one of these flags as a secret in error messages.
 * Convex/wrangler take secret values positionally too (e.g. `convex env set
 * KEY VALUE`), so we mask any token longer than 20 chars that doesn't look
 * like a flag/url/path — overzealous, but safer than leaking.
 */
const SECRET_VALUE_FLAGS = new Set(["set", "put", "--token", "--secret", "--key"]);

function maskArgs(args: string[]): string {
  return args
    .map((a, i) => {
      if (a.startsWith("-") || a.length <= 20) return a;
      const prev = args[i - 1] ?? "";
      const prev2 = args[i - 2] ?? "";
      if (SECRET_VALUE_FLAGS.has(prev) || SECRET_VALUE_FLAGS.has(prev2)) return "***";
      // Heuristic: long base64-ish opaque tokens with no path/url shape.
      if (!a.includes("/") && !a.includes(":") && /^[A-Za-z0-9_+/=.-]+$/.test(a)) return "***";
      return a;
    })
    .join(" ");
}

function signalNumber(signal: NodeJS.Signals): number {
  // Best-effort, just so the exit code is non-zero and roughly identifiable.
  const map: Partial<Record<NodeJS.Signals, number>> = {
    SIGHUP: 1,
    SIGINT: 2,
    SIGQUIT: 3,
    SIGKILL: 9,
    SIGTERM: 15,
  };
  return map[signal] ?? 1;
}

/** Throws if the command exits non-zero. Returns stdout. */
export async function runOrFail(
  cmd: string,
  args: string[],
  opts: RunOptions = {},
): Promise<string> {
  const result = await run(cmd, args, opts);
  if (result.exitCode !== 0) {
    const tail = (result.stderr || result.stdout || "").trim().split("\n").slice(-10).join("\n");
    throw new Error(`\`${cmd} ${maskArgs(args)}\` exited ${result.exitCode}\n${tail}`);
  }
  return result.stdout;
}
