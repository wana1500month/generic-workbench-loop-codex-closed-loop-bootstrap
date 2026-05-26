import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  cleanupTempRoot,
  createTempRoot,
  importDist,
  readJsonFile
} from "./testing/bootstrap-validator-helpers.mjs";

const main = async () => {
  const tempRoot = await createTempRoot("validate-evaluation-policy");

  try {
    const {
      buildEvaluationPolicy,
      generatedAdapterEvaluationPolicyPathForRun,
      writeEvaluationPolicyArtifacts
    } = await importDist("evaluation-policy.js");
    const runDirectory = join(tempRoot, "run");
    const policy = buildEvaluationPolicy({
      intake: {
        product_summary: "Build a CLI log analyzer that writes report files.",
        project_kind: "cli_tool",
        strictness_level: 5,
        verification_surfaces: ["cli", "file", "test"],
        custom_quality_metrics: [
          {
            metric_id: "output.report_clarity",
            label: "Report clarity",
            description: "The generated report should be clear and actionable.",
            minimum_score_out_of_ten: 9.4,
            required: true,
            weight: 2
          }
        ]
      }
    });

    assert.equal(policy.strictness_level, 5);
    assert.equal(policy.target_total_score, 0.95);
    assert.equal(policy.project_kind, "cli_tool");
    assert.ok(policy.evidence_surfaces.includes("cli"));
    assert.ok(policy.evidence_surfaces.includes("file"));
    assert.ok(policy.evidence_caps.length >= 4);
    const custom = policy.dimensions.find(
      (dimension) => dimension.dimension_id === "output.report_clarity"
    );
    assert.ok(custom, "custom dimension should be promoted into policy");
    assert.equal(custom.required, true);
    assert.equal(custom.minimum_score, 9.4);

    await writeEvaluationPolicyArtifacts({ runDirectory, policy });
    const generatedAdapterPolicyPath =
      generatedAdapterEvaluationPolicyPathForRun(runDirectory);
    assert.equal(existsSync(generatedAdapterPolicyPath), true);
    const written = await readJsonFile(generatedAdapterPolicyPath);
    assert.equal(written.strictness_level, 5);
    assert.equal(written.dimensions.length, policy.dimensions.length);
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

await main();
console.log("validate:evaluation-policy passed");
