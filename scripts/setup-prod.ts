#!/usr/bin/env bun
// cc-stack onboarding CLI — PROD.
//
// Layers production keys + Cloudflare provisioning + cross-wire over an
// existing dev install. Three values are unavoidably manual paste-backs
// because no API surface exposes them: Convex prod deploy key, Clerk prod
// publishable key, Clerk prod secret key.
//
// Usage: bun run setup:prod [--force] [--only=clerk,convex,cloudflare,posthog]
import { resolve } from "node:path";
import pc from "picocolors";
import { ClerkClient } from "./lib/clerk";
import { readClipboard } from "./lib/clipboard";
import {
  getWorkersDevSubdomain,
  putSecretsBulk,
  whoami,
  login as wranglerLogin,
} from "./lib/cloudflare";
import { setEnvMany as convexSetEnvMany, deployProd } from "./lib/convex";
import { envToObject, getEnv, loadEnv, parseEnvObject, saveEnv, setEnvMany } from "./lib/env";
import { openUrl } from "./lib/open";
import { ANALYTICS_HOSTS, PostHogClient, type PostHogRegion } from "./lib/posthog";
import { exitOnCancel, fail, header, info, note, p, success, warn } from "./lib/prompts";

const ROOT = process.cwd();
const ENV_LOCAL = resolve(ROOT, ".env.local");
const ENV_PROD = resolve(ROOT, ".env.production");

type Phase = "clerk" | "convex" | "cloudflare" | "posthog";
const ALL_PHASES: Phase[] = ["clerk", "convex", "posthog", "cloudflare"];

function parseArgs() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const only = onlyArg ? (onlyArg.slice(7).split(",").filter(Boolean) as Phase[]) : ALL_PHASES;
  return { force, only };
}

async function main() {
  const { force, only } = parseArgs();

  console.clear();
  console.log("");
  console.log(pc.bold(pc.bgYellow(pc.black(" cc-stack ")) + pc.yellow("  prod setup")));
  console.log(pc.dim("  Layers prod over your dev install. Re-run anytime."));
  console.log("");

  const dev = loadEnv(ENV_LOCAL);
  if (!getEnv(dev, "NEXT_PUBLIC_CONVEX_URL")) {
    fail("`.env.local` is missing — run `bun run setup` first.");
  }
  if (!getEnv(dev, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")) {
    fail("Clerk dev keys missing — run `bun run setup` first.");
  }

  let prod = loadEnv(ENV_PROD);

  // Verify wrangler auth up-front so the user isn't surprised at the end.
  await ensureWrangler();

  const workerName = await chooseWorkerName();
  const workerUrl = await previewWorkerUrl(workerName);

  if (only.includes("clerk")) {
    prod = await runClerkProd(prod, workerUrl, force);
  }
  if (only.includes("convex")) {
    prod = await runConvexProd(prod, force);
  }
  if (only.includes("posthog")) {
    prod = await runPostHogProd(dev, prod, force);
  }
  if (only.includes("cloudflare")) {
    await runCloudflarePush(prod, workerUrl);
  }

  saveEnv(prod);

  header("Prod is wired", "");
  console.log(`  ${pc.bold("Deploy:")} ${pc.cyan("bun run deploy")}`);
  if (workerUrl) {
    console.log(`  ${pc.bold("URL:")}    ${pc.cyan(workerUrl)}`);
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// Pre-flight
// ---------------------------------------------------------------------------

async function ensureWrangler(): Promise<void> {
  const me = await whoami();
  if (me) {
    info(`Cloudflare authed as ${me.email}.`);
    return;
  }
  warn("Not logged in to Cloudflare.");
  const ok = await exitOnCancel(
    await p.confirm({ message: "Run `bunx wrangler login` now?", initialValue: true }),
  );
  if (!ok) fail("Cloudflare login is required for prod setup.");
  await wranglerLogin();
}

async function chooseWorkerName(): Promise<string> {
  const wranglerJsoncPath = resolve(ROOT, "wrangler.jsonc");
  // Read raw text and pluck "name" — keeps us off a JSONC parser.
  const text = await Bun.file(wranglerJsoncPath).text();
  const m = /"name"\s*:\s*"([^"]+)"/.exec(text);
  const current = m?.[1] ?? "cc-stack";

  const name = await exitOnCancel(
    await p.text({
      message: "Cloudflare Worker name",
      placeholder: current,
      defaultValue: current,
    }),
  );

  if (name !== current) {
    const updated = text.replace(/"name"\s*:\s*"[^"]+"/, `"name": "${name}"`);
    await Bun.write(wranglerJsoncPath, updated);
    success(`Updated wrangler.jsonc name → ${name}`);
  }
  return name;
}

async function previewWorkerUrl(name: string): Promise<string | null> {
  const me = await whoami();
  if (!me?.account_id) return null;
  const sub = await getWorkersDevSubdomain(me.account_id);
  if (!sub) {
    info(
      "Tip: set CLOUDFLARE_API_TOKEN to let me preview the workers.dev URL before first deploy.",
    );
    return null;
  }
  const url = `https://${name}.${sub}.workers.dev`;
  info(`Worker will deploy to: ${pc.cyan(url)}`);
  return url;
}

// ---------------------------------------------------------------------------
// Clerk prod
// ---------------------------------------------------------------------------

async function runClerkProd(
  prod: ReturnType<typeof loadEnv>,
  workerUrl: string | null,
  force: boolean,
) {
  header("Clerk (prod)", "Promoted instance + JWT template + redirect URLs");

  const haveAll =
    getEnv(prod, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") &&
    getEnv(prod, "CLERK_SECRET_KEY") &&
    getEnv(prod, "CLERK_JWT_ISSUER_DOMAIN");
  if (haveAll && !force) {
    success("Clerk prod already configured.");
    return prod;
  }

  note(
    [
      "1. Open your Clerk app → Instance settings → Production → Promote.",
      "2. After promotion, copy the prod publishable + secret keys.",
    ].join("\n"),
    "Clerk dashboard",
  );
  const open = await exitOnCancel(
    await p.confirm({ message: "Open Clerk dashboard?", initialValue: true }),
  );
  if (open) openUrl("https://dashboard.clerk.com");

  const { publishable: pub, secret } = await collectProdClerkKeys();

  const spinner = p.spinner();
  spinner.start("Configuring Clerk prod via Backend API…");
  try {
    const clerk = new ClerkClient(secret, pub);
    const issuer = await clerk.getJwtIssuerDomain();
    await clerk.ensureConvexJwtTemplate();
    if (workerUrl) {
      await clerk.addRedirectUrl(workerUrl);
      await clerk.updateInstance({ allowed_origins: [workerUrl] });
    }
    spinner.stop("Clerk prod wired.");

    setEnvMany(prod, {
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pub,
      CLERK_SECRET_KEY: secret,
      CLERK_JWT_ISSUER_DOMAIN: issuer,
    });
    if (workerUrl) setEnvMany(prod, { NEXT_PUBLIC_APP_URL: workerUrl });
    success(`Clerk prod issuer: ${issuer}`);
  } catch (err) {
    spinner.stop("Clerk prod failed.");
    fail((err as Error).message);
  }
  return prod;
}

// ---------------------------------------------------------------------------
// Convex prod
// ---------------------------------------------------------------------------

/**
 * Same clipboard-first UX as the dev flow, but enforces `pk_live_` / `sk_live_`.
 * Falls back to manual entry if the clipboard doesn't have both keys (or if the
 * user picks manual).
 */
async function collectProdClerkKeys(): Promise<{ publishable: string; secret: string }> {
  const mode = (await exitOnCancel(
    await p.select({
      message: "How do you want to provide your prod Clerk keys?",
      options: [
        { value: "clipboard", label: "Read from clipboard (.env block from Clerk)" },
        { value: "manual", label: "Type each key separately" },
      ],
      initialValue: "clipboard",
    }),
  )) as "clipboard" | "manual";

  if (mode === "clipboard") {
    await exitOnCancel(
      await p.confirm({
        message: "Copy the prod .env block from Clerk's API Keys page, then press Enter.",
        initialValue: true,
      }),
    );
    const parsed = parseEnvObject(await readClipboard());
    const pk = parsed.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    const sk = parsed.CLERK_SECRET_KEY;
    if (pk?.startsWith("pk_live_") && sk?.startsWith("sk_live_")) {
      success(`Found prod keys in clipboard (${pk.slice(0, 18)}…).`);
      return { publishable: pk, secret: sk };
    }
    if (pk?.startsWith("pk_test_") || sk?.startsWith("sk_test_")) {
      warn("Clipboard contained dev (pk_test_/sk_test_) keys. We need prod keys here.");
    } else {
      warn("Clipboard didn't contain both prod Clerk keys — falling back to manual entry.");
    }
  }

  const publishable = await exitOnCancel(
    await p.text({
      message: "PROD NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (pk_live_…)",
      validate: (v) => (v?.startsWith("pk_live_") ? undefined : "Should start with pk_live_"),
    }),
  );
  const secret = await exitOnCancel(
    await p.password({
      message: "PROD CLERK_SECRET_KEY (sk_live_…)",
      validate: (v) => (v?.startsWith("sk_live_") ? undefined : "Should start with sk_live_"),
    }),
  );
  return { publishable, secret };
}

async function runConvexProd(prod: ReturnType<typeof loadEnv>, force: boolean) {
  header("Convex (prod)", "Provision prod deployment + push env");

  const existing = getEnv(prod, "CONVEX_DEPLOY_KEY");
  if (existing && !force) {
    success("Convex prod already configured.");
    return prod;
  }

  note(
    "Generate a Production deploy key at:\nhttps://dashboard.convex.dev → your project → Settings → Deploy Keys",
    "Convex dashboard",
  );
  const open = await exitOnCancel(
    await p.confirm({ message: "Open the dashboard?", initialValue: true }),
  );
  if (open) openUrl("https://dashboard.convex.dev");

  const deployKey = await exitOnCancel(
    await p.password({
      message: "CONVEX_DEPLOY_KEY (production)",
      validate: (v) => (v?.startsWith("prod:") ? undefined : "Should start with prod:"),
    }),
  );

  const spinner = p.spinner();
  spinner.start("Deploying to Convex prod…");
  let prodUrl: string | undefined;
  try {
    const result = await deployProd(deployKey);
    prodUrl = result.url;
    spinner.stop(prodUrl ? `Provisioned ${prodUrl}` : "Provisioned.");
  } catch (err) {
    spinner.stop("Convex deploy failed.");
    fail((err as Error).message);
  }

  // Mirror prod backend secrets.
  spinner.start("Setting prod env vars on Convex…");
  try {
    await convexSetEnvMany(
      {
        CLERK_JWT_ISSUER_DOMAIN: getEnv(prod, "CLERK_JWT_ISSUER_DOMAIN") ?? "",
        VAPID_PUBLIC_KEY: getEnv(prod, "NEXT_PUBLIC_VAPID_PUBLIC_KEY") ?? "",
        VAPID_PRIVATE_KEY: getEnv(prod, "VAPID_PRIVATE_KEY") ?? "",
        VAPID_SUBJECT: getEnv(prod, "VAPID_SUBJECT") ?? "",
      },
      { prod: true, deployKey },
    );
    spinner.stop("Convex prod env set.");
  } catch (err) {
    spinner.stop("Setting Convex env failed.");
    warn(`Continuing without prod env mirror: ${(err as Error).message}`);
  }

  setEnvMany(prod, { CONVEX_DEPLOY_KEY: deployKey });
  if (prodUrl) setEnvMany(prod, { NEXT_PUBLIC_CONVEX_URL: prodUrl });
  return prod;
}

// ---------------------------------------------------------------------------
// PostHog prod
// ---------------------------------------------------------------------------

async function runPostHogProd(
  dev: ReturnType<typeof loadEnv>,
  prod: ReturnType<typeof loadEnv>,
  force: boolean,
) {
  header("PostHog (prod)", "Production environment write token");

  if (getEnv(prod, "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN") && !force) {
    success("PostHog prod already configured.");
    return prod;
  }

  const enable = await exitOnCancel(
    await p.confirm({
      message: "Configure PostHog for prod now?",
      initialValue: true,
    }),
  );
  if (!enable) return prod;

  // Prefer the dev region if set, otherwise ask.
  let region: PostHogRegion = "us";
  const devHost = getEnv(dev, "NEXT_PUBLIC_POSTHOG_HOST");
  if (devHost?.includes("eu.")) region = "eu";

  const personalKey = await exitOnCancel(
    await p.password({
      message: `PostHog personal API key (${region})`,
      validate: (v) => ((v?.length ?? 0) > 10 ? undefined : "That doesn't look right"),
    }),
  );

  const ph = new PostHogClient(personalKey, region);
  const spinner = p.spinner();
  spinner.start("Connecting to PostHog…");
  try {
    const orgId = await ph.getOrgId();
    const projects = await ph.listProjects(orgId);
    spinner.stop("Connected.");

    const projectChoice = await exitOnCancel(
      await p.select({
        message: "Project for production",
        options: projects.map((proj) => ({ value: String(proj.id), label: proj.name })),
      }),
    );
    const projectId = Number(projectChoice);

    const prodEnv = await ph.ensureEnvironment(projectId, "production");
    const token = prodEnv?.api_token ?? projects.find((p) => p.id === projectId)?.api_token;
    if (!token) fail("Could not resolve a PostHog token for prod.");

    // Also try to create a "preview" environment for branch deploys.
    await ph.ensureEnvironment(projectId, "preview");

    setEnvMany(prod, {
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: token,
      NEXT_PUBLIC_POSTHOG_HOST: ANALYTICS_HOSTS[region],
      NEXT_PUBLIC_POSTHOG_ENVIRONMENT: "production",
    });
    success("PostHog prod token saved.");
  } catch (err) {
    spinner.stop("PostHog prod failed.");
    fail((err as Error).message);
  }
  return prod;
}

// ---------------------------------------------------------------------------
// Cloudflare push
// ---------------------------------------------------------------------------

async function runCloudflarePush(
  prod: ReturnType<typeof loadEnv>,
  workerUrl: string | null,
): Promise<void> {
  header("Cloudflare", "Push secrets to the Worker");

  const obj = envToObject(prod);
  // Don't push the deploy key (CI uses it; not a secret the runtime needs)
  // unless you want CI redeploys to read it from the Worker — which they don't.
  const exclude = new Set(["CONVEX_DEPLOY_KEY"]);
  const secrets: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!exclude.has(k) && v) secrets[k] = v;
  }
  if (workerUrl && !secrets.NEXT_PUBLIC_APP_URL) {
    secrets.NEXT_PUBLIC_APP_URL = workerUrl;
  }

  if (Object.keys(secrets).length === 0) {
    warn("Nothing to push.");
    return;
  }

  info(`Pushing ${Object.keys(secrets).length} secrets via \`wrangler secret bulk\`…`);
  try {
    await putSecretsBulk(secrets);
    success("Cloudflare secrets pushed.");
  } catch (err) {
    fail((err as Error).message);
  }
}

main().catch((err) => {
  console.error(pc.red(`\n${err.stack ?? err.message ?? err}`));
  process.exit(1);
});
