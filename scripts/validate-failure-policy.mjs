import {
  assertDecisionSource,
  assertFailurePolicySnapshot,
  assertTrajectoryDecisionSurface,
  assertStopReason,
  extractRunDirectory,
  readJsonFile,
  readSummary,
  runLoop
} from "./validation-utils.mjs";

const assertNegotiationMode = (roundSummary, expectedMode, label) => {
  if (!roundSummary) {
    throw new Error(`Expected ${label}, but no round summary was recorded.`);
  }
  if (roundSummary.negotiation_mode !== expectedMode) {
    throw new Error(
      `Expected ${label} negotiation_mode '${expectedMode}', received '${roundSummary.negotiation_mode ?? "missing"}'.`
    );
  }
};

const cases = [
  {
    label: "stable-patch-authority",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/patch-only-success/adapter.json",
      "--target-family",
      "api-service",
      "--max-rounds",
      "3"
    ],
    validate: async (summary) => {
      await assertFailurePolicySnapshot(summary.round_history?.[0], {
        expectedAction: "patch_only",
        expectedDominantTrigger: "stable_patch_authority",
        expectedPatchAuthorityState: "healthy",
        expectedRecommendationSource: "weighted_policy",
        expectedTriggerCodes: ["stable_patch_authority"],
        label: "stable patch authority snapshot"
      });
      await assertTrajectoryDecisionSurface(summary.round_history?.[0], {
        expectedMode: "refine",
        expectedRestartFrom: "current_head",
        label: "stable patch authority trajectory"
      });
      assertNegotiationMode(
        summary.round_history?.[1],
        "patch_only",
        "stable patch authority follow-up round"
      );
      assertDecisionSource(
        summary.round_history?.[1],
        "policy_snapshot",
        "stable patch authority decision source"
      );
    }
  },
  {
    label: "patch-entropy-spike",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/no-live/adapter.json",
      "--target-family",
      "api-service",
      "--max-rounds",
      "2"
    ],
    validate: async (summary) => {
      await assertFailurePolicySnapshot(summary.round_history?.[0], {
        expectedAction: "patch_only",
        expectedDominantTrigger: "patch_entropy_spike",
        expectedPatchAuthorityState: "strained",
        expectedRecommendationSource: "weighted_policy",
        expectedTriggerCodes: ["patch_entropy_spike", "stable_patch_authority"],
        label: "patch entropy snapshot"
      });
      await assertTrajectoryDecisionSurface(summary.round_history?.[0], {
        expectedMode: "tighten",
        expectedRestartFrom: "current_head",
        label: "patch entropy trajectory"
      });
      assertNegotiationMode(
        summary.round_history?.[1],
        "patch_only",
        "patch entropy follow-up round"
      );
      assertDecisionSource(
        summary.round_history?.[1],
        "policy_snapshot",
        "patch entropy decision source"
      );
    }
  },
  {
    label: "hard-rule-release-gate-regression",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/patch-recontract/adapter.json",
      "--target-family",
      "api-service",
      "--max-rounds",
      "3"
    ],
    validate: async (summary) => {
      await assertFailurePolicySnapshot(summary.round_history?.[1], {
        expectedAction: "recontract",
        expectedDominantTrigger: "release_gate_regression",
        expectedPatchAuthorityState: "collapsed",
        expectedRecommendationSource: "hard_rule",
        expectedTriggerCodes: ["release_gate_regression", "stable_patch_authority"],
        label: "release gate regression snapshot"
      });
      await assertTrajectoryDecisionSurface(summary.round_history?.[1], {
        expectedMode: "pivot",
        label: "release gate regression trajectory"
      });
      assertNegotiationMode(
        summary.round_history?.[2],
        "recontract",
        "release gate regression follow-up round"
      );
      assertDecisionSource(
        summary.round_history?.[2],
        "trajectory_policy",
        "release gate regression decision source"
      );
    }
  },
  {
    label: "environment-blocked-only",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/editor-blocked/adapter.json",
      "--evaluator-profile",
      "./.tmp/semantic-validation/verification-profile-editor-semantic.json",
      "--max-rounds",
      "3"
    ],
    validate: async (summary) => {
      assertStopReason(summary, "environment_blocked");
      await assertFailurePolicySnapshot(summary.round_history?.[0], {
        expectedAction: "stop",
        expectedDominantTrigger: "environment_blocked",
        expectedPatchAuthorityState: "collapsed",
        expectedRecommendationSource: "hard_rule",
        expectedTriggerCodes: ["environment_blocked", "stable_patch_authority"],
        label: "environment-blocked snapshot"
      });
    }
  },
  {
    label: "policy-plateau-recontract",
    args: [
      "--adapter",
      "./.tmp/semantic-validation/contradictory/adapter.json",
      "--target-family",
      "api-service",
      "--max-rounds",
      "4"
    ],
    validate: async (summary) => {
      let policyRecontractRound;
      for (const roundSummary of summary.round_history ?? []) {
        if (
          roundSummary?.decision_source !== "trajectory_policy" ||
          roundSummary.negotiation_mode !== "recontract" ||
          !roundSummary.failure_lineage_path
        ) {
          continue;
        }
        const failureLineage = await readJsonFile(roundSummary.failure_lineage_path);
        if (failureLineage.policy_snapshot?.dominant_trigger_code === "plateau_without_progress") {
          policyRecontractRound = roundSummary;
          break;
        }
      }
      if (!policyRecontractRound) {
        throw new Error(
          "Expected contradictory fixture to produce a plateau-driven trajectory recontract round."
        );
      }
      const snapshot = await assertFailurePolicySnapshot(policyRecontractRound, {
        expectedAction: "recontract",
        expectedDominantTrigger: "plateau_without_progress",
        expectedPatchAuthorityState: "collapsed",
        expectedRecommendationSource: "weighted_policy",
        expectedTriggerCodes: ["plateau_without_progress", "stable_patch_authority"],
        label: "policy plateau recontract snapshot"
      });
      if (!snapshot.plateau_limit_reached) {
        throw new Error(
          "Expected policy plateau recontract snapshot to record plateau_limit_reached."
        );
      }
      if (snapshot.projected_plateau_count < snapshot.plateau_limit) {
        throw new Error(
          `Expected projected plateau count to meet or exceed the plateau limit, received '${snapshot.projected_plateau_count}' vs '${snapshot.plateau_limit}'.`
        );
      }
      if (policyRecontractRound.negotiation_mode !== "recontract") {
        throw new Error(
          `Expected policy recontract round to negotiate as 'recontract', received '${policyRecontractRound.negotiation_mode ?? "missing"}'.`
        );
      }
      if (policyRecontractRound.decision_source !== "trajectory_policy") {
        throw new Error(
          `Expected policy recontract decision source 'trajectory_policy', received '${policyRecontractRound.decision_source ?? "missing"}'.`
        );
      }
      await assertTrajectoryDecisionSurface(policyRecontractRound, {
        expectedMode: "parallel_pivot",
        label: "policy plateau trajectory"
      });
    }
  }
];

for (const testCase of cases) {
  console.log(`\n[validate-failure-policy] ${testCase.label}`);
  const result = await runLoop(testCase.args);
  if (result.code !== 0) {
    throw new Error(`Loop command failed for '${testCase.label}'.`);
  }
  const summary = await readSummary(extractRunDirectory(result.stdout));
  await testCase.validate(summary);
}

console.log("\n[validate-failure-policy] complete");
