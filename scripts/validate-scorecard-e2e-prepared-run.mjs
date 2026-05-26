import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  cleanupTempRoot,
  createTempRoot,
  ensureBuild,
  readJsonFile,
  runCommand,
  writeJsonFile
} from "./testing/bootstrap-validator-helpers.mjs";
import { ensureSemanticValidationFixtures } from "./testing/semantic-fixtures.mjs";
import {
  extractRunDirectory,
  readSummary,
  runLoop
} from "./validation-utils.mjs";

const evaluationPolicy = {
  schema_version: "2026-05-26",
  generated_at: "2026-05-26T00:00:00.000Z",
  strictness_level: 5,
  strictness_label: "release_review",
  project_kind: "browser_ui",
  evidence_surfaces: ["browser", "screenshot", "test"],
  target_total_score: 0.8,
  pass_mode: "all_required_dimensions",
  dimensions: [
    {
      dimension_id: "design.no_noise_text",
      label: "No noisy text",
      description: "No dummy, helper, or excessive explanatory text.",
      scale: 10,
      minimum_score: 9.5,
      required: true,
      weight: 2,
      evidence_surface: "browser",
      evidence_required: true,
      source: "custom"
    }
  ],
  evidence_caps: []
};

const main = async () => {
  await ensureSemanticValidationFixtures({ clean: true });
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-scorecard-e2e-prepared-run");

  try {
    const policyPath = join(tempRoot, "evaluation-policy.generated.json");
    const runsDirectory = join(tempRoot, "runs");
    await writeJsonFile(policyPath, evaluationPolicy);

    const result = await runLoop(
      [
        "--single",
        "--adapter",
        "./.tmp/semantic-validation/low-score/adapter.json",
        "--evaluator-profile",
        "./.tmp/semantic-validation/verification-profile-score-policy-lenient.json"
      ],
      {
        env: {
          HARNESS_RUNS_DIRECTORY: runsDirectory,
          HARNESS_EVALUATION_POLICY_PATH: policyPath,
          HARNESS_SEMANTIC_SUBJECTIVE_METRIC: "fail"
        },
        silent: true
      }
    );
    assert.equal(result.code, 0, result.stderr);

    const runDirectory = extractRunDirectory(result.stdout);
    const summary = await readSummary(runDirectory);
    assert.notEqual(
      summary.stop_reason,
      "target_reached",
      "required custom dimension failure should block target closure"
    );

    const scorecardPath = join(runDirectory, "round-001", "scorecard.json");
    assert.equal(existsSync(scorecardPath), true);
    const scorecard = await readJsonFile(scorecardPath);
    assert.equal(scorecard.target_reached, false);
    assert.ok(
      scorecard.blocking_reasons.some(
        (reason) => reason.dimension_id === "design.no_noise_text"
      )
    );

    const evalReport = await readJsonFile(
      join(runDirectory, "round-001", "eval_report.json")
    );
    assert.equal(evalReport.threshold_results.target_reached_eligible, false);

    const scorecardsResult = await runCommand(process.execPath, [
      "./scripts/loop-scorecards.mjs",
      "--run-dir",
      runDirectory,
      "--json"
    ]);
    assert.equal(scorecardsResult.code, 0, scorecardsResult.stderr);
    const scorecardsPayload = JSON.parse(scorecardsResult.stdout);
    assert.equal(scorecardsPayload.scorecards.length, 1);
    assert.equal(
      scorecardsPayload.scorecards[0].scorecard.blocking_reasons[0]
        .dimension_id,
      "design.no_noise_text"
    );

    assert.equal(
      existsSync(join(runDirectory, "evaluation-policy.generated.json")),
      true
    );
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

await main();
console.log("validate:scorecard-e2e-prepared-run passed");
