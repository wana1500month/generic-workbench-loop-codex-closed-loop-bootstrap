import {
  assertControllerDecisionBundleSemantics,
  assertEvalReportCoverage,
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

const expectedProbeIds = [
  "item-persists",
  "invalid-item-rejected",
  "item-summary-consistent",
  "idempotent-write-safe",
  "stale-write-rejected",
  "pagination-consistent"
];
const expectedCriterionIds = [
  "item_persists",
  "invalid_item_rejected",
  "collection_consistent",
  "idempotent_write_safe",
  "stale_write_rejected",
  "pagination_consistent"
];

const cases = [
  {
    label: "patch-only-success",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/patch-only-success/adapter.json",
      "--target-family",
      "api-service",
      "--max-rounds",
      "3"
    ],
    stopReason: "target_reached",
    roundCount: 2
  },
  {
    label: "patch-recontract",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/patch-recontract/adapter.json",
      "--target-family",
      "api-service",
      "--max-rounds",
      "3"
    ],
    stopReason: "target_reached",
    roundCount: 3
  },
  {
    label: "api-only-witness",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/api-only-witness/adapter.json",
      "--target-family",
      "api-service",
      "--max-rounds",
      "1"
    ],
    stopReason: "target_reached",
    roundCount: 1
  }
];

for (const testCase of cases) {
  console.log(`\n[validate-lifecycle-api] ${testCase.label}`);
  const result = await runLoop(testCase.args);
  if (result.code !== 0) {
    throw new Error(`Loop command failed for '${testCase.label}'.`);
  }
  const runDirectory = extractRunDirectory(result.stdout);
  const summary = await readSummary(runDirectory);
  assertTargetFamily(summary, "api-service");
  assertValidationLane(summary, "deterministic_semantic");
  assertStopReason(summary, testCase.stopReason);
  assertRoundCount(summary, testCase.roundCount);
  const latestRound = summary.round_history?.[summary.round_history.length - 1];
  await assertControllerDecisionBundleSemantics(
    latestRound,
    "api-service",
    "deterministic_semantic",
    `api controller decision (${testCase.label})`
  );
  await assertEvalReportCoverage(latestRound, {
    expectedProbeIds,
    expectedCriterionIds,
    label: `api eval report (${testCase.label})`
  });
  await assertSuccessfulRoundHasNoFailureClassification(
    latestRound,
    `api success round (${testCase.label})`
  );
  if (testCase.label === "patch-only-success") {
    await assertFailurePolicyRecommendation(
      summary.round_history?.[0],
      "patch_only",
      "api patch-only policy"
    );
    await assertPatchOnlyArtifactSurface(
      latestRound,
      "api patch-only remediation round"
    );
  }
  if (testCase.label === "patch-recontract") {
    await assertFailurePolicyRecommendation(
      summary.round_history?.[1],
      "recontract",
      "api recontract policy"
    );
    await assertPatchOnlyArtifactSurface(
      summary.round_history?.[1],
      "api patch-only carry-forward round"
    );
    await assertRecontractArtifactSurface(
      latestRound,
      "api recontract round"
    );
  }
}

console.log("\n[validate-lifecycle-api] complete");
