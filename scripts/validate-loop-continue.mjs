import { spawn } from "node:child_process";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { strict as assert } from "node:assert";

import {
  extractRunDirectory,
  repoRoot,
  runLoop
} from "./validation-utils.mjs";

const foregroundThreadEnv = {
  ...process.env,
  CODEX_THREAD_ID: "thread_validate_loop_continue",
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

const startForegroundRun = async (label) => {
  const execution = await runLoop(
    ["--single", "--controller-mode", "attached", "--transport", "current-thread", "--max-rounds", "3"],
    {
      env: foregroundThreadEnv,
      silent: true
    }
  );
  assertSucceeded(execution, label);
  return extractRunDirectory(execution.stdout);
};

const readContinueContract = async (runDirectory, extraArgs = []) => {
  const execution = await runPackageScript(
    "loop:continue",
    ["--run-dir", runDirectory, "--json", ...extraArgs],
    foregroundThreadEnv
  );
  assertSucceeded(execution, "loop:continue");
  return JSON.parse(execution.stdout);
};

console.log("[validate-loop-continue] start contract uses autocontinue checkpoint");
const happyRunDirectory = await startForegroundRun("happy-path seed");
const firstContract = await readContinueContract(happyRunDirectory);
assert.equal(firstContract.state, "codex_checkpoint");
assert.equal(firstContract.worker, "loop-control");
assert.equal(firstContract.recovery_skill, "attached-loop");
assert.equal(firstContract.user_visible_pause, false);
assert.equal(firstContract.ui_visibility, "internal_checkpoint");
assert.equal(firstContract.foreground_owner, "codex");
assert.equal(firstContract.checkpoint_kind, "planner");
assert.equal(firstContract.recommended_skill, undefined);
assert.equal(typeof firstContract.checkpoint_id, "string");
assert.equal(typeof firstContract.active_response_path, "string");

await writeFile(
  firstContract.active_response_path,
  `${JSON.stringify({ checkpoint_id: firstContract.checkpoint_id }, null, 2)}\n`,
  "utf8"
);
const secondContract = await readContinueContract(happyRunDirectory);
assert(secondContract.hop_index >= 1, "Autocontinue should consume at least one hop.");
assert.notEqual(
  secondContract.checkpoint_id,
  firstContract.checkpoint_id,
  "Autocontinue should move past the first checkpoint."
);
assert.notEqual(
  secondContract.checkpoint_kind,
  "planner",
  "Autocontinue should move beyond the planner checkpoint after a matching response."
);

console.log("[validate-loop-continue] stale checkpoint response is quarantined");
const staleRunDirectory = await startForegroundRun("stale-response seed");
const staleContract = await readContinueContract(staleRunDirectory);
await writeFile(
  staleContract.active_response_path,
  `${JSON.stringify({ checkpoint_id: `${staleContract.checkpoint_id}:stale` }, null, 2)}\n`,
  "utf8"
);
const staleResult = await readContinueContract(staleRunDirectory);
assert.equal(staleResult.state, "human_stop");
assert.equal(staleResult.guard_reason, "stale_checkpoint_response");
assert.equal(staleResult.ui_visibility, "user_boundary");
assert.equal(staleResult.foreground_owner, "human");
const staleDirectory = join(staleRunDirectory, "runtime", "stale-checkpoint-responses");
const staleEntries = await readdir(staleDirectory);
assert(
  staleEntries.some((entry) => entry.includes("planner-enhancement-response")),
  "Expected stale checkpoint response to be quarantined under runtime/stale-checkpoint-responses."
);

console.log("[validate-loop-continue] hop limit stops silent checkpoint chaining");
const hopRunDirectory = await startForegroundRun("hop-limit seed");
const hopContract = await readContinueContract(hopRunDirectory);
await writeFile(
  hopContract.active_response_path,
  `${JSON.stringify({ checkpoint_id: hopContract.checkpoint_id }, null, 2)}\n`,
  "utf8"
);
const hopLimitedContract = await readContinueContract(hopRunDirectory, ["--hop-limit", "0"]);
assert.equal(hopLimitedContract.state, "human_stop");
assert.equal(hopLimitedContract.guard_reason, "hop_limit_reached");
assert.equal(hopLimitedContract.ui_visibility, "user_boundary");
assert.equal(hopLimitedContract.foreground_owner, "human");

console.log("loop continue validation passed.");
