import { existsSync } from "node:fs";
import { join } from "node:path";

import { runCommand, runPinnedTypeScriptBuild } from "./lib/front-door-build.mjs";

const resolveLocalTsc = () =>
  join(process.cwd(), "node_modules", "typescript", "bin", "tsc");

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

const main = async () => {
  const localTsc = resolveLocalTsc();
  const forceBuild =
    process.env.HARNESS_FORCE_TYPESCRIPT_BUILD === "1" ||
    missingRequiredOutputs().length > 0;

  if (existsSync(localTsc)) {
    const args = [
      localTsc,
      "-b",
      ...(forceBuild ? ["--force"] : []),
      "--pretty",
      "false"
    ];
    const exitCode = await runCommand(process.cwd(), process.execPath, args);
    process.exitCode = exitCode === 0 ? assertRequiredOutputs() : exitCode;
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
