import {
  assertControllerDecisionBundleSemantics,
  assertSuccessfulRoundHasNoFailureClassification,
  assertTargetFamily,
  assertValidationLane,
  cleanupReferenceTargetServers,
  assertStopReason,
  extractRunDirectory,
  readSummary,
  runLoop
} from "./validation-utils.mjs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldReferenceAdapter } from "./reference-adapter-template.mjs";

const scorePolicyProfile = (input) => ({
  profile_id: `semantic-validation-score-policy-${input.id}`,
  label: `Semantic Validation Score Policy ${input.label}`,
  bundle_label: `Semantic Validation Score Policy ${input.label}`,
  target_family: "api-service",
  validation_lane: "deterministic_semantic",
  expected_target_surfaces: ["api"],
  required_live_verification_modes: ["api"],
  target_reached_requires_core_probes: true,
  minimum_feature_release_assertions: 2,
  minimum_assertion_tag_counts: {
    api: 2,
    persistence: 1,
    error_path: 1
  },
  score_policy: input.scorePolicy,
  core_probes: [
    {
      probe_id: "target-health-http",
      label: "Supporting health endpoint probe",
      role: "supporting",
      mode: "http",
      target_manifest_key: "health_url",
      expected_value: "\"status\":\"ready\"",
      required: true
    },
    {
      probe_id: "target-item-title",
      label: "Core API probe confirms the latest item title persists",
      role: "release_gate",
      mode: "http_json",
      assertion_id: "item_persists",
      assertion_tags: ["api", "persistence"],
      semantic_level: "workflow",
      target_manifest_key: "api_base_url",
      target_path: "items/latest",
      json_path: "title",
      expected_value: "Smoke Item",
      expected_status: 200,
      required: true
    },
    {
      probe_id: "target-invalid-item",
      label: "Core API probe confirms invalid item requests are rejected",
      role: "release_gate",
      mode: "http_json",
      assertion_id: "invalid_item_rejected",
      assertion_tags: ["api", "error_path"],
      semantic_level: "workflow",
      target_manifest_key: "api_base_url",
      target_path: "items/invalid",
      json_path: "error",
      expected_value: "invalid_title",
      expected_status: 400,
      required: true
    }
  ],
  criteria: [
    {
      criterion_id: "item_persists",
      assertion_id: "item_persists",
      capability: "run_checks",
      summary: "run_checks must confirm the latest item persists before release gating passes.",
      operator: "equals",
      expected_value: "persisted",
      hard: true
    },
    {
      criterion_id: "invalid_item_rejected",
      assertion_id: "invalid_item_rejected",
      capability: "run_checks",
      summary: "run_checks must confirm the invalid item path is rejected before release gating passes.",
      operator: "equals",
      expected_value: "rejected",
      hard: true
    },
    {
      criterion_id: "item_persists",
      assertion_id: "item_persists",
      capability: "grade_round",
      summary: "grade_round must confirm the latest item persists before release gating passes.",
      operator: "equals",
      expected_value: "persisted",
      hard: true
    }
  ]
});

const fixtureRoot = await mkdtemp(join(tmpdir(), "codex-score-policy-"));
await scaffoldReferenceAdapter({
  outputDirectory: fixtureRoot,
  template: "canonical-api",
  templateOptions: {
    adapterId: "semantic-low-score",
    label: "Semantic Low Score Adapter",
    providerId: "semantic-low-score-verifier",
    roundBehavior: {
      failing_rounds: [],
      failing_criteria: [],
      grade_score: 0.2
    }
  }
});
const adapterPath = join(fixtureRoot, "adapter.json");
const strictProfile = join(fixtureRoot, "verification-profile-score-policy-strict.json");
const lenientProfile = join(fixtureRoot, "verification-profile-score-policy-lenient.json");
await writeFile(
  strictProfile,
  `${JSON.stringify(
    scorePolicyProfile({
      id: "strict",
      label: "Strict",
      scorePolicy: {
        proof_weights: {
          proof_pass_rate: 0.1,
          criterion_pass_rate: 0.1,
          threshold_verdict: 0.1,
          external_grade: 0.7
        },
        release_weights: {
          control_plane_score: 0.4,
          proof_score: 0.6
        }
      }
    }),
    null,
    2
  )}\n`,
  "utf8"
);
await writeFile(
  lenientProfile,
  `${JSON.stringify(
    scorePolicyProfile({
      id: "lenient",
      label: "Lenient",
      scorePolicy: {
        proof_weights: {
          proof_pass_rate: 0.45,
          criterion_pass_rate: 0.4,
          threshold_verdict: 0.15,
          external_grade: 0
        },
        release_weights: {
          control_plane_score: 0.4,
          proof_score: 0.6
        }
      }
    }),
    null,
    2
  )}\n`,
  "utf8"
);

console.log("[validate-score-policy] strict profile should hold target_reached closed");
const strictResult = await runLoop([
  "--single",
  "--adapter",
  adapterPath,
  "--evaluator-profile",
  strictProfile,
], {
  env: {
    HARNESS_ALLOW_EXTERNAL_TARGET_ROOT: "1"
  }
});
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
await cleanupReferenceTargetServers(strictRunDirectory);

console.log("[validate-score-policy] lenient profile should allow target_reached");
const lenientResult = await runLoop([
  "--single",
  "--adapter",
  adapterPath,
  "--evaluator-profile",
  lenientProfile
], {
  env: {
    HARNESS_ALLOW_EXTERNAL_TARGET_ROOT: "1"
  }
});
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
await cleanupReferenceTargetServers(lenientRunDirectory);

console.log("[validate-score-policy] complete");
