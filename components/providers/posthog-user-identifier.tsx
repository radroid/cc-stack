"use client";

import { useUser } from "@clerk/nextjs";
import posthog from "posthog-js";
import { useEffect } from "react";

/**
 * Identifies the signed-in Clerk user with PostHog. Safe to leave mounted —
 * PostHog is a no-op in dev (see `instrumentation-client.ts`), so this component
 * does nothing until production. Extend the `identify` props with Convex user
 * data once you have a `users` query in your app.
 */
export function PostHogUserIdentifier() {
  const { user, isLoaded } = useUser();

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) {
      posthog.reset();
      return;
    }
    posthog.identify(user.id, {
      email: user.primaryEmailAddress?.emailAddress,
      name: user.fullName ?? user.username,
      created_at: user.createdAt?.toISOString(),
    });
  }, [isLoaded, user]);

  return null;
}
