// Cross-platform "open URL in browser" with no external deps.
import { spawn } from "node:child_process";

export function openUrl(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    // ignore — we'll print the URL anyway
  }
}
