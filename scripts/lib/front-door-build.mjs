import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

export const PINNED_TYPESCRIPT_VERSION = "5.9.3";

export const runCommand = async (cwd, command, args, options = {}) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      shell: options.shell ?? false,
      windowsHide: true
    });

    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise(code ?? 1);
    });
  });

export const latestModifiedTimeMs = (targetPath) => {
  if (!existsSync(targetPath)) {
    return 0;
  }

  const stats = statSync(targetPath);
  if (!stats.isDirectory()) {
    return stats.mtimeMs;
  }

  return readdirSync(targetPath, { withFileTypes: true }).reduce((latest, entry) => {
    const entryPath = resolve(targetPath, entry.name);
    return Math.max(latest, latestModifiedTimeMs(entryPath));
  }, stats.mtimeMs);
};

export const needsBuild = (distEntryPath, watchPaths) => {
  if (!existsSync(distEntryPath)) {
    return true;
  }

  const distMtimeMs = latestModifiedTimeMs(distEntryPath);
  const latestWatchMtimeMs = watchPaths.reduce(
    (latest, targetPath) => Math.max(latest, latestModifiedTimeMs(targetPath)),
    0
  );
  return latestWatchMtimeMs > distMtimeMs;
};

export const runPinnedTypeScriptBuild = async (cwd, extraArgs = []) =>
  runCommand(
    cwd,
    "npx",
    [
      "-p",
      `typescript@${PINNED_TYPESCRIPT_VERSION}`,
      "tsc",
      "-b",
      ...extraArgs,
      "--pretty",
      "false"
    ],
    { shell: process.platform === "win32" }
  );
