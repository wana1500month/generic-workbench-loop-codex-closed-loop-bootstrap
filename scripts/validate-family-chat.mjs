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
  "chat-grounded-reply",
  "chat-invalid-tool-call-rejected",
  "chat-memory-preserved",
  "chat-unsafe-tool-blocked",
  "chat-refusal-fallback-safe",
  "chat-tool-trace-persisted"
];
const expectedCriterionIds = [
  "grounded_reply",
  "invalid_tool_call_rejected",
  "conversation_memory_preserved",
  "unsafe_tool_request_blocked",
  "refusal_fallback_safe",
  "tool_trace_persisted"
];

const cases = [
  {
    label: "chat-success",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/chat-success/adapter.json",
      "--target-family",
      "chat-agent",
      "--max-rounds",
      "1"
    ],
    stopReason: "target_reached",
    roundCount: 1
  },
  {
    label: "chat-patch-only",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/chat-patch-only/adapter.json",
      "--target-family",
      "chat-agent",
      "--max-rounds",
      "3"
    ],
    stopReason: "target_reached",
    roundCount: 2
  },
  {
    label: "chat-recontract",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/chat-recontract/adapter.json",
      "--target-family",
      "chat-agent",
      "--max-rounds",
      "3"
    ],
    stopReason: "target_reached",
    roundCount: 3
  },
  {
    label: "chat-hard-failure",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/no-profile/adapter.json",
      "--target-family",
      "chat-agent",
      "--max-rounds",
      "1"
    ],
    stopReason: "adapter_contract_invalid",
    roundCount: 1
  }
];

for (const testCase of cases) {
  console.log(`\n[validate-family-chat] ${testCase.label}`);
  const result = await runLoop(testCase.args);
  if (result.code !== 0) {
    throw new Error(`Loop command failed for '${testCase.label}'.`);
  }
  const runDirectory = extractRunDirectory(result.stdout);
  const summary = await readSummary(runDirectory);
  assertTargetFamily(summary, "chat-agent");
  assertValidationLane(summary, "deterministic_semantic");
  assertStopReason(summary, testCase.stopReason);
  assertRoundCount(summary, testCase.roundCount);
  const latestRound = summary.round_history?.[summary.round_history.length - 1];
  await assertControllerDecisionBundleSemantics(
    latestRound,
    "chat-agent",
    "deterministic_semantic",
    `chat controller decision (${testCase.label})`
  );
  if (testCase.stopReason === "target_reached") {
    await assertEvalReportCoverage(latestRound, {
      expectedProbeIds,
      expectedCriterionIds,
      label: `chat eval report (${testCase.label})`
    });
    await assertSuccessfulRoundHasNoFailureClassification(
      latestRound,
      `chat success round (${testCase.label})`
    );
  }
  if (testCase.label === "chat-patch-only") {
    await assertFailurePolicyRecommendation(
      summary.round_history?.[0],
      "patch_only",
      "chat patch-only policy"
    );
    await assertPatchOnlyArtifactSurface(
      latestRound,
      "chat patch-only remediation round"
    );
  }
  if (testCase.label === "chat-recontract") {
    await assertFailurePolicyRecommendation(
      summary.round_history?.[1],
      "recontract",
      "chat recontract policy"
    );
    await assertPatchOnlyArtifactSurface(
      summary.round_history?.[1],
      "chat patch-only carry-forward round"
    );
    await assertRecontractArtifactSurface(
      latestRound,
      "chat recontract round"
    );
  }
}

console.log("\n[validate-family-chat] complete");
