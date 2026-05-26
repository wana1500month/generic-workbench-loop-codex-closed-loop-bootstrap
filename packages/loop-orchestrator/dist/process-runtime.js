import { spawn } from "node:child_process";
const processTreeKillGraceMs = () => {
    const parsed = Number(process.env.HARNESS_PROCESS_TREE_KILL_GRACE_MS);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 1000;
};
const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const signalProcessTree = (pid, signal) => {
    try {
        process.kill(-pid, signal);
        return true;
    }
    catch {
        try {
            process.kill(pid, signal);
            return true;
        }
        catch {
            return false;
        }
    }
};
export const stopProcessTree = async (pid) => {
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
    signalProcessTree(pid, "SIGTERM");
    await delay(processTreeKillGraceMs());
    signalProcessTree(pid, "SIGKILL");
};
//# sourceMappingURL=process-runtime.js.map