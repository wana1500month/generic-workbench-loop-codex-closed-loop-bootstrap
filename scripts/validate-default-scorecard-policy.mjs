import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  cleanupTempRoot,
  createTempRoot,
  ensureBuild,
  readJsonFile
} from "./testing/bootstrap-validator-helpers.mjs";
import { ensureSemanticValidationFixtures } from "./testing/semantic-fixtures.mjs";
import {
  extractRunDirectory,
  readSummary,
  runLoop
} from "./validation-utils.mjs";

const main = async () => {
  await ensureSemanticValidationFixtures({ clean: true });
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-default-scorecard-policy");

  try {
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
          ...process.env,
          HARNESS_RUNS_DIRECTORY: join(tempRoot, "runs"),
          HARNESS_EVALUATION_POLICY_PATH: ""
        },
        silent: true
      }
    );
    assert.equal(result.code, 0, result.stderr);

    const runDirectory = extractRunDirectory(result.stdout);
    const summary = await readSummary(runDirectory);
    assert.ok(summary.evaluation_policy_path, JSON.stringify(summary, null, 2));

    const policyPath = join(runDirectory, "evaluation-policy.generated.json");
    const scorecardPath = join(runDirectory, "round-001", "scorecard.json");
    assert.equal(existsSync(policyPath), true);
    assert.equal(existsSync(scorecardPath), true);

    const policy = await readJsonFile(policyPath);
    assert.equal(policy.project_kind, "generic");
    assert.deepEqual(policy.evidence_surfaces, ["file", "test", "manual_review"]);

    const scorecard = await readJsonFile(scorecardPath);
    assert.equal(scorecard.round, 1);
    assert.equal(scorecard.target_total_score, policy.target_total_score);
    assert.ok(scorecard.dimension_scores.length >= 2);
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

await main();
console.log("validate:default-scorecard-policy passed");
