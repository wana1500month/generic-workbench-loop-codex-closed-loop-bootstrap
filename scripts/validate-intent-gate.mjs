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

const koreanHarnessFixture = fixtures.find(
  (fixture) => fixture.id === "korean-harness-design-actual-prompt"
);
assert(koreanHarnessFixture, "Missing korean-harness-design-actual-prompt fixture.");
const koreanHarnessQuestions = renderLoopIntentResponse(
  evaluateLoopIntent(koreanHarnessFixture.request)
);
assert.match(
  koreanHarnessQuestions,
  /^1\.\s+(현재 흐름에서 어떤 구체적 결함|어떤 결과가 나오면 이번 하네스 변경이 효과 있었다고 볼 수 있나)/m
);

const koreanResumeRoute = renderLoopIntentResponse(
  evaluateLoopIntent(
    "evals/runs/run-042를 이어서 진행해줘. 지금 run은 environment_blocked로 멈췄고 다음 단계는 reopen인지 hold인지 결정해야 한다."
  )
);
assert.match(koreanResumeRoute, /^의도:\s+run_resume/m);
assert.match(koreanResumeRoute, /경로:\s+기존 run을 이어서 진행\./);

console.log(`validate:intent-gate passed (${fixtures.length} fixtures)`);
