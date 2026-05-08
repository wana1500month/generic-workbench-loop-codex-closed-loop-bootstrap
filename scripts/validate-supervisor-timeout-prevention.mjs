import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  extractRunDirectory,
  readSummary,
  repoRoot
} from "./validation-utils.mjs";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const readJsonFile = async (path) =>
  JSON.parse(await readFile(path, "utf8"));

const runSupervisor = async (args, env) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ["./scripts/loop-supervisor.mjs", ...args], {
      cwd: repoRoot,
      env
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({
        code: code ?? 1,
        stdout,
        stderr
      });
    });
  });

const main = async () => {
  const execution = await runSupervisor(
    [
      "--max-restarts",
      "2",
      "--restart-delay-ms",
      "50",
      "--adapter",
      "./.tmp/semantic-validation/patch-only-success/adapter.json",
      "--target-family",
      "api-service",
      "--max-rounds",
      "3"
    ],
    {
      ...process.env,
      HARNESS_DISABLE_CODEX_AGENTS: process.env.HARNESS_DISABLE_CODEX_AGENTS ?? "1",
      HARNESS_TEST_CRASH_AFTER_CHECKPOINT_ONCE: "1"
    }
  );

  if (execution.code !== 0) {
    throw new Error(
      `Supervisor validation run failed.\n${execution.stdout}\n${execution.stderr}`
    );
  }

  const runDirectory = extractRunDirectory(execution.stdout);
  const summary = await readSummary(runDirectory);
  assert(
    summary.stop_reason === "target_reached",
    `Expected supervisor run to reach target_reached, received '${summary.stop_reason ?? "missing"}'.`
  );
  assert(
    summary.round_count === 2,
    `Expected supervisor run to write 2 rounds, received '${summary.round_count}'.`
  );

  const supervisorState = await readJsonFile(
    join(runDirectory, "runtime", "supervisor-state.json")
  );
  assert(
    supervisorState.status === "completed",
    `Expected supervisor state 'completed', received '${supervisorState.status ?? "missing"}'.`
  );
  assert(
    supervisorState.restart_count >= 1,
    `Expected supervisor to restart at least once, received '${supervisorState.restart_count ?? "missing"}'.`
  );

  console.log(
    `Validated supervisor timeout prevention for ${runDirectory.replace(`${repoRoot}\\`, "")}.`
  );
};

main().catch((error) => {
  console.error("Supervisor timeout prevention validation failed.");
  console.error(error);
  process.exitCode = 1;
});
