import { spawn } from "node:child_process";
import { strict as assert } from "node:assert";

import { repoRoot } from "./validation-utils.mjs";

const foregroundThreadEnv = {
  ...process.env,
  CODEX_THREAD_ID: "thread_validate_canonical_worker",
  HARNESS_LAUNCH_ORIGIN: "codex-app-thread",
  HARNESS_THREAD_BINDING_STATE: "bound",
  HARNESS_SURFACE_OWNER: "stock-codex-thread",
  HARNESS_ENTRYPOINT: "skill",
  HARNESS_APP_VISIBILITY: "visible-in-stock-app"
};

const runPackageScript = async (scriptName, scriptArgs = [], env = process.env) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      "npm",
      ["run", scriptName, "--silent", ...(scriptArgs.length > 0 ? ["--", ...scriptArgs] : [])],
      {
        cwd: repoRoot,
        env,
        shell: process.platform === "win32",
        windowsHide: true
      }
    );

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

const assertSucceeded = (execution, label) => {
  if (execution.code !== 0) {
    throw new Error(`${label} failed.\nSTDOUT:\n${execution.stdout}\nSTDERR:\n${execution.stderr}`);
  }
};

console.log("[validate-canonical-foreground-worker] intent output prefers autocontinue over handoff");
const intentExecution = await runPackageScript("loop:intent", ["루프 시작"]);
assertSucceeded(intentExecution, "loop:intent");
assert.match(intentExecution.stdout, /^명령:\s+npm run loop:start:codex -- --json/m);
assert.match(intentExecution.stdout, /^연속 실행:\s+same-thread autocontinue/m);
assert.match(intentExecution.stdout, /^복구 스킬:\s+\$attached-loop/m);
assert.doesNotMatch(intentExecution.stdout, /^다음 스킬:\s+\$attached-loop/m);

console.log("[validate-canonical-foreground-worker] start JSON exposes canonical worker and recovery");
const startExecution = await runPackageScript("loop:start:codex", ["--json"], foregroundThreadEnv);
assertSucceeded(startExecution, "loop:start:codex --json");
const startReport = JSON.parse(startExecution.stdout);
assert.equal(startReport.stop_reason, "awaiting_codex_checkpoint");
assert.equal(startReport.active.worker_skill, "loop-control");
assert.equal(startReport.active.recovery_skill, "attached-loop");
assert.equal(startReport.operator_surface.worker_skill, "loop-control");
assert.equal(startReport.operator_surface.recovery_skill, "attached-loop");
assert.equal(startReport.operator_surface.recommended_skill, "loop-control");
assert.equal(startReport.operator_surface.resume_skill, "attached-loop");

console.log("[validate-canonical-foreground-worker] loop:continue contract stays on loop-control");
const continueExecution = await runPackageScript(
  "loop:continue",
  ["--run-dir", startReport.run_directory, "--json"],
  foregroundThreadEnv
);
assertSucceeded(continueExecution, "loop:continue --json");
const continueContract = JSON.parse(continueExecution.stdout);
assert.equal(continueContract.state, "codex_checkpoint");
assert.equal(continueContract.worker, "loop-control");
assert.equal(continueContract.recovery_skill, "attached-loop");
assert.equal(continueContract.user_visible_pause, false);
assert.equal(continueContract.recommended_skill, undefined);

console.log("[validate-canonical-foreground-worker] status output orders worker before recovery");
const statusExecution = await runPackageScript(
  "loop:status",
  ["--run-dir", startReport.run_directory],
  foregroundThreadEnv
);
assertSucceeded(statusExecution, "loop:status");
const workerIndex = statusExecution.stdout.indexOf("Worker: $loop-control");
const recoveryIndex = statusExecution.stdout.indexOf("Recovery: $attached-loop");
const fallbackIndex = statusExecution.stdout.indexOf("CLI fallback:");
assert(workerIndex >= 0, "Expected status output to include canonical worker.");
assert(recoveryIndex > workerIndex, "Expected recovery output after worker output.");
assert(fallbackIndex > recoveryIndex, "Expected CLI fallback after worker and recovery output.");
assert(statusExecution.stdout.indexOf("Resume skill: $attached-loop") === -1,
  "Foreground status should not foreground the legacy Resume skill label.");

console.log("canonical foreground worker validation passed.");
