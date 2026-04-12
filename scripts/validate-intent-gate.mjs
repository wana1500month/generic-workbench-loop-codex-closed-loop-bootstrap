import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateLoopIntent,
  renderLoopIntentResponse
} from "../packages/loop-orchestrator/dist/intent-gate.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(repoRoot, "scripts/fixtures/intent-gate-cases.json");

const fixtures = JSON.parse(readFileSync(fixturePath, "utf8"));

for (const fixture of fixtures) {
  const result = evaluateLoopIntent(fixture.request);

  assert.equal(result.intent, fixture.expect_intent, `${fixture.id}: unexpected intent`);
  assert.equal(result.status, fixture.expect_status, `${fixture.id}: unexpected status`);
  assert.equal(result.route_target, fixture.expect_route, `${fixture.id}: unexpected route`);

  if (fixture.expect_intake_status) {
    assert.equal(
      result.intake_status,
      fixture.expect_intake_status,
      `${fixture.id}: unexpected intake status`
    );
  }

  if (fixture.expect_run_reference) {
    assert.match(
      result.extracted_run_reference ?? "",
      new RegExp(fixture.expect_run_reference, "i"),
      `${fixture.id}: missing run reference`
    );
  }

  if (fixture.expect_run_control_action) {
    assert.equal(
      result.run_control_action,
      fixture.expect_run_control_action,
      `${fixture.id}: unexpected run-control action`
    );
  }

  if (fixture.expect_targets_all_runs !== undefined) {
    assert.equal(
      result.run_control_targets_all_runs,
      fixture.expect_targets_all_runs,
      `${fixture.id}: unexpected all-runs targeting flag`
    );
  }

  if (fixture.expect_run_control_start_surface) {
    assert.equal(
      result.run_control_start_surface,
      fixture.expect_run_control_start_surface,
      `${fixture.id}: unexpected start surface`
    );
  }

  if (fixture.expect_primary_command) {
    assert.equal(
      result.run_control_primary_command,
      fixture.expect_primary_command,
      `${fixture.id}: unexpected primary command`
    );
  }

  if (fixture.expect_diagnostic_focus) {
    assert.deepEqual(
      result.run_control_diagnostic_focus ?? [],
      fixture.expect_diagnostic_focus,
      `${fixture.id}: unexpected run-control diagnostic focus`
    );
  }
}

const harnessHumanOutput = renderLoopIntentResponse(
  evaluateLoopIntent(
    "Add a new loop:intent router so harness-design requests stop falling through product intake. The current gap is that harness requests are misclassified as product builds, and success means the operator lands in the harness lane without extra intake prompts. Keep loop:intake product-only, add .agents/skills for the operator surface, and make the next step explicit."
  )
);
assert.match(harnessHumanOutput, /^Intent:\s+harness_design/m);
assert.match(harnessHumanOutput, /Route:\s+proceed in the harness-design lane\./i);

const runControlHumanOutput = renderLoopIntentResponse(
  evaluateLoopIntent(
    "Start loop with loop:start:codex on the current-thread foreground surface instead of loop:start:bg detached background supervisor mode."
  )
);
assert.match(runControlHumanOutput, /^Intent:\s+run_control/m);
assert.match(runControlHumanOutput, /Route:\s+proceed in the run-control lane\./i);
assert.match(runControlHumanOutput, /^Action:\s+start/m);
assert.match(runControlHumanOutput, /^Start surface:\s+Codex foreground current-thread/m);
assert.match(runControlHumanOutput, /^Command:\s+npm run loop:start:codex/m);

const koreanRunControlRoute = renderLoopIntentResponse(
  evaluateLoopIntent("\uD604\uC7AC \uB8E8\uD504 \uC0C1\uD0DC")
);
assert.match(koreanRunControlRoute, /\uC758\uB3C4:\s+run_control/);
assert.match(
  koreanRunControlRoute,
  /\uACBD\uB85C:\s+run-control \uB808\uC778\uC73C\uB85C \uC9C4\uD589\./
);
assert.match(koreanRunControlRoute, /\uB3D9\uC791:\s+status/);
assert.match(koreanRunControlRoute, /\uBA85\uB839:\s+npm run loop:status/);

const compoundRunControl = evaluateLoopIntent(
  "\uBAA8\uB4E0 \uB8E8\uD504 \uC815\uC9C0\uD558\uACE0 \uC65C \uD0C0\uC784\uC544\uC6C3 \uB098\uB294\uC9C0 \uC6D0\uC778 \uC0C1\uC138\uD558\uAC8C \uADDC\uBA85"
);
assert.equal(compoundRunControl.intent, "run_control");
assert.equal(compoundRunControl.run_control_action, "stop");
assert.deepEqual(compoundRunControl.run_control_diagnostic_focus, ["timeout_root_cause"]);
assert.equal(compoundRunControl.run_control_primary_command, "npm run loop:stop -- --all");
assert.deepEqual(compoundRunControl.run_control_follow_up_commands, ["npm run loop:status"]);
const compoundRunControlOutput = renderLoopIntentResponse(compoundRunControl);
assert.match(compoundRunControlOutput, /^\uB3D9\uC791:\s+stop/m);
assert.match(compoundRunControlOutput, /^\uB300\uC0C1:\s+\uBAA8\uB4E0 run/m);
assert.match(compoundRunControlOutput, /^\uC9C4\uB2E8 \uD3EC\uCEE4\uC2A4:\s+timeout_root_cause/m);
assert.match(compoundRunControlOutput, /^\uBA85\uB839:\s+npm run loop:stop -- --all/m);
assert.match(compoundRunControlOutput, /^\uB2E4\uC74C \uBA85\uB839:\s+npm run loop:status/m);

const koreanHarnessFixture = fixtures.find(
  (fixture) => fixture.id === "korean-harness-design-actual-prompt"
);
assert(koreanHarnessFixture, "Missing korean-harness-design-actual-prompt fixture.");
const koreanHarnessQuestions = renderLoopIntentResponse(
  evaluateLoopIntent(koreanHarnessFixture.request)
);
assert.match(koreanHarnessQuestions, /^1\.\s+/m);

const koreanResumeRoute = renderLoopIntentResponse(
  evaluateLoopIntent(
    "evals/runs/run-042瑜??댁뼱??吏꾪뻾?댁쨾. 吏湲?run? environment_blocked濡?硫덉톬怨??ㅼ쓬 ?④퀎??reopen?몄? hold?몄? 寃곗젙?댁빞 ?쒕떎."
  )
);
assert.match(koreanResumeRoute, /^\uC758\uB3C4:\s+run_resume/m);
assert.match(koreanResumeRoute, /\uACBD\uB85C:\s+\uAE30\uC874 run\uC744 \uC774\uC5B4\uC11C \uC9C4\uD589\./);

console.log(`validate:intent-gate passed (${fixtures.length} fixtures)`);
