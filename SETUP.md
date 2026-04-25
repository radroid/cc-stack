# SETUP.md

One-time setup after cloning this template. Each step lists the **exact CLI commands** to run plus any manual UI steps that can't be automated (account creation, OAuth approval, etc).

> Order matters — Convex first (creates `.env.local`), then everything else fills in keys.

---

## 0. Prereqs

```bash
bun --version          # need 1.1+
gh auth status         # for repo creation later
```

If you don't have Bun: `curl -fsSL https://bun.sh/install | bash`.

---

## 1. Install + scaffold env

```bash
bun install
cp .env.example .env.local
```

Leave `.env.local` open — you'll fill it in as you go.

---

## 2. Convex — backend + database

```bash
bunx convex dev
```

The first run will:

- Open a browser to log in
- Prompt you to **create a new project** (pick any name)
- Write `NEXT_PUBLIC_CONVEX_URL=…` into `.env.local` automatically
- Start watching `convex/` and pushing on save — leave this terminal running

---

## 3. Clerk — authentication

**Manual (UI):**

1. Go to <https://dashboard.clerk.com> → **Create application** → enable Email + Google sign-in
2. Copy from **API Keys** page:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `CLERK_SECRET_KEY`
3. Go to **JWT Templates** → **New template** → choose **Convex** → name it exactly `convex` → copy the **Issuer** URL

**CLI:**

```bash
# Paste the Issuer URL into .env.local as CLERK_JWT_ISSUER_DOMAIN
# Then mirror it to Convex so the backend can verify Clerk tokens:
bunx convex env set CLERK_JWT_ISSUER_DOMAIN <issuer-url>
```

Restart `bunx convex dev` after setting the env var.

---

## 4. (Optional) GCP — custom Google OAuth client for Clerk

Only needed if you want production Google sign-in branded as your app instead of "via Clerk":

**Manual (UI):**

1. <https://console.cloud.google.com> → create project → **APIs & Services → Credentials**
2. **Create credentials → OAuth client ID** → Web application
3. Authorized redirect URIs: copy from Clerk Dashboard → **Social Connections → Google** → "Use custom credentials"
4. Paste the GCP **Client ID + Client Secret** back into Clerk

No CLI step. No env vars in this repo — Clerk holds the credentials.

Skip this for dev. Clerk's shared OAuth client just works.

---

## 5. Web Push — VAPID keypair

```bash
bun run vapid
```

Output gives you a `Public Key:` and `Private Key:`.

- Paste **public** as `NEXT_PUBLIC_VAPID_PUBLIC_KEY` in `.env.local`
- Paste **private** as `VAPID_PRIVATE_KEY` in `.env.local`
- Set `VAPID_SUBJECT=mailto:you@example.com` in `.env.local`
- Mirror the private + subject to Convex (the server signs pushes there):

```bash
bunx convex env set VAPID_PRIVATE_KEY <private-key>
bunx convex env set VAPID_SUBJECT mailto:you@example.com
```

---

## 6. PostHog — analytics (production only)

By design, PostHog is a **no-op in development** — no events, no network traffic. You only need to configure it for production.

**Manual (UI):**

1. <https://us.posthog.com> → create project → **Project settings → Project API key**
2. Copy the `phc_…` token

**Env:**

- Add `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com` to your **production** env (Cloudflare secret in step 7), **not** `.env.local`.
- To opt in from a preview env, set `NEXT_PUBLIC_POSTHOG_FORCE_ENABLE=1` there.

---

## 7. Cloudflare — deployment

```bash
bunx wrangler login
```

Edit `wrangler.jsonc` → change `"name": "cc-stack"` to your worker name.

Set production secrets on the Worker:

```bash
bunx wrangler secret put NEXT_PUBLIC_CONVEX_URL
bunx wrangler secret put NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
bunx wrangler secret put CLERK_SECRET_KEY
bunx wrangler secret put NEXT_PUBLIC_VAPID_PUBLIC_KEY
bunx wrangler secret put NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
bunx wrangler secret put NEXT_PUBLIC_POSTHOG_HOST
bunx wrangler secret put NEXT_PUBLIC_APP_URL   # e.g. https://your-app.pages.dev
```

(Repeat for any other prod-only vars.)

Deploy:

```bash
bun run deploy
```

---

## 8. GitHub

```bash
git add -A
git commit -m "chore: initial setup"
gh repo create <name> --public --source=. --push
```

---

## 9. Run it

```bash
# Terminal 1
bunx convex dev

# Terminal 2
bun run dev
```

Open <http://localhost:3000>.

---

## Where things live (cheat sheet)

| Need to … | Edit |
| --- | --- |
| Add a Convex query | `convex/<name>.ts` |
| Add a shadcn component | `bunx shadcn add <name>` |
| Apply a TweakCN theme | `bunx shadcn add <theme-url>` |
| Wire a new provider in the tree | `app/layout.tsx` |
| Tune service-worker caching | `public/sw.js` (bump `CACHE_NAME`) |
| Add a tracked event | `posthog.capture("event_name", { ... })` anywhere — no-op in dev |
| Subscribe a user to push | `usePushSubscription()` from `components/pwa/use-push-subscription.ts` |
