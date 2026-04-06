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
  "crud-item-persists",
  "crud-invalid-item-rejected",
  "crud-item-summary-consistent",
  "crud-idempotent-write-safe",
  "crud-stale-write-rejected",
  "crud-pagination-consistent"
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
    label: "crud-success",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/api-only-witness/adapter.json",
      "--target-family",
      "crud-api",
      "--max-rounds",
      "1"
    ],
    stopReason: "target_reached",
    roundCount: 1
  },
  {
    label: "crud-patch-only",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/patch-only-success/adapter.json",
      "--target-family",
      "crud-api",
      "--max-rounds",
      "3"
    ],
    stopReason: "target_reached",
    roundCount: 2
  },
  {
    label: "crud-recontract",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/patch-recontract/adapter.json",
      "--target-family",
      "crud-api",
      "--max-rounds",
      "3"
    ],
    stopReason: "target_reached",
    roundCount: 3
  },
  {
    label: "crud-hard-failure",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/no-profile/adapter.json",
      "--target-family",
      "crud-api",
      "--max-rounds",
      "1"
    ],
    stopReason: "adapter_contract_invalid",
    roundCount: 1
  }
];

for (const testCase of cases) {
  console.log(`\n[validate-family-crud] ${testCase.label}`);
  const result = await runLoop(testCase.args);
  if (result.code !== 0) {
    throw new Error(`Loop command failed for '${testCase.label}'.`);
  }
  const runDirectory = extractRunDirectory(result.stdout);
  const summary = await readSummary(runDirectory);
  assertTargetFamily(summary, "crud-api");
  assertValidationLane(summary, "deterministic_semantic");
  assertStopReason(summary, testCase.stopReason);
  assertRoundCount(summary, testCase.roundCount);
  const latestRound = summary.round_history?.[summary.round_history.length - 1];
  await assertControllerDecisionBundleSemantics(
    latestRound,
    "crud-api",
    "deterministic_semantic",
    `crud controller decision (${testCase.label})`
  );
  if (testCase.stopReason === "target_reached") {
    await assertEvalReportCoverage(latestRound, {
      expectedProbeIds,
      expectedCriterionIds,
      label: `crud eval report (${testCase.label})`
    });
    await assertSuccessfulRoundHasNoFailureClassification(
      latestRound,
      `crud success round (${testCase.label})`
    );
  }
  if (testCase.label === "crud-patch-only") {
    await assertFailurePolicyRecommendation(
      summary.round_history?.[0],
      "patch_only",
      "crud patch-only policy"
    );
    await assertPatchOnlyArtifactSurface(
      latestRound,
      "crud patch-only remediation round"
    );
  }
  if (testCase.label === "crud-recontract") {
    await assertFailurePolicyRecommendation(
      summary.round_history?.[1],
      "recontract",
      "crud recontract policy"
    );
    await assertPatchOnlyArtifactSurface(
      summary.round_history?.[1],
      "crud patch-only carry-forward round"
    );
    await assertRecontractArtifactSurface(
      latestRound,
      "crud recontract round"
    );
  }
}

console.log("\n[validate-family-crud] complete");
