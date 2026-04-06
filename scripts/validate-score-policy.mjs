import {
  assertControllerDecisionBundleSemantics,
  assertSuccessfulRoundHasNoFailureClassification,
  assertTargetFamily,
  assertValidationLane,
  assertStopReason,
  extractRunDirectory,
  readSummary,
  runLoop
} from "./validation-utils.mjs";

const adapterPath = "./.tmp/semantic-validation/low-score/adapter.json";
const strictProfile =
  "./.tmp/semantic-validation/verification-profile-score-policy-strict.json";
const lenientProfile =
  "./.tmp/semantic-validation/verification-profile-score-policy-lenient.json";

console.log("[validate-score-policy] strict profile should hold target_reached closed");
const strictResult = await runLoop([
  "--single",
  "--adapter",
  adapterPath,
  "--evaluator-profile",
  strictProfile,
]);
if (strictResult.code !== 0) {
  throw new Error("Strict score-policy validation run failed.");
}
const strictRunDirectory = extractRunDirectory(strictResult.stdout);
const strictSummary = await readSummary(strictRunDirectory);
assertTargetFamily(strictSummary, "api-service");
assertValidationLane(strictSummary, "deterministic_semantic");
assertStopReason(strictSummary, "max_rounds_reached");
const strictRound = strictSummary.round_history?.[strictSummary.round_history.length - 1];
await assertControllerDecisionBundleSemantics(
  strictRound,
  "api-service",
  "deterministic_semantic",
  "strict score-policy controller decision"
);
if (strictSummary.threshold_results?.contract_completed !== true) {
  throw new Error("Strict score-policy run should still complete the negotiated contract.");
}

console.log("[validate-score-policy] lenient profile should allow target_reached");
const lenientResult = await runLoop([
  "--single",
  "--adapter",
  adapterPath,
  "--evaluator-profile",
  lenientProfile
]);
if (lenientResult.code !== 0) {
  throw new Error("Lenient score-policy validation run failed.");
}
const lenientRunDirectory = extractRunDirectory(lenientResult.stdout);
const lenientSummary = await readSummary(lenientRunDirectory);
assertTargetFamily(lenientSummary, "api-service");
assertValidationLane(lenientSummary, "deterministic_semantic");
assertStopReason(lenientSummary, "target_reached");
const lenientRound = lenientSummary.round_history?.[lenientSummary.round_history.length - 1];
await assertControllerDecisionBundleSemantics(
  lenientRound,
  "api-service",
  "deterministic_semantic",
  "lenient score-policy controller decision"
);
await assertSuccessfulRoundHasNoFailureClassification(
  lenientRound,
  "lenient score-policy round"
);

console.log("[validate-score-policy] complete");
