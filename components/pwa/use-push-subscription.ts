"use client";

import { useCallback, useEffect, useState } from "react";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export type PushPermission = "default" | "granted" | "denied" | "unsupported";

/**
 * Tiny hook around the browser's Push API. Returns the current permission and
 * a `subscribe()` that asks for permission, registers with the active SW, and
 * hands you the resulting `PushSubscription` (which you should send to a
 * Convex mutation to persist).
 */
export function usePushSubscription() {
  const [permission, setPermission] = useState<PushPermission>("default");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission as PushPermission);
  }, []);

  const subscribe = useCallback(async (): Promise<PushSubscription | null> => {
    const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapid) {
      console.warn("[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set — cannot subscribe.");
      return null;
    }
    if (permission === "unsupported") return null;

    const result = await Notification.requestPermission();
    setPermission(result as PushPermission);
    if (result !== "granted") return null;

    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (existing) return existing;

    return registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid),
    });
  }, [permission]);

  return { permission, subscribe };
}
