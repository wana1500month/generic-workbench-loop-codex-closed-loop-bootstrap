import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  assertRoundCount,
  assertRuntimeEventCode,
  assertRuntimeWarningContains,
  assertStopReason,
  assertTargetFamily,
  assertValidationLane,
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

const fakeAppServerEnv = () => {
  const fakeAppServerPath = join(process.cwd(), "scripts", "testing", "fake-app-server.mjs");
  return {
    ...process.env,
    HARNESS_APP_SERVER_BIN: process.execPath,
    HARNESS_APP_SERVER_BIN_ARGS: JSON.stringify([fakeAppServerPath])
  };
};

console.log("[validate-attached-resume-smoke] attached current-thread seed");
const currentThreadSeed = await runLoop([
  "--single",
  "--controller-mode",
  "attached",
  "--transport",
  "current-thread",
  "--adapter",
  "./.tmp/semantic-validation/patch-only-success/adapter.json",
  "--target-family",
  "api-service"
]);
if (currentThreadSeed.code !== 0) {
  throw new Error("Attached current-thread seed run failed.");
}
const currentThreadRunDirectory = extractRunDirectory(currentThreadSeed.stdout);
const currentThreadSeedSummary = await readSummary(currentThreadRunDirectory);
assertTargetFamily(currentThreadSeedSummary, "api-service");
assertValidationLane(currentThreadSeedSummary, "deterministic_semantic");
assertStopReason(currentThreadSeedSummary, "max_rounds_reached");
await assertAttachedTransportSurface(currentThreadSeedSummary, {
  expectedTransportMode: "current-thread",
  expectedRoundCount: 1
});

console.log("[validate-attached-resume-smoke] attached current-thread resume from missing summary");
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
]);
if (currentThreadResume.code !== 0) {
  throw new Error("Attached current-thread resume failed.");
}
const currentThreadResumedSummary = await readSummary(currentThreadRunDirectory);
assertStopReason(currentThreadResumedSummary, "target_reached");
assertRuntimeEventCode(currentThreadResumedSummary, "resume.recovered_round_checkpoint");
await assertAttachedTransportSurface(currentThreadResumedSummary, {
  expectedTransportMode: "current-thread",
  expectedRoundCount: 2
});

console.log("[validate-attached-resume-smoke] attached current-thread interrupted-round repair");
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
]);
if (currentThreadRepairSeed.code !== 0) {
  throw new Error("Attached current-thread repair seed failed.");
}
const currentThreadRepairRunDirectory = extractRunDirectory(currentThreadRepairSeed.stdout);
const currentThreadRoundOneDirectory = join(currentThreadRepairRunDirectory, "round-001");
const currentThreadRoundTwoDirectory = join(currentThreadRepairRunDirectory, "round-002");
const currentThreadRuntimeDirectory = join(currentThreadRepairRunDirectory, "runtime");
const currentThreadRoundTwoRuntimeDirectory = join(
  currentThreadRoundTwoDirectory,
  "runtime"
);
await cp(currentThreadRoundOneDirectory, currentThreadRoundTwoDirectory, {
  recursive: true
});
await Promise.all([
  rm(join(currentThreadRoundTwoDirectory, "round_summary.json")),
  rm(join(currentThreadRoundTwoDirectory, "target-manifest.json"), { force: true }),
  rm(join(currentThreadRoundTwoDirectory, "core-probe-results.json"), { force: true }),
  rm(join(currentThreadRoundTwoRuntimeDirectory, "pre-verification-executions.json"), {
    force: true
  }),
  rm(join(currentThreadRoundTwoRuntimeDirectory, "post-verification-executions.json"), {
    force: true
  }),
  rm(join(currentThreadRoundTwoRuntimeDirectory, "adapter-executions.json"), {
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
    round_count: 1,
    active_round: 2,
    active_phase: "post_verification",
    active_phase_status: "in_progress",
    updated_at: staleHeartbeat,
    heartbeat_at: staleHeartbeat
  }),
  writeJson(join(currentThreadRuntimeDirectory, "round-phase.json"), {
    ...currentThreadRoundPhase,
    round: 2,
    phase: "post_verification",
    status: "in_progress",
    updated_at: staleHeartbeat,
    heartbeat_at: staleHeartbeat,
    phase_started_at: staleHeartbeat,
    artifacts: {
      target_manifest_path: join(currentThreadRoundTwoDirectory, "target-manifest.json"),
      core_probe_results_path: join(currentThreadRoundTwoDirectory, "core-probe-results.json"),
      post_verification_executions_path: join(
        currentThreadRoundTwoRuntimeDirectory,
        "post-verification-executions.json"
      ),
      adapter_executions_path: join(
        currentThreadRoundTwoRuntimeDirectory,
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
    round: 2,
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
]);
if (currentThreadRepair.code !== 0) {
  throw new Error("Attached current-thread repair failed.");
}
const currentThreadRepairedSummary = await readSummary(currentThreadRepairRunDirectory);
assertRuntimeEventCode(currentThreadRepairedSummary, "resume.repaired_interrupted_round");
assertRuntimeWarningContains(
  currentThreadRepairedSummary,
  "Reconstructed pre_verification capability aggregate from adapter result files for round 2."
);
await assertAttachedTransportSurface(currentThreadRepairedSummary, {
  expectedTransportMode: "current-thread",
  expectedRoundCount: 2
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
