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
  "./.tmp/semantic-validation/verification-profile-dashboard-semantic.json";
const expectedProbeIds = [
  "dashboard-semantic-shell",
  "dashboard-semantic-metrics",
  "dashboard-semantic-invalid-filter",
  "dashboard-semantic-time-range",
  "dashboard-semantic-filter",
  "dashboard-semantic-aggregation",
  "dashboard-semantic-drilldown",
  "dashboard-semantic-filter-reset",
  "dashboard-semantic-drilldown-refresh"
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

const cases = [
  {
    label: "dashboard-success",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/dashboard-success/adapter.json",
      "--evaluator-profile",
      profilePath,
      "--max-rounds",
      "1"
    ],
    stopReason: "target_reached",
    roundCount: 1
  },
  {
    label: "dashboard-patch-only",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/dashboard-patch-only/adapter.json",
      "--evaluator-profile",
      profilePath,
      "--max-rounds",
      "3"
    ],
    stopReason: "target_reached",
    roundCount: 2
  },
  {
    label: "dashboard-recontract",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/dashboard-recontract/adapter.json",
      "--evaluator-profile",
      profilePath,
      "--max-rounds",
      "3"
    ],
    stopReason: "target_reached",
    roundCount: 3
  },
  {
    label: "dashboard-environment-blocked",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/dashboard-blocked/adapter.json",
      "--evaluator-profile",
      profilePath,
      "--max-rounds",
      "3"
    ],
    stopReason: "environment_blocked",
    roundCount: 1
  },
  {
    label: "dashboard-hard-failure",
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
  console.log(`\n[validate-family-dashboard-semantic] ${testCase.label}`);
  const result = await runLoop(testCase.args);
  if (result.code !== 0) {
    throw new Error(`Loop command failed for '${testCase.label}'.`);
  }
  const runDirectory = extractRunDirectory(result.stdout);
  const summary = await readSummary(runDirectory);
  assertTargetFamily(summary, "dashboard");
  assertValidationLane(summary, "deterministic_semantic");
  assertStopReason(summary, testCase.stopReason);
  assertRoundCount(summary, testCase.roundCount);
  const latestRound = summary.round_history?.[summary.round_history.length - 1];
  await assertControllerDecisionBundleSemantics(
    latestRound,
    "dashboard",
    "deterministic_semantic",
    `dashboard controller decision (${testCase.label})`
  );
  if (testCase.stopReason === "target_reached") {
    await assertEvalReportCoverage(latestRound, {
      expectedProbeIds,
      expectedCriterionIds,
      label: `dashboard semantic eval report (${testCase.label})`
    });
    await assertSuccessfulRoundHasNoFailureClassification(
      latestRound,
      `dashboard success round (${testCase.label})`
    );
  }
  if (testCase.stopReason === "environment_blocked") {
    await assertEnvironmentBlockedRound(
      latestRound,
      `dashboard blocked round (${testCase.label})`
    );
    await assertFailurePolicyRecommendation(
      latestRound,
      "stop",
      "dashboard blocked policy"
    );
  }
  if (testCase.label === "dashboard-patch-only") {
    await assertFailurePolicyRecommendation(
      summary.round_history?.[0],
      "patch_only",
      "dashboard semantic patch-only policy"
    );
    await assertPatchOnlyArtifactSurface(
      latestRound,
      "dashboard semantic patch-only remediation round"
    );
  }
  if (testCase.label === "dashboard-recontract") {
    await assertFailurePolicyRecommendation(
      summary.round_history?.[1],
      "recontract",
      "dashboard semantic recontract policy"
    );
    await assertPatchOnlyArtifactSurface(
      summary.round_history?.[1],
      "dashboard semantic patch-only carry-forward round"
    );
    await assertRecontractArtifactSurface(
      latestRound,
      "dashboard semantic recontract round"
    );
  }
}

console.log("\n[validate-family-dashboard-semantic] complete");
