// Cross-platform clipboard read. Returns "" if the platform has no clipboard
// utility installed (caller should fall back to manual entry rather than fail).
import { run } from "./exec";

export async function readClipboard(): Promise<string> {
  const platform = process.platform;
  if (platform === "darwin") {
    return tryRun("pbpaste", []);
  }
  if (platform === "win32") {
    return tryRun("powershell.exe", ["-NoProfile", "-Command", "Get-Clipboard"]);
  }
  // Linux: prefer Wayland, fall back to X11.
  const wl = await tryRun("wl-paste", ["--no-newline"]);
  if (wl) return wl;
  return tryRun("xclip", ["-selection", "clipboard", "-o"]);
}

async function tryRun(cmd: string, args: string[]): Promise<string> {
  try {
    const result = await run(cmd, args);
    return result.exitCode === 0 ? result.stdout : "";
  } catch {
    return "";
  }
}
