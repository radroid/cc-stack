"use client";

import { useEffect } from "react";

/**
 * Registers `/sw.js` on any HTTPS origin (and localhost). Service workers are
 * scoped to their origin, so preview/staging/prod don't bleed into each other.
 * Cross-deploy staleness on the same origin is handled by bumping `CACHE_NAME`
 * in `public/sw.js`.
 */
function isSWEligible(hostname: string, protocol: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  return protocol === "https:";
}

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const { hostname, protocol } = window.location;
    if (!isSWEligible(hostname, protocol)) return;

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        if (cancelled) return;
        interval = setInterval(() => registration.update(), 60 * 60 * 1000);
      })
      .catch((err) => {
        console.warn("[sw] registration failed", err);
      });

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, []);

  return null;
}
