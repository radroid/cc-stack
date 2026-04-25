# Convex backend

Run `bunx convex dev` to start the dev server. It will:

1. Prompt for login (first time only)
2. Create a Convex project + deployment
3. Write `NEXT_PUBLIC_CONVEX_URL` to `.env.local`
4. Watch this folder and deploy on save

## Environment variables (Convex side)

Set with `bunx convex env set <KEY> <VALUE>` (or via the dashboard):

- `CLERK_JWT_ISSUER_DOMAIN` — same value as in `.env.local`
- `VAPID_PRIVATE_KEY` — from `bunx web-push generate-vapid-keys`
- `VAPID_SUBJECT` — `mailto:you@example.com`

## Files

- `schema.ts` — minimal `users` table indexed by Clerk id
- `users.ts` — `getCurrentUser` + `ensureUser`
- `auth.config.ts` — wires Clerk JWT verification

Add your own queries/mutations/actions here. See https://docs.convex.dev for patterns.
