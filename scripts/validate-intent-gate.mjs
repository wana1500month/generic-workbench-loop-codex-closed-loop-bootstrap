import { strict as assert } from "node:assert";

import {
  evaluateLoopIntent,
  renderLoopIntentResponse
} from "../packages/loop-orchestrator/dist/intent-gate.js";

const productResult = evaluateLoopIntent(
  "Build a storyboard editor for indie animators. The first version needs drag-and-drop panels and note taking."
);
assert.equal(productResult.intent, "product_build");
assert.equal(productResult.status, "route_to_product_intake");
assert.equal(productResult.route_target, "product_intake");
assert.equal(productResult.intake_status, "ask_product_questions");

const harnessHumanOutput = renderLoopIntentResponse(
  evaluateLoopIntent(
    "Add a new loop:intent router so harness-design requests stop falling through product intake. Keep loop:intake product-only, add .agents/skills for the operator surface, and make the next step explicit."
  )
);
assert.match(harnessHumanOutput, /^Intent:\s+harness_design/m);
assert.match(harnessHumanOutput, /Route:\s+proceed in the harness-design lane\./i);

const harnessResult = evaluateLoopIntent(
  "Add a new loop:intent router so harness-design requests stop falling through product intake. Keep loop:intake product-only, add .agents/skills for the operator surface, and make the next step explicit."
);
assert.equal(harnessResult.intent, "harness_design");
assert.equal(harnessResult.status, "ready_for_handoff");

const resumeResult = evaluateLoopIntent(
  "Resume evals/runs/run-042. The run stopped with environment_blocked after round 3 and I need to decide whether to reopen or hold."
);
assert.equal(resumeResult.intent, "run_resume");
assert.equal(resumeResult.status, "ready_for_handoff");
assert.match(resumeResult.extracted_run_reference, /run-042/i);

const evaluatorResult = evaluateLoopIntent(
  "Tune the evaluator for the browser-app heavy lane. We keep seeing false positives on subjective metrics, and I want goldens plus trigger conditions before closeout. The goal is to only run the heavy lane near release closeout and stop reopening deterministic smoke checks."
);
assert.equal(evaluatorResult.intent, "evaluator_tuning");
assert.equal(evaluatorResult.status, "ready_for_handoff");

console.log("validate:intent-gate passed");
