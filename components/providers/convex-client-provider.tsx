"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import type { ReactNode } from "react";

// Tolerate a missing URL during build / prerender — Convex queries simply
// won't run until it's set. The dev workflow (`bunx convex dev`) writes this
// to .env.local automatically on first run.
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://placeholder.convex.cloud";

if (!process.env.NEXT_PUBLIC_CONVEX_URL && typeof window !== "undefined") {
  console.warn(
    "[convex] NEXT_PUBLIC_CONVEX_URL is not set — run `bunx convex dev` once to create it.",
  );
}

const convex = new ConvexReactClient(convexUrl);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
