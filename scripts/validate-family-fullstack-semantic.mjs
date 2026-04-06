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
  "./.tmp/semantic-validation/verification-profile-fullstack-semantic.json";
const expectedProbeIds = [
  "fullstack-semantic-shell",
  "fullstack-semantic-item",
  "fullstack-semantic-invalid-item",
  "fullstack-semantic-session",
  "fullstack-semantic-roundtrip",
  "fullstack-semantic-refresh",
  "fullstack-semantic-audit",
  "fullstack-semantic-retry",
  "fullstack-semantic-audit-refresh"
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

const cases = [
  {
    label: "fullstack-success",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/fullstack-success/adapter.json",
      "--evaluator-profile",
      profilePath,
      "--max-rounds",
      "1"
    ],
    stopReason: "target_reached",
    roundCount: 1
  },
  {
    label: "fullstack-patch-only",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/fullstack-patch-only/adapter.json",
      "--evaluator-profile",
      profilePath,
      "--max-rounds",
      "3"
    ],
    stopReason: "target_reached",
    roundCount: 2
  },
  {
    label: "fullstack-recontract",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/fullstack-recontract/adapter.json",
      "--evaluator-profile",
      profilePath,
      "--max-rounds",
      "3"
    ],
    stopReason: "target_reached",
    roundCount: 3
  },
  {
    label: "fullstack-hard-failure",
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
  console.log(`\n[validate-family-fullstack-semantic] ${testCase.label}`);
  const result = await runLoop(testCase.args);
  if (result.code !== 0) {
    throw new Error(`Loop command failed for '${testCase.label}'.`);
  }
  const runDirectory = extractRunDirectory(result.stdout);
  const summary = await readSummary(runDirectory);
  assertTargetFamily(summary, "fullstack-app");
  assertValidationLane(summary, "deterministic_semantic");
  assertStopReason(summary, testCase.stopReason);
  assertRoundCount(summary, testCase.roundCount);
  const latestRound = summary.round_history?.[summary.round_history.length - 1];
  await assertControllerDecisionBundleSemantics(
    latestRound,
    "fullstack-app",
    "deterministic_semantic",
    `fullstack semantic controller decision (${testCase.label})`
  );
  if (testCase.stopReason === "target_reached") {
    await assertEvalReportCoverage(latestRound, {
      expectedProbeIds,
      expectedCriterionIds,
      label: `fullstack semantic eval report (${testCase.label})`
    });
    await assertSuccessfulRoundHasNoFailureClassification(
      latestRound,
      `fullstack semantic success round (${testCase.label})`
    );
  }
  if (testCase.label === "fullstack-patch-only") {
    await assertFailurePolicyRecommendation(
      summary.round_history?.[0],
      "patch_only",
      "fullstack semantic patch-only policy"
    );
    await assertPatchOnlyArtifactSurface(
      latestRound,
      "fullstack semantic patch-only remediation round"
    );
  }
  if (testCase.label === "fullstack-recontract") {
    await assertFailurePolicyRecommendation(
      summary.round_history?.[1],
      "recontract",
      "fullstack semantic recontract policy"
    );
    await assertPatchOnlyArtifactSurface(
      summary.round_history?.[1],
      "fullstack semantic patch-only carry-forward round"
    );
    await assertRecontractArtifactSurface(
      latestRound,
      "fullstack semantic recontract round"
    );
  }
}

console.log("\n[validate-family-fullstack-semantic] complete");
