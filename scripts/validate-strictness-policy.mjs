import { strict as assert } from "node:assert";

import { importDist } from "./testing/bootstrap-validator-helpers.mjs";

const main = async () => {
  const {
    buildEvaluationPolicy,
    defaultCustomMetricMinimumForStrictness,
    defaultTargetScoreForStrictness
  } = await importDist("evaluation-policy.js");

  assert.equal(defaultTargetScoreForStrictness(1), 0.8);
  assert.equal(defaultTargetScoreForStrictness(3), 0.9);
  assert.equal(defaultTargetScoreForStrictness(5), 0.95);
  assert.equal(defaultCustomMetricMinimumForStrictness(4), 9);
  assert.equal(defaultCustomMetricMinimumForStrictness(5), 9.3);

  const strictPolicy = buildEvaluationPolicy({
    intake: {
      strictness_level: 5,
      custom_quality_metrics: [
        {
          metric_id: "design.cleanliness",
          label: "Cleanliness",
          description: "Clean visual hierarchy.",
          minimum_score_out_of_ten: 8,
          required: true
        }
      ]
    }
  });
  const custom = strictPolicy.dimensions.find(
    (dimension) => dimension.dimension_id === "design.cleanliness"
  );
  assert.ok(custom, "strict custom dimension should exist");
  assert.equal(custom.minimum_score, 9.3);
  assert.ok(
    strictPolicy.evidence_caps.some(
      (cap) => cap.cap_id === "visual_without_rendered_evidence"
    )
  );
};

await main();
console.log("validate:strictness-policy passed");
