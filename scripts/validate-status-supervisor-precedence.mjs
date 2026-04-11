import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

import {
  extractRunDirectory,
  readSummary,
  repoRoot,
  runLoop
} from "./validation-utils.mjs";

const runCli = async (args, options = {}) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ["./scripts/loop-runner.mjs", ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...(options.env ?? {})
      },
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
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

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const assertSucceeded = (execution, label) => {
  if (execution.code !== 0) {
    throw new Error(`${label} failed.\nSTDOUT:\n${execution.stdout}\nSTDERR:\n${execution.stderr}`);
  }
};

const foregroundThreadEnv = {
  ...process.env,
  CODEX_THREAD_ID: "thread_validate_supervisor_precedence",
  HARNESS_LAUNCH_ORIGIN: "codex-app-thread",
  HARNESS_THREAD_BINDING_STATE: "bound",
  HARNESS_SURFACE_OWNER: "stock-codex-thread",
  HARNESS_ENTRYPOINT: "skill",
  HARNESS_APP_VISIBILITY: "visible-in-stock-app"
};

const main = async () => {
  const seed = await runLoop(
    ["--controller-mode", "attached", "--transport", "current-thread", "--single"],
    {
      env: foregroundThreadEnv,
      silent: true
    }
  );
  assertSucceeded(seed, "status precedence seed");

  const runDirectory = extractRunDirectory(seed.stdout);
  const summary = await readSummary(runDirectory);
  const summaryPath = join(runDirectory, "summary.json");

  const liveStatePath = join(runDirectory, "runtime", "live-state.json");
  const supervisorStatePath = join(runDirectory, "runtime", "supervisor-state.json");

  const { stop_reason: _ignoredStopReason, ...summaryWithoutStopReason } = summary;
  await writeFile(summaryPath, `${JSON.stringify(summaryWithoutStopReason, null, 2)}\n`, "utf8");

  const liveState = await readJson(liveStatePath);
  await writeFile(
    liveStatePath,
    `${JSON.stringify(
      {
        ...liveState,
        execution_state: "running",
        last_progress_note: "Simulated stale running state for supervisor precedence validation."
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await writeFile(
    supervisorStatePath,
    `${JSON.stringify(
      {
        run_id: summary.run_id,
        status: "failed",
        restart_count: 3,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        stopped_at: new Date().toISOString(),
        last_error: "Simulated supervisor failure for status precedence validation."
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const status = await runCli(["status", "--run-dir", runDirectory, "--json"]);
  assertSucceeded(status, "status precedence report");
  const report = JSON.parse(status.stdout);

  if (report.runtime_health.execution_state === "failed") {
    throw new Error(
      `Expected runtime health to stay non-terminal so supervisor precedence is observable, received '${report.runtime_health.execution_state ?? "missing"}'.`
    );
  }
  if (report.supervisor_state?.status !== "failed") {
    throw new Error(
      `Expected persisted supervisor state 'failed', received '${report.supervisor_state?.status ?? "missing"}'.`
    );
  }
  if (report.status_source !== "supervisor_state") {
    throw new Error(
      `Expected status_source 'supervisor_state', received '${report.status_source ?? "missing"}'.`
    );
  }
  if (report.effective_execution_state !== "failed") {
    throw new Error(
      `Expected effective_execution_state 'failed', received '${report.effective_execution_state ?? "missing"}'.`
    );
  }

  console.log(`validate:status-supervisor-precedence passed (${runDirectory})`);
};

main().catch((error) => {
  console.error("Status supervisor precedence validation failed.");
  console.error(error);
  process.exitCode = 1;
});
