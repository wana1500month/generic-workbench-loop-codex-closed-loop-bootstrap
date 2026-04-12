import { spawn } from "node:child_process";
import { strict as assert } from "node:assert";

import {
  driveCurrentThreadHandoffs,
  extractRunDirectory,
  readJsonFile,
  readSummary,
  repoRoot,
  runLoop
} from "./validation-utils.mjs";

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

const foregroundThreadEnv = {
  ...process.env,
  CODEX_THREAD_ID: "thread_validate_stop_boundaries",
  HARNESS_LAUNCH_ORIGIN: "codex-app-thread",
  HARNESS_THREAD_BINDING_STATE: "bound",
  HARNESS_SURFACE_OWNER: "stock-codex-thread",
  HARNESS_ENTRYPOINT: "skill",
  HARNESS_APP_VISIBILITY: "visible-in-stock-app"
};

const shellLikeEnv = {
  ...process.env,
  CODEX_THREAD_ID: "",
  HARNESS_LAUNCH_ORIGIN: "shell",
  HARNESS_THREAD_BINDING_STATE: "unbound",
  HARNESS_SURFACE_OWNER: "external-controller",
  HARNESS_ENTRYPOINT: "shell",
  HARNESS_APP_VISIBILITY: "not-visible-in-stock-app"
};

console.log("[validate-stop-boundaries] manual current-thread human boundary");
const manualSeed = await runPackageScript("loop:start:manual", ["--json"], shellLikeEnv);
if (manualSeed.code !== 0) {
  throw new Error(
    `Manual current-thread seed failed.\nSTDOUT:\n${manualSeed.stdout}\nSTDERR:\n${manualSeed.stderr}`
  );
}

const manualSeedReport = JSON.parse(manualSeed.stdout);
const manualRunDirectory = manualSeedReport.run_directory;
const manualSummary = await readSummary(manualRunDirectory);
assert.equal(
  manualSummary.stop_reason,
  "awaiting_human_input",
  "Manual current-thread seed should pause on a human boundary."
);
const manualSurface = await readJsonFile(manualSummary.operator_surface_path);
assert.equal(manualSurface.phase_status, "awaiting_human_input");
assert.equal(manualSurface.attention_required, "human");
assert.equal(manualSurface.recommended_skill, "loop-control");

console.log("[validate-stop-boundaries] current-thread external boundary");
const externalSeed = await runLoop(
  [
    "--single",
    "--controller-mode",
    "attached",
    "--transport",
    "current-thread",
    "--adapter",
    "./.tmp/semantic-validation/editor-blocked/adapter.json",
    "--evaluator-profile",
    "./.tmp/semantic-validation/verification-profile-editor-semantic.json",
    "--max-rounds",
    "3"
  ],
  {
    env: foregroundThreadEnv,
    silent: true
  }
);
if (externalSeed.code !== 0) {
  throw new Error(
    `Current-thread external seed failed.\nSTDOUT:\n${externalSeed.stdout}\nSTDERR:\n${externalSeed.stderr}`
  );
}

const externalRunDirectory = extractRunDirectory(externalSeed.stdout);
const externalSummary = await driveCurrentThreadHandoffs({
  runDirectory: externalRunDirectory,
  resumeArgs: [
    "--resume-run",
    externalRunDirectory,
    "--controller-mode",
    "attached",
    "--transport",
    "current-thread",
    "--adapter",
    "./.tmp/semantic-validation/editor-blocked/adapter.json",
    "--evaluator-profile",
    "./.tmp/semantic-validation/verification-profile-editor-semantic.json",
    "--max-rounds",
    "3"
  ],
  env: foregroundThreadEnv,
  silent: true,
  label: "current-thread external boundary run"
});
assert.equal(
  externalSummary.stop_reason,
  "awaiting_external_condition",
  "Blocked current-thread run should pause on an external boundary."
);
const externalSurface = await readJsonFile(externalSummary.operator_surface_path);
assert.equal(externalSurface.phase_status, "awaiting_external_condition");
assert.equal(externalSurface.attention_required, "external");
assert.equal(externalSurface.recommended_skill, "loop-control");
assert.equal(externalSurface.checkpoint_kind, "evaluator");

console.log("stop boundary validation passed.");
