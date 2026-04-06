import { spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const run = (args) => {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
};

const parseJson = (request) =>
  JSON.parse(
    run(["./packages/loop-orchestrator/dist/intake-gate-cli.js", "--json", request])
  );

const productOnlyRequest =
  "난 치지직 클립을 관리하고 자신만의 스토리보드를 만든 웹 서비스를 생각중이다. 치지직 로그인 후 클립을 드래그해서 보드에 배치하고 싶다. UI는 편집툴처럼 단순했으면 좋겠다.";

const productOnlyHumanOutput = run([
  "./packages/loop-orchestrator/dist/intake-gate-cli.js",
  productOnlyRequest
]);

assert.match(productOnlyHumanOutput, /^1\.\s+/m);
assert.ok(!/browser-editor/i.test(productOnlyHumanOutput), productOnlyHumanOutput);
assert.ok(!/3-?panel|패널|어댑터|adapter|wireframe|와이어프레임/i.test(productOnlyHumanOutput), productOnlyHumanOutput);
assert.ok(!/target score|max rounds|작업 폴더|새 프로젝트|기존 프로젝트/i.test(productOnlyHumanOutput), productOnlyHumanOutput);

const askProductResult = parseJson(productOnlyRequest);
assert.equal(askProductResult.status, "ask_product_questions");
assert.equal(askProductResult.phase, "product");
assert.equal(askProductResult.is_product_build_request, true);
assert.equal(askProductResult.internal_working_hypothesis, "browser-editor");
assert.ok(askProductResult.questions.length >= 2, JSON.stringify(askProductResult, null, 2));
assert.equal(askProductResult.missing_execution_fields.length, 0);

const productFilledRequest =
  "우리는 치지직 창작자를 위한 웹 기반 스토리보드 에디터를 만든다. 주요 사용자는 자신의 클립을 큐레이션하려는 1인 창작자다. 첫 버전에서는 로그인, 클립 라이브러리 정리, 보드에 드래그 앤 드롭 배치, 메모 작성, 저장이 반드시 가능해야 한다. 참고 화면은 Linear와 Figma 사이의 편집툴 느낌이면 좋다. MVP 성공 기준은 위 플로우가 실제로 동작하는 것이다.";

const askExecutionResult = parseJson(productFilledRequest);
assert.equal(askExecutionResult.status, "ask_execution_questions");
assert.equal(askExecutionResult.phase, "execution");
assert.ok(
  askExecutionResult.missing_execution_fields.includes("project_mode"),
  JSON.stringify(askExecutionResult, null, 2)
);
assert.ok(askExecutionResult.missing_execution_fields.includes("target_root"));
assert.ok(askExecutionResult.missing_execution_fields.includes("target_score"));
assert.ok(askExecutionResult.missing_execution_fields.includes("max_rounds"));
assert.ok(
  askExecutionResult.questions.some((question) => /target score/i.test(question)),
  JSON.stringify(askExecutionResult, null, 2)
);
assert.ok(
  askExecutionResult.questions.some((question) => /max rounds/i.test(question)),
  JSON.stringify(askExecutionResult, null, 2)
);

const existingProjectNeedsRuntimeHints = parseJson(
  `${productFilledRequest} 기존 프로젝트를 이어서 수정하고 작업 루트는 ./apps/storyboard 이다. target score는 0.88이고 max rounds는 4다.`
);
assert.equal(existingProjectNeedsRuntimeHints.status, "ask_execution_questions");
assert.ok(existingProjectNeedsRuntimeHints.missing_execution_fields.includes("run_command"));
assert.ok(existingProjectNeedsRuntimeHints.missing_execution_fields.includes("ready_url"));

const readyResult = parseJson(
  `${productFilledRequest} 새 프로젝트로 만들고 작업 루트는 C:\\Users\\SUNGMOK\\Desktop\\harness\\storyboard-app 이다. target score는 0.9이고 max rounds는 4다.`
);
assert.equal(readyResult.status, "ready_for_confirmation");
assert.equal(readyResult.phase, "confirmation");
assert.equal(readyResult.is_product_build_request, true);
assert.ok(Array.isArray(readyResult.confirmation_summary));
assert.ok(
  readyResult.confirmation_summary.some((line) => /Target score:\s*0\.9/i.test(line)),
  JSON.stringify(readyResult, null, 2)
);
assert.ok(
  readyResult.confirmation_summary.some((line) => /Max rounds:\s*4/i.test(line)),
  JSON.stringify(readyResult, null, 2)
);
assert.ok(
  !readyResult.confirmation_summary.some((line) => /family/i.test(line)),
  JSON.stringify(readyResult, null, 2)
);

console.log("validate:intake-gate passed");
