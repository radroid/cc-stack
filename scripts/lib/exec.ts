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
    child.on("close", (code) => resolve({ exitCode: code ?? 0, stdout, stderr }));
  });
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
    throw new Error(`\`${cmd} ${args.join(" ")}\` exited ${result.exitCode}\n${tail}`);
  }
  return result.stdout;
}
