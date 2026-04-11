import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertRoundCount,
  assertStopReason,
  assertTextContains,
  extractRunDirectory,
  readJsonFile,
  readSummary,
  repoRoot,
  runLoop
} from "./validation-utils.mjs";

const cliPath = resolve(repoRoot, "scripts", "loop-runner.mjs");

const runCli = async (args, options = {}) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: repoRoot,
      env: options.env ?? process.env,
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

const assertSucceeded = (execution, label) => {
  if (execution.code !== 0) {
    throw new Error(`${label} failed.\nSTDOUT:\n${execution.stdout}\nSTDERR:\n${execution.stderr}`);
  }
};

const foregroundThreadEnv = {
  ...process.env,
  CODEX_THREAD_ID: "thread_validate_cli",
  HARNESS_LAUNCH_ORIGIN: "codex-app-thread",
  HARNESS_THREAD_BINDING_STATE: "bound",
  HARNESS_SURFACE_OWNER: "stock-codex-thread",
  HARNESS_ENTRYPOINT: "skill",
  HARNESS_APP_VISIBILITY: "visible-in-stock-app"
};

const help = await runCli(["--help"]);
assertSucceeded(help, "cli help");
assertTextContains(help.stdout, "status --run-dir <run-dir>", "cli help");
assertTextContains(help.stdout, "loop:phase -- <phase> --run-dir <run-dir>", "cli help");
assertTextContains(help.stdout, "loop:resume -- --run-dir <run-dir>", "cli help");
const helpWithoutPath = await runCli(["--help"], {
  env: {
    ...process.env,
    PATH: ""
  }
});
assertSucceeded(helpWithoutPath, "cli help without npm on PATH");

const seed = await runLoop(
  ["--controller-mode", "attached", "--transport", "current-thread", "--single"],
  {
    env: foregroundThreadEnv,
    silent: true
  }
);
assertSucceeded(seed, "current-thread seed run");
const runDirectory = extractRunDirectory(seed.stdout);
let summary = await readSummary(runDirectory);
assertStopReason(summary, "awaiting_current_thread_handoff");
assertRoundCount(summary, 0);

const planningStatus = await runCli(["status", "--run-dir", runDirectory, "--json"]);
assertSucceeded(planningStatus, "cli status planning");
const planningReport = JSON.parse(planningStatus.stdout);
if (planningReport.active.phase !== "planning") {
  throw new Error(
    `Expected planning status phase to be 'planning', received '${planningReport.active.phase ?? "missing"}'.`
  );
}
if (planningReport.runtime_health.execution_state !== "paused") {
  throw new Error(
    `Expected planning status execution_state 'paused', received '${planningReport.runtime_health.execution_state ?? "missing"}'.`
  );
}
if (planningReport.operator_surface?.resume_skill !== "attached-loop") {
  throw new Error(
    `Expected planning status resume_skill 'attached-loop', received '${planningReport.operator_surface?.resume_skill ?? "missing"}'.`
  );
}
if (planningReport.operator_surface?.resume_command !== undefined) {
  throw new Error("Expected foreground-thread planning status to omit resume_command.");
}
if (planningReport.operator_surface?.presentation_mode !== "foreground-thread") {
  throw new Error(
    `Expected current-thread foreground surface to resolve as 'foreground-thread', received '${planningReport.operator_surface?.presentation_mode ?? "missing"}'.`
  );
}
if (planningReport.operator_surface?.thread_binding_state === "unbound") {
  throw new Error(
    "Foreground-thread planning status should not report an unbound thread binding state."
  );
}
if (!planningReport.operator_surface?.next_action?.includes("$attached-loop")) {
  throw new Error(
    `Expected foreground-thread planning next_action to reference $attached-loop, received '${planningReport.operator_surface?.next_action ?? "missing"}'.`
  );
}
const planningStatusWithoutPath = await runCli(["status", "--run-dir", runDirectory, "--json"], {
  env: {
    ...process.env,
    PATH: ""
  }
});
assertSucceeded(planningStatusWithoutPath, "cli status without npm on PATH");
await writeFile(planningReport.active.active_response_path, "{}\n", "utf8");

const planningPhase = await runCli(["phase", "open", "--run-dir", runDirectory]);
assertSucceeded(planningPhase, "cli phase planning");
summary = await readSummary(runDirectory);
assertStopReason(summary, "awaiting_current_thread_handoff");

const negotiationStatus = await runCli(["status", "--run-dir", runDirectory, "--json"]);
assertSucceeded(negotiationStatus, "cli status negotiation");
const negotiationReport = JSON.parse(negotiationStatus.stdout);
if (negotiationReport.active.phase !== "negotiation") {
  throw new Error(
    `Expected negotiation status phase to be 'negotiation', received '${negotiationReport.active.phase ?? "missing"}'.`
  );
}
if (negotiationReport.active.round !== 1) {
  throw new Error(
    `Expected negotiation status round to be '1', received '${negotiationReport.active.round ?? "missing"}'.`
  );
}
await writeFile(negotiationReport.active.active_response_path, "{}\n", "utf8");

const secondNegotiationPhase = await runCli([
  "phase",
  "negotiate",
  "--run-dir",
  runDirectory
]);
assertSucceeded(secondNegotiationPhase, "cli phase negotiation");
summary = await readSummary(runDirectory);
assertStopReason(summary, "awaiting_current_thread_handoff");

const generatorPlanStatus = await runCli([
  "status",
  "--run-dir",
  runDirectory,
  "--json"
]);
assertSucceeded(generatorPlanStatus, "cli status generator plan");
const generatorPlanReport = JSON.parse(generatorPlanStatus.stdout);
if (generatorPlanReport.active.phase !== "negotiation") {
  throw new Error(
    `Expected generator-plan handoff phase 'negotiation', received '${generatorPlanReport.active.phase ?? "missing"}'.`
  );
}
await writeFile(generatorPlanReport.active.active_response_path, "{}\n", "utf8");

const attachedGeneratorResume = await runCli(["resume", "--run-dir", runDirectory]);
assertSucceeded(attachedGeneratorResume, "cli resume to attached generator");
summary = await readSummary(runDirectory);
assertStopReason(summary, "awaiting_current_thread_handoff");

const postNegotiationStatus = await runCli([
  "status",
  "--run-dir",
  runDirectory,
  "--json"
]);
assertSucceeded(postNegotiationStatus, "cli status post negotiation");
const postNegotiationReport = JSON.parse(postNegotiationStatus.stdout);

let evaluationReport = postNegotiationReport;
if (postNegotiationReport.active.phase === "pre_verification") {
  await writeFile(postNegotiationReport.active.active_response_path, "{}\n", "utf8");

  const evaluationResume = await runCli(["resume", "--run-dir", runDirectory]);
  assertSucceeded(evaluationResume, "cli resume to evaluation");
  summary = await readSummary(runDirectory);
  assertStopReason(summary, "awaiting_current_thread_handoff");

  const evaluationStatus = await runCli([
    "status",
    "--run-dir",
    runDirectory,
    "--json"
  ]);
  assertSucceeded(evaluationStatus, "cli status evaluation");
  evaluationReport = JSON.parse(evaluationStatus.stdout);
} else if (postNegotiationReport.active.phase !== "evaluation") {
  throw new Error(
    `Expected post-negotiation handoff phase 'pre_verification' or 'evaluation', received '${postNegotiationReport.active.phase ?? "missing"}'.`
  );
}

if (evaluationReport.active.phase !== "evaluation") {
  throw new Error(
    `Expected post-resume phase 'evaluation', received '${evaluationReport.active.phase ?? "missing"}'.`
  );
}
if (typeof evaluationReport.active.active_prompt_path !== "string") {
  throw new Error("Expected evaluation handoff to expose active_prompt_path.");
}
if (evaluationReport.operator_surface?.handoff_state === "headless") {
  throw new Error("Expected current-thread evaluation handoff to avoid headless handoff_state.");
}
if (!(await readJsonFile(summary.operator_surface_path)).active_prompt_path) {
  throw new Error("Expected operator_surface.json to retain active_prompt_path.");
}

console.log("cli front door validation passed.");
