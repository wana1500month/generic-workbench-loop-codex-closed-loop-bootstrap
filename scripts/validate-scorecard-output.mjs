import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  cleanupTempRoot,
  createTempRoot,
  importDist,
  readJsonFile
} from "./testing/bootstrap-validator-helpers.mjs";

const baseEvalReport = {
  generated_at: "2026-05-26T00:00:00.000Z",
  round: 2,
  total_score: 0.91,
  control_plane_score: 0.95,
  proof_score: 0.94,
  release_score: 0.91,
  overall_verdict: "advance",
  strengths: [],
  blockers: [],
  next_actions: ["Remove non-essential explanatory copy."],
  evidence_paths: ["round-002/evidence/browser-screenshot.png"],
  threshold_gap_details: [],
  check_results: [],
  resolved_check_ids: [],
  unresolved_check_ids: [],
  adapter_attached: true,
  threshold_results: {
    contract_completed: true,
    minimum_control_plane_score_met: true,
    minimum_proof_score_met: true,
    minimum_release_score_met: true,
    adapter_required_met: true,
    grade_score_required_met: true,
    core_probe_required_met: true,
    dimension_thresholds_met: true,
    target_reached_eligible: true
  },
  dimension_scores: [],
  adapter_results: [
    {
      capability: "grade_round",
      provider_id: "generated-codex-verifier",
      provider_role: "verifier",
      packet_path: "packet.json",
      result_path: "result.json",
      result: {
        capability: "grade_round",
        ok: true,
        summary: "graded",
        findings: [],
        evidence_paths: ["round-002/evidence/browser-screenshot.png"],
        subjective_metric_results: [
          {
            metric_id: "design.no_noise_text",
            label: "No noise text",
            score_out_of_ten: 8.7,
            minimum_score_out_of_ten: 9.5,
            status: "fail",
            rationale: "There is still too much helper copy.",
            recommended_changes: ["Remove helper copy."],
            evidence_paths: ["round-002/evidence/browser-screenshot.png"],
            required: true
          }
        ]
      },
      verified_evidence: [],
      verified_criteria_results: [],
      verified_evidence_paths: [],
      validation_errors: []
    }
  ],
  core_probe_results: []
};

const main = async () => {
  const tempRoot = await createTempRoot("validate-scorecard-output");

  try {
    const {
      buildEvaluationPolicy,
      buildRoundScorecard,
      writeRoundScorecardArtifacts
    } = await importDist("evaluation-policy.js");
    const policy = buildEvaluationPolicy({
      intake: {
        strictness_level: 4,
        target_score: 0.9,
        project_kind: "browser_ui",
        verification_surfaces: ["browser", "screenshot", "test"],
        custom_quality_metrics: [
          {
            metric_id: "design.no_noise_text",
            label: "No noise text",
            description: "No dummy, helper, or excessive explanatory text.",
            minimum_score_out_of_ten: 9.5,
            required: true,
            weight: 2
          }
        ]
      }
    });
    const scorecard = buildRoundScorecard({
      policy,
      evalReport: baseEvalReport
    });
    assert.equal(scorecard.total_score, 0.91);
    assert.equal(scorecard.target_reached, false);
    assert.ok(
      scorecard.blocking_reasons.some(
        (reason) => reason.dimension_id === "design.no_noise_text"
      )
    );
    const roundDirectory = join(tempRoot, "run", "round-002");
    await writeRoundScorecardArtifacts({ roundDirectory, scorecard });
    assert.equal(existsSync(join(roundDirectory, "scorecard.json")), true);
    assert.equal(existsSync(join(roundDirectory, "scorecard.md")), true);
    const written = await readJsonFile(join(roundDirectory, "scorecard.json"));
    assert.equal(written.target_reached, false);
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

await main();
console.log("validate:scorecard-output passed");
