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
assert.ok(askProductResult.questions.length >= 1, JSON.stringify(askProductResult, null, 2));
assert.ok(askProductResult.questions.length <= 3, JSON.stringify(askProductResult, null, 2));
assert.ok(
  askProductResult.questions.every((question) => !/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/u.test(question)),
  JSON.stringify(askProductResult, null, 2)
);
assert.equal(askProductResult.missing_execution_fields.length, 0);
assert.equal(askProductResult.extracted_target_score, 0.9);
assert.equal(askProductResult.extracted_max_rounds, 3);

const koreanBudgetInitial = evaluateIntakeRequest("가계부 앱 만들어줘");
assert.equal(koreanBudgetInitial.status, "ask_product_questions");
assert.equal(koreanBudgetInitial.locale, "ko");
assert.equal(koreanBudgetInitial.extracted_target_root, undefined);
assert.match(koreanBudgetInitial.extracted_summary ?? "", /가계부 앱/);
assert.ok(
  !koreanBudgetInitial.questions.some((question) => /참고/.test(question)),
  JSON.stringify(koreanBudgetInitial, null, 2)
);

const koreanSlashWorkflow = evaluateIntakeRequest(
  "가계부 앱 만들어줘. 주 사용자는 개인 사용자. 핵심 작업: 수입/지출 기록, 카테고리 관리, 월별 통계. 성공 기준: 거래 추가/삭제와 통계 확인 가능."
);
assert.equal(koreanSlashWorkflow.extracted_target_root, undefined);

const englishSlashWorkflow = evaluateIntakeRequest(
  "Build a personal budgeting web app for individuals. Core workflows: add income/expense transactions, categorize them, and view monthly summary. Finish line: users can add/delete transactions and see monthly summary."
);
assert.equal(englishSlashWorkflow.extracted_target_root, undefined);

const explicitKoreanTargetRoot = evaluateIntakeRequest(
  "가계부 앱 만들어줘. 주 사용자는 개인 사용자. 핵심 작업: 수입/지출 기록, 월별 통계. 성공 기준: 통계 확인 가능. 새 프로젝트고 작업 폴더는 ./apps/budget-app."
);
assert.equal(explicitKoreanTargetRoot.extracted_target_root, "./apps/budget-app");

for (const request of [
  "Build me a todo app with auth",
  "Create a CRM web app for sales reps",
  "Make a booking service for salons",
  "Create a support agent for customer replies",
  "Build an internal platform for finance approvals",
  "Create an API for developers",
  "Create a website for a service",
  "Build an agent review dashboard for QA",
  "Build an API docs portal for developers",
  "Build a documentation portal for API developers",
  "Create API documentation tool for developers",
  "Create a website copy editor for marketers",
  "Build a dashboard for audit teams",
  "Build a portal for content teams",
  "Build a content management system for marketers",
  "Build a review management tool for HR",
  "Build a documentation portal for developers",
  "Build an audit portal for compliance",
  "감사팀용 대시보드 만들어줘",
  "문서 관리툴 만들어줘",
  "콘텐츠 관리 시스템 만들어줘",
  "리뷰 관리 도구 만들어줘",
  "문서 자동화 도구 만들어줘"
]) {
  const result = evaluateIntakeRequest(request);
  assert.equal(result.is_product_build_request, true, request);
  assert.equal(result.status, "ask_product_questions", request);
}

const nonProduct = evaluateIntakeRequest(
  "Make patch authority carry-forward safer in the harness control plane."
);
assert.equal(nonProduct.status, "not_product_build_request");

for (const request of [
  "Build onboarding docs for our service",
  "Design product strategy for Q2",
  "Create a SaaS pricing page copy refresh",
  "Add a new loop:intent router so harness-design requests stop falling through product intake",
  "Create customer service strategy for support team",
  "Build a service roadmap for Q2",
  "Make internal platform documentation for admins",
  "Create an agent evaluation spec for QA",
  "Build an API spec for developers",
  "Build a dashboard strategy for operators",
  "Create website copy for a service",
  "Create API documentation for developers",
  "API 문서 만들어줘",
  "서비스 로드맵 만들어줘",
  "대시보드 전략 작성해줘"
]) {
  const result = evaluateIntakeRequest(request);
  assert.equal(result.status, "not_product_build_request", request);
}

const productFilledRequest =
  "Build a storyboard editor for indie animators. The target users are solo creators. The core workflows are arranging boards, dragging panels, and writing notes. References can be Linear and Figma. Good enough means those workflows run end to end.";
const browserAdapterClause =
  "Verify with browser. arranging boards -> board arrangement is visible. dragging panels -> panel movement result is visible. writing notes -> note result is visible.";
const productFilledWithAdapterRequest = `${productFilledRequest} ${browserAdapterClause}`;
const adapterSurfaceOnlyResult = evaluateIntakeRequest(
  `${productFilledRequest} This is a new project and the target root is ./apps/storyboard. Verify with browser.`
);
assert.equal(adapterSurfaceOnlyResult.status, "ask_adapter_questions");
assert.ok(
  adapterSurfaceOnlyResult.missing_adapter_fields.includes("workflow_checks"),
  JSON.stringify(adapterSurfaceOnlyResult, null, 2)
);

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
  `${productFilledWithAdapterRequest} This is a new project and the target root is /tmp/loop-dashboard.`
);
assert.equal(absolutePosixPathResult.status, "ready_for_prepare");
assert.equal(absolutePosixPathResult.extracted_target_root, "/tmp/loop-dashboard");

const koreanSentenceEndingPathResult = evaluateIntakeRequest(
  `${productFilledWithAdapterRequest} \uC0C8 \uD504\uB85C\uC81D\uD2B8\uACE0 \uC791\uC5C5 \uD3F4\uB354\uB294 /tmp/crm-dashboard\uB2E4.`
);
assert.equal(koreanSentenceEndingPathResult.status, "ready_for_prepare");
assert.equal(koreanSentenceEndingPathResult.extracted_target_root, "/tmp/crm-dashboard");

const koreanCasualPathResult = evaluateIntakeRequest(
  `${productFilledWithAdapterRequest} \uACBD\uB85C\uB294 /tmp/crm-dashboard\uC57C.`
);
assert.equal(koreanCasualPathResult.extracted_target_root, "/tmp/crm-dashboard");

const normalizedTargetScoreResult = evaluateIntakeRequest(
  `${productFilledWithAdapterRequest} This is a new project and the target root is ./apps/storyboard. target score 82.`
);
assert.equal(normalizedTargetScoreResult.status, "ready_for_prepare");
assert.equal(normalizedTargetScoreResult.extracted_target_score, 0.82);
assert.equal(normalizedTargetScoreResult.extracted_max_rounds, 3);

const invalidTargetScoreResult = evaluateIntakeRequest(
  `${productFilledWithAdapterRequest} This is a new project and the target root is ./apps/storyboard. target score 120.`
);
assert.equal(invalidTargetScoreResult.status, "ready_for_prepare");
assert.equal(invalidTargetScoreResult.extracted_target_score, 0.9);

const newProjectOnboardingTitleResult = evaluateIntakeRequest(
  "Build a new project onboarding dashboard for PMs. Primary users are PMs. Core workflows: create a project, assign owners, and track milestones. References: Linear. Finish line: users can create and track projects."
);
assert.equal(newProjectOnboardingTitleResult.status, "ask_execution_questions");
assert.equal(
  newProjectOnboardingTitleResult.extracted_summary,
  "new project onboarding dashboard for PMs"
);
assert.equal(newProjectOnboardingTitleResult.extracted_project_mode, undefined);
assert.ok(
  newProjectOnboardingTitleResult.missing_execution_fields.includes("project_mode"),
  JSON.stringify(newProjectOnboardingTitleResult, null, 2)
);
assert.equal(newProjectOnboardingTitleResult.extracted_target_root, undefined);

const projectRootExplorerTitleResult = evaluateIntakeRequest(
  "Build a project root explorer for monorepos. Primary users are platform engineers. Core workflows: browse packages, inspect boundaries, and copy paths. References: VS Code explorer. Finish line: users can inspect and copy package roots."
);
assert.equal(projectRootExplorerTitleResult.status, "ask_execution_questions");
assert.equal(
  projectRootExplorerTitleResult.extracted_summary,
  "project root explorer for monorepos"
);
assert.equal(projectRootExplorerTitleResult.extracted_target_root, undefined);
assert.ok(
  projectRootExplorerTitleResult.missing_execution_fields.includes("target_root"),
  JSON.stringify(projectRootExplorerTitleResult, null, 2)
);

const workingFolderPickerTitleResult = evaluateIntakeRequest(
  "Build a working folder picker for desktop apps. Primary users are designers. Core workflows: choose a folder, preview recent paths, and save the selection. References: Finder. Finish line: users can choose and save a folder."
);
assert.equal(workingFolderPickerTitleResult.status, "ask_execution_questions");
assert.equal(
  workingFolderPickerTitleResult.extracted_summary,
  "working folder picker for desktop apps"
);
assert.equal(workingFolderPickerTitleResult.extracted_target_root, undefined);

const koreanFolderPickerTitleResult = evaluateIntakeRequest(
  "\uB370\uC2A4\uD06C\uD1B1 \uC571\uC6A9 \uC791\uC5C5 \uD3F4\uB354 \uC120\uD0DD\uAE30 \uB9CC\uB4E4\uC5B4\uC918. Primary users are designers. Core workflows: choose a folder, preview recent paths, and save the selection. References: Finder. Finish line: users can choose and save a folder."
);
assert.equal(koreanFolderPickerTitleResult.status, "ask_execution_questions");
assert.equal(koreanFolderPickerTitleResult.locale, "ko");
assert.equal(koreanFolderPickerTitleResult.extracted_target_root, undefined);
assert.match(
  koreanFolderPickerTitleResult.extracted_summary ?? "",
  /\uC791\uC5C5 \uD3F4\uB354 \uC120\uD0DD\uAE30/
);

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
  `${productFilledWithAdapterRequest} This is a new project and the target root is C:\\Users\\SUNGMOK\\Desktop\\harness\\storyboard-app. target score 0.9 and max rounds 4.`
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
const readyGoalLine = readyResult.preparation_summary.find((line) => /^Goal:/i.test(line));
assert.ok(readyGoalLine, JSON.stringify(readyResult, null, 2));
assert.match(readyGoalLine, /Goal:\s*storyboard editor for indie animators/i);
assert.ok(!/This is a new project|max rounds|target root/i.test(readyGoalLine), readyGoalLine);

const koreanReadyResult = evaluateIntakeRequest(
  productFilledWithAdapterRequest + " \uC0C8 \uD504\uB85C\uC81D\uD2B8\uACE0 \uC791\uC5C5\uD3F4\uB354 /tmp/loop-dashboard \uBAA9\uD45C\uC810\uC218 82 \uCD5C\uB300 4\uB77C\uC6B4\uB4DC."
);
assert.equal(koreanReadyResult.status, "ready_for_prepare");
assert.equal(koreanReadyResult.locale, "ko");
assert.equal(koreanReadyResult.extracted_target_root, "/tmp/loop-dashboard");
assert.equal(koreanReadyResult.extracted_target_score, 0.82);
assert.equal(koreanReadyResult.extracted_max_rounds, 4);
assert.ok(
  koreanReadyResult.questions.every((question) => /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/u.test(question)) ||
    koreanReadyResult.questions.length === 0,
  JSON.stringify(koreanReadyResult, null, 2)
);
assert.ok(
  koreanReadyResult.preparation_summary.some((line) => /\uBAA9\uD45C \uC810\uC218:\s*0\.82/.test(line)),
  JSON.stringify(koreanReadyResult, null, 2)
);
assert.ok(
  koreanReadyResult.preparation_summary.some((line) => /\uCD5C\uB300 \uB77C\uC6B4\uB4DC:\s*4/.test(line)),
  JSON.stringify(koreanReadyResult, null, 2)
);
const koreanGoalLine = koreanReadyResult.preparation_summary.find((line) =>
  /^\uBAA9\uD45C:/.test(line)
);
assert.ok(koreanGoalLine, JSON.stringify(koreanReadyResult, null, 2));
assert.ok(!/\uC791\uC5C5\uD3F4\uB354|\uBAA9\uD45C\uC810\uC218|\uCD5C\uB300/.test(koreanGoalLine), koreanGoalLine);

const readyHumanOutput = renderIntakeGateResponse(readyResult);
assert.match(readyHumanOutput, /Preparation is complete\./);
assert.match(readyHumanOutput, /ready_to_start/);
assert.match(readyHumanOutput, /start loop/i);

console.log("validate:intake-gate passed");
