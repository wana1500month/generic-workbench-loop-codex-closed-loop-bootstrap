import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ensureBuild,
  importDist,
  repoRoot,
  runCommand
} from "./testing/bootstrap-validator-helpers.mjs";

const resultPath = join(repoRoot, ".tmp", "codex-real-smoke", "binary-preflight-result.json");

const writeResult = async (result) => {
  await mkdir(join(repoRoot, ".tmp", "codex-real-smoke"), { recursive: true });
  await writeFile(
    resultPath,
    JSON.stringify(
      {
        validated_at: new Date().toISOString(),
        ...result
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
};

const launchText = (launch) =>
  [launch.command, ...(launch.args ?? [])]
    .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(" ");

const main = async () => {
  if (process.env.HARNESS_DISABLE_CODEX_AGENTS === "1") {
    throw new Error(
      "Codex binary preflight failed: HARNESS_DISABLE_CODEX_AGENTS=1 prevents real Codex execution."
    );
  }

  await ensureBuild();

  const { resolveCodexCliLaunch } = await importDist("codex-cli.js");
  const codexLaunch = resolveCodexCliLaunch();
  const version = await runCommand(
    codexLaunch.command,
    [...codexLaunch.args, "--version"],
    { shell: false }
  ).catch((error) => ({
    code: 1,
    stdout: "",
    stderr: error instanceof Error ? error.message : String(error)
  }));

  if (version.code !== 0) {
    const reason = [
      "codex binary not found or not executable.",
      "Install Codex CLI or set HARNESS_CODEX_BIN to the executable path.",
      "If extra launch arguments are required, set HARNESS_CODEX_BIN_ARGS to a JSON string array.",
      `Resolved launch: ${launchText(codexLaunch)}`
    ].join(" ");
    await writeResult({
      status: "environment_blocked",
      reason,
      resolved_launch: {
        command: codexLaunch.command,
        args: codexLaunch.args
      },
      stderr: version.stderr.trim(),
      stdout: version.stdout.trim()
    });
    throw new Error(`Codex binary preflight failed: ${reason}`);
  }

  const codexVersion = version.stdout.trim() || version.stderr.trim();
  await writeResult({
    status: "passed",
    codex_version: codexVersion,
    resolved_launch: {
      command: codexLaunch.command,
      args: codexLaunch.args
    }
  });
  console.log(`Codex binary preflight passed: ${codexVersion}`);
};

main().catch(async (error) => {
  console.error("Codex binary preflight failed.");
  console.error(error);
  process.exitCode = 1;
});
