<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

Next 16 has breaking changes — APIs, conventions, and file structure may all differ from your training data. The biggest one: there is no `middleware.ts` in this project — Clerk runs from `proxy.ts` at the root. Read the relevant guide in `node_modules/next/dist/docs/` before writing any route, middleware, or data-fetching code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

This file is the source of truth for any AI coding agent (Claude Code, Cursor, Codex, etc.) working in this repo. Read it before touching code. If a rule here conflicts with your training data, the rule wins.

## Stack snapshot

| Layer | Choice | Role |
| --- | --- | --- |
| Framework | Next.js 16.2 (App Router, React 19.2) | UI + routing + server components |
| Backend / DB | Convex 1.36 | Realtime DB, queries, mutations, actions |
| Auth | Clerk 7 (`@clerk/nextjs`) | Sessions, JWTs, user UI |
| Styling | Tailwind v4 + shadcn/ui | Design system, theme tokens in CSS |
| Analytics | PostHog (`posthog-js` + `posthog-node`) | Events, recordings, exceptions |
| Push | `web-push` + native Service Worker | Web Push (VAPID), PWA shell |
| Deploy | Cloudflare Workers via OpenNext (`@opennextjs/cloudflare`) | Production runtime |
| Tooling | Bun + Biome 2 | Package manager + lint/format |

Project layout is **flat** — `app/`, `components/`, `convex/`, `lib/`, `public/`, `scripts/` at root. No `src/`.

## Tooling: bun, biome, dev server

Use `bun` for everything: `bun install`, `bun add <pkg>`, `bun run <script>`. Never use `npm` or `pnpm` — the lockfile is `bun.lock`.

Biome owns lint and format. Do not add ESLint or Prettier back. Run before committing:

```bash
bun run build       # next build — catches RSC + type errors at build time
bun run lint        # biome check .
bun run typecheck   # tsc --noEmit
```

The dev server is almost certainly already running in another terminal (`bun run dev` and `bunx convex dev`). Do **not** start your own — port 3000 will collide and you'll fight Convex's file watcher. Ask the user if you think it isn't running.

## Convex rules

If you have not already, install the Convex agent guidelines into this repo: `npx convex ai-files install`. Also use the `convex`, `convex-quickstart`, `convex-setup-auth`, `convex-helpers-guide`, and `convex-performance-audit` skills when relevant.

**Schema discipline.** Every table is declared in `convex/schema.ts` with `defineTable` + validators (`v.string()`, `v.optional(...)`, etc.). Add an index for every access pattern — never `.filter()` for primary lookups, always `.withIndex(...)`. Index names are `by_<field>` (see `users` table).

**Function discipline.** Every public `query`, `mutation`, and `action` declares an `args` validator (use `args: {}` if none). Use `internalQuery` / `internalMutation` / `internalAction` for anything not called from the client. Return values should be validated too where practical.

**Separation.** Queries are pure reads — no `Date.now()`, no `Math.random()`, no `fetch`. Mutations write the DB and may call `Date.now()`. Actions are the only place for `fetch`, third-party SDKs, or anything non-deterministic that needs to write — actions call mutations via `ctx.runMutation(internal.foo.bar, …)`.

**Auth in Convex.** Always read identity via `await ctx.auth.getUserIdentity()`. Do not manually verify JWTs — Convex handles that against `convex/auth.config.ts`. The Clerk subject (`identity.subject`) is the join key into our `users` table (`by_clerk_id` index).

**Generated code.** Treat `convex/_generated/` as read-only — Biome already excludes it.

## Clerk + Convex auth

Clerk is the IdP, Convex trusts it via a **JWT template named exactly `convex`** (created in the Clerk dashboard). The bridge:

- `convex/auth.config.ts` reads `CLERK_JWT_ISSUER_DOMAIN` (set both in `.env.local` and via `bunx convex env set`).
- `proxy.ts` at the project root runs `clerkMiddleware()` — this is the Next 16 replacement for `middleware.ts`. Don't create a `middleware.ts`.
- The frontend wires them together with `<ConvexProviderWithClerk client={convex} useAuth={useAuth}>` in `components/providers/convex-client-provider.tsx`.

To gate a server-rendered page, use Clerk's `auth()` from `@clerk/nextjs/server`. To gate a Convex function, check `ctx.auth.getUserIdentity()` and throw if missing. Don't roll your own session cookies, JWT verification, or "current user" context.

## Tailwind v4 / shadcn

There is **no `tailwind.config.ts`**. Theme tokens live in `app/globals.css` under `@theme inline` as CSS custom properties. Use Tailwind v4 directives — `@theme`, `@custom-variant`, `@apply`, `@import "tailwindcss"`. Biome's CSS parser is configured with `tailwindDirectives: true` so they won't trip the linter.

Do not rewrite Tailwind utility class strings to "canonical" or "shorthand" form unless explicitly asked — diffs become noise and shadcn upstream stays diffable.

shadcn components live in `components/ui/` and are **excluded from Biome lint** (see `biome.json`). Leave them as shadcn ships them. Add new components with `bunx shadcn add <name>`. Themes via `bunx shadcn add <tweakcn-url>`.

## PostHog

PostHog is **production-only by default**. The init guard in `instrumentation-client.ts` requires `NODE_ENV === "production"` (or `NEXT_PUBLIC_POSTHOG_FORCE_ENABLE=1`) — keep that guard. In dev, `posthog-js` is loaded but not initialized, so calls become no-ops.

This means `posthog.capture("event_name", { … })` is **safe to call anywhere** without a feature flag — no events fire in dev.

We use **PostHog's Environments-within-a-Project** feature: one project, separate write tokens per env. `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` holds the **current env's** token (different value in `.env.local`, `.env.production`, and Cloudflare secrets). `NEXT_PUBLIC_POSTHOG_ENVIRONMENT` (`development` / `preview` / `production`) is registered as a super-property so dashboards can filter even on legacy single-token setups. Don't introduce a second env var name for tokens — keep one variable, vary its value per env.

PostHog ingest is reverse-proxied through `/ingest/*` (see `next.config.ts` rewrites) — keep `api_host: "/ingest"` so ad-blockers don't kill events.

PII rules: mask sensitive text with `data-ph-mask`, block whole regions from autocapture and recording with `data-ph-no-capture`. Never put email, name, raw IDs, or free-text input into event properties.

## PWA / service worker

The SW lives at `public/sw.js`. Bump `CACHE_NAME` (`create-club-stack-vN` → `vN+1`) for **any** change that affects the cached shell — otherwise existing installs serve stale assets forever.

Registration is handled by `components/pwa/service-worker-registration.tsx` and only fires on HTTPS or `localhost`. The `fetch` handler already skips Convex (`*.convex.cloud`, `*.convex.site`), Clerk (`*clerk*`), and PostHog hosts — preserve those skips when editing.

Web Push payloads are JSON. iOS Safari ignores `actions` and `vibrate`, so don't rely on them for critical UX. The `pushsubscriptionchange` handler re-subscribes and `postMessage`s the new subscription to clients — server-side persistence happens in the page, via `usePushSubscription()` in `components/pwa/use-push-subscription.ts`.

## Cloudflare / OpenNext deploy

`bun run build` runs Next's build. `bun run preview` runs OpenNext + wrangler locally. `bun run deploy` builds and ships to Cloudflare Workers.

The Worker uses the `nodejs_compat` compatibility flag (`wrangler.jsonc`), but stay conservative: avoid Node-only APIs (`fs`, `child_process`, raw `net`) in any code that can run on the edge — that includes route handlers, server components, and middleware/proxy. Push Node-only work into Convex actions instead.

Set production env via `bunx wrangler secret put <NAME>` (see `SETUP.md` for the full list). Don't bake secrets into `wrangler.jsonc`. Convex-side secrets go through `bunx convex env set <NAME> <value>`.

## Onboarding CLI

The intended dev experience is `bun run setup` (dev) and `bun run setup:prod` (prod) — one orchestrator per phase, idempotent, resumable, safe to re-run. See `PLAN.md` for the design and `scripts/lib/` for per-integration modules. The CLI may not yet be wired into `package.json` in every clone — if not, `SETUP.md` is the manual fallback.

Direct users to the CLI rather than walking them through editing `.env.local` by hand. The CLI reads existing values and skips them; pass `--force` (or `--only=<phase>`) to redo a step.

## What NOT to do

- **No second auth provider.** Clerk is it. Don't add NextAuth, Lucia, Supabase Auth, etc.
- **No second ORM/DB.** Convex is the database. Don't add Prisma, Drizzle, Kysely, raw Postgres, MongoDB.
- **No ESLint / Prettier.** Biome owns lint and format.
- **No `src/` folder.** The project is flat; keep it flat.
- **No Tailwind v3 plugins** (`@tailwindcss/forms`, `tailwindcss-animate`, etc.) — we're on v4. Use `tw-animate-css` or v4-native equivalents.
- **No `middleware.ts`.** Use `proxy.ts` (Next 16).
- **No `.filter()` on Convex queries** for primary lookups — add an index.
- **No `Date.now()` / `Math.random()` / `fetch` inside `query` functions.**
- **Never commit** `.env.local`, `.env.production`, VAPID private keys, or any `*_SECRET_KEY` value. `.gitignore` already covers `.env*` — keep it that way.
- **No emojis** in code, comments, commit messages, or UI copy unless the user explicitly asks.

## Pre-commit checklist

Before you stage and commit:

- [ ] `bun run build` passes
- [ ] `bun run lint` passes (or you ran `bun run lint:fix`)
- [ ] `bun run typecheck` passes
- [ ] No new PII flowing into PostHog events; sensitive UI marked with `data-ph-mask` / `data-ph-no-capture`
- [ ] No secrets, tokens, or `.env*` files staged (`git diff --cached` to confirm)
- [ ] If `public/sw.js` changed: `CACHE_NAME` bumped
- [ ] If schema changed: indexes added for any new access pattern; Convex types regenerated (`bunx convex dev` will do it)
