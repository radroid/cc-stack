# SETUP.md

Two commands set up the entire stack:

```bash
bun run setup        # dev: Convex, Clerk, VAPID, optionally PostHog
bun run setup:prod   # prod: layers prod keys + Cloudflare push (run later)
```

Both are **idempotent** — re-running them skips anything already configured. Pass `--force` to redo a step, or `--only=<phase>` (e.g. `--only=clerk`) to re-run a single integration.

The CLI handles all cross-wiring (Clerk JWT issuer → Convex env, Cloudflare URL → Clerk allowed origins, VAPID → both `.env.local` and Convex env). You'll only be asked to paste values that have no API surface — three in total for prod (Convex prod deploy key, Clerk prod publishable + secret keys).

---

## Prereqs

```bash
bun --version          # 1.1+
gh auth status         # for repo hosting later (optional)
```

If Bun isn't installed: `curl -fsSL https://bun.sh/install | bash`.

---

## Dev — `bun run setup`

```bash
bun install
bun run setup
```

What happens, in order:

1. **Convex (cloud dev)** — `bunx convex dev --once --configure new` runs. Browser opens for login on first run; project gets created; `NEXT_PUBLIC_CONVEX_URL` + `CONVEX_DEPLOYMENT` are written to `.env.local`. `convex/_generated/` is created.
2. **Clerk (dev)** — opens the Clerk dashboard. You create an app and paste back the dev publishable + secret keys. The CLI then uses Clerk's Backend API to derive `CLERK_JWT_ISSUER_DOMAIN` and create the `convex` JWT template — no manual UI clicking required for that. The issuer is also pushed to Convex via `bunx convex env set`.
3. **VAPID** — generates a fresh keypair locally, writes the public key to `.env.local`, mirrors private + subject to Convex env.
4. **PostHog** *(optional)* — defaults to off in dev. Opt in if you want analytics in dev too: paste a personal API key, pick or create a project, the CLI creates a "development" environment (PostHog's Environments feature) and writes the env's write-only token to `.env.local`.

After it finishes, two terminals:

```bash
# Terminal 1
bunx convex dev

# Terminal 2
bun run dev
```

Open <http://localhost:3000>.

---

## Prod — `bun run setup:prod`

Run when you're ready to deploy. Prereq: `.env.local` exists (i.e., dev setup is done).

```bash
bun run setup:prod
```

What happens:

1. **Pre-flight** — verifies `bunx wrangler whoami`. If you're not logged in, the CLI offers to run `bunx wrangler login`.
2. **Worker name + URL preview** — reads `wrangler.jsonc`, lets you rename, prints the eventual URL (`https://<name>.<your-subdomain>.workers.dev`) so you know what's about to land where. *(Set `CLOUDFLARE_API_TOKEN` to enable subdomain preview before first deploy — otherwise the URL prints after the first deploy.)*
3. **Clerk (prod)** — opens the dashboard so you can promote the dev instance to production. Paste the prod publishable + secret keys. CLI calls Backend API to: derive prod JWT issuer, create the `convex` template, allow-list the Worker URL.
4. **Convex (prod)** — opens the dashboard so you can mint a Production deploy key. Paste it. CLI runs `bunx convex deploy` to provision the prod deployment, then mirrors `CLERK_JWT_ISSUER_DOMAIN` + VAPID secrets to the prod backend env.
5. **PostHog (prod)** — re-uses your personal API key, creates `production` and `preview` environments in your PostHog project, writes the prod env's token to `.env.production`.
6. **Cloudflare** — bulk-uploads everything from `.env.production` to the Worker via `bunx wrangler secret bulk` (excluding the Convex deploy key).

Then:

```bash
bun run deploy
```

---

## Manual fallback (if the CLI fails)

If any step blows up, here's how to do it by hand. (Open an issue if you hit this — the CLI should handle it.)

### Convex
```bash
bunx convex dev   # follow prompts; writes NEXT_PUBLIC_CONVEX_URL to .env.local
```

### Clerk
1. <https://dashboard.clerk.com> → create app
2. API Keys → copy publishable + secret → paste into `.env.local`
3. JWT Templates → New → "Convex" → name it `convex` → copy Issuer URL into `.env.local` as `CLERK_JWT_ISSUER_DOMAIN`
4. `bunx convex env set CLERK_JWT_ISSUER_DOMAIN <issuer>`

### VAPID
```bash
bun run vapid
# paste public key into .env.local as NEXT_PUBLIC_VAPID_PUBLIC_KEY
# paste private key into .env.local as VAPID_PRIVATE_KEY
bunx convex env set VAPID_PRIVATE_KEY <key>
bunx convex env set VAPID_SUBJECT mailto:you@example.com
```

### PostHog
1. <https://us.posthog.com> → project → API key
2. Add to `.env.production` (not `.env.local`): `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`, `NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com`
3. *(Optional)* Project → Settings → Environments → enable for cleaner separation

### Cloudflare
```bash
bunx wrangler login
bunx wrangler secret put NEXT_PUBLIC_CONVEX_URL
bunx wrangler secret put NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
bunx wrangler secret put CLERK_SECRET_KEY
# ...repeat for every var in .env.production
bun run deploy
```

---

## Cheat sheet

| Need to … | Run |
| --- | --- |
| Configure dev from scratch | `bun run setup` |
| Add prod | `bun run setup:prod` |
| Re-do one step | `bun run setup -- --force --only=clerk` |
| Add a Convex query | new file in `convex/` (e.g. `convex/posts.ts`) |
| Add a shadcn component | `bunx shadcn add <name>` |
| Apply a TweakCN theme | `bunx shadcn add <theme-url>` |
| Bump the SW cache | edit `CACHE_NAME` in `public/sw.js` |
| Deploy | `bun run deploy` |
