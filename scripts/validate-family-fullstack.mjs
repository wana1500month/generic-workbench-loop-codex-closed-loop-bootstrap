import {
  assertControllerDecisionBundleSemantics,
  assertEvalReportCoverage,
  assertEnvironmentBlockedRound,
  assertFailurePolicyRecommendation,
  assertRoundStopReason,
  assertSuccessfulRoundHasNoFailureClassification,
  assertTargetFamily,
  assertRuntimeWarningContains,
  assertValidationLane,
  extractRunDirectory,
  latestRoundSummary,
  readSummary,
  runLoop
} from "./validation-utils.mjs";

const requireTargetReached = process.argv.includes("--require-target-reached");

const expectedProbeIds = [
  "app-shell-renders",
  "item-persists",
  "invalid-item-rejected",
  "session-state-persists",
  "browser-api-roundtrip-consistent",
  "refresh-state-persisted",
  "mutation-audit-recorded",
  "retry-recovery-persisted",
  "audit-refresh-consistent"
];
const expectedCriterionIds = [
  "ui_shell_renders",
  "item_persists",
  "invalid_item_rejected",
  "session_state_persists",
  "browser_api_roundtrip_consistent",
  "refresh_state_persisted",
  "mutation_audit_recorded",
  "retry_recovery_persisted",
  "audit_refresh_consistent"
];

console.log("[validate-family-fullstack] fullstack environment lane");
const result = await runLoop([
  "--adapter",
  "./.tmp/semantic-validation/fullstack-success/adapter.json",
  "--target-family",
  "fullstack-app",
  "--max-rounds",
  "1"
]);
if (result.code !== 0) {
  throw new Error("Fullstack family validation run failed.");
}

const runDirectory = extractRunDirectory(result.stdout);
const summary = await readSummary(runDirectory);
assertTargetFamily(summary, "fullstack-app");
assertValidationLane(summary, "environment_integration");
assertRuntimeWarningContains(summary, "depends on the local environment");
const latest = latestRoundSummary(summary);
await assertControllerDecisionBundleSemantics(
  latest,
  "fullstack-app",
  "environment_integration",
  "fullstack environment controller decision"
);
await assertEvalReportCoverage(latest, {
  expectedProbeIds,
  expectedCriterionIds,
  label: "fullstack environment eval report"
});

if (summary.stop_reason !== "target_reached") {
  if (requireTargetReached) {
    throw new Error(
      `Fullstack environment lane expected stop_reason 'target_reached' in positive realism mode, received '${summary.stop_reason ?? "none"}'.`
    );
  }
  if (summary.stop_reason !== "environment_blocked") {
    throw new Error(
      `Expected fullstack environment lane to either reach target or stop as environment_blocked, received '${summary.stop_reason ?? "none"}'.`
    );
  }
  await assertEnvironmentBlockedRound(latest, "fullstack environment blocked round");
  assertRoundStopReason(latest, "environment_blocked", "fullstack environment round");
  await assertFailurePolicyRecommendation(
    latest,
    "stop",
    "fullstack environment blocked policy"
  );
} else {
  assertRoundStopReason(latest, "target_reached", "fullstack environment round");
  await assertSuccessfulRoundHasNoFailureClassification(
    latest,
    "fullstack environment success round"
  );
}

console.log("[validate-family-fullstack] complete");
