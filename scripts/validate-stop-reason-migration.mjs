import { spawn } from "node:child_process";
import { strict as assert } from "node:assert";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { restoreRunState } from "../packages/loop-orchestrator/dist/resume-state.js";
import {
  extractRunDirectory,
  repoRoot,
  readSummary,
  runLoop
} from "./validation-utils.mjs";

const foregroundThreadEnv = {
  ...process.env,
  CODEX_THREAD_ID: "thread_validate_stop_reason_migration",
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

console.log("[validate-stop-reason-migration] fresh current-thread writes the canonical stop reason");
const seedExecution = await runLoop(
  ["--single", "--controller-mode", "attached", "--transport", "current-thread"],
  {
    env: foregroundThreadEnv,
    silent: true
  }
);
assertSucceeded(seedExecution, "current-thread seed");
const runDirectory = extractRunDirectory(seedExecution.stdout);
const summaryPath = join(runDirectory, "summary.json");
const seededSummary = await readSummary(runDirectory);
assert.equal(seededSummary.stop_reason, "awaiting_codex_checkpoint");

console.log("[validate-stop-reason-migration] restore normalizes the deprecated alias on read");
await writeFile(
  summaryPath,
  JSON.stringify(
    {
      ...seededSummary,
      stop_reason: "awaiting_current_thread_handoff"
    },
    null,
    2
  ),
  "utf8"
);
const restoredRun = await restoreRunState(runDirectory);
assert.equal(restoredRun.summary.stop_reason, "awaiting_codex_checkpoint");

console.log("[validate-stop-reason-migration] status surfaces the canonical stop reason");
const statusExecution = await runPackageScript(
  "loop:status",
  ["--run-dir", runDirectory, "--json"],
  foregroundThreadEnv
);
assertSucceeded(statusExecution, "loop:status --json");
const statusReport = JSON.parse(statusExecution.stdout);
assert.equal(statusReport.stop_reason, "awaiting_codex_checkpoint");

console.log("[validate-stop-reason-migration] resume rewrites deprecated aliases back to the canonical reason");
const planningResponsePath = statusReport.active.active_response_path;
assert.equal(typeof planningResponsePath, "string");
await writeFile(
  planningResponsePath,
  `${JSON.stringify({ checkpoint_id: statusReport.active.checkpoint_id }, null, 2)}\n`,
  "utf8"
);
const resumeExecution = await runPackageScript(
  "loop:resume",
  ["--run-dir", runDirectory, "--json"],
  foregroundThreadEnv
);
assertSucceeded(resumeExecution, "loop:resume --json");
const resumedReport = JSON.parse(resumeExecution.stdout);
assert.equal(resumedReport.stop_reason, "awaiting_codex_checkpoint");

const rewrittenSummary = JSON.parse(await readFile(summaryPath, "utf8"));
assert.equal(rewrittenSummary.stop_reason, "awaiting_codex_checkpoint");

console.log("stop reason migration validation passed.");
