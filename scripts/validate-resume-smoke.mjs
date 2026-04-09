import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  assertDecisionSource,
  assertFailurePolicySnapshot,
  assertControllerDecisionBundleSemantics,
  assertRoundCount,
  assertRoundBundleSemantics,
  assertRoundStopReason,
  assertRuntimeEventCode,
  assertRuntimeEventCodeMissing,
  assertRuntimeWarningMissing,
  assertStopReason,
  assertTargetFamily,
  assertTrajectoryDecisionSurface,
  assertValidationLane,
  extractRunDirectory,
  readJsonFile,
  readResumeDecisionArtifact,
  readSummary,
  runLoop
} from "./validation-utils.mjs";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const writeJson = async (path, value) =>
  writeFile(path, JSON.stringify(value, null, 2));

const assertRuntimeCheckpointSurface = async (
  summary,
  { expectedRoundCount, expectedControllerMode = "detached" }
) => {
  if (summary.controller_mode !== expectedControllerMode) {
    throw new Error(
      `Expected controller_mode '${expectedControllerMode}', received '${summary.controller_mode ?? "missing"}'.`
    );
  }
  if (!summary.runtime_live_state_path || !summary.runtime_round_phase_path || !summary.controller_lease_path) {
    throw new Error("Expected runtime checkpoint paths to be present in summary.json.");
  }

  const [liveState, roundPhase, controllerLease] = await Promise.all([
    readJson(summary.runtime_live_state_path),
    readJson(summary.runtime_round_phase_path),
    readJson(summary.controller_lease_path)
  ]);

  if (liveState.round_count !== expectedRoundCount) {
    throw new Error(
      `Expected runtime live-state round_count '${expectedRoundCount}', received '${liveState.round_count}'.`
    );
  }
  if (liveState.controller_mode !== expectedControllerMode) {
    throw new Error(
      `Expected live-state controller_mode '${expectedControllerMode}', received '${liveState.controller_mode ?? "missing"}'.`
    );
  }
  if (roundPhase.controller_mode !== expectedControllerMode) {
    throw new Error(
      `Expected round-phase controller_mode '${expectedControllerMode}', received '${roundPhase.controller_mode ?? "missing"}'.`
    );
  }
  if (controllerLease.controller_mode !== expectedControllerMode) {
    throw new Error(
      `Expected controller-lease controller_mode '${expectedControllerMode}', received '${controllerLease.controller_mode ?? "missing"}'.`
    );
  }
};

console.log("[validate-resume-smoke] seed single attempt");
const seedResult = await runLoop([
  "--single",
  "--adapter",
  "./.tmp/semantic-validation/patch-only-success/adapter.json",
  "--target-family",
  "api-service"
]);
if (seedResult.code !== 0) {
  throw new Error("Seed single-attempt run failed.");
}

const seededRunDirectory = extractRunDirectory(seedResult.stdout);
const seededSummary = await readSummary(seededRunDirectory);
assertTargetFamily(seededSummary, "api-service");
assertValidationLane(seededSummary, "deterministic_semantic");
assertStopReason(seededSummary, "max_rounds_reached");
assertRoundCount(seededSummary, 1);
await assertRuntimeCheckpointSurface(seededSummary, { expectedRoundCount: 1 });
await assertControllerDecisionBundleSemantics(
  seededSummary.round_history?.[0],
  "api-service",
  "deterministic_semantic",
  "seed controller decision"
);
assertRoundStopReason(
  seededSummary.round_history?.[0],
  "max_rounds_reached",
  "seed remediation candidate round"
);

console.log("[validate-resume-smoke] remove summary and resume from committed round checkpoint");
await rm(join(seededRunDirectory, "summary.json"));
const resumedResult = await runLoop([
  "--resume-run",
  seededRunDirectory,
  "--adapter",
  "./.tmp/semantic-validation/patch-only-success/adapter.json",
  "--target-family",
  "api-service",
  "--max-rounds",
  "3"
]);
if (resumedResult.code !== 0) {
  throw new Error("Resume run failed.");
}

const resumedSummary = await readSummary(seededRunDirectory);
assertTargetFamily(resumedSummary, "api-service");
assertValidationLane(resumedSummary, "deterministic_semantic");
assertStopReason(resumedSummary, "target_reached");
assertRoundCount(resumedSummary, 2);
await assertRuntimeCheckpointSurface(resumedSummary, { expectedRoundCount: 2 });
assertRuntimeEventCode(resumedSummary, "run.resumed_from_history");
assertRuntimeEventCode(resumedSummary, "resume.recovered_round_checkpoint");
assertRuntimeEventCode(resumedSummary, "resume.continued");
assertRoundBundleSemantics(
  resumedSummary.round_history?.[0],
  "api-service",
  "deterministic_semantic"
);
assertRoundBundleSemantics(
  resumedSummary.round_history?.[1],
  "api-service",
  "deterministic_semantic"
);
await assertControllerDecisionBundleSemantics(
  resumedSummary.round_history?.[1],
  "api-service",
  "deterministic_semantic",
  "resumed controller decision"
);
assertRoundStopReason(
  resumedSummary.round_history?.[0],
  "max_rounds_reached",
  "resume seed round"
);
assertRoundStopReason(
  resumedSummary.round_history?.[1],
  "target_reached",
  "resume terminal round"
);
const resumedDecision = await readResumeDecisionArtifact(resumedSummary);
if (resumedDecision.decision !== "continue") {
  throw new Error(
    `Expected resumed decision 'continue', received '${resumedDecision.decision}'.`
  );
}

console.log("[validate-resume-smoke] synthesize interrupted round and repair from runtime journal");
const repairSeedResult = await runLoop([
  "--single",
  "--adapter",
  "./.tmp/semantic-validation/patch-only-success/adapter.json",
  "--target-family",
  "api-service"
]);
if (repairSeedResult.code !== 0) {
  throw new Error("Repair seed single-attempt run failed.");
}

const repairRunDirectory = extractRunDirectory(repairSeedResult.stdout);
const repairSummarySeed = await readSummary(repairRunDirectory);
const roundOneDirectory = join(repairRunDirectory, "round-001");
const roundTwoDirectory = join(repairRunDirectory, "round-002");
const runtimeDirectory = join(repairRunDirectory, "runtime");
await cp(roundOneDirectory, roundTwoDirectory, { recursive: true });
await rm(join(roundTwoDirectory, "round_summary.json"));
const [runtimeLiveState, runtimeRoundPhase] = await Promise.all([
  readJson(join(runtimeDirectory, "live-state.json")),
  readJson(join(runtimeDirectory, "round-phase.json"))
]);
const staleHeartbeat = "2026-04-09T00:00:00.000Z";
await Promise.all([
  writeJson(join(runtimeDirectory, "live-state.json"), {
    ...runtimeLiveState,
    round_count: 1,
    active_round: 2,
    active_phase: "evaluation",
    active_phase_status: "completed",
    latest_eval_report_path: join(roundTwoDirectory, "eval_report.json"),
    latest_round_summary_path: join(roundOneDirectory, "round_summary.json"),
    updated_at: staleHeartbeat,
    heartbeat_at: staleHeartbeat,
    notes: ["Synthetic interrupted round for resume repair validation."]
  }),
  writeJson(join(runtimeDirectory, "round-phase.json"), {
    ...runtimeRoundPhase,
    round: 2,
    phase: "evaluation",
    status: "completed",
    updated_at: staleHeartbeat,
    heartbeat_at: staleHeartbeat,
    phase_started_at: staleHeartbeat,
    phase_completed_at: staleHeartbeat,
    artifacts: {
      negotiation_state_path: join(roundTwoDirectory, "negotiation-state.json"),
      eval_report_path: join(roundTwoDirectory, "eval_report.json"),
      patch_request_path: join(roundTwoDirectory, "patch-request.json"),
      round_result_path: join(roundTwoDirectory, "round-result.json")
    }
  }),
  writeJson(join(runtimeDirectory, "controller-lease.json"), {
    run_id: repairSummarySeed.run_id,
    controller_mode: "detached",
    executor_mode: repairSummarySeed.executor_mode,
    status: "running",
    updated_at: staleHeartbeat,
    heartbeat_at: staleHeartbeat,
    owner_pid: 99999,
    round: 2,
    phase: "evaluation",
    phase_status: "completed",
    summary_path: join(repairRunDirectory, "summary.json"),
    live_state_path: join(runtimeDirectory, "live-state.json")
  })
]);

const repairResult = await runLoop([
  "--resume-run",
  repairRunDirectory,
  "--repair",
  "--resume-phase",
  "evaluation",
  "--max-rounds",
  "3"
]);
if (repairResult.code !== 0) {
  throw new Error("Interrupted round repair run failed.");
}

const repairedSummary = await readSummary(repairRunDirectory);
assertTargetFamily(repairedSummary, "api-service");
assertValidationLane(repairedSummary, "deterministic_semantic");
assertRoundCount(repairedSummary, 2);
await assertRuntimeCheckpointSurface(repairedSummary, { expectedRoundCount: 2 });
assertRuntimeEventCode(repairedSummary, "run.resumed_from_history");
assertRuntimeEventCode(repairedSummary, "resume.repaired_interrupted_round");
assertRuntimeWarningMissing(
  repairedSummary,
  "Resume returned without opening a new round."
);
assertRoundStopReason(
  repairedSummary.round_history?.[1],
  "continue",
  "repaired interrupted round"
);
const repairedRoundSummary = await readJson(join(roundTwoDirectory, "round_summary.json"));
if (repairedRoundSummary.round !== 2) {
  throw new Error(
    `Expected repaired round_summary.json to record round 2, received '${repairedRoundSummary.round ?? "missing"}'.`
  );
}

console.log("[validate-resume-smoke] seed migration candidate");
const migrationSeedResult = await runLoop([
  "--single",
  "--adapter",
  "./.tmp/semantic-validation/patch-only-success/adapter.json",
  "--target-family",
  "api-service"
]);
if (migrationSeedResult.code !== 0) {
  throw new Error("Migration seed single-attempt run failed.");
}

const migrationRunDirectory = extractRunDirectory(migrationSeedResult.stdout);
console.log("[validate-resume-smoke] reject identity mismatch without override");
const rejectedResumeResult = await runLoop(
  [
    "--resume-run",
    migrationRunDirectory,
    "--target-family",
    "crud-api",
    "--max-rounds",
    "3"
  ],
  { silent: true }
);
if (rejectedResumeResult.code === 0) {
  throw new Error("Resume identity mismatch should have failed without override.");
}
if (!rejectedResumeResult.stderr.includes("Resume identity mismatch")) {
  throw new Error("Resume identity mismatch failure did not mention identity integrity.");
}

console.log("[validate-resume-smoke] allow explicit migration override");
const migratedResumeResult = await runLoop([
  "--resume-run",
  migrationRunDirectory,
  "--target-family",
  "crud-api",
  "--allow-resume-migration",
  "--max-rounds",
  "3"
]);
if (migratedResumeResult.code !== 0) {
  throw new Error("Resume migration override run failed.");
}

const migratedSummary = await readSummary(migrationRunDirectory);
assertTargetFamily(migratedSummary, "crud-api");
assertValidationLane(migratedSummary, "deterministic_semantic");
if (!migratedSummary.bundle_migrated || !migratedSummary.resume_migration_path) {
  throw new Error("Expected resume migration metadata to be recorded.");
}
assertRuntimeEventCode(migratedSummary, "resume.migration_override");
assertRuntimeEventCode(migratedSummary, "resume.continued");
assertRoundBundleSemantics(
  migratedSummary.round_history?.[0],
  "api-service",
  "deterministic_semantic"
);
assertRoundBundleSemantics(
  migratedSummary.round_history?.[1],
  "crud-api",
  "deterministic_semantic"
);
await assertControllerDecisionBundleSemantics(
  migratedSummary.round_history?.[1],
  "crud-api",
  "deterministic_semantic",
  "migration controller decision"
);
assertRoundStopReason(
  migratedSummary.round_history?.[0],
  "max_rounds_reached",
  "migration seed round"
);
assertRoundStopReason(
  migratedSummary.round_history?.[1],
  "target_reached",
  "migration terminal round"
);
const migratedDecision = await readResumeDecisionArtifact(migratedSummary);
if (migratedDecision.decision !== "continue") {
  throw new Error(
    `Expected migration decision 'continue', received '${migratedDecision.decision}'.`
  );
}

console.log("[validate-resume-smoke] seed no-adapter run");
const noAdapterSeedResult = await runLoop(["--single"]);
if (noAdapterSeedResult.code !== 0) {
  throw new Error("No-adapter seed run failed.");
}
const noAdapterRunDirectory = extractRunDirectory(noAdapterSeedResult.stdout);
const noAdapterSeedSummary = await readSummary(noAdapterRunDirectory);
assertTargetFamily(noAdapterSeedSummary, "generic-core");
assertValidationLane(noAdapterSeedSummary, "deterministic_semantic");
assertStopReason(noAdapterSeedSummary, "contract_completed");
assertRoundCount(noAdapterSeedSummary, 1);
assertRoundBundleSemantics(
  noAdapterSeedSummary.round_history?.[0],
  "generic-core",
  "deterministic_semantic"
);
await assertControllerDecisionBundleSemantics(
  noAdapterSeedSummary.round_history?.[0],
  "generic-core",
  "deterministic_semantic",
  "no-adapter seed controller decision"
);
assertRoundStopReason(
  noAdapterSeedSummary.round_history?.[0],
  "contract_completed",
  "no-adapter terminal round"
);

console.log("[validate-resume-smoke] terminal resume defaults to noop");
const noAdapterNoopResume = await runLoop([
  "--resume-run",
  noAdapterRunDirectory,
  "--max-rounds",
  "3"
]);
if (noAdapterNoopResume.code !== 0) {
  throw new Error("Terminal noop resume run failed.");
}
const noAdapterNoopSummary = await readSummary(noAdapterRunDirectory);
assertStopReason(noAdapterNoopSummary, "contract_completed");
assertRoundCount(noAdapterNoopSummary, 1);
assertRuntimeEventCode(noAdapterNoopSummary, "resume.noop_terminal");
assertRuntimeEventCodeMissing(noAdapterNoopSummary, "resume.reopened_terminal");
assertRoundStopReason(
  noAdapterNoopSummary.round_history?.[0],
  "contract_completed",
  "terminal noop round"
);
const noopDecision = await readResumeDecisionArtifact(noAdapterNoopSummary);
if (noopDecision.decision !== "noop_terminal") {
  throw new Error(
    `Expected terminal noop decision 'noop_terminal', received '${noopDecision.decision}'.`
  );
}

console.log("[validate-resume-smoke] reject adapter presence change without override");
const adapterPresenceRejected = await runLoop(
  [
    "--resume-run",
    noAdapterRunDirectory,
    "--adapter",
    "./.tmp/semantic-validation/patch-only-success/adapter.json",
    "--evaluator-profile",
    "./.tmp/semantic-validation/verification-profile-api-only.json",
    "--max-rounds",
    "3"
  ],
  { silent: true }
);
if (adapterPresenceRejected.code === 0) {
  throw new Error("Adapter presence change should have failed without override.");
}
if (!adapterPresenceRejected.stderr.includes("Resume identity mismatch")) {
  throw new Error("Adapter presence-change mismatch did not mention identity integrity.");
}

console.log("[validate-resume-smoke] terminal migration override still requires explicit reopen");
const adapterPresenceTerminalBlocked = await runLoop(
  [
    "--resume-run",
    noAdapterRunDirectory,
    "--adapter",
    "./.tmp/semantic-validation/patch-only-success/adapter.json",
    "--evaluator-profile",
    "./.tmp/semantic-validation/verification-profile-api-only.json",
    "--allow-resume-migration",
    "--max-rounds",
    "3"
  ],
  { silent: true }
);
if (adapterPresenceTerminalBlocked.code === 0) {
  throw new Error(
    "Terminal migration override should require --force-reopen-terminal."
  );
}
if (
  !adapterPresenceTerminalBlocked.stderr.includes(
    "Terminal runs stay closed on default resume"
  )
) {
  throw new Error(
    "Terminal migration rejection did not explain the force-reopen requirement."
  );
}

console.log("[validate-resume-smoke] allow adapter presence migration override with explicit terminal reopen");
const adapterPresenceMigrated = await runLoop([
  "--resume-run",
  noAdapterRunDirectory,
  "--adapter",
  "./.tmp/semantic-validation/patch-only-success/adapter.json",
  "--evaluator-profile",
  "./.tmp/semantic-validation/verification-profile-api-only.json",
  "--allow-resume-migration",
  "--force-reopen-terminal",
  "--max-rounds",
  "3"
]);
if (adapterPresenceMigrated.code !== 0) {
  throw new Error("Adapter presence migration override run failed.");
}

const adapterPresenceSummary = await readSummary(noAdapterRunDirectory);
assertTargetFamily(adapterPresenceSummary, "api-service");
assertValidationLane(adapterPresenceSummary, "deterministic_semantic");
if (!adapterPresenceSummary.bundle_migrated || !adapterPresenceSummary.resume_migration_path) {
  throw new Error("Expected adapter presence migration metadata to be recorded.");
}
assertRuntimeEventCode(adapterPresenceSummary, "resume.migration_override");
assertRuntimeEventCode(adapterPresenceSummary, "resume.reopened_terminal");
assertRuntimeEventCodeMissing(adapterPresenceSummary, "resume.noop_terminal");
assertRoundBundleSemantics(
  adapterPresenceSummary.round_history?.[0],
  "generic-core",
  "deterministic_semantic"
);
assertRoundBundleSemantics(
  adapterPresenceSummary.round_history?.[1],
  "api-service",
  "deterministic_semantic"
);
await assertControllerDecisionBundleSemantics(
  adapterPresenceSummary.round_history?.[1],
  "api-service",
  "deterministic_semantic",
  "adapter presence migration controller decision"
);
assertRoundStopReason(
  adapterPresenceSummary.round_history?.[1],
  "target_reached",
  "adapter presence migration terminal round"
);
assertRuntimeWarningMissing(
  adapterPresenceSummary,
  "Resume returned without opening a new round."
);
assertRoundStopReason(
  adapterPresenceSummary.round_history?.[0],
  "contract_completed",
  "adapter presence migration seed round"
);
const adapterPresenceDecision = await readResumeDecisionArtifact(
  adapterPresenceSummary
);
if (adapterPresenceDecision.decision !== "reopened_terminal") {
  throw new Error(
    `Expected adapter presence migration decision 'reopened_terminal', received '${adapterPresenceDecision.decision}'.`
  );
}

console.log("[validate-resume-smoke] force reopen terminal run when explicitly requested");
const forcedTerminalSeed = await runLoop(["--single"]);
if (forcedTerminalSeed.code !== 0) {
  throw new Error("Forced terminal reopen seed run failed.");
}
const forcedTerminalRunDirectory = extractRunDirectory(forcedTerminalSeed.stdout);
const forcedTerminalSeedSummary = await readSummary(forcedTerminalRunDirectory);
assertRoundCount(forcedTerminalSeedSummary, 1);
assertStopReason(forcedTerminalSeedSummary, "contract_completed");
const forcedTerminalResume = await runLoop([
  "--resume-run",
  forcedTerminalRunDirectory,
  "--force-reopen-terminal",
  "--max-rounds",
  "3"
]);
if (forcedTerminalResume.code !== 0) {
  throw new Error("Forced terminal reopen run failed.");
}
const forcedTerminalSummary = await readSummary(forcedTerminalRunDirectory);
if ((forcedTerminalSummary.round_count ?? 0) < 2) {
  throw new Error("Expected --force-reopen-terminal to add a new round.");
}
assertRuntimeEventCode(forcedTerminalSummary, "resume.reopened_terminal");
assertRuntimeEventCodeMissing(forcedTerminalSummary, "resume.noop_terminal");
const forcedTerminalDecision = await readResumeDecisionArtifact(forcedTerminalSummary);
if (forcedTerminalDecision.decision !== "reopened_terminal") {
  throw new Error(
    `Expected forced terminal decision 'reopened_terminal', received '${forcedTerminalDecision.decision}'.`
  );
}

console.log("[validate-resume-smoke] resume weighted-policy recontract continuity");
const policySeedResult = await runLoop([
  "--single",
  "--adapter",
  "./.tmp/semantic-validation/contradictory/adapter.json",
  "--target-family",
  "api-service"
]);
if (policySeedResult.code !== 0) {
  throw new Error("Weighted-policy recontract seed run failed.");
}
const policyRunDirectory = extractRunDirectory(policySeedResult.stdout);
const policyResumeResult = await runLoop([
  "--resume-run",
  policyRunDirectory,
  "--max-rounds",
  "4"
]);
if (policyResumeResult.code !== 0) {
  throw new Error("Weighted-policy recontract resume run failed.");
}
const policySummary = await readSummary(policyRunDirectory);
assertRuntimeEventCode(policySummary, "resume.continued");
if ((policySummary.round_count ?? 0) < 3) {
  throw new Error(
    `Expected weighted-policy resume run to record at least three rounds, received '${policySummary.round_count ?? "missing"}'.`
  );
}
assertDecisionSource(
  policySummary.round_history?.[1],
  "policy_snapshot",
  "weighted-policy patch-only continuation source"
);
const weightedRecontractRound = policySummary.round_history?.find(
  (roundSummary) =>
    roundSummary?.decision_source === "trajectory_policy" &&
    roundSummary.negotiation_mode === "recontract"
);
if (!weightedRecontractRound) {
  throw new Error(
    "Expected weighted-policy resume run to record a trajectory-driven recontract decision."
  );
}
if (weightedRecontractRound.negotiation_mode !== "recontract") {
  throw new Error(
    `Expected weighted-policy recontract round to negotiate as 'recontract', received '${weightedRecontractRound.negotiation_mode ?? "missing"}'.`
  );
}
await assertFailurePolicySnapshot(policySummary.round_history?.[0], {
  expectedAction: "patch_only",
  expectedDominantTrigger: "patch_entropy_spike",
  expectedPatchAuthorityState: "strained",
  expectedRecommendationSource: "weighted_policy",
  label: "weighted-policy seed snapshot"
});
await assertFailurePolicySnapshot(weightedRecontractRound, {
  expectedAction: "recontract",
  expectedDominantTrigger: "plateau_without_progress",
  expectedPatchAuthorityState: "collapsed",
  expectedRecommendationSource: "weighted_policy",
  expectedTriggerCodes: [
    "plateau_without_progress",
    "stable_patch_authority"
  ],
  label: "weighted-policy recontract snapshot"
});
await assertTrajectoryDecisionSurface(
  policySummary.round_history?.[(weightedRecontractRound.round ?? 1) - 2],
  {
    expectedMode: "parallel_pivot",
    label: "weighted-policy recontract trajectory"
  }
);
const weightedRecontractSnapshot = await readJsonFile(
  weightedRecontractRound.failure_lineage_path
);
if (!weightedRecontractSnapshot.policy_snapshot?.plateau_limit_reached) {
  throw new Error(
    "Expected weighted-policy recontract snapshot to record plateau_limit_reached."
  );
}
const resumedRoundSummaries =
  policySummary.round_history?.filter((roundSummary) => roundSummary.round >= 2) ?? [];
const [seedLineage, ...resumedLineages] = await Promise.all([
  readJsonFile(policySummary.round_history?.[0]?.failure_lineage_path),
  ...resumedRoundSummaries.map((roundSummary) =>
    readJsonFile(roundSummary.failure_lineage_path)
  )
]);
if (
  !seedLineage.policy_snapshot ||
  resumedLineages.some((lineage) => !lineage.policy_snapshot)
) {
  throw new Error(
    "Expected weighted-policy recontract resume to preserve policy snapshots across seed and resumed rounds."
  );
}
const weightedPolicyDecision = await readResumeDecisionArtifact(policySummary);
if (weightedPolicyDecision.decision !== "continue") {
  throw new Error(
    `Expected weighted-policy resume decision 'continue', received '${weightedPolicyDecision.decision}'.`
  );
}

console.log("[validate-resume-smoke] complete");
