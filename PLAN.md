# cc-stack onboarding CLI — design

Branch: `feat/onboarding-cli`. Goal: replace the multi-page manual SETUP.md with `bun run setup` (dev) and `bun run setup:prod` (prod), wiring every integration end-to-end. After clone, the time from `bun install` to "open browser, see app, signed in, data saving to Convex" should be under 5 minutes.

---

## Decisions (locked from chat)

| # | Decision | Rationale |
| --- | --- | --- |
| 1 | **Hybrid CLI**: drive what we can via API/CLI; print "open this URL, paste back" only where unavoidable | Keep automation high without faking flows that need a human in a browser |
| 2 | **Dev-first**: `bun run setup` then optional `bun run setup:prod` | Fastest path to a running app; defer prod until ready to deploy |
| 3 | **PostHog Environments-within-a-Project** (one project, separate write tokens per env) | Cleaner than super-properties; dev events can't pollute prod funnels; flags shared across envs |
| 4 | **Convex cloud dev** (not anonymous local) | User can see their data in Convex dashboard from day one |

---

## What stays manual (and why)

Three paste-backs in the prod flow are unavoidable — there's no API surface:

1. **Convex prod deploy key** — minted in dashboard only
2. **Clerk prod publishable key** — only available after dashboard "promote to production"
3. **Clerk prod secret key** — same

Two interactive logins in the dev flow:

1. **`bunx convex dev` initial login** — Convex's CLI handles its own browser flow
2. **`bunx wrangler login`** (deferred to prod step) — Cloudflare's OAuth flow

Everything else is automatable.

---

## CLI architecture

```
scripts/
  setup.ts                    # dev orchestrator — entry for `bun run setup`
  setup-prod.ts               # prod additions — entry for `bun run setup:prod`
  lib/
    env.ts                    # parse, mutate, write .env.local / .env.production atomically
    prompts.ts                # @clack/prompts wrappers + helpers (note, success, error)
    http.ts                   # fetch with sane defaults, JSON in/out, error surfaces
    open.ts                   # cross-platform "open this URL in browser" with countdown
    exec.ts                   # spawn helpers (Bun.$ wrappers, pipes stdin for `wrangler secret put`)
    convex.ts                 # convex dev/deploy + env set wrapper
    clerk.ts                  # Clerk Backend API client (instance, jwt_templates, redirect_urls)
    posthog.ts                # PostHog API client (orgs, projects, environments)
    cloudflare.ts             # wrangler shells + CF REST for subdomain
    vapid.ts                  # web-push key gen
    cross-wire.ts             # high-level orchestrators that touch >1 system
```

Each integration module exports a `setupDev()` and `setupProd()` so the orchestrators just sequence them.

---

## Dev flow — `bun run setup`

```
1. WELCOME
   - Header, version, "this will configure: convex, clerk, posthog (optional), web push"
   - Confirm project name (from package.json by default; offer to rename)

2. CONVEX (cloud dev)
   - Spawn `bunx convex dev --once --configure new --project-name <name>`
   - Convex handles browser login; writes NEXT_PUBLIC_CONVEX_URL + CONVEX_DEPLOYMENT to .env.local
   - We then read .env.local back to confirm and surface the URL

3. CLERK (dev instance)
   - Open https://dashboard.clerk.com/apps/new (with a 5s countdown so user can ctrl+c)
   - Prompt for: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY (masked input)
   - Use Backend API:
     a) GET /v1/instance → derive CLERK_JWT_ISSUER_DOMAIN from `frontend_api`
     b) POST /v1/jwt_templates (idempotent — if exists, PATCH)
        body: { name: "convex", claims: { aud: "convex" }, lifetime: 3600 }
   - Write all three keys to .env.local
   - Mirror CLERK_JWT_ISSUER_DOMAIN to Convex: `bunx convex env set CLERK_JWT_ISSUER_DOMAIN <url>`

4. WEB PUSH (VAPID)
   - Run web-push generate-vapid-keys (programmatically via the `web-push` lib, not the CLI)
   - Prompt for VAPID_SUBJECT email (default mailto:<gh user email if available>)
   - Write NEXT_PUBLIC_VAPID_PUBLIC_KEY to .env.local
   - Mirror to Convex: VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY (also handy server-side), VAPID_SUBJECT

5. POSTHOG (optional in dev — default OFF)
   - Ask: "Capture analytics in dev too? (defaults to off — events fire only in prod/preview)"
   - If no: skip; PostHog stays gated by NODE_ENV === 'production'
   - If yes:
     a) Open https://us.posthog.com/settings/user-api-keys
     b) Prompt for personal API key (masked) + region (US/EU)
     c) GET /api/users/@me/ → fetch org id
     d) Either create new project ("cc-stack") or pick an existing one (list)
     e) Use Environments API to create/find a "development" environment, copy its api_token
     f) Write to .env.local: NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=<dev-token>, NEXT_PUBLIC_POSTHOG_HOST, NEXT_PUBLIC_POSTHOG_FORCE_ENABLE=1, NEXT_PUBLIC_POSTHOG_ENVIRONMENT=development

6. SUMMARY
   - Print everything that's now configured
   - Print exact next commands:
       Terminal 1:  bunx convex dev
       Terminal 2:  bun run dev
       When ready to deploy:  bun run setup:prod
```

State machine: each integration is **resumable**. If the user ctrl+c's mid-Clerk, re-running `bun run setup` reads `.env.local` and skips already-set keys (with `--force` to redo).

---

## Prod flow — `bun run setup:prod`

```
1. PRECHECKS
   - Verify .env.local exists and has dev keys
   - Verify `bunx wrangler whoami` (offer to run `bunx wrangler login` if not authed)
   - Print account name + workers.dev subdomain

2. WORKER NAME + URL PREVIEW
   - Read wrangler.jsonc name (default = package.json name)
   - Print the eventual prod URL: https://<worker>.<subdomain>.workers.dev
   - Offer to rename the worker before going further

3. CLERK (prod)
   - Open https://dashboard.clerk.com → instance settings → "Promote to production"
   - Print: "After promoting, copy the prod publishable + secret keys"
   - Prompt for both (masked); user pastes
   - Use Backend API with the prod secret to:
     a) GET /v1/instance → derive prod JWT issuer domain
     b) POST /v1/jwt_templates (recreate "convex" template)
     c) POST /v1/redirect_urls with { url: "https://<worker>.<subdomain>.workers.dev" }
     d) PATCH /v1/instance with allowed_origins
   - Write to .env.production (and stage for Cloudflare secrets)

4. CONVEX (prod)
   - Open https://dashboard.convex.dev/<project>/settings/deploy-keys → "Generate Production"
   - Prompt for the deploy key (masked)
   - Run: CONVEX_DEPLOY_KEY=<key> bunx convex deploy --cmd 'echo "prod provisioned"'
   - Set prod env vars on Convex via `bunx convex env set --prod`:
       CLERK_JWT_ISSUER_DOMAIN, VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, VAPID_SUBJECT
   - Write CONVEX_DEPLOY_KEY + the prod deployment URL to .env.production

5. POSTHOG (prod environment)
   - If PostHog was set up in dev, re-use the personal API key (cached in OS keychain via `bun secrets` if available, otherwise re-prompt)
   - Create/find a "production" environment in the same project; copy its api_token
   - Write NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN_PROD to .env.production
   - (And a "preview" environment too, for branch deploys later)

6. CLOUDFLARE SECRETS
   - Bulk-pipe .env.production into wrangler:
       bunx wrangler secret bulk .env.production
     (or per-key via `echo $VAL | wrangler secret put $KEY` for old wrangler versions)
   - Confirm each secret was written

7. NEXT_PUBLIC_APP_URL
   - Set to https://<worker>.<subdomain>.workers.dev as a Cloudflare secret
   - Update Clerk allowed_origins one more time with the final URL (idempotent)

8. SUMMARY
   - "You're ready: bun run deploy"
```

---

## Cross-wiring matrix

| Value | Source | Destinations | Path |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` (dev) | `bunx convex dev --configure new` | `.env.local` | written by Convex CLI |
| `NEXT_PUBLIC_CONVEX_URL` (prod) | `bunx convex deploy` output | `.env.production`, Cloudflare secret | parsed from CLI stdout |
| `CLERK_JWT_ISSUER_DOMAIN` | Clerk `GET /v1/instance` | `.env.local`/`.env.production`, `bunx convex env set` (dev + `--prod`) | derived from secret key |
| `convex` JWT template | none (created by us) | Clerk side via `POST /v1/jwt_templates` | created automatically |
| Cloudflare worker URL | `wrangler whoami --json` + CF subdomain API | Clerk allowed_origins + redirect_urls, `NEXT_PUBLIC_APP_URL` secret | derived |
| VAPID public/private | local `web-push generate-vapid-keys` | `.env.local`, Convex env (dev + prod) | generated |
| PostHog dev token | PostHog API → environment "development" | `.env.local` (only if user opted in) | API |
| PostHog prod token | PostHog API → environment "production" | `.env.production`, Cloudflare secret | API |
| Convex prod deploy key | dashboard | `.env.production`, Cloudflare secret `CONVEX_DEPLOY_KEY` (for CI redeploy) | manual paste |
| Clerk prod pub/secret | dashboard "promote" | `.env.production`, Cloudflare secrets | manual paste |

---

## Code-side changes alongside the CLI

- **`instrumentation-client.ts`**: read `NEXT_PUBLIC_POSTHOG_ENVIRONMENT` (defaults `production` if `NODE_ENV` is `production`, otherwise `development`); call `posthog.register({ environment, deployment_url: NEXT_PUBLIC_APP_URL })` so every event carries it. Stays no-op in dev unless `_FORCE_ENABLE=1`.
- **`.env.example`**: document the new env vars (`NEXT_PUBLIC_POSTHOG_ENVIRONMENT`, `CONVEX_DEPLOYMENT`, `CONVEX_DEPLOY_KEY`).
- **`AGENTS.md`**: stack-wide best-practice notes for future agents — Convex schema discipline, Clerk middleware → proxy convention, Tailwind v4 directives, Cloudflare deploy gotchas, do-not-skip-build rule.
- **`SETUP.md`**: shrunk to "run `bun run setup`"; keep an "if anything fails, here's the manual fallback" section.
- **`package.json`**: new scripts `setup`, `setup:prod`.

---

## Out of scope for this branch

- Preview deployments (per-branch Convex previews + per-PR Cloudflare Pages) — possible follow-up
- Custom domain wiring (Cloudflare → Clerk satellite domains)
- Clerk social-OAuth credential automation (GCP OAuth client creation)
- A "destroy / reset" command — for now, manual `.env.local` edits
- Switching to anonymous Convex local (the alternate dev path)

---

## Risks / open questions

- **PostHog Environments-within-a-Project** rolled out 2025; older accounts may still be on legacy projects-per-env. The CLI should detect and fall back to the super-property approach if the API returns "Environments not enabled."
- **`wrangler secret bulk`** format: takes JSON, not dotenv. We'll synthesize a JSON payload from the parsed `.env.production` and pipe it.
- **Clerk JWT template idempotency**: API doesn't have an upsert. We list templates first, find the one named `convex`, PATCH or POST.
- Anything weird at runtime (Convex CLI prompts in unexpected order, Clerk API rate limits) — the CLI should let you re-run a single phase: `bun run setup -- --only=clerk`.
