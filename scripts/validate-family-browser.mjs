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
  "target-app-browser",
  "target-invalid-browser-flow",
  "target-draft-persistence",
  "target-navigation-state",
  "refresh-state-persisted",
  "submission-roundtrip-consistent",
  "draft-restore-after-refresh"
];
const expectedCriterionIds = [
  "ui_shell_renders",
  "invalid_form_rejected",
  "draft_persists",
  "navigation_state_preserved",
  "refresh_state_persisted",
  "submission_roundtrip_consistent",
  "draft_restore_after_refresh"
];

console.log("[validate-family-browser] browser environment lane");
const result = await runLoop([
  "--adapter",
  "./.tmp/semantic-validation/browser-success/adapter.json",
  "--evaluator-profile",
  "./.tmp/semantic-validation/verification-profile-browser.json",
  "--max-rounds",
  "1"
]);
if (result.code !== 0) {
  throw new Error("Browser family validation run failed.");
}

const runDirectory = extractRunDirectory(result.stdout);
const summary = await readSummary(runDirectory);
assertTargetFamily(summary, "browser-app");
assertValidationLane(summary, "environment_integration");
assertRuntimeWarningContains(summary, "depends on the local environment");
const latest = latestRoundSummary(summary);
await assertControllerDecisionBundleSemantics(
  latest,
  "browser-app",
  "environment_integration",
  "browser environment controller decision"
);
await assertEvalReportCoverage(latest, {
  expectedProbeIds,
  expectedCriterionIds,
  label: "browser environment eval report"
});

if (summary.stop_reason !== "target_reached") {
  if (requireTargetReached) {
    throw new Error(
      `Browser environment lane expected stop_reason 'target_reached' in positive realism mode, received '${summary.stop_reason ?? "none"}'.`
    );
  }
  if (summary.stop_reason !== "environment_blocked") {
    throw new Error(
      `Expected browser environment lane to either reach target or stop as environment_blocked, received '${summary.stop_reason ?? "none"}'.`
    );
  }
  await assertEnvironmentBlockedRound(latest, "browser environment blocked round");
  assertRoundStopReason(latest, "environment_blocked", "browser environment round");
  await assertFailurePolicyRecommendation(
    latest,
    "stop",
    "browser environment blocked policy"
  );
} else {
  assertRoundStopReason(latest, "target_reached", "browser environment round");
  await assertSuccessfulRoundHasNoFailureClassification(
    latest,
    "browser environment success round"
  );
}

console.log("[validate-family-browser] complete");
