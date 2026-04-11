import { spawn } from "node:child_process";

export const stopProcessTree = async (pid: number): Promise<void> => {
  if (typeof pid !== "number" || pid <= 0) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise((resolvePromise) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        shell: false,
        windowsHide: true,
        stdio: "ignore"
      });
      killer.on("close", () => resolvePromise(undefined));
      killer.on("error", () => resolvePromise(undefined));
    });
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Ignore missing processes during best-effort cleanup.
    }
  }
};
