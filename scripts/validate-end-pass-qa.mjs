import {
  assertDimensionScores,
  assertRoundContractReleaseQa,
  assertStopReason,
  assertTargetFamily,
  assertValidationLane,
  extractRunDirectory,
  readSummary,
  runLoop
} from "./validation-utils.mjs";

console.log("[validate-end-pass-qa] fullstack success should write explicit round-contract release QA");
const fullstackResult = await runLoop([
  "--adapter",
  "./.tmp/semantic-validation/fullstack-success/adapter.json",
  "--evaluator-profile",
  "./.tmp/semantic-validation/verification-profile-fullstack-semantic.json",
  "--max-rounds",
  "1"
]);
if (fullstackResult.code !== 0) {
  throw new Error("Fullstack end-pass-QA validation run failed.");
}
const fullstackRunDirectory = extractRunDirectory(fullstackResult.stdout);
const fullstackSummary = await readSummary(fullstackRunDirectory);
assertTargetFamily(fullstackSummary, "fullstack-app");
assertValidationLane(fullstackSummary, "deterministic_semantic");
assertStopReason(fullstackSummary, "target_reached");
const fullstackRound = fullstackSummary.round_history?.[fullstackSummary.round_history.length - 1];
await assertRoundContractReleaseQa(fullstackRound, {
  expectedApiProbeIds: [
    "fullstack-semantic-shell",
    "fullstack-semantic-item",
    "fullstack-semantic-invalid-item",
    "fullstack-semantic-session"
  ],
  label: "fullstack round contract"
});
await assertDimensionScores(fullstackRound, {
  expectedDimensionIds: [
    "contract_execution",
    "proof_integrity",
    "browser_release_qa",
    "api_release_qa",
    "repair_convergence"
  ],
  requireThresholdsMet: true,
  label: "fullstack dimension scores"
});

console.log("[validate-end-pass-qa] no-live api run should fail at least one dimension floor");
const noLiveResult = await runLoop([
  "--single",
  "--adapter",
  "./.tmp/semantic-validation/no-live/adapter.json",
  "--target-family",
  "api-service"
]);
if (noLiveResult.code !== 0) {
  throw new Error("No-live end-pass-QA validation run failed.");
}
const noLiveRunDirectory = extractRunDirectory(noLiveResult.stdout);
const noLiveSummary = await readSummary(noLiveRunDirectory);
assertTargetFamily(noLiveSummary, "api-service");
assertValidationLane(noLiveSummary, "deterministic_semantic");
const noLiveRound = noLiveSummary.round_history?.[noLiveSummary.round_history.length - 1];
await assertRoundContractReleaseQa(noLiveRound, {
  expectedApiProbeIds: ["item-persists", "invalid-item-rejected"],
  label: "no-live round contract"
});
const noLiveDimensions = await assertDimensionScores(noLiveRound, {
  expectedDimensionIds: [
    "contract_execution",
    "proof_integrity",
    "api_release_qa",
    "repair_convergence"
  ],
  requireThresholdsMet: false,
  label: "no-live dimension scores"
});
if (!noLiveDimensions.some((dimension) => dimension.applicable && !dimension.passed)) {
  throw new Error("Expected the no-live fixture to fail at least one applicable dimension.");
}

console.log("[validate-end-pass-qa] complete");
