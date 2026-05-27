import { strict as assert } from "node:assert";

import { importDist } from "./testing/bootstrap-validator-helpers.mjs";

const main = async () => {
  const { evaluateIntakeRequest } = await importDist("intake-gate.js");
  const { mergeFrontDoorSessionTurn } = await importDist("front-door-session-merge.js");
  const { buildAdaptiveQuestionSet } = await importDist("adaptive-interviewer.js");

  const browserRequest = [
    "가계부 앱을 만들어줘.",
    "대상 사용자는 개인 사용자.",
    "핵심 기능: 수입/지출 추가, 목록 확인, 월별 합계.",
    "성공 기준: 첫 화면에서 거래를 추가하고 합계가 맞아야 함.",
    "새 프로젝트. target root ./apps/budget-app. target score 0.9. max rounds 4.",
    "평가 엄격도는 5.",
    "추가 평가 기준:",
    "- 깔끔함: 최소 9.2점. 여백, 정렬, 계층이 좋아야 함.",
    "- 쓸데없는 텍스트 없음: 최소 9.5점. 설명문이나 더미 텍스트가 과하면 실패."
  ].join("\n");
  const browserResult = evaluateIntakeRequest(browserRequest);
  const merged = mergeFrontDoorSessionTurn({
    sourceRequest: browserRequest,
    message: browserRequest,
    intakeResult: browserResult,
    turnCount: 1
  });
  assert.equal(merged.intake.strictness_level, 5);
  assert.equal(merged.intake.project_kind, "browser_ui");
  assert.ok(merged.intake.evidence_surfaces?.includes("browser"));
  assert.ok((merged.intake.custom_quality_metrics ?? []).length >= 2);
  const explicitMetricById = new Map(
    (merged.intake.custom_quality_metrics ?? []).map((metric) => [
      metric.metric_id,
      metric
    ])
  );
  assert.equal(
    explicitMetricById.get("custom.\uAE54\uB054\uD568")?.minimum_score_out_of_ten,
    9.2
  );
  assert.equal(
    explicitMetricById.get("custom.\uC4F8\uB370\uC5C6\uB294_\uD14D\uC2A4\uD2B8_\uC5C6\uC74C")
      ?.minimum_score_out_of_ten,
    9.5
  );

  const cliRequest = [
    "CLI 로그 분석기를 만들어줘.",
    "대상 사용자는 운영자.",
    "핵심 기능: sample.log를 분석해서 summary.json을 생성.",
    "성공 기준: 명령 실행 후 summary.json과 표준 출력 요약이 생성됨.",
    "기존 프로젝트. target root ./tools/log-analyzer. target score 0.9. max rounds 3.",
    "run command node ./bin/log-analyzer.js sample.log"
  ].join("\n");
  const cliResult = evaluateIntakeRequest(cliRequest);
  assert.ok(
    cliResult.questions.every((question) => !/ready URL|127\.0\.0\.1/u.test(question)),
    `CLI adaptive intake should not ask for browser ready URL: ${cliResult.questions.join(" | ")}`
  );

  const scorelessCriteriaRequest = [
    "Build a CLI report generator.",
    "Target users: operators.",
    "Core workflows: generate report.md from input.json.",
    "Good enough means the generated report is stable and readable.",
    "Existing project. target root ./tools/reporter. target score 0.9. max rounds 3.",
    "run command node ./bin/reporter.js input.json",
    "Strictness level 5.",
    "Penalize excessive helper text.",
    "Fail if it does not feel app-like when a UI surface is present.",
    "Output format must stay consistent across runs."
  ].join("\n");
  const scorelessResult = evaluateIntakeRequest(scorelessCriteriaRequest);
  const scorelessMerged = mergeFrontDoorSessionTurn({
    sourceRequest: scorelessCriteriaRequest,
    message: scorelessCriteriaRequest,
    intakeResult: scorelessResult,
    turnCount: 1
  });
  const scorelessMetricIds = new Set(
    (scorelessMerged.intake.custom_quality_metrics ?? []).map(
      (metric) => metric.metric_id
    )
  );
  assert.ok(scorelessMetricIds.has("design.no_noise_text"));
  assert.ok(scorelessMetricIds.has("design.app_like_feel"));
  assert.ok(scorelessMetricIds.has("output.consistency"));
  assert.ok(
    (scorelessMerged.intake.custom_quality_metrics ?? []).every(
      (metric) => metric.minimum_score_out_of_ten >= 9.3
    )
  );

  const libraryQuestions = buildAdaptiveQuestionSet({
    request:
      "Build an npm package SDK. It should expose a clean import API and stable examples.",
    hasVerificationSurface: false,
    hasWorkflowChecks: false,
    hasCustomQualityMetrics: false,
    hasFailureExpectations: false,
    maxQuestions: 3
  });
  assert.equal(libraryQuestions.project_kind, "library_package");
  assert.ok(libraryQuestions.evidence_surfaces.includes("package_import"));
  assert.ok(libraryQuestions.selected_questions.length <= 3);
  assert.ok(
    libraryQuestions.selected_questions.every(
      (question) => question.why_it_matters.length > 0
    )
  );
  assert.match(
    libraryQuestions.by_field.workflow_checks.question,
    /import\/API call/u
  );
};

await main();
console.log("validate:adaptive-intake passed");
