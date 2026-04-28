// Cross-platform "open URL in browser" with no external deps.
import { spawn } from "node:child_process";
import pc from "picocolors";
import { exitOnCancel, p } from "./prompts";

export function openUrl(url: string): void {
  // `start` is a cmd.exe builtin — calling it via plain spawn fails on
  // Windows. Route through cmd.exe with the empty title arg start expects.
  const isWin = process.platform === "win32";
  const cmd = isWin ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = isWin ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    // spawn errors (command-not-found, EACCES, …) come through async.
    child.on("error", () => {
      // ignore — the URL is already printed by confirmOpen for the user.
    });
    child.unref();
  } catch {
    // ignore — synchronous spawn errors are rare; URL is shown either way.
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
