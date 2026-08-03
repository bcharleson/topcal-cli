import { spawn } from "node:child_process";
import { platform } from "node:os";

/** Best-effort open URL in the default browser. Returns false if spawn failed. */
export function openUrl(url: string): boolean {
  try {
    const os = platform();
    if (os === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
      return true;
    }
    if (os === "win32") {
      spawn("cmd", ["/c", "start", "", url], {
        detached: true,
        stdio: "ignore",
      }).unref();
      return true;
    }
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}
