import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const sourceBootstrapAllowed = () =>
  process.env.HARNESS_ALLOW_SOURCE_BOOTSTRAP === "1";

const npxBuildAllowed = () =>
  process.env.HARNESS_ALLOW_NPX_INSTALL === "1";

const hasLocalTypeScript = async (repoRoot) => {
  const candidates = [
    join(
      repoRoot,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "tsc.cmd" : "tsc"
    ),
    join(repoRoot, "node_modules", "typescript", "bin", "tsc")
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.F_OK);
      return true;
    } catch {
      // Try the next local compiler candidate.
    }
  }

  return false;
};

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
    // Fall back to the build path below.
  }

  return runCommand(repoRoot, "npm", ["run", "build", "--silent"]);
};

const buildOrBootstrap = async (repoRoot) => {
  if ((await hasLocalTypeScript(repoRoot)) || npxBuildAllowed()) {
    return runCommand(repoRoot, "npm", ["run", "build", "--silent"]);
  }

  if (sourceBootstrapAllowed()) {
    return runBootstrap(repoRoot);
  }

  return undefined;
};

const sourceArchiveMessage = (relativeModulePath) =>
  [
    `Missing ${relativeModulePath}.`,
    "This folder looks like a source archive, not the installable release ZIP.",
    "Install .tmp/release/generic-codex-workbench.zip for Codex app use.",
    "If you intentionally want local source bootstrap, run bash ./init.sh yourself or set HARNESS_ALLOW_SOURCE_BOOTSTRAP=1 before retrying."
  ].join(" ");

export const ensureDistModule = async (repoRoot, relativeModulePath) => {
  const distModulePath = resolve(repoRoot, relativeModulePath);
  try {
    await access(distModulePath, constants.F_OK);
    return { ok: true, distModulePath };
  } catch {
    const code = await buildOrBootstrap(repoRoot);
    if (code === undefined) {
      return {
        ok: false,
        distModulePath,
        message: sourceArchiveMessage(relativeModulePath)
      };
    }

    if (code !== 0) {
      return {
        ok: false,
        distModulePath,
        message:
          `Missing ${relativeModulePath} and build/bootstrap failed. Install .tmp/release/generic-codex-workbench.zip, or run bash ./init.sh once for an intentional source checkout, then retry.`
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
