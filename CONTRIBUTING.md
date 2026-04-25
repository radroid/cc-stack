# Contributing

Thanks for taking a look! This is a starter template, so the bar for changes is **does this make a future scaffold cleaner without locking anyone in to product decisions?**

## Local setup

See [SETUP.md](./SETUP.md). You don't need real Convex/Clerk/Cloudflare credentials to work on the template scaffold itself — only to verify the integrations.

## Before opening a PR

```bash
bun run lint
bun run typecheck
bun run build
```

All three must pass.

## What belongs here

- Stack-level wiring: providers, middleware, env scaffolding, deploy config
- PWA primitives, service worker handlers
- Setup docs, ergonomics

## What doesn't belong here

- App-specific Convex schemas, components, copy
- Branding, domains, real keys
- Opinions about *which* features to build

If you'd like an addition, open an issue first describing the use case.
