import { existsSync } from "node:fs";
import { join } from "node:path";

import { runCommand, runPinnedTypeScriptBuild } from "./lib/front-door-build.mjs";

const main = async () => {
  const localTsc = join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsc.cmd" : "tsc"
  );

  if (existsSync(localTsc)) {
    process.exitCode = await runCommand(
      process.cwd(),
      localTsc,
      ["-b", "--pretty", "false"]
    );
    return;
  }

  const primaryExitCode = await runCommand(process.cwd(), "npx", [
    "--no-install",
    "tsc",
    "-b",
    "--pretty",
    "false"
  ], { shell: process.platform === "win32" });

  if (primaryExitCode === 0) {
    return;
  }

  if (process.env.HARNESS_ALLOW_NPX_INSTALL === "1") {
    process.exitCode = await runPinnedTypeScriptBuild(process.cwd(), ["--force"]);
    return;
  }

  console.error(
    "TypeScript is not installed. Run `npm ci`, or set HARNESS_ALLOW_NPX_INSTALL=1 to allow npx fallback."
  );
  process.exitCode = primaryExitCode;
};

await main();
