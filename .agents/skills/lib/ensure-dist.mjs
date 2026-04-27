import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const runCommand = async (repoRoot, command, args) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
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

const runBootstrap = async (repoRoot) => {
  const initPath = join(repoRoot, "init.sh");

  try {
    await access(initPath, constants.F_OK);
    const initCode = await runCommand(repoRoot, "bash", [initPath]);
    if (initCode === 0) {
      return 0;
    }
  } catch {
    // Fall back to the local build path below.
  }

  return runCommand(repoRoot, "npm", ["run", "build", "--silent"]);
};

export const ensureDistModule = async (repoRoot, relativeModulePath) => {
  const distModulePath = resolve(repoRoot, relativeModulePath);
  try {
    await access(distModulePath, constants.F_OK);
    return { ok: true, distModulePath };
  } catch {
    const code = await runBootstrap(repoRoot);
    if (code !== 0) {
      return {
        ok: false,
        distModulePath,
        message:
          `Missing ${relativeModulePath} and bootstrap failed. Run bash ./init.sh once, then retry.`
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
        `Bootstrap completed but ${relativeModulePath} is still missing. Run npm run build and inspect the TypeScript output.`
    };
  }
};
