// Cross-platform "open URL in browser" with no external deps.
import { spawn } from "node:child_process";
import pc from "picocolors";
import { exitOnCancel, p } from "./prompts";

export function openUrl(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    // ignore — we'll print the URL anyway
  }
}

/**
 * Show a URL inline (so it's clickable in modern terminals + the chat
 * transcript), prompt the user to open it, and launch the browser if they
 * say yes. The URL is always visible in the prompt regardless of yes/no, so
 * the user can copy it manually if they prefer.
 */
export async function confirmOpen(url: string, label = "Open"): Promise<boolean> {
  const proceed = await exitOnCancel(
    await p.confirm({
      message: `${label} ${pc.cyan(pc.underline(url))} ?`,
      initialValue: true,
    }),
  );
  if (proceed) openUrl(url);
  return proceed;
}
