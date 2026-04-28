// The placeholder lets Convex's deploy-time validator accept this file before
// CLERK_JWT_ISSUER_DOMAIN has been set on the deployment (which is a
// chicken-and-egg during first-run setup — the deployment must exist before
// `convex env set` can target it). The real value is written by the Clerk
// phase of `bun run setup`. Auth won't actually function until that's set,
// which is fine — there are no users yet on a fresh deployment.
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN || "https://placeholder.clerk.accounts.dev",
      applicationID: "convex",
    },
  ],
};
