import { existsSync } from "node:fs";
import { join } from "node:path";

import { runCommand, runPinnedTypeScriptBuild } from "./lib/front-door-build.mjs";

const resolveLocalTsc = () =>
  join(process.cwd(), "node_modules", "typescript", "bin", "tsc");

const main = async () => {
  const localTsc = resolveLocalTsc();

  if (existsSync(localTsc)) {
    process.exitCode = await runCommand(process.cwd(), process.execPath, [
      localTsc,
      "-b",
      "--pretty",
      "false"
    ]);
    return;
  }

  if (process.env.HARNESS_ALLOW_NPX_INSTALL === "1") {
    process.exitCode = await runPinnedTypeScriptBuild(process.cwd(), ["--force"]);
    return;
  }

  console.error(
    "TypeScript is not installed locally. Run `npm ci`, or set HARNESS_ALLOW_NPX_INSTALL=1 to allow npx fallback."
  );
  process.exitCode = 1;
};

await main();
