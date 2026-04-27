import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const runBuild = async (repoRoot) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("npm", ["run", "build", "--silent"], {
      cwd: repoRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
      windowsHide: true
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise(code ?? 1);
    });
  });

export const ensureDistModule = async (repoRoot, relativeModulePath) => {
  const distModulePath = resolve(repoRoot, relativeModulePath);
  try {
    await access(distModulePath, constants.F_OK);
    return { ok: true, distModulePath };
  } catch {
    const code = await runBuild(repoRoot);
    if (code !== 0) {
      return {
        ok: false,
        distModulePath,
        message:
          `Missing ${relativeModulePath} and automatic build failed. Run ./init.sh or npm ci && npm run build, then retry.`
      };
    }
  }

  try {
    await access(distModulePath, constants.F_OK);
    return { ok: true, distModulePath };
  } catch {
    return {
      ok: false,
      distModulePath,
      message:
        `Build completed but ${relativeModulePath} is still missing. Run npm run build and inspect the TypeScript output.`
    };
  }
};
