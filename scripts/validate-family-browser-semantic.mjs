import {
  assertControllerDecisionBundleSemantics,
  assertEvalReportCoverage,
  assertFailurePolicyRecommendation,
  assertPatchOnlyArtifactSurface,
  assertRecontractArtifactSurface,
  assertRoundCount,
  assertStopReason,
  assertSuccessfulRoundHasNoFailureClassification,
  assertTargetFamily,
  assertValidationLane,
  extractRunDirectory,
  readSummary,
  runLoop
} from "./validation-utils.mjs";

const profilePath =
  "./.tmp/semantic-validation/verification-profile-browser-semantic.json";
const expectedProbeIds = [
  "browser-semantic-shell",
  "browser-semantic-invalid-flow",
  "browser-semantic-draft",
  "browser-semantic-navigation",
  "browser-semantic-refresh",
  "browser-semantic-submit",
  "browser-semantic-draft-restore"
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

const cases = [
  {
    label: "browser-success",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/browser-success/adapter.json",
      "--evaluator-profile",
      profilePath,
      "--max-rounds",
      "1"
    ],
    stopReason: "target_reached",
    roundCount: 1
  },
  {
    label: "browser-patch-only",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/browser-patch-only/adapter.json",
      "--evaluator-profile",
      profilePath,
      "--max-rounds",
      "3"
    ],
    stopReason: "target_reached",
    roundCount: 2
  },
  {
    label: "browser-recontract",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/browser-recontract/adapter.json",
      "--evaluator-profile",
      profilePath,
      "--max-rounds",
      "3"
    ],
    stopReason: "target_reached",
    roundCount: 3
  },
  {
    label: "browser-hard-failure",
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
  console.log(`\n[validate-family-browser-semantic] ${testCase.label}`);
  const result = await runLoop(testCase.args);
  if (result.code !== 0) {
    throw new Error(`Loop command failed for '${testCase.label}'.`);
  }
  const runDirectory = extractRunDirectory(result.stdout);
  const summary = await readSummary(runDirectory);
  assertTargetFamily(summary, "browser-app");
  assertValidationLane(summary, "deterministic_semantic");
  assertStopReason(summary, testCase.stopReason);
  assertRoundCount(summary, testCase.roundCount);
  const latestRound = summary.round_history?.[summary.round_history.length - 1];
  await assertControllerDecisionBundleSemantics(
    latestRound,
    "browser-app",
    "deterministic_semantic",
    `browser semantic controller decision (${testCase.label})`
  );
  if (testCase.stopReason === "target_reached") {
    await assertEvalReportCoverage(latestRound, {
      expectedProbeIds,
      expectedCriterionIds,
      label: `browser semantic eval report (${testCase.label})`
    });
    await assertSuccessfulRoundHasNoFailureClassification(
      latestRound,
      `browser semantic success round (${testCase.label})`
    );
  }
  if (testCase.label === "browser-patch-only") {
    await assertFailurePolicyRecommendation(
      summary.round_history?.[0],
      "patch_only",
      "browser semantic patch-only policy"
    );
    await assertPatchOnlyArtifactSurface(
      latestRound,
      "browser semantic patch-only remediation round"
    );
  }
  if (testCase.label === "browser-recontract") {
    await assertFailurePolicyRecommendation(
      summary.round_history?.[1],
      "recontract",
      "browser semantic recontract policy"
    );
    await assertPatchOnlyArtifactSurface(
      summary.round_history?.[1],
      "browser semantic patch-only carry-forward round"
    );
    await assertRecontractArtifactSurface(
      latestRound,
      "browser semantic recontract round"
    );
  }
}

console.log("\n[validate-family-browser-semantic] complete");
