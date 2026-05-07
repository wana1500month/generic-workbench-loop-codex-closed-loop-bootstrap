import { spawn } from "node:child_process";

const killGraceMs = () => {
  const parsed = Number(process.env.HARNESS_PROCESS_TREE_KILL_GRACE_MS);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 1000;
};

const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

const signalProcessTree = (pid, signal) => {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
};

export const stopProcessTree = async (pid) => {
  if (typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) {
    return false;
  }

  if (process.platform === "win32") {
    return new Promise((resolvePromise) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        shell: false,
        windowsHide: true,
        stdio: "ignore"
      });
      killer.on("close", (code) => resolvePromise(code === 0));
      killer.on("error", () => resolvePromise(false));
    });
  }

  const terminated = signalProcessTree(pid, "SIGTERM");
  await delay(killGraceMs());
  const killed = signalProcessTree(pid, "SIGKILL");
  return terminated || killed;
};
