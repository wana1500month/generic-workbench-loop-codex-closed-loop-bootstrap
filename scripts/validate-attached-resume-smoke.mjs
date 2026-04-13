import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  assertRoundCount,
  assertRuntimeEventCode,
  assertRuntimeWarningContains,
  assertStopReason,
  assertTargetFamily,
  assertValidationLane,
  driveCurrentThreadHandoffs,
  extractRunDirectory,
  readJsonFile,
  readSummary,
  runLoop
} from "./validation-utils.mjs";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const writeJson = async (path, value) =>
  writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertAttachedTransportSurface = async (
  summary,
  { expectedTransportMode, expectedRoundCount }
) => {
  assert(
    summary.controller_mode === "attached",
    `Expected controller_mode 'attached', received '${summary.controller_mode ?? "missing"}'.`
  );
  assert(
    summary.transport_mode === expectedTransportMode,
    `Expected transport_mode '${expectedTransportMode}', received '${summary.transport_mode ?? "missing"}'.`
  );
  assertRoundCount(summary, expectedRoundCount);
  assert(
    typeof summary.transport_state_path === "string",
    "Expected summary.transport_state_path to be present."
  );
  assert(
    typeof summary.transport_protocol_path === "string",
    "Expected summary.transport_protocol_path to be present."
  );
  const [transportState, protocolText] = await Promise.all([
    readJsonFile(summary.transport_state_path),
    readFile(summary.transport_protocol_path, "utf8")
  ]);
  assert(
    transportState.transport_mode === expectedTransportMode,
    `Expected transport-state transport_mode '${expectedTransportMode}', received '${transportState.transport_mode ?? "missing"}'.`
  );
  if (expectedTransportMode === "current-thread") {
    assert(
      protocolText.includes("Do not call nested `codex exec`") ||
        protocolText.includes("Do not spawn nested `codex exec`"),
      "Expected current-thread protocol to forbid nested codex exec."
    );
  } else {
    assert(
      protocolText.includes("App Server Rules"),
      "Expected app-server protocol to describe App Server rules."
    );
  }
};

const assertCompletedOperatorSurface = async (summary) => {
  const operatorSurface = await readJsonFile(summary.operator_surface_path);
  assert(
    operatorSurface.execution_state === "completed",
    `Expected completed operator surface execution_state, received '${operatorSurface.execution_state ?? "missing"}'.`
  );
  assert(
    typeof operatorSurface.next_action === "string" &&
      operatorSurface.next_action.includes("no resume is required"),
    `Expected completed operator surface next_action to close out the run, received '${operatorSurface.next_action ?? "missing"}'.`
  );
  assert(
    !operatorSurface.next_action.includes("Reattach through a Codex thread"),
    "Completed operator surface should not keep stale manual reattach guidance."
  );
  assert(
    !operatorSurface.next_action.includes("resume from the same shell"),
    "Completed operator surface should not keep stale shell resume guidance."
  );
  assert(
    !Array.isArray(operatorSurface.notes) || operatorSurface.notes.length === 0,
    "Completed operator surface should clear stale handoff notes."
  );
};

const fakeAppServerEnv = () => {
  const fakeAppServerPath = join(process.cwd(), "scripts", "testing", "fake-app-server.mjs");
  return {
    ...process.env,
    HARNESS_APP_SERVER_BIN: process.execPath,
    HARNESS_APP_SERVER_BIN_ARGS: JSON.stringify([fakeAppServerPath])
  };
};

const foregroundThreadEnv = {
  ...process.env,
  CODEX_THREAD_ID: "thread_validate_attached_resume_smoke",
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

const assertCurrentThreadOperatorSurface = async (
  summary,
  {
    expectedPresentationMode,
    expectedAttentionRequired,
    expectedWorkerSkill,
    expectedRecoverySkill
  }
) => {
  const operatorSurface = await readJsonFile(summary.operator_surface_path);
  assert(
    operatorSurface.presentation_mode === expectedPresentationMode,
    `Expected operator-surface presentation_mode '${expectedPresentationMode}', received '${operatorSurface.presentation_mode ?? "missing"}'.`
  );
  assert(
    operatorSurface.attention_required === expectedAttentionRequired,
    `Expected operator-surface attention_required '${expectedAttentionRequired}', received '${operatorSurface.attention_required ?? "missing"}'.`
  );
  if (expectedWorkerSkill !== undefined) {
    assert(
      operatorSurface.worker_skill === expectedWorkerSkill,
      `Expected operator-surface worker_skill '${expectedWorkerSkill}', received '${operatorSurface.worker_skill ?? "missing"}'.`
    );
  }
  if (expectedRecoverySkill !== undefined) {
    assert(
      operatorSurface.recovery_skill === expectedRecoverySkill,
      `Expected operator-surface recovery_skill '${expectedRecoverySkill}', received '${operatorSurface.recovery_skill ?? "missing"}'.`
    );
  }
};

console.log("[validate-attached-resume-smoke] unbound current-thread manual protocol seed");
const manualCurrentThreadSeed = await runLoop(
  [
    "--single",
    "--controller-mode",
    "attached",
    "--transport",
    "current-thread",
    "--allow-manual-protocol-seed",
    "--adapter",
    "./.tmp/semantic-validation/patch-only-success/adapter.json",
    "--target-family",
    "api-service"
  ],
  {
    env: shellLikeEnv
  }
);
if (manualCurrentThreadSeed.code !== 0) {
  throw new Error("Unbound current-thread manual-protocol seed run failed.");
}
const manualCurrentThreadRunDirectory = extractRunDirectory(manualCurrentThreadSeed.stdout);
const manualCurrentThreadSeedSummary = await readSummary(manualCurrentThreadRunDirectory);
assertTargetFamily(manualCurrentThreadSeedSummary, "api-service");
assertValidationLane(manualCurrentThreadSeedSummary, "deterministic_semantic");
assertStopReason(manualCurrentThreadSeedSummary, "awaiting_human_input");
assertRuntimeWarningContains(
  manualCurrentThreadSeedSummary,
  "manual protocol"
);
await assertAttachedTransportSurface(manualCurrentThreadSeedSummary, {
  expectedTransportMode: "current-thread",
  expectedRoundCount: 0
});
await assertCurrentThreadOperatorSurface(manualCurrentThreadSeedSummary, {
  expectedPresentationMode: "manual-protocol",
  expectedAttentionRequired: "human",
  expectedWorkerSkill: "loop-control",
  expectedRecoverySkill: "attached-loop"
});

console.log("[validate-attached-resume-smoke] bound foreground current-thread seed");
const currentThreadSeed = await runLoop(
  [
    "--single",
    "--controller-mode",
    "attached",
    "--transport",
    "current-thread",
    "--adapter",
    "./.tmp/semantic-validation/patch-only-success/adapter.json",
    "--target-family",
    "api-service"
  ],
  {
    env: foregroundThreadEnv
  }
);
if (currentThreadSeed.code !== 0) {
  throw new Error("Bound foreground current-thread seed run failed.");
}
const currentThreadRunDirectory = extractRunDirectory(currentThreadSeed.stdout);
const currentThreadSeedSummary = await readSummary(currentThreadRunDirectory);
assertTargetFamily(currentThreadSeedSummary, "api-service");
assertValidationLane(currentThreadSeedSummary, "deterministic_semantic");
assertStopReason(currentThreadSeedSummary, "awaiting_codex_checkpoint");
await assertAttachedTransportSurface(currentThreadSeedSummary, {
  expectedTransportMode: "current-thread",
  expectedRoundCount: 0
});
await assertCurrentThreadOperatorSurface(currentThreadSeedSummary, {
  expectedPresentationMode: "foreground-thread",
  expectedAttentionRequired: "codex",
  expectedWorkerSkill: "loop-control",
  expectedRecoverySkill: "attached-loop"
});

console.log("[validate-attached-resume-smoke] bound foreground current-thread resume from missing summary");
await rm(join(currentThreadRunDirectory, "summary.json"));
const currentThreadResume = await runLoop([
  "--resume-run",
  currentThreadRunDirectory,
  "--controller-mode",
  "attached",
  "--transport",
  "current-thread",
  "--adapter",
  "./.tmp/semantic-validation/patch-only-success/adapter.json",
  "--target-family",
  "api-service",
  "--max-rounds",
  "3"
], {
  env: foregroundThreadEnv
});
if (currentThreadResume.code !== 0) {
  throw new Error("Bound foreground current-thread resume failed.");
}
const currentThreadResumedSummary = await driveCurrentThreadHandoffs({
  runDirectory: currentThreadRunDirectory,
  resumeArgs: [
    "--resume-run",
    currentThreadRunDirectory,
    "--controller-mode",
    "attached",
    "--transport",
    "current-thread",
    "--adapter",
    "./.tmp/semantic-validation/patch-only-success/adapter.json",
    "--target-family",
    "api-service",
    "--max-rounds",
    "3"
  ],
  env: foregroundThreadEnv,
  label: "Bound foreground current-thread resume"
});
assertStopReason(currentThreadResumedSummary, "target_reached");
assertRuntimeEventCode(currentThreadResumedSummary, "resume.recovered_round_checkpoint");
await assertAttachedTransportSurface(currentThreadResumedSummary, {
  expectedTransportMode: "current-thread",
  expectedRoundCount: 2
});
await assertCompletedOperatorSurface(currentThreadResumedSummary);

console.log("[validate-attached-resume-smoke] bound foreground current-thread interrupted-round repair");
const currentThreadRepairSeed = await runLoop([
  "--single",
  "--controller-mode",
  "attached",
  "--transport",
  "current-thread",
  "--adapter",
  "./.tmp/semantic-validation/patch-only-success/adapter.json",
  "--target-family",
  "api-service"
], {
  env: foregroundThreadEnv
});
if (currentThreadRepairSeed.code !== 0) {
  throw new Error("Bound foreground current-thread repair seed failed.");
}
const currentThreadRepairRunDirectory = extractRunDirectory(currentThreadRepairSeed.stdout);
await driveCurrentThreadHandoffs({
  runDirectory: currentThreadRepairRunDirectory,
  resumeArgs: [
    "--resume-run",
    currentThreadRepairRunDirectory,
    "--controller-mode",
    "attached",
    "--transport",
    "current-thread",
    "--adapter",
    "./.tmp/semantic-validation/patch-only-success/adapter.json",
    "--target-family",
    "api-service",
    "--max-rounds",
    "3"
  ],
  env: foregroundThreadEnv,
  label: "Bound foreground current-thread repair seed"
});
const currentThreadRoundTwoDirectory = join(currentThreadRepairRunDirectory, "round-002");
const currentThreadRoundThreeDirectory = join(currentThreadRepairRunDirectory, "round-003");
const currentThreadRuntimeDirectory = join(currentThreadRepairRunDirectory, "runtime");
const currentThreadRoundThreeRuntimeDirectory = join(
  currentThreadRoundThreeDirectory,
  "runtime"
);
await cp(currentThreadRoundTwoDirectory, currentThreadRoundThreeDirectory, {
  recursive: true
});
await Promise.all([
  rm(join(currentThreadRoundThreeDirectory, "round_summary.json")),
  rm(join(currentThreadRoundThreeDirectory, "target-manifest.json"), { force: true }),
  rm(join(currentThreadRoundThreeDirectory, "core-probe-results.json"), { force: true }),
  rm(join(currentThreadRoundThreeRuntimeDirectory, "pre-verification-executions.json"), {
    force: true
  }),
  rm(join(currentThreadRoundThreeRuntimeDirectory, "post-verification-executions.json"), {
    force: true
  }),
  rm(join(currentThreadRoundThreeRuntimeDirectory, "adapter-executions.json"), {
    force: true
  })
]);
const staleHeartbeat = "2026-04-09T00:00:00.000Z";
const [currentThreadLiveState, currentThreadRoundPhase] = await Promise.all([
  readJson(join(currentThreadRuntimeDirectory, "live-state.json")),
  readJson(join(currentThreadRuntimeDirectory, "round-phase.json"))
]);
await Promise.all([
  writeJson(join(currentThreadRuntimeDirectory, "live-state.json"), {
    ...currentThreadLiveState,
    round_count: 2,
    active_round: 3,
    active_phase: "post_verification",
    active_phase_status: "in_progress",
    updated_at: staleHeartbeat,
    heartbeat_at: staleHeartbeat
  }),
  writeJson(join(currentThreadRuntimeDirectory, "round-phase.json"), {
    ...currentThreadRoundPhase,
    round: 3,
    phase: "post_verification",
    status: "in_progress",
    updated_at: staleHeartbeat,
    heartbeat_at: staleHeartbeat,
    phase_started_at: staleHeartbeat,
    artifacts: {
      target_manifest_path: join(currentThreadRoundThreeDirectory, "target-manifest.json"),
      core_probe_results_path: join(currentThreadRoundThreeDirectory, "core-probe-results.json"),
      post_verification_executions_path: join(
        currentThreadRoundThreeRuntimeDirectory,
        "post-verification-executions.json"
      ),
      adapter_executions_path: join(
        currentThreadRoundThreeRuntimeDirectory,
        "adapter-executions.json"
      )
    }
  }),
  writeJson(join(currentThreadRuntimeDirectory, "controller-lease.json"), {
    run_id: "attached-current-thread-repair",
    controller_mode: "attached",
    transport_mode: "current-thread",
    status: "running",
    updated_at: staleHeartbeat,
    heartbeat_at: staleHeartbeat,
    owner_pid: 99999,
    round: 3,
    phase: "post_verification",
    phase_status: "in_progress",
    summary_path: join(currentThreadRepairRunDirectory, "summary.json"),
    live_state_path: join(currentThreadRuntimeDirectory, "live-state.json")
  })
]);
const currentThreadRepair = await runLoop([
  "--resume-run",
  currentThreadRepairRunDirectory,
  "--repair",
  "--force-reopen-terminal",
  "--resume-phase",
  "post_verification",
  "--controller-mode",
  "attached",
  "--transport",
  "current-thread",
  "--adapter",
  "./.tmp/semantic-validation/patch-only-success/adapter.json",
  "--target-family",
  "api-service",
  "--max-rounds",
  "3"
], {
  env: foregroundThreadEnv
});
if (currentThreadRepair.code !== 0) {
  throw new Error("Bound foreground current-thread repair failed.");
}
const currentThreadRepairedSummary = await driveCurrentThreadHandoffs({
  runDirectory: currentThreadRepairRunDirectory,
  resumeArgs: [
    "--resume-run",
    currentThreadRepairRunDirectory,
    "--controller-mode",
    "attached",
    "--transport",
    "current-thread",
    "--adapter",
    "./.tmp/semantic-validation/patch-only-success/adapter.json",
    "--target-family",
    "api-service",
    "--max-rounds",
    "3"
  ],
  env: foregroundThreadEnv,
  label: "Bound foreground current-thread repair resume"
});
assertRuntimeEventCode(currentThreadRepairedSummary, "resume.repaired_interrupted_round");
assertRuntimeWarningContains(
  currentThreadRepairedSummary,
  "Reconstructed pre_verification capability aggregate from adapter result files for round 3."
);
await assertAttachedTransportSurface(currentThreadRepairedSummary, {
  expectedTransportMode: "current-thread",
  expectedRoundCount: 3
});

console.log("[validate-attached-resume-smoke] attached app-server seed and resume");
const appServerSeed = await runLoop(
  [
    "--single",
    "--controller-mode",
    "attached",
    "--transport",
    "app-server",
    "--adapter",
    "./.tmp/semantic-validation/patch-only-success/adapter.json",
    "--target-family",
    "api-service"
  ],
  {
    env: fakeAppServerEnv()
  }
);
if (appServerSeed.code !== 0) {
  throw new Error("Attached app-server seed run failed.");
}
const appServerRunDirectory = extractRunDirectory(appServerSeed.stdout);
const appServerSeedSummary = await readSummary(appServerRunDirectory);
assertStopReason(appServerSeedSummary, "max_rounds_reached");
await assertAttachedTransportSurface(appServerSeedSummary, {
  expectedTransportMode: "app-server",
  expectedRoundCount: 1
});
const appServerSeedTransportState = await readJsonFile(
  appServerSeedSummary.transport_state_path
);
assert(
  appServerSeedTransportState.app_server?.implemented === true,
  "Expected attached app-server transport to be implemented."
);
assert(
  typeof appServerSeedTransportState.app_server?.thread_id === "string",
  "Expected attached app-server seed to persist a thread id."
);

await rm(join(appServerRunDirectory, "summary.json"));
const appServerResume = await runLoop(
  [
    "--resume-run",
    appServerRunDirectory,
    "--controller-mode",
    "attached",
    "--transport",
    "app-server",
    "--adapter",
    "./.tmp/semantic-validation/patch-only-success/adapter.json",
    "--target-family",
    "api-service",
    "--max-rounds",
    "3"
  ],
  {
    env: fakeAppServerEnv()
  }
);
if (appServerResume.code !== 0) {
  throw new Error("Attached app-server resume failed.");
}
const appServerResumedSummary = await readSummary(appServerRunDirectory);
assertStopReason(appServerResumedSummary, "target_reached");
assertRuntimeEventCode(appServerResumedSummary, "resume.recovered_round_checkpoint");
await assertAttachedTransportSurface(appServerResumedSummary, {
  expectedTransportMode: "app-server",
  expectedRoundCount: 2
});
await assertCompletedOperatorSurface(appServerResumedSummary);

console.log("[validate-attached-resume-smoke] attached app-server interrupted-round repair");
const appServerRepairSeed = await runLoop(
  [
    "--single",
    "--controller-mode",
    "attached",
    "--transport",
    "app-server",
    "--adapter",
    "./.tmp/semantic-validation/patch-only-success/adapter.json",
    "--target-family",
    "api-service"
  ],
  {
    env: fakeAppServerEnv()
  }
);
if (appServerRepairSeed.code !== 0) {
  throw new Error("Attached app-server repair seed failed.");
}
const appServerRepairRunDirectory = extractRunDirectory(appServerRepairSeed.stdout);
const appServerRoundOneDirectory = join(appServerRepairRunDirectory, "round-001");
const appServerRoundTwoDirectory = join(appServerRepairRunDirectory, "round-002");
const appServerRuntimeDirectory = join(appServerRepairRunDirectory, "runtime");
const appServerRoundTwoRuntimeDirectory = join(appServerRoundTwoDirectory, "runtime");
await cp(appServerRoundOneDirectory, appServerRoundTwoDirectory, {
  recursive: true
});
await Promise.all([
  rm(join(appServerRoundTwoDirectory, "round_summary.json")),
  rm(join(appServerRoundTwoDirectory, "target-manifest.json"), { force: true }),
  rm(join(appServerRoundTwoDirectory, "core-probe-results.json"), { force: true }),
  rm(join(appServerRoundTwoRuntimeDirectory, "pre-verification-executions.json"), {
    force: true
  }),
  rm(join(appServerRoundTwoRuntimeDirectory, "post-verification-executions.json"), {
    force: true
  }),
  rm(join(appServerRoundTwoRuntimeDirectory, "adapter-executions.json"), {
    force: true
  })
]);
const [appServerLiveState, appServerRoundPhase] = await Promise.all([
  readJson(join(appServerRuntimeDirectory, "live-state.json")),
  readJson(join(appServerRuntimeDirectory, "round-phase.json"))
]);
await Promise.all([
  writeJson(join(appServerRuntimeDirectory, "live-state.json"), {
    ...appServerLiveState,
    round_count: 1,
    active_round: 2,
    active_phase: "post_verification",
    active_phase_status: "in_progress",
    updated_at: staleHeartbeat,
    heartbeat_at: staleHeartbeat
  }),
  writeJson(join(appServerRuntimeDirectory, "round-phase.json"), {
    ...appServerRoundPhase,
    round: 2,
    phase: "post_verification",
    status: "in_progress",
    updated_at: staleHeartbeat,
    heartbeat_at: staleHeartbeat,
    phase_started_at: staleHeartbeat,
    artifacts: {
      target_manifest_path: join(appServerRoundTwoDirectory, "target-manifest.json"),
      core_probe_results_path: join(appServerRoundTwoDirectory, "core-probe-results.json"),
      post_verification_executions_path: join(
        appServerRoundTwoRuntimeDirectory,
        "post-verification-executions.json"
      ),
      adapter_executions_path: join(
        appServerRoundTwoRuntimeDirectory,
        "adapter-executions.json"
      )
    }
  }),
  writeJson(join(appServerRuntimeDirectory, "controller-lease.json"), {
    run_id: "attached-app-server-repair",
    controller_mode: "attached",
    transport_mode: "app-server",
    status: "running",
    updated_at: staleHeartbeat,
    heartbeat_at: staleHeartbeat,
    owner_pid: 99999,
    round: 2,
    phase: "post_verification",
    phase_status: "in_progress",
    summary_path: join(appServerRepairRunDirectory, "summary.json"),
    live_state_path: join(appServerRuntimeDirectory, "live-state.json")
  })
]);
const appServerRepair = await runLoop(
  [
    "--resume-run",
    appServerRepairRunDirectory,
    "--repair",
    "--resume-phase",
    "post_verification",
    "--controller-mode",
    "attached",
    "--transport",
    "app-server",
    "--adapter",
    "./.tmp/semantic-validation/patch-only-success/adapter.json",
    "--target-family",
    "api-service",
    "--max-rounds",
    "3"
  ],
  {
    env: fakeAppServerEnv()
  }
);
if (appServerRepair.code !== 0) {
  throw new Error("Attached app-server repair failed.");
}
const appServerRepairedSummary = await readSummary(appServerRepairRunDirectory);
assertRuntimeEventCode(appServerRepairedSummary, "resume.repaired_interrupted_round");
assertRuntimeWarningContains(
  appServerRepairedSummary,
  "Reconstructed pre_verification capability aggregate from adapter result files for round 2."
);
await assertAttachedTransportSurface(appServerRepairedSummary, {
  expectedTransportMode: "app-server",
  expectedRoundCount: 2
});
const appServerRepairedTransportState = await readJsonFile(
  appServerRepairedSummary.transport_state_path
);
assert(
  typeof appServerRepairedTransportState.app_server?.thread_id === "string",
  "Expected repaired app-server run to preserve a thread id."
);

console.log("[validate-attached-resume-smoke] complete");
