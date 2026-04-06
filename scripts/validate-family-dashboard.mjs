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
  "dashboard-shell-renders",
  "dashboard-metrics-consistent",
  "dashboard-invalid-filter-rejected",
  "dashboard-time-range-consistent",
  "dashboard-filter-state-persists",
  "dashboard-aggregation-correct",
  "dashboard-drilldown-continuity",
  "dashboard-filter-reset-restored",
  "dashboard-drilldown-refresh-preserved"
];
const expectedCriterionIds = [
  "dashboard_shell_renders",
  "metrics_consistent",
  "invalid_filter_rejected",
  "time_range_consistent",
  "filter_state_persisted",
  "aggregation_correct",
  "drilldown_continuity",
  "filter_reset_restored",
  "drilldown_refresh_preserved"
];

console.log("[validate-family-dashboard] dashboard environment lane");
const result = await runLoop([
  "--adapter",
  "./.tmp/semantic-validation/dashboard-success/adapter.json",
  "--target-family",
  "dashboard",
  "--max-rounds",
  "1"
]);
if (result.code !== 0) {
  throw new Error("Dashboard family validation run failed.");
}

const runDirectory = extractRunDirectory(result.stdout);
const summary = await readSummary(runDirectory);
assertTargetFamily(summary, "dashboard");
assertValidationLane(summary, "environment_integration");
assertRuntimeWarningContains(summary, "depends on the local environment");
const latest = latestRoundSummary(summary);
await assertControllerDecisionBundleSemantics(
  latest,
  "dashboard",
  "environment_integration",
  "dashboard environment controller decision"
);
await assertEvalReportCoverage(latest, {
  expectedProbeIds,
  expectedCriterionIds,
  label: "dashboard environment eval report"
});

if (summary.stop_reason !== "target_reached") {
  if (requireTargetReached) {
    throw new Error(
      `Dashboard environment lane expected stop_reason 'target_reached' in positive realism mode, received '${summary.stop_reason ?? "none"}'.`
    );
  }
  if (summary.stop_reason !== "environment_blocked") {
    throw new Error(
      `Expected dashboard environment lane to either reach target or stop as environment_blocked, received '${summary.stop_reason ?? "none"}'.`
    );
  }
  assertRoundStopReason(latest, "environment_blocked", "dashboard environment round");
  await assertEnvironmentBlockedRound(latest, "dashboard environment blocked round");
  await assertFailurePolicyRecommendation(
    latest,
    "stop",
    "dashboard environment blocked policy"
  );
} else {
  assertRoundStopReason(latest, "target_reached", "dashboard environment round");
  await assertSuccessfulRoundHasNoFailureClassification(
    latest,
    "dashboard environment success round"
  );
}

console.log("[validate-family-dashboard] complete");
