// Convex CLI wrappers. Convex's CLI handles its own browser OAuth on first
// run, so we use stdio inheritance for those interactive flows.
import { run, runOrFail } from "./exec";

/**
 * Run `bunx convex dev --once` to provision (or sync) the dev deployment.
 *
 * Convex's CLI rejects `--dev-deployment` and `--team`/`--project` unless
 * paired with `--configure`. So:
 *
 * - **First run** (no `CONVEX_DEPLOYMENT` in .env.local): pass `--configure new
 *   --dev-deployment cloud`. Convex prompts for login, team, and project
 *   name; we surface those via stdio inheritance.
 * - **Subsequent runs**: pass nothing — Convex picks up the existing
 *   deployment from `.env.local` and just syncs.
 *
 * Pass `configureNew: true` to force the "new project" flow even if a
 * `CONVEX_DEPLOYMENT` is already configured.
 */
export async function devOnce(opts: { configureNew?: boolean } = {}): Promise<void> {
  const args = ["convex", "dev", "--once"];
  if (opts.configureNew) {
    args.push("--configure", "new", "--dev-deployment", "cloud");
  }
  await runOrFail("bunx", args, { inherit: true });
}

export async function setEnv(
  key: string,
  value: string,
  opts: { prod?: boolean; deployKey?: string } = {},
): Promise<void> {
  const args = ["convex", "env", "set", key, value];
  if (opts.prod) args.splice(2, 0, "--prod");
  await runOrFail("bunx", args, {
    env: opts.deployKey ? { CONVEX_DEPLOY_KEY: opts.deployKey } : undefined,
  });
}

export async function setEnvMany(
  entries: Record<string, string>,
  opts: { prod?: boolean; deployKey?: string } = {},
): Promise<void> {
  for (const [k, v] of Object.entries(entries)) {
    if (v) await setEnv(k, v, opts);
  }
}

/**
 * Run `bunx convex deploy` with a prod deploy key. Returns parsed prod URL if
 * the CLI emits one we can recognize; otherwise the caller should fetch it
 * from the dashboard.
 */
export async function deployProd(deployKey: string): Promise<{ url?: string }> {
  const result = await run("bunx", ["convex", "deploy", "--cmd", "echo provisioned"], {
    env: { CONVEX_DEPLOY_KEY: deployKey },
    inherit: false,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `convex deploy failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`,
    );
  }
  // Convex prints the deployment URL during deploy; try to extract it.
  const m = /(https:\/\/[a-z0-9-]+\.convex\.cloud)/i.exec(result.stdout);
  return { url: m?.[1] };
}
