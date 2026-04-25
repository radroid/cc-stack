import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-24 text-center">
      <div className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
          Create Club Stack
        </p>
        <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          A PWA-ready Next.js starter.
        </h1>
        <p className="mx-auto max-w-md text-pretty text-muted-foreground">
          Convex · Clerk · Tailwind · shadcn · PostHog · Web Push · Cloudflare. Edit{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">app/page.tsx</code> to
          start.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button asChild>
          <Link href="/sign-in">Sign in</Link>
        </Button>
        <Button variant="outline" asChild>
          <a href="https://github.com" target="_blank" rel="noreferrer">
            View on GitHub
          </a>
        </Button>
      </div>
    </main>
  );
}
