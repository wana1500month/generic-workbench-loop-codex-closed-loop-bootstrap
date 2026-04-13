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

const runNodeScript = async (scriptPath, args, options = {}) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
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

const runCli = async (args, options = {}) => runNodeScript(cliPath, args, options);

const runPackageScript = async (scriptName, options = {}) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      "npm",
      [
        "run",
        scriptName,
        "--silent",
        ...(options.scriptArgs?.length ? ["--", ...options.scriptArgs] : [])
      ],
      {
        cwd: repoRoot,
        env: options.env ?? process.env,
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

const checkpointResponseText = (report) =>
  `${JSON.stringify(
    report.active?.checkpoint_id ? { checkpoint_id: report.active.checkpoint_id } : {},
    null,
    2
  )}\n`;

const foregroundThreadEnv = {
  ...process.env,
  CODEX_THREAD_ID: "thread_validate_cli",
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
const assumedForegroundEnv = {
  ...process.env,
  CODEX_THREAD_ID: "",
  HARNESS_LAUNCH_ORIGIN: "codex-app-thread",
  HARNESS_THREAD_BINDING_STATE: "bound",
  HARNESS_SURFACE_OWNER: "stock-codex-thread",
  HARNESS_ENTRYPOINT: "skill",
  HARNESS_APP_VISIBILITY: "visible-in-stock-app"
};
const otherForegroundThreadEnv = {
  ...foregroundThreadEnv,
  CODEX_THREAD_ID: "thread_validate_other"
};

const help = await runCli(["--help"]);
assertSucceeded(help, "cli help");
assertTextContains(help.stdout, "status --run-dir <run-dir>", "cli help");
assertTextContains(help.stdout, "loop:phase -- <phase> --run-dir <run-dir>", "cli help");
assertTextContains(help.stdout, "loop:resume -- --run-dir <run-dir>", "cli help");
assertTextContains(help.stdout, "loop:start:codex", "cli help");
assertTextContains(help.stdout, "loop:start:bg", "cli help");
assertTextContains(help.stdout, "loop:start:manual", "cli help");
assertTextContains(help.stdout, "loop:stop -- --run-dir <run-dir>", "cli help");
assertTextContains(help.stdout, "--allow-shell-resume-downgrade", "cli help");
const helpWithoutPath = await runCli(["--help"], {
  env: {
    ...process.env,
    PATH: ""
  }
});
assertSucceeded(helpWithoutPath, "cli help without npm on PATH");

const explicitHeadlessSingle = await runPackageScript("loop:single");
assertSucceeded(explicitHeadlessSingle, "loop:single detached front door");
const explicitHeadlessRunDirectory = extractRunDirectory(explicitHeadlessSingle.stdout);
const explicitHeadlessSummary = await readSummary(explicitHeadlessRunDirectory);
if (explicitHeadlessSummary.controller_mode !== "detached") {
  throw new Error(
    `Expected loop:single controller_mode 'detached', received '${explicitHeadlessSummary.controller_mode ?? "missing"}'.`
  );
}
if (explicitHeadlessSummary.transport_mode !== "codex-exec") {
  throw new Error(
    `Expected loop:single transport_mode 'codex-exec', received '${explicitHeadlessSummary.transport_mode ?? "missing"}'.`
  );
}

const blockedCodexScriptSeed = await runPackageScript("loop:start:codex", {
  env: shellLikeEnv
});
if (blockedCodexScriptSeed.code === 0) {
  throw new Error("Expected loop:start:codex to fail from a shell-like environment.");
}
assertTextContains(
  `${blockedCodexScriptSeed.stdout}\n${blockedCodexScriptSeed.stderr}`,
  "--allow-manual-protocol-seed",
  "blocked loop:start:codex"
);
const codexScriptSeed = await runPackageScript("loop:start:codex", {
  env: foregroundThreadEnv
});
assertSucceeded(codexScriptSeed, "loop:start:codex foreground front door");
const codexScriptRunDirectory = extractRunDirectory(codexScriptSeed.stdout);
const codexScriptSummary = await readSummary(codexScriptRunDirectory);
if (codexScriptSummary.controller_mode !== "attached") {
  throw new Error(
    `Expected loop:start:codex controller_mode 'attached', received '${codexScriptSummary.controller_mode ?? "missing"}'.`
  );
}
if (codexScriptSummary.transport_mode !== "current-thread") {
  throw new Error(
    `Expected loop:start:codex transport_mode 'current-thread', received '${codexScriptSummary.transport_mode ?? "missing"}'.`
  );
}
const codexScriptSeedJson = await runPackageScript("loop:start:codex", {
  env: foregroundThreadEnv,
  scriptArgs: ["--json"]
});
assertSucceeded(codexScriptSeedJson, "loop:start:codex foreground JSON front door");
const codexScriptSeedReport = JSON.parse(codexScriptSeedJson.stdout);
if (codexScriptSeedReport.active.attention_required !== "codex") {
  throw new Error(
    `Expected loop:start:codex --json attention_required 'codex', received '${codexScriptSeedReport.active.attention_required ?? "missing"}'.`
  );
}
if (codexScriptSeedReport.active.recommended_skill !== "loop-control") {
  throw new Error(
    `Expected loop:start:codex --json recommended_skill 'loop-control', received '${codexScriptSeedReport.active.recommended_skill ?? "missing"}'.`
  );
}
if (codexScriptSeedReport.effective_execution_state !== "paused") {
  throw new Error(
    `Expected loop:start:codex --json effective_execution_state 'paused', received '${codexScriptSeedReport.effective_execution_state ?? "missing"}'.`
  );
}

const blockedShellSeed = await runCli(
  ["--controller-mode", "attached", "--transport", "current-thread", "--single"],
  {
    env: shellLikeEnv
  }
);
if (blockedShellSeed.code === 0) {
  throw new Error("Expected shell current-thread seed to fail without explicit manual flag.");
}
assertTextContains(
  `${blockedShellSeed.stdout}\n${blockedShellSeed.stderr}`,
  "--allow-manual-protocol-seed",
  "blocked shell seed"
);
assertTextContains(
  `${blockedShellSeed.stdout}\n${blockedShellSeed.stderr}`,
  "$loop-control",
  "blocked shell seed"
);
assertTextContains(
  `${blockedShellSeed.stdout}\n${blockedShellSeed.stderr}`,
  "bound Codex thread id",
  "blocked shell seed"
);

const blockedAssumedSeed = await runCli(
  ["--controller-mode", "attached", "--transport", "current-thread", "--single"],
  {
    env: assumedForegroundEnv
  }
);
if (blockedAssumedSeed.code === 0) {
  throw new Error("Expected assumed foreground seed without CODEX_THREAD_ID to fail.");
}
assertTextContains(
  `${blockedAssumedSeed.stdout}\n${blockedAssumedSeed.stderr}`,
  "bound Codex thread id",
  "blocked assumed seed"
);

const manualSeed = await runPackageScript("loop:start:manual", {
  env: shellLikeEnv
});
assertSucceeded(manualSeed, "manual-protocol shell seed");
const manualSeedRunDirectory = extractRunDirectory(manualSeed.stdout);
const manualSeedSummary = await readSummary(manualSeedRunDirectory);
assertStopReason(manualSeedSummary, "awaiting_human_input");
const manualSeedSurface = await readJsonFile(manualSeedSummary.operator_surface_path);
if (manualSeedSurface.presentation_mode !== "manual-protocol") {
  throw new Error(
    `Expected manual shell seed surface 'manual-protocol', received '${manualSeedSurface.presentation_mode ?? "missing"}'.`
  );
}
if (manualSeedSurface.launch_origin !== "shell") {
  throw new Error(
    `Expected manual shell seed launch_origin 'shell', received '${manualSeedSurface.launch_origin ?? "missing"}'.`
  );
}
if (manualSeedSurface.app_visibility !== "not-visible-in-stock-app") {
  throw new Error(
    `Expected manual shell seed app_visibility 'not-visible-in-stock-app', received '${manualSeedSurface.app_visibility ?? "missing"}'.`
  );
}
if (manualSeedSurface.attention_required !== "human") {
  throw new Error(
    `Expected manual shell seed attention_required 'human', received '${manualSeedSurface.attention_required ?? "missing"}'.`
  );
}
if (manualSeedSurface.recommended_skill !== "loop-control") {
  throw new Error(
    `Expected manual shell seed recommended_skill 'loop-control', received '${manualSeedSurface.recommended_skill ?? "missing"}'.`
  );
}

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
if (planningReport.active.phase_status !== "awaiting_codex_work") {
  throw new Error(
    `Expected planning status phase_status 'awaiting_codex_work', received '${planningReport.active.phase_status ?? "missing"}'.`
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
if (planningReport.operator_surface?.attention_required !== "codex") {
  throw new Error(
    `Expected planning status attention_required 'codex', received '${planningReport.operator_surface?.attention_required ?? "missing"}'.`
  );
}
if (planningReport.operator_surface?.checkpoint_kind !== "planner") {
  throw new Error(
    `Expected planning status checkpoint_kind 'planner', received '${planningReport.operator_surface?.checkpoint_kind ?? "missing"}'.`
  );
}
if (planningReport.operator_surface?.auto_resume_eligible !== true) {
  throw new Error("Expected planning status auto_resume_eligible to be true.");
}
if (planningReport.active.recommended_skill !== "loop-control") {
  throw new Error(
    `Expected planning status recommended_skill 'loop-control', received '${planningReport.active.recommended_skill ?? "missing"}'.`
  );
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
if (!planningReport.operator_surface?.next_action?.includes("$loop-control")) {
  throw new Error(
    `Expected foreground-thread planning next_action to reference $loop-control, received '${planningReport.operator_surface?.next_action ?? "missing"}'.`
  );
}
const planningStatusWithoutPath = await runCli(["status", "--run-dir", runDirectory, "--json"], {
  env: {
    ...process.env,
    PATH: ""
  }
});
assertSucceeded(planningStatusWithoutPath, "cli status without npm on PATH");
const blockedShellPlanningPhase = await runCli(["phase", "open", "--run-dir", runDirectory], {
  env: shellLikeEnv
});
if (blockedShellPlanningPhase.code === 0) {
  throw new Error("Expected shell phase entry to fail for an app-visible current-thread run.");
}
assertTextContains(
  `${blockedShellPlanningPhase.stdout}\n${blockedShellPlanningPhase.stderr}`,
  "$attached-loop",
  "blocked shell phase"
);
assertTextContains(
  `${blockedShellPlanningPhase.stdout}\n${blockedShellPlanningPhase.stderr}`,
  "--allow-shell-resume-downgrade",
  "blocked shell phase"
);
const blockedOtherThreadPlanningPhase = await runCli(["phase", "open", "--run-dir", runDirectory], {
  env: otherForegroundThreadEnv
});
if (blockedOtherThreadPlanningPhase.code === 0) {
  throw new Error("Expected different Codex thread continuation to fail for an app-visible run.");
}
assertTextContains(
  `${blockedOtherThreadPlanningPhase.stdout}\n${blockedOtherThreadPlanningPhase.stderr}`,
  "thread_validate_cli",
  "blocked other-thread phase"
);
assertTextContains(
  `${blockedOtherThreadPlanningPhase.stdout}\n${blockedOtherThreadPlanningPhase.stderr}`,
  "thread_validate_other",
  "blocked other-thread phase"
);
await writeFile(
  planningReport.active.active_response_path,
  checkpointResponseText(planningReport),
  "utf8"
);

const planningPhase = await runCli(["phase", "open", "--run-dir", runDirectory], {
  env: foregroundThreadEnv
});
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
if (negotiationReport.active.phase_status !== "awaiting_codex_work") {
  throw new Error(
    `Expected negotiation status phase_status 'awaiting_codex_work', received '${negotiationReport.active.phase_status ?? "missing"}'.`
  );
}
if (negotiationReport.active.round !== 1) {
  throw new Error(
    `Expected negotiation status round to be '1', received '${negotiationReport.active.round ?? "missing"}'.`
  );
}
await writeFile(
  negotiationReport.active.active_response_path,
  checkpointResponseText(negotiationReport),
  "utf8"
);

const secondNegotiationPhase = await runCli([
  "phase",
  "negotiate",
  "--run-dir",
  runDirectory
], {
  env: foregroundThreadEnv
});
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
if (generatorPlanReport.operator_surface?.checkpoint_kind !== "generator-plan") {
  throw new Error(
    `Expected generator-plan checkpoint_kind 'generator-plan', received '${generatorPlanReport.operator_surface?.checkpoint_kind ?? "missing"}'.`
  );
}
await writeFile(
  generatorPlanReport.active.active_response_path,
  checkpointResponseText(generatorPlanReport),
  "utf8"
);

const attachedGeneratorResume = await runCli(["resume", "--run-dir", runDirectory], {
  env: foregroundThreadEnv
});
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
  if (postNegotiationReport.operator_surface?.checkpoint_kind !== "attached-generator") {
    throw new Error(
      `Expected attached-generator checkpoint_kind 'attached-generator', received '${postNegotiationReport.operator_surface?.checkpoint_kind ?? "missing"}'.`
    );
  }
  await writeFile(
    postNegotiationReport.active.active_response_path,
    checkpointResponseText(postNegotiationReport),
    "utf8"
  );

  const evaluationResume = await runCli(["resume", "--run-dir", runDirectory], {
    env: foregroundThreadEnv
  });
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
if (evaluationReport.operator_surface?.attention_required !== "codex") {
  throw new Error(
    `Expected evaluation attention_required 'codex', received '${evaluationReport.operator_surface?.attention_required ?? "missing"}'.`
  );
}
if (evaluationReport.operator_surface?.checkpoint_kind !== "evaluator") {
  throw new Error(
    `Expected evaluation checkpoint_kind 'evaluator', received '${evaluationReport.operator_surface?.checkpoint_kind ?? "missing"}'.`
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
