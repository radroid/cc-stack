import posthog from "posthog-js";

/**
 * Production-only PostHog init. In dev this is a no-op — no events, no network
 * traffic, no session recording, no console noise. To opt in from a preview env
 * set NEXT_PUBLIC_POSTHOG_FORCE_ENABLE=1.
 */
const shouldInit =
  !!process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN &&
  (process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_POSTHOG_FORCE_ENABLE === "1");

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
}
