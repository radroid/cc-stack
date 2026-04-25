/// <reference lib="webworker" />

// Bump this version to force existing clients to drop old caches and re-fetch
// on activate.
const CACHE_NAME = "create-club-stack-v1";
const OFFLINE_URL = "/offline";

const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
];

// Install: pre-cache offline page + core shell assets.
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: "reload" }));
          } catch (err) {
            console.warn("[sw] precache failed for", url, err);
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

// Activate: drop caches from previous versions.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

// Fetch: route requests through caching strategies.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") return;
  // Convex realtime / API.
  if (url.hostname.includes("convex.cloud") || url.hostname.includes("convex.site")) return;
  // Clerk auth.
  if (url.hostname.includes("clerk")) return;
  // PostHog ingest (we proxy through /ingest, so only direct hits).
  if (url.hostname.includes("posthog")) return;
  if (!url.protocol.startsWith("http")) return;

  // Cache-first: Next.js content-hashed static assets.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      }),
    );
    return;
  }

  // Cache-first: Google Fonts.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      }),
    );
    return;
  }

  // Network-first: HTML navigations with offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch (_err) {
          const cache = await caches.open(CACHE_NAME);
          const offline = await cache.match(OFFLINE_URL);
          if (offline) return offline;
          return new Response(
            "<!doctype html><meta charset=utf-8><title>Offline</title><p>You're offline.</p>",
            {
              status: 503,
              statusText: "Service Unavailable",
              headers: { "Content-Type": "text/html; charset=utf-8" },
            },
          );
        }
      })(),
    );
    return;
  }
});

// ---------------------------------------------------------------------------
// Web Push
// ---------------------------------------------------------------------------

self.addEventListener("push", (event) => {
  const defaultIcon = "/icon-192.png";
  const defaultBadge = "/icon-192.png";

  let payload = {
    title: "Notification",
    body: "You have a new update.",
    icon: defaultIcon,
    badge: defaultBadge,
    tag: undefined,
    data: {},
    actions: undefined,
    vibrate: undefined,
    requireInteraction: undefined,
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = {
        title: parsed.title || payload.title,
        body: parsed.body || payload.body,
        icon: parsed.icon || defaultIcon,
        badge: parsed.badge || defaultBadge,
        tag: parsed.tag,
        data: parsed.data || {},
        actions: Array.isArray(parsed.actions) ? parsed.actions : undefined,
        vibrate: Array.isArray(parsed.vibrate) ? parsed.vibrate : undefined,
        requireInteraction:
          typeof parsed.requireInteraction === "boolean"
            ? parsed.requireInteraction
            : undefined,
      };
    } catch (_e) {
      try {
        payload.body = event.data.text() || payload.body;
      } catch (_e2) {
        // keep defaults
      }
    }
  }

  const maxActions =
    typeof Notification !== "undefined" && typeof Notification.maxActions === "number"
      ? Notification.maxActions
      : 0;
  const actions =
    payload.actions && maxActions > 0 ? payload.actions.slice(0, maxActions) : undefined;

  const options = {
    body: payload.body,
    icon: payload.icon,
    badge: payload.badge,
    tag: payload.tag,
    data: payload.data,
  };
  if (actions) options.actions = actions;
  if (payload.vibrate) options.vibrate = payload.vibrate;
  if (typeof payload.requireInteraction === "boolean") {
    options.requireInteraction = payload.requireInteraction;
  }

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;

  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of allClients) {
        try {
          const clientUrl = new URL(client.url);
          if (clientUrl.origin === self.location.origin) {
            if ("focus" in client) await client.focus();
            if ("navigate" in client && clientUrl.pathname !== targetUrl) {
              try {
                await client.navigate(targetUrl);
              } catch (_e) {
                // navigation can fail across controllers
              }
            }
            return;
          }
        } catch (_e) {
          // skip malformed
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});

// pushsubscriptionchange: re-subscribe with the same VAPID key after rotation
// and notify open clients so they can persist the new subscription server-side.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const oldSub = event.oldSubscription;
        const appServerKey =
          (oldSub && oldSub.options && oldSub.options.applicationServerKey) || null;
        if (!appServerKey) return;
        const newSub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: appServerKey,
        });
        const allClients = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        for (const client of allClients) {
          client.postMessage({
            type: "pushsubscriptionchange",
            subscription: newSub.toJSON(),
            oldEndpoint: oldSub ? oldSub.endpoint : null,
          });
        }
      } catch (err) {
        console.warn("[sw] pushsubscriptionchange re-subscribe failed", err);
      }
    })(),
  );
});
