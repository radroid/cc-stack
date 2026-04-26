#!/usr/bin/env bun
// cc-stack onboarding CLI — DEV.
//
// Provisions Convex (cloud dev), Clerk (dev instance), VAPID keys, and
// optionally PostHog (dev environment). Idempotent: safe to re-run; values
// already in .env.local are preserved unless --force is set.
//
// Usage: bun run setup [--force] [--only=convex,clerk,vapid,posthog]
import { resolve } from "node:path";
import pc from "picocolors";
import { ClerkClient } from "./lib/clerk";
import { setEnvMany as convexSetEnvMany, devOnce } from "./lib/convex";
import { getEnv, loadEnv, saveEnv, setEnvMany } from "./lib/env";
import { openUrl } from "./lib/open";
import { ANALYTICS_HOSTS, PostHogClient, type PostHogRegion } from "./lib/posthog";
import { exitOnCancel, fail, header, info, note, p, success, warn } from "./lib/prompts";
import { generateVapidKeys } from "./lib/vapid";

const ROOT = process.cwd();
const ENV_LOCAL = resolve(ROOT, ".env.local");

type Phase = "convex" | "clerk" | "vapid" | "posthog";
const ALL_PHASES: Phase[] = ["convex", "clerk", "vapid", "posthog"];

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
  console.log(pc.bold(pc.bgCyan(pc.black(" cc-stack ")) + pc.cyan("  dev setup")));
  console.log(pc.dim("  Provisions Convex, Clerk, VAPID, and PostHog (optional)."));
  console.log(pc.dim("  Idempotent — safe to re-run. Pass --force to overwrite existing values."));
  console.log("");

  // Existing env (if any) drives the "skip if already set" logic.
  let env = loadEnv(ENV_LOCAL);

  if (only.includes("convex")) {
    env = await runConvexPhase(env, force);
  }
  if (only.includes("clerk")) {
    env = await runClerkPhase(env, force);
  }
  if (only.includes("vapid")) {
    env = await runVapidPhase(env, force);
  }
  if (only.includes("posthog")) {
    env = await runPostHogPhase(env, force);
  }

  saveEnv(env);

  header("All done", "Your dev environment is wired up.");
  console.log(`  ${pc.bold("Terminal 1:")} ${pc.cyan("bunx convex dev")}`);
  console.log(`  ${pc.bold("Terminal 2:")} ${pc.cyan("bun run dev")}`);
  console.log("");
  console.log(`  When ready to deploy: ${pc.cyan("bun run setup:prod")}`);
  console.log("");
}

// ---------------------------------------------------------------------------
// Convex
// ---------------------------------------------------------------------------

async function runConvexPhase(env: ReturnType<typeof loadEnv>, force: boolean) {
  header("Convex", "Cloud dev deployment + generated types");

  const existing = getEnv(env, "NEXT_PUBLIC_CONVEX_URL");
  const hasDeployment = !!getEnv(env, "CONVEX_DEPLOYMENT");
  if (existing && hasDeployment && !force) {
    success(`Convex already configured (${existing}). Skipping.`);
    return env;
  }

  // Convex's CLI doesn't accept a project-name flag — naming happens in its
  // interactive prompt (which we surface via stdio inheritance below).
  const configureNew = !hasDeployment || force;
  info(
    hasDeployment
      ? "Re-running `bunx convex dev` to sync your existing deployment…"
      : "Launching `bunx convex dev` — log in, pick a team, and name your project when prompted.",
  );
  await devOnce({ configureNew });

  // Convex CLI writes NEXT_PUBLIC_CONVEX_URL to .env.local — reload.
  const reloaded = loadEnv(ENV_LOCAL);
  const url = getEnv(reloaded, "NEXT_PUBLIC_CONVEX_URL");
  if (!url)
    fail(
      "Convex did not write NEXT_PUBLIC_CONVEX_URL — try again or run `bunx convex dev` manually.",
    );
  success(`Convex provisioned: ${url}`);
  return reloaded;
}

// ---------------------------------------------------------------------------
// Clerk
// ---------------------------------------------------------------------------

async function runClerkPhase(env: ReturnType<typeof loadEnv>, force: boolean) {
  header("Clerk", "Dev instance + JWT template wired to Convex");

  const haveAll =
    getEnv(env, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") &&
    getEnv(env, "CLERK_SECRET_KEY") &&
    getEnv(env, "CLERK_JWT_ISSUER_DOMAIN");
  if (haveAll && !force) {
    success("Clerk already configured. Skipping.");
    return env;
  }

  note(
    [
      "1. We'll open the Clerk dashboard. Create a new app (or pick one).",
      "2. Enable the sign-in methods you want (email + Google is a fine default).",
      "3. Copy the dev publishable + secret keys back here.",
    ].join("\n"),
    "Clerk dashboard",
  );

  const proceed = await exitOnCancel(
    await p.confirm({ message: "Open Clerk dashboard now?", initialValue: true }),
  );
  if (proceed) openUrl("https://dashboard.clerk.com/apps/new");

  const publishable = await exitOnCancel(
    await p.text({
      message: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (starts with pk_test_…)",
      validate: (v) =>
        v?.startsWith("pk_") ? undefined : "Should start with pk_test_ or pk_live_",
    }),
  );

  const secret = await exitOnCancel(
    await p.password({
      message: "CLERK_SECRET_KEY (starts with sk_test_…)",
      validate: (v) =>
        v?.startsWith("sk_") ? undefined : "Should start with sk_test_ or sk_live_",
    }),
  );

  const spinner = p.spinner();
  spinner.start("Wiring up Clerk via Backend API…");
  try {
    const clerk = new ClerkClient(secret);
    const issuer = await clerk.getJwtIssuerDomain();
    await clerk.ensureConvexJwtTemplate();
    spinner.stop("Clerk wired.");
    setEnvMany(env, {
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: publishable,
      CLERK_SECRET_KEY: secret,
      CLERK_JWT_ISSUER_DOMAIN: issuer,
    });
    saveEnv(env);

    // Mirror to Convex so backend can verify Clerk tokens.
    info("Setting CLERK_JWT_ISSUER_DOMAIN in your Convex dev env…");
    await convexSetEnvMany({ CLERK_JWT_ISSUER_DOMAIN: issuer });
    success("Clerk done. JWT template `convex` is live.");
  } catch (err) {
    spinner.stop("Clerk failed.");
    fail((err as Error).message);
  }

  return env;
}

// ---------------------------------------------------------------------------
// VAPID
// ---------------------------------------------------------------------------

async function runVapidPhase(env: ReturnType<typeof loadEnv>, force: boolean) {
  header("Web Push", "VAPID keypair for push notifications");

  if (getEnv(env, "NEXT_PUBLIC_VAPID_PUBLIC_KEY") && !force) {
    success("VAPID already configured. Skipping.");
    return env;
  }

  const subject = await exitOnCancel(
    await p.text({
      message: "Contact email for VAPID_SUBJECT",
      placeholder: "you@example.com",
      validate: (v) => (v?.includes("@") ? undefined : "Looks invalid"),
    }),
  );

  const { publicKey, privateKey } = generateVapidKeys();
  const vapidSubject = subject.startsWith("mailto:") ? subject : `mailto:${subject}`;

  setEnvMany(env, {
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: publicKey,
    VAPID_PRIVATE_KEY: privateKey,
    VAPID_SUBJECT: vapidSubject,
  });
  saveEnv(env);

  info("Mirroring private + subject to your Convex dev env…");
  await convexSetEnvMany({
    VAPID_PUBLIC_KEY: publicKey,
    VAPID_PRIVATE_KEY: privateKey,
    VAPID_SUBJECT: vapidSubject,
  });
  success("VAPID keys generated and wired.");
  return env;
}

// ---------------------------------------------------------------------------
// PostHog (optional)
// ---------------------------------------------------------------------------

async function runPostHogPhase(env: ReturnType<typeof loadEnv>, force: boolean) {
  header("PostHog", "Optional — capture analytics in dev too");

  if (getEnv(env, "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN") && !force) {
    success("PostHog already configured. Skipping.");
    return env;
  }

  const enable = await exitOnCancel(
    await p.confirm({
      message: "Capture analytics in dev? (You can do this later.)",
      initialValue: false,
    }),
  );
  if (!enable) {
    info("Skipping PostHog — it stays a no-op until you set the prod token.");
    return env;
  }

  const region = (await exitOnCancel(
    await p.select({
      message: "PostHog region",
      options: [
        { value: "us", label: "US (us.posthog.com)" },
        { value: "eu", label: "EU (eu.posthog.com)" },
      ],
      initialValue: "us",
    }),
  )) as PostHogRegion;

  const personalKeyUrl = `https://${region}.posthog.com/settings/user-api-keys`;
  note(
    `Generate a personal API key at:\n${personalKeyUrl}\n\nGive it scopes: project:write, organization:read.`,
    "PostHog",
  );
  const open = await exitOnCancel(await p.confirm({ message: "Open it now?", initialValue: true }));
  if (open) openUrl(personalKeyUrl);

  const personalKey = await exitOnCancel(
    await p.password({
      message: "PostHog personal API key (phx_…)",
      validate: (v) => ((v?.length ?? 0) > 10 ? undefined : "That doesn't look right"),
    }),
  );

  const ph = new PostHogClient(personalKey, region);
  const spinner = p.spinner();
  spinner.start("Connecting to PostHog…");
  try {
    const orgId = await ph.getOrgId();
    const existing = await ph.listProjects(orgId);
    spinner.stop("Connected.");

    const projectChoice = await exitOnCancel(
      await p.select({
        message: "Project",
        options: [
          { value: "__new__", label: pc.green("Create new project") },
          ...existing.map((proj) => ({ value: String(proj.id), label: proj.name })),
        ],
      }),
    );

    let projectId: number;
    if (projectChoice === "__new__") {
      const name = await exitOnCancel(
        await p.text({
          message: "Project name",
          placeholder: "cc-stack",
          defaultValue: "cc-stack",
        }),
      );
      const created = await ph.createProject(orgId, name);
      projectId = created.id;
      success(`Created PostHog project "${name}".`);
    } else {
      projectId = Number(projectChoice);
    }

    // Try Environments-within-a-Project; fall back to project-level token.
    spinner.start("Setting up dev environment…");
    const devEnv = await ph.ensureEnvironment(projectId, "development");
    let token: string;
    if (devEnv) {
      token = devEnv.api_token;
      spinner.stop("Dev environment ready.");
    } else {
      // Legacy fallback: use the project's own write key.
      const project = (await ph.listProjects(orgId)).find((p) => p.id === projectId);
      if (!project) fail("Could not read project token from PostHog.");
      token = project.api_token;
      spinner.stop("Environments not enabled — using project token.");
      warn(
        "Tip: enable Environments in PostHog (Project settings) for cleaner dev/prod separation.",
      );
    }

    setEnvMany(env, {
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: token,
      NEXT_PUBLIC_POSTHOG_HOST: ANALYTICS_HOSTS[region],
      NEXT_PUBLIC_POSTHOG_FORCE_ENABLE: "1",
      NEXT_PUBLIC_POSTHOG_ENVIRONMENT: "development",
    });
    success("PostHog dev wiring done.");
  } catch (err) {
    spinner.stop("PostHog failed.");
    fail((err as Error).message);
  }

  return env;
}

main().catch((err) => {
  console.error(pc.red(`\n${err.stack ?? err.message ?? err}`));
  process.exit(1);
});
