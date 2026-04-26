// Cloudflare helpers — wrangler shells + REST calls for things wrangler
// doesn't expose (workers.dev subdomain).

import { run, runOrFail } from "./exec";
import { request } from "./http";

type WhoamiJson = {
  email: string;
  account_id?: string;
  accounts?: { name: string; id: string }[];
};

export async function whoami(): Promise<WhoamiJson | null> {
  // wrangler whoami doesn't have a stable --json flag across versions; parse stdout.
  const result = await run("bunx", ["wrangler", "whoami"]);
  if (result.exitCode !== 0) return null;
  // Best-effort parse — the table format is:
  //   You are logged in with an OAuth Token, associated with the email '...'!
  //   Your account: ... (...id...)
  const emailMatch = /associated with the email '([^']+)'/.exec(result.stdout);
  const accountMatch = /\b([0-9a-f]{32})\b/.exec(result.stdout);
  if (!emailMatch) return null;
  return {
    email: emailMatch[1],
    account_id: accountMatch?.[1],
  };
}

export async function login(): Promise<void> {
  await runOrFail("bunx", ["wrangler", "login"], { inherit: true });
}

/** Reads the workers.dev subdomain via the CF REST API. Requires an API token,
 * not the wrangler OAuth, so we only call this when the user has a token in env
 * (CLOUDFLARE_API_TOKEN). Returns null otherwise — the caller should fall back
 * to "we'll know after first deploy".
 */
export async function getWorkersDevSubdomain(accountId: string): Promise<string | null> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) return null;
  type Resp = { result: { subdomain: string } };
  const res = await request<Resp>(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return res.result?.subdomain ?? null;
}

/** Pipe a single secret to `wrangler secret put`. */
export async function putSecret(key: string, value: string): Promise<void> {
  await runOrFail("bunx", ["wrangler", "secret", "put", key], { stdin: value });
}

/** Bulk upload secrets via stdin JSON. */
export async function putSecretsBulk(secrets: Record<string, string>): Promise<void> {
  const json = JSON.stringify(secrets);
  await runOrFail("bunx", ["wrangler", "secret", "bulk"], { stdin: json });
}
