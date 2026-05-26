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

const cliEvaluationPolicy = {
  schema_version: "2026-05-26",
  generated_at: "2026-05-26T00:00:00.000Z",
  strictness_level: 4,
  strictness_label: "strict_product",
  project_kind: "cli_tool",
  evidence_surfaces: ["cli", "file", "test"],
  target_total_score: 0.93,
  pass_mode: "all_required_dimensions",
  dimensions: [
    {
      dimension_id: "functionality.core_workflows",
      label: "CLI workflow behavior",
      description: "The CLI workflow should pass with command/file evidence.",
      scale: 100,
      minimum_score: 90,
      required: true,
      weight: 3,
      evidence_surface: "cli",
      evidence_required: true,
      source: "core"
    },
    {
      dimension_id: "proof.evidence_integrity",
      label: "CLI verification evidence",
      description: "The round should include non-browser evidence appropriate for a CLI target.",
      scale: 100,
      minimum_score: 90,
      required: true,
      weight: 2,
      evidence_surface: "file",
      evidence_required: true,
      source: "core"
    }
  ],
  evidence_caps: []
};

const main = async () => {
  await ensureSemanticValidationFixtures({ clean: true });
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-non-web-e2e");

  try {
    const runsDirectory = join(tempRoot, "runs");
    const policyPath = join(tempRoot, "cli-evaluation-policy.json");
    await writeJsonFile(policyPath, cliEvaluationPolicy);

    const result = await runLoop(
      [
        "--single",
        "--adapter",
        "./.tmp/semantic-validation/cli-success/adapter.json",
        "--evaluator-profile",
        "./.tmp/semantic-validation/verification-profile-cli.json"
      ],
      {
        env: {
          HARNESS_RUNS_DIRECTORY: runsDirectory,
          HARNESS_EVALUATION_POLICY_PATH: policyPath
        },
        silent: true
      }
    );
    assert.equal(result.code, 0, result.stderr);

    const runDirectory = extractRunDirectory(result.stdout);
    const summary = await readSummary(runDirectory);
    assert.equal(summary.stop_reason, "target_reached");
    assert.equal(summary.threshold_results.target_reached_eligible, true);
    assert.equal(summary.target_family, "cli-tool");

    const persistedPolicy = await readJsonFile(
      join(runDirectory, "evaluation-policy.generated.json")
    );
    assert.equal(persistedPolicy.project_kind, "cli_tool");
    assert.deepEqual(persistedPolicy.evidence_surfaces, ["cli", "file", "test"]);

    const scorecardPath = join(runDirectory, "round-001", "scorecard.json");
    assert.equal(existsSync(scorecardPath), true);
    const scorecard = await readJsonFile(scorecardPath);
    assert.equal(scorecard.target_reached, true);
    assert.ok(
      scorecard.dimension_scores.every((dimension) => dimension.status === "pass")
    );

    const scorecardsResult = await runCommand(process.execPath, [
      "./scripts/loop-scorecards.mjs",
      "--run-dir",
      runDirectory,
      "--json"
    ]);
    assert.equal(scorecardsResult.code, 0, scorecardsResult.stderr);
    const payload = JSON.parse(scorecardsResult.stdout);
    assert.equal(payload.scorecards.length, 1);
    assert.equal(payload.scorecards[0].scorecard.target_reached, true);
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

await main();
console.log("validate:non-web-e2e passed");
