import {
  assertControllerDecisionBundleSemantics,
  assertEvalReportCoverage,
  assertEnvironmentBlockedRound,
  assertFailurePolicyRecommendation,
  assertPatchOnlyArtifactSurface,
  assertRecontractArtifactSurface,
  assertRoundCount,
  assertSuccessfulRoundHasNoFailureClassification,
  assertStopReason,
  assertTargetFamily,
  assertValidationLane,
  extractRunDirectory,
  readSummary,
  runLoop
} from "./validation-utils.mjs";

const profilePath =
  "./.tmp/semantic-validation/verification-profile-editor-semantic.json";
const expectedProbeIds = [
  "editor-semantic-shell",
  "editor-semantic-invalid-flow",
  "editor-semantic-undo",
  "editor-semantic-selection",
  "editor-semantic-redo",
  "editor-semantic-autosave",
  "editor-semantic-invalid-selection",
  "editor-semantic-restore",
  "editor-semantic-selection-recovery"
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

const cases = [
  {
    label: "editor-success",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/editor-success/adapter.json",
      "--evaluator-profile",
      profilePath,
      "--max-rounds",
      "1"
    ],
    stopReason: "target_reached",
    roundCount: 1
  },
  {
    label: "editor-patch-only",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/editor-patch-only/adapter.json",
      "--evaluator-profile",
      profilePath,
      "--max-rounds",
      "3"
    ],
    stopReason: "target_reached",
    roundCount: 2
  },
  {
    label: "editor-recontract",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/editor-recontract/adapter.json",
      "--evaluator-profile",
      profilePath,
      "--max-rounds",
      "3"
    ],
    stopReason: "target_reached",
    roundCount: 3
  },
  {
    label: "editor-environment-blocked",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/editor-blocked/adapter.json",
      "--evaluator-profile",
      profilePath,
      "--max-rounds",
      "3"
    ],
    stopReason: "environment_blocked",
    roundCount: 1
  },
  {
    label: "editor-hard-failure",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/no-profile/adapter.json",
      "--evaluator-profile",
      profilePath,
      "--max-rounds",
      "1"
    ],
    stopReason: "adapter_contract_invalid",
    roundCount: 1
  }
];

for (const testCase of cases) {
  console.log(`\n[validate-family-editor-semantic] ${testCase.label}`);
  const result = await runLoop(testCase.args);
  if (result.code !== 0) {
    throw new Error(`Loop command failed for '${testCase.label}'.`);
  }
  const runDirectory = extractRunDirectory(result.stdout);
  const summary = await readSummary(runDirectory);
  assertTargetFamily(summary, "browser-editor");
  assertValidationLane(summary, "deterministic_semantic");
  assertStopReason(summary, testCase.stopReason);
  assertRoundCount(summary, testCase.roundCount);
  const latestRound = summary.round_history?.[summary.round_history.length - 1];
  await assertControllerDecisionBundleSemantics(
    latestRound,
    "browser-editor",
    "deterministic_semantic",
    `editor controller decision (${testCase.label})`
  );
  if (testCase.stopReason === "target_reached") {
    await assertEvalReportCoverage(latestRound, {
      expectedProbeIds,
      expectedCriterionIds,
      label: `editor semantic eval report (${testCase.label})`
    });
    await assertSuccessfulRoundHasNoFailureClassification(
      latestRound,
      `editor success round (${testCase.label})`
    );
  }
  if (testCase.stopReason === "environment_blocked") {
    await assertEnvironmentBlockedRound(
      latestRound,
      `editor blocked round (${testCase.label})`
    );
    await assertFailurePolicyRecommendation(
      latestRound,
      "stop",
      "editor blocked policy"
    );
  }
  if (testCase.label === "editor-patch-only") {
    await assertFailurePolicyRecommendation(
      summary.round_history?.[0],
      "patch_only",
      "editor semantic patch-only policy"
    );
    await assertPatchOnlyArtifactSurface(
      latestRound,
      "editor semantic patch-only remediation round"
    );
  }
  if (testCase.label === "editor-recontract") {
    await assertFailurePolicyRecommendation(
      summary.round_history?.[1],
      "recontract",
      "editor semantic recontract policy"
    );
    await assertPatchOnlyArtifactSurface(
      summary.round_history?.[1],
      "editor semantic patch-only carry-forward round"
    );
    await assertRecontractArtifactSurface(
      latestRound,
      "editor semantic recontract round"
    );
  }
}

console.log("\n[validate-family-editor-semantic] complete");
