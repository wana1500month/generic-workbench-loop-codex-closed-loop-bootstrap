import { strict as assert } from "node:assert";

import {
  evaluateLoopIntent,
  renderLoopIntentResponse
} from "../packages/loop-orchestrator/dist/intent-gate.js";

console.log("[validate-resume-autocontinue] english resume intent enables same-thread autocontinue");
const englishResult = evaluateLoopIntent("Resume run-179 on the current thread.");
assert.equal(englishResult.intent, "run_control");
assert.equal(englishResult.run_control_action, "resume");
assert.equal(
  englishResult.run_control_primary_command,
  "npm run loop:resume -- --run-dir evals/runs/run-179 --json"
);
assert.equal(englishResult.run_control_dispatch_plan?.autocontinue?.enabled, true);
assert.equal(englishResult.run_control_dispatch_plan?.autocontinue?.worker, "loop-control");
assert.equal(
  englishResult.run_control_dispatch_plan?.autocontinue?.recovery_skill,
  "attached-loop"
);

const englishOutput = renderLoopIntentResponse(englishResult);
assert.match(englishOutput, /^Action:\s+resume/m);
assert.match(
  englishOutput,
  /^Command:\s+npm run loop:resume -- --run-dir evals\/runs\/run-179 --json/m
);
assert.match(englishOutput, /^Autocontinue:\s+same-thread foreground/m);
assert.match(englishOutput, /^Recovery skill:\s+\$attached-loop/m);
assert.doesNotMatch(englishOutput, /^Next skill:\s+\$attached-loop/m);

console.log("[validate-resume-autocontinue] korean resume phrasing stays in run_control");
const koreanResult = evaluateLoopIntent("run-179 이어가");
assert.equal(koreanResult.intent, "run_control");
assert.equal(koreanResult.run_control_action, "resume");
assert.equal(
  koreanResult.run_control_primary_command,
  "npm run loop:resume -- --run-dir evals/runs/run-179 --json"
);
assert.equal(koreanResult.run_control_dispatch_plan?.autocontinue?.enabled, true);
assert.equal(koreanResult.run_control_dispatch_plan?.autocontinue?.worker, "loop-control");
assert.equal(
  koreanResult.run_control_dispatch_plan?.autocontinue?.recovery_skill,
  "attached-loop"
);

const koreanOutput = renderLoopIntentResponse(koreanResult);
assert.match(koreanOutput, /^\uC758\uB3C4:\s+run_control/m);
assert.match(koreanOutput, /^\uB3D9\uC791:\s+resume/m);
assert.match(
  koreanOutput,
  /^\uBA85\uB839:\s+npm run loop:resume -- --run-dir evals\/runs\/run-179 --json/m
);
assert.match(
  koreanOutput,
  /^\uC5F0\uC18D \uC2E4\uD589:\s+same-thread autocontinue/m
);
assert.match(
  koreanOutput,
  /^\uBCF5\uAD6C \uC2A4\uD0AC:\s+\$attached-loop/m
);
assert.doesNotMatch(
  koreanOutput,
  /^\uB2E4\uC74C \uC2A4\uD0AC:\s+\$attached-loop/m
);

console.log("resume autocontinue validation passed.");
