# create-club-stack

A PWA-ready, opinionated Next.js starter wired with the full Create➕Club stack — clone it, log in to a few services, and start building product.

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-149eca?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Convex](https://img.shields.io/badge/Backend-Convex-ee342f)](https://convex.dev)
[![Clerk](https://img.shields.io/badge/Auth-Clerk-6c47ff)](https://clerk.com)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06b6d4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Cloudflare](https://img.shields.io/badge/Deploy-Cloudflare_Workers-f38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![Bun](https://img.shields.io/badge/Runtime-Bun-fbf0df?logo=bun&logoColor=black)](https://bun.sh)
[![Biome](https://img.shields.io/badge/Lint-Biome-60a5fa?logo=biome&logoColor=white)](https://biomejs.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

## Stack

| Layer | Choice |
| --- | --- |
| Framework | **Next.js 16** (App Router, no `src/`, Turbopack) |
| Language | **TypeScript** |
| Package manager | **Bun** |
| Linter / formatter | **Biome** |
| Styling | **Tailwind CSS v4** |
| Components | **shadcn/ui** + [TweakCN](https://tweakcn.com) themes |
| Backend / DB | **Convex** (reactive, typed) |
| Auth | **Clerk** |
| Auth infra | **GCP** (only for custom Google OAuth client) |
| Analytics | **PostHog** (prod-only, reverse-proxied via `/ingest`) |
| Push notifications | **Web Push (VAPID)** + service worker |
| PWA | App manifest + service worker + offline route |
| Deploy | **Cloudflare Workers** via OpenNext |

## Use this template

```bash
bunx create-next-app@latest my-app -e https://github.com/<you>/create-club-stack
cd my-app
bun install
cp .env.example .env.local
```

Then follow [SETUP.md](./SETUP.md) — it lists every account login and CLI command in order.

## Quick start (after SETUP.md)

```bash
bun run convex   # in one terminal — Convex dev server
bun run dev      # in another — Next.js dev server
```

Open <http://localhost:3000>.

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Next.js dev server (Turbopack) |
| `bun run convex` | Convex dev (watches `convex/` and deploys) |
| `bun run build` | Production build — must pass before committing |
| `bun run lint` | Biome check |
| `bun run lint:fix` | Biome check + auto-fix |
| `bun run format` | Biome format |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run vapid` | Generate a fresh VAPID keypair |
| `bun run preview` | OpenNext local Cloudflare Worker preview |
| `bun run deploy` | OpenNext build + deploy to Cloudflare |

## Project layout

```
app/                 # App Router pages, layout, manifest, offline page
components/
  providers/         # Clerk, Convex, Theme, PostHog identifier
  pwa/               # service worker registration, push subscription hook
  ui/                # shadcn baseline (button, card, input, dialog, ...)
convex/              # Convex schema + functions (users baseline included)
lib/                 # utils, clerk-appearance
public/sw.js         # service worker (cache + push handlers)
instrumentation-client.ts  # PostHog init (prod-only gate)
middleware.ts        # Clerk middleware
next.config.ts       # PostHog reverse-proxy + OpenNext dev hook
wrangler.jsonc       # Cloudflare Worker config
biome.json           # Biome lint + format config
```

## Theming

Ships with shadcn's `radix-nova` preset. Swap in a [TweakCN](https://tweakcn.com/themes) theme any time:

```bash
bunx shadcn add <theme-url>
```

## Deployment

- **Frontend:** Cloudflare Workers (OpenNext) — `bun run deploy`
- **Backend:** Convex (`bunx convex deploy --prod`)
- **Auth:** Clerk has separate dev + prod instances — use prod publishable + secret keys in production env

Set production env vars on Cloudflare via `bunx wrangler secret put <KEY>` and on Convex via `bunx convex env set <KEY> <VALUE>`.

## License

[MIT](./LICENSE) © Create➕Club. PRs welcome.
