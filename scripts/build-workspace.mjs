import { runCommand, runPinnedTypeScriptBuild } from "./lib/front-door-build.mjs";

const main = async () => {
  const primaryExitCode = await runCommand(
    process.cwd(),
    "npx",
    ["tsc", "-b", "--pretty", "false"],
    { shell: process.platform === "win32" }
  );

  if (primaryExitCode === 0) {
    return;
  }

  const fallbackExitCode = await runPinnedTypeScriptBuild(process.cwd(), ["--force"]);

  process.exitCode = fallbackExitCode;
};

await main();
