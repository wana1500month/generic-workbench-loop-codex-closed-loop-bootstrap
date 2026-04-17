import { strict as assert } from "node:assert";

import {
  evaluateIntakeRequest,
  renderIntakeGateResponse
} from "../packages/loop-orchestrator/dist/intake-gate.js";

const productOnlyRequest =
  "Build a storyboard editor for indie animators. The first version needs drag-and-drop panels and note taking.";

const productOnlyHumanOutput = renderIntakeGateResponse(
  evaluateIntakeRequest(productOnlyRequest)
);
const productOnlyQuestions = productOnlyHumanOutput
  .split("\n")
  .filter((line) => /^\d+\.\s+/.test(line));

assert.match(productOnlyHumanOutput, /^1\.\s+/m);
assert.ok(productOnlyQuestions.length <= 3, productOnlyHumanOutput);
assert.ok(!/browser-editor/i.test(productOnlyHumanOutput), productOnlyHumanOutput);
assert.ok(!/adapter|wireframe|3-?panel/i.test(productOnlyHumanOutput), productOnlyHumanOutput);
assert.ok(
  !/target score|max rounds|target root|existing project|new project/i.test(
    productOnlyHumanOutput
  ),
  productOnlyHumanOutput
);

const askProductResult = evaluateIntakeRequest(productOnlyRequest);
assert.equal(askProductResult.status, "ask_product_questions");
assert.equal(askProductResult.phase, "product");
assert.equal(askProductResult.is_product_build_request, true);
assert.equal(askProductResult.internal_working_hypothesis, "browser-editor");
assert.ok(askProductResult.questions.length >= 2, JSON.stringify(askProductResult, null, 2));
assert.ok(askProductResult.questions.length <= 3, JSON.stringify(askProductResult, null, 2));
assert.equal(askProductResult.missing_execution_fields.length, 0);
assert.equal(askProductResult.extracted_target_score, 0.9);
assert.equal(askProductResult.extracted_max_rounds, 3);

const productFilledRequest =
  "Build a storyboard editor for indie animators. The target users are solo creators. The core workflows are arranging boards, dragging panels, and writing notes. References can be Linear and Figma. Good enough means those workflows run end to end.";

const askExecutionResult = evaluateIntakeRequest(productFilledRequest);
assert.equal(askExecutionResult.status, "ask_execution_questions");
assert.equal(askExecutionResult.phase, "execution");
assert.ok(
  askExecutionResult.missing_execution_fields.includes("project_mode"),
  JSON.stringify(askExecutionResult, null, 2)
);
assert.ok(askExecutionResult.missing_execution_fields.includes("target_root"));
assert.ok(!askExecutionResult.missing_execution_fields.includes("target_score"));
assert.ok(!askExecutionResult.missing_execution_fields.includes("max_rounds"));
assert.ok(
  !askExecutionResult.questions.some((question) => /target score/i.test(question)),
  JSON.stringify(askExecutionResult, null, 2)
);
assert.ok(
  !askExecutionResult.questions.some((question) => /max rounds/i.test(question)),
  JSON.stringify(askExecutionResult, null, 2)
);
assert.ok(askExecutionResult.questions.length <= 3, JSON.stringify(askExecutionResult, null, 2));
assert.equal(askExecutionResult.extracted_target_score, 0.9);
assert.equal(askExecutionResult.extracted_max_rounds, 3);

const existingProjectNeedsRuntimeHints = evaluateIntakeRequest(
  `${productFilledRequest} This is an existing project and the target root is ./apps/storyboard. target score 0.88 and max rounds 4.`
);
assert.equal(existingProjectNeedsRuntimeHints.status, "ask_execution_questions");
assert.ok(existingProjectNeedsRuntimeHints.missing_execution_fields.includes("run_command"));
assert.ok(existingProjectNeedsRuntimeHints.missing_execution_fields.includes("ready_url"));
assert.equal(existingProjectNeedsRuntimeHints.extracted_target_root, "./apps/storyboard");
assert.equal(existingProjectNeedsRuntimeHints.extracted_target_score, 0.88);
assert.equal(existingProjectNeedsRuntimeHints.extracted_max_rounds, 4);

const punctuationPathResult = evaluateIntakeRequest(
  "Build a dashboard app for operators. The target users are QA leads and the core workflows are reviewing thresholds, comparing runs, and exporting notes. References can be Linear and Metabase. Good enough means the first version supports those workflows. This is an existing project and the target root is ./apps/loop, with target score 0.88 and max rounds 4."
);
assert.equal(punctuationPathResult.status, "ask_execution_questions");
assert.equal(punctuationPathResult.extracted_target_root, "./apps/loop");

const absolutePosixPathResult = evaluateIntakeRequest(
  `${productFilledRequest} This is a new project and the target root is /tmp/loop-dashboard.`
);
assert.equal(absolutePosixPathResult.status, "ready_for_prepare");
assert.equal(absolutePosixPathResult.extracted_target_root, "/tmp/loop-dashboard");

const normalizedTargetScoreResult = evaluateIntakeRequest(
  `${productFilledRequest} This is a new project and the target root is ./apps/storyboard. target score 82.`
);
assert.equal(normalizedTargetScoreResult.status, "ready_for_prepare");
assert.equal(normalizedTargetScoreResult.extracted_target_score, 0.82);
assert.equal(normalizedTargetScoreResult.extracted_max_rounds, 3);

const koreanExecutionControlClause =
  "\uAE30\uC874 \uD504\uB85C\uC81D\uD2B8\uACE0 \uC791\uC5C5\uD3F4\uB354 apps/support-desk \uBAA9\uD45C\uC810\uC218 0.8 \uCD5C\uB300 4\uB77C\uC6B4\uB4DC.";
const koreanExecutionHintsResult = evaluateIntakeRequest(
  `${productFilledRequest} ${koreanExecutionControlClause}`
);
assert.equal(koreanExecutionHintsResult.status, "ask_execution_questions");
assert.equal(koreanExecutionHintsResult.phase, "execution");
assert.ok(koreanExecutionHintsResult.missing_execution_fields.includes("run_command"));
assert.ok(koreanExecutionHintsResult.missing_execution_fields.includes("ready_url"));
assert.equal(koreanExecutionHintsResult.extracted_target_root, "apps/support-desk");
assert.equal(koreanExecutionHintsResult.extracted_target_score, 0.8);
assert.equal(koreanExecutionHintsResult.extracted_max_rounds, 4);

const readyResult = evaluateIntakeRequest(
  "Build a storyboard editor for indie animators. The target users are solo creators. The core workflows are arranging boards, dragging panels, and writing notes. References can be Linear and Figma. Good enough means those workflows run end to end. This is a new project and the target root is C:\\Users\\SUNGMOK\\Desktop\\harness\\storyboard-app. target score 0.9 and max rounds 4."
);
assert.equal(readyResult.status, "ready_for_prepare");
assert.equal(readyResult.phase, "prepare");
assert.equal(readyResult.is_product_build_request, true);
assert.equal(readyResult.auto_prepare, true);
assert.equal(readyResult.next_step, "prepare");
assert.ok(Array.isArray(readyResult.preparation_summary));
assert.ok(
  readyResult.preparation_summary.some((line) => /Target score:\s*0\.9/i.test(line)),
  JSON.stringify(readyResult, null, 2)
);
assert.ok(
  readyResult.preparation_summary.some((line) => /Max rounds:\s*4/i.test(line)),
  JSON.stringify(readyResult, null, 2)
);
assert.ok(
  !readyResult.preparation_summary.some((line) => /family/i.test(line)),
  JSON.stringify(readyResult, null, 2)
);
assert.equal(
  readyResult.extracted_target_root,
  "C:\\Users\\SUNGMOK\\Desktop\\harness\\storyboard-app"
);

const koreanReadyResult = evaluateIntakeRequest(
  productFilledRequest + " \uC0C8 \uD504\uB85C\uC81D\uD2B8\uACE0 \uC791\uC5C5\uD3F4\uB354 /tmp/loop-dashboard \uBAA9\uD45C\uC810\uC218 82 \uCD5C\uB300 4\uB77C\uC6B4\uB4DC."
);
assert.equal(koreanReadyResult.status, "ready_for_prepare");
assert.equal(koreanReadyResult.locale, "ko");
assert.equal(koreanReadyResult.extracted_target_root, "/tmp/loop-dashboard");
assert.equal(koreanReadyResult.extracted_target_score, 0.82);
assert.equal(koreanReadyResult.extracted_max_rounds, 4);
assert.ok(
  koreanReadyResult.preparation_summary.some((line) => /\uBAA9\uD45C \uC810\uC218:\s*0\.82/.test(line)),
  JSON.stringify(koreanReadyResult, null, 2)
);
assert.ok(
  koreanReadyResult.preparation_summary.some((line) => /\uCD5C\uB300 \uB77C\uC6B4\uB4DC:\s*4/.test(line)),
  JSON.stringify(koreanReadyResult, null, 2)
);

const readyHumanOutput = renderIntakeGateResponse(readyResult);
assert.match(readyHumanOutput, /Preparation is complete\./);
assert.match(readyHumanOutput, /ready_to_start/);
assert.match(readyHumanOutput, /start loop/i);

console.log("validate:intake-gate passed");
