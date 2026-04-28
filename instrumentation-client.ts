import posthog from "posthog-js";

/**
 * Production-only PostHog init. In dev this is a no-op — no events, no network
 * traffic, no session recording, no console noise. To opt in from a preview env
 * (or from local dev after `bun run setup` configured a dev environment token),
 * set NEXT_PUBLIC_POSTHOG_FORCE_ENABLE=1.
 *
 * Environment separation uses PostHog's Environments-within-a-Project feature:
 * each env (development / preview / production) gets its own write-only
 * `api_token`. The token is loaded from NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN, and
 * `environment` is registered as a super-property so dashboards can also
 * filter by it.
 */
const shouldInit =
  !!process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN &&
  (process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_POSTHOG_FORCE_ENABLE === "1");

const environment =
  process.env.NEXT_PUBLIC_POSTHOG_ENVIRONMENT ??
  (process.env.NODE_ENV === "production" ? "production" : "development");

if (shouldInit) {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN as string, {
    api_host: "/ingest",
    ui_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.posthog.com",
    defaults: "2026-01-30",
    capture_exceptions: true,
    debug: false,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "[data-ph-mask]",
      blockSelector: "[data-ph-no-capture]",
    },
    autocapture: {
      dom_event_allowlist: ["click", "change", "submit"],
      css_selector_allowlist: ["[data-ph-capture]", "button", "a"],
    },
  });

  // Tag every event with environment + deployment URL so dashboards can
  // filter, even in setups that share a single project token across envs.
  posthog.register({
    environment,
    deployment_url: process.env.NEXT_PUBLIC_APP_URL,
  });
}
