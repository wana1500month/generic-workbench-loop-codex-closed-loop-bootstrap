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
  "editor-shell-renders",
  "editor-invalid-flow-rejected",
  "editor-undo-preserved",
  "editor-selection-persists",
  "editor-redo-preserved",
  "editor-autosave-persisted",
  "editor-invalid-selection-blocked",
  "editor-autosave-restore-after-refresh",
  "editor-selection-recovers"
];
const expectedCriterionIds = [
  "editor_shell_renders",
  "invalid_editor_flow_rejected",
  "undo_redo_available",
  "selection_state_persisted",
  "redo_state_available",
  "autosave_persisted",
  "invalid_selection_blocked",
  "autosave_restore_after_refresh",
  "selection_recovery_after_invalid_mutation"
];

console.log("[validate-family-editor] editor environment lane");
const result = await runLoop([
  "--adapter",
  "./.tmp/semantic-validation/editor-success/adapter.json",
  "--target-family",
  "browser-editor",
  "--max-rounds",
  "1"
]);
if (result.code !== 0) {
  throw new Error("Editor family validation run failed.");
}

const runDirectory = extractRunDirectory(result.stdout);
const summary = await readSummary(runDirectory);
assertTargetFamily(summary, "browser-editor");
assertValidationLane(summary, "environment_integration");
assertRuntimeWarningContains(summary, "depends on the local environment");
const latest = latestRoundSummary(summary);
await assertControllerDecisionBundleSemantics(
  latest,
  "browser-editor",
  "environment_integration",
  "editor environment controller decision"
);
await assertEvalReportCoverage(latest, {
  expectedProbeIds,
  expectedCriterionIds,
  label: "editor environment eval report"
});

if (summary.stop_reason !== "target_reached") {
  if (requireTargetReached) {
    throw new Error(
      `Editor environment lane expected stop_reason 'target_reached' in positive realism mode, received '${summary.stop_reason ?? "none"}'.`
    );
  }
  if (summary.stop_reason !== "environment_blocked") {
    throw new Error(
      `Expected editor environment lane to either reach target or stop as environment_blocked, received '${summary.stop_reason ?? "none"}'.`
    );
  }
  assertRoundStopReason(latest, "environment_blocked", "editor environment round");
  await assertEnvironmentBlockedRound(latest, "editor environment blocked round");
  await assertFailurePolicyRecommendation(
    latest,
    "stop",
    "editor environment blocked policy"
  );
} else {
  assertRoundStopReason(latest, "target_reached", "editor environment round");
  await assertSuccessfulRoundHasNoFailureClassification(
    latest,
    "editor environment success round"
  );
}

console.log("[validate-family-editor] complete");
