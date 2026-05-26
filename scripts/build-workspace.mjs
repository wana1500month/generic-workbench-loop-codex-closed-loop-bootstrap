import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  needsBuild,
  PINNED_TYPESCRIPT_VERSION,
  runCommand,
  runPinnedTypeScriptBuild
} from "./lib/front-door-build.mjs";

const resolveLocalTsc = () =>
  join(process.cwd(), "node_modules", "typescript", "bin", "tsc");

const resolveLocalTscJs = () =>
  join(process.cwd(), "node_modules", "typescript", "lib", "tsc.js");

const requiredOutputs = [
  "packages/loop-orchestrator/dist/index.js",
  "packages/loop-orchestrator/dist/file-system.js",
  "packages/loop-orchestrator/dist/codex-runtime.js"
];

const missingRequiredOutputs = () =>
  requiredOutputs.filter((relativePath) => !existsSync(join(process.cwd(), relativePath)));

const assertRequiredOutputs = () => {
  const missing = missingRequiredOutputs();
  if (missing.length === 0) {
    return 0;
  }
  for (const relativePath of missing) {
    console.error(`Build output missing: ${relativePath}`);
  }
  return 1;
};

const runLocalTypeScriptBuildFromSafeCwd = async (extraArgs = []) => {
  const safeCwd = process.env.TEMP ?? process.env.TMP ?? process.cwd();
  const localTypeScriptRoot = join(process.cwd(), "node_modules", "typescript");
  if (!existsSync(resolveLocalTscJs())) {
    return undefined;
  }
  const safeTypeScriptRoot = join(
    safeCwd,
    `generic-workbench-typescript-${PINNED_TYPESCRIPT_VERSION}`
  );
  const safeTscJs = join(safeTypeScriptRoot, "lib", "tsc.js");
  if (!existsSync(safeTscJs)) {
    rmSync(safeTypeScriptRoot, { recursive: true, force: true });
    cpSync(localTypeScriptRoot, safeTypeScriptRoot, { recursive: true });
  }
  return runCommand(safeCwd, process.execPath, [
    safeTscJs,
    "-b",
    process.cwd(),
    ...extraArgs,
    "--pretty",
    "false"
  ]);
};

const runPinnedTypeScriptBuildFromSafeCwd = async (extraArgs = []) => {
  const safeCwd = process.env.TEMP ?? process.env.TMP ?? process.cwd();
  return runCommand(
    safeCwd,
    "npx",
    [
      "-p",
      `typescript@${PINNED_TYPESCRIPT_VERSION}`,
      "tsc",
      "-b",
      process.cwd(),
      ...extraArgs,
      "--pretty",
      "false"
    ],
    { shell: process.platform === "win32" }
  );
};

const distEntryPath = join(process.cwd(), "packages", "loop-orchestrator", "dist");
const buildWatchPaths = [
  join(process.cwd(), "packages", "loop-orchestrator", "src"),
  join(process.cwd(), "packages", "loop-orchestrator", "tsconfig.json"),
  join(process.cwd(), "tsconfig.base.json")
];

const main = async () => {
  const localTsc = resolveLocalTsc();
  const forceBuild =
    process.env.HARNESS_FORCE_TYPESCRIPT_BUILD === "1" ||
    missingRequiredOutputs().length > 0;

  if (!forceBuild && !needsBuild(distEntryPath, buildWatchPaths)) {
    process.exitCode = assertRequiredOutputs();
    return;
  }

  if (existsSync(localTsc)) {
    const args = [
      localTsc,
      "-b",
      ...(forceBuild ? ["--force"] : []),
      "--pretty",
      "false"
    ];
    const exitCode = await runCommand(process.cwd(), process.execPath, args);
    if (exitCode === 0) {
      process.exitCode = assertRequiredOutputs();
      return;
    }
    const localFallbackExitCode = await runLocalTypeScriptBuildFromSafeCwd(
      forceBuild ? ["--force"] : []
    );
    if (localFallbackExitCode !== undefined) {
      process.exitCode =
        localFallbackExitCode === 0 ? assertRequiredOutputs() : localFallbackExitCode;
      return;
    }
    if (process.env.HARNESS_ALLOW_NPX_INSTALL === "1") {
      const fallbackExitCode = await runPinnedTypeScriptBuildFromSafeCwd(
        forceBuild ? ["--force"] : []
      );
      process.exitCode =
        fallbackExitCode === 0 ? assertRequiredOutputs() : fallbackExitCode;
      return;
    }
    console.error(
      "Local TypeScript build failed and no local TypeScript JS fallback was found. Set HARNESS_ALLOW_NPX_INSTALL=1 to allow npx fallback."
    );
    process.exitCode = exitCode;
    return;
  }

  if (process.env.HARNESS_ALLOW_NPX_INSTALL === "1") {
    const exitCode = await runPinnedTypeScriptBuild(process.cwd(), ["--force"]);
    process.exitCode = exitCode === 0 ? assertRequiredOutputs() : exitCode;
    return;
  }

  console.error(
    "TypeScript is not installed locally. Run `npm ci`, or set HARNESS_ALLOW_NPX_INSTALL=1 to allow npx fallback."
  );
  process.exitCode = 1;
};

await main();
