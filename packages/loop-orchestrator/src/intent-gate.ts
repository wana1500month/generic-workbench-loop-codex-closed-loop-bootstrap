import {
  evaluateIntakeRequest,
  renderIntakeGateResponse,
  type IntakeGateResult
} from "./intake-gate.js";

type HarnessIntentFieldId = "change_goal" | "current_gap" | "success_criteria";
type ResumeIntentFieldId = "run_reference" | "current_state" | "next_step";
type EvaluatorIntentFieldId = "calibration_focus" | "failure_examples" | "success_criteria";
type IntentFieldId =
  | HarnessIntentFieldId
  | ResumeIntentFieldId
  | EvaluatorIntentFieldId;

export type LoopIntent =
  | "product_build"
  | "harness_design"
  | "run_resume"
  | "evaluator_tuning"
  | "unknown";

export type LoopIntentStatus =
  | "route_to_product_intake"
  | "ask_harness_questions"
  | "ask_resume_questions"
  | "ask_evaluator_questions"
  | "ready_for_handoff"
  | "unclassified";

export type LoopIntentPhase = "none" | "intent" | "handoff";
export type LoopIntentRoute =
  | "product_intake"
  | "harness_design"
  | "run_resume"
  | "evaluator_tuning"
  | "clarify";

interface IntentFieldState<TFieldId extends IntentFieldId = IntentFieldId> {
  id: TFieldId;
  satisfied: boolean;
  question: string;
}

export interface LoopIntentResult {
  intent: LoopIntent;
  status: LoopIntentStatus;
  phase: LoopIntentPhase;
  confidence: number;
  route_target: LoopIntentRoute;
  questions: string[];
  missing_fields: IntentFieldId[];
  satisfied_fields: IntentFieldId[];
  rationale: string[];
  extracted_run_reference?: string;
  intake?: IntakeGateResult;
  intake_status?: IntakeGateResult["status"];
  intake_phase?: IntakeGateResult["phase"];
  intake_missing_fields?: string[];
}

const HARNESS_SURFACE_KEYWORDS = [
  "harness",
  "하네스",
  "closed-loop",
  "닫힌 루프",
  "control plane",
  "제어면",
  "planner",
  "플래너",
  "generator",
  "evaluator",
  "평가기",
  "오퍼레이터 surface",
  "operator surface",
  "operator ux",
  "codex app",
  "codex 앱",
  "loop:intent",
  "loop:intake",
  "loop:run",
  ".agents/skills",
  ".codex/agents",
  "agents.md",
  "runbook.md",
  "status.md",
  "plans.md",
  "subagent",
  "subagents",
  "thread fork",
  "worktree",
  "durable memory",
  "feature ledger",
  "feature_list.generated.json",
  "progress.md",
  "done_when.md",
  "quality critique",
  "quality-critique",
  "patch-request",
  "trajectory-decision",
  "round-contract",
  "bootstrap",
  "router",
  "intent gate",
  "intake gate",
  "control-plane",
  "resume-identity"
] as const;

const HARNESS_PATH_KEYWORDS = [
  "packages/loop-orchestrator",
  "packages\\loop-orchestrator",
  "evals/runs",
  "evals\\runs",
  "evals/rubrics",
  "evals\\rubrics",
  ".agents/skills",
  ".codex/agents",
  "agents.md",
  "runbook.md",
  "status.md",
  "plans.md",
  "feature_list.generated.json",
  "progress.md",
  "done_when.md",
  "loop:intent",
  "loop:intake"
] as const;

const RUN_RESUME_KEYWORDS = [
  "resume",
  "resume-run",
  "--resume-run",
  "continue run",
  "reopen",
  "pick up",
  "carry on",
  "이어",
  "이어서",
  "이어서 진행",
  "이어가기",
  "재개",
  "재시작",
  "다시 열기",
  "last patch request",
  "latest patch request",
  "codex-handoff",
  "controller-summary",
  "summary.json",
  "resume-identity",
  "resume-migration",
  "force-reopen-terminal",
  "terminal run"
] as const;

const EVALUATOR_SURFACE_KEYWORDS = [
  "evaluator tuning",
  "evaluator",
  "평가기",
  "rubric",
  "quality lift",
  "calibration",
  "calibrate",
  "보정",
  "튜닝",
  "threshold",
  "임계값",
  "few-shot",
  "golden",
  "goldens",
  "negative exemplar",
  "positive exemplar",
  "exemplar",
  "false positive",
  "false negative",
  "오탐",
  "미탐",
  "subjective metrics",
  "quality_contract",
  "quality contract",
  "verification profile",
  "release gate",
  "light lane",
  "heavy lane",
  "probe",
  "browser-app",
  "dashboard",
  "api-service",
  "browser-editor",
  "fullstack-app",
  "chat-agent",
  "best_passing"
] as const;

const NON_PRODUCT_CHANGE_HINTS = [
  "add",
  "change",
  "refactor",
  "split",
  "route",
  "promote",
  "remove",
  "replace",
  "design",
  "tune",
  "lift",
  "improve",
  "upgrade",
  "wire",
  "adjust",
  "fix",
  "introduce",
  "support",
  "separate",
  "추가",
  "분리",
  "승격",
  "교체",
  "보강",
  "개선",
  "수정",
  "보정",
  "튜닝",
  "올리기",
  "남기기",
  "숨기기",
  "남긴다",
  "바꾸기"
] as const;

const GAP_HINTS = [
  "current",
  "today",
  "now",
  "missing",
  "gap",
  "weak",
  "lack",
  "problem",
  "pain",
  "falls through",
  "not enough",
  "middle state",
  "still",
  "현재",
  "지금",
  "빠진",
  "빠집니다",
  "놓칩니다",
  "약합니다",
  "문제",
  "병목",
  "부족",
  "비어",
  "오분류",
  "삼켜버립니다",
  "어렵",
  "불안정",
  "신뢰",
  "앞문"
] as const;

const SUCCESS_HINTS = [
  "priority",
  "first",
  "next",
  "goal",
  "good enough",
  "done when",
  "should",
  "must",
  "need",
  "acceptance",
  "outcome",
  "lift",
  "trigger condition",
  "trigger conditions",
  "closeout",
  "release closeout",
  "우선순위",
  "다음",
  "목표",
  "좋은 상태",
  "성공",
  "완료",
  "끝내려면",
  "되어야",
  "해야",
  "필요",
  "한 줄로",
  "정리하면",
  "믿고",
  "앞문",
  "쓸 수 있는 상태",
  "보강",
  "신뢰"
] as const;

const EVALUATOR_EXAMPLE_HINTS = [
  "false positive",
  "false negative",
  "example",
  "examples",
  "golden",
  "goldens",
  "exemplar",
  "plateau",
  "regression",
  "signature repeat",
  "오탐",
  "미탐",
  "예시",
  "사례",
  "골든",
  "회귀",
  "플래토",
  "반복"
] as const;

const EVALUATOR_OVERRIDE_HINTS = [
  "tune",
  "calibrate",
  "adjust",
  "threshold",
  "heavy lane",
  "light lane",
  "rubric",
  "verification profile",
  "bundle",
  "quality contract",
  "subjective metrics",
  "보정",
  "튜닝",
  "조정",
  "임계값",
  "lane",
  "프로파일",
  "번들"
] as const;

const RUN_STATE_HINTS = [
  "blocked",
  "failed",
  "holding",
  "hold",
  "stopped",
  "round",
  "patch request",
  "stop reason",
  "environment_blocked",
  "target_reached",
  "contract_completed",
  "max_rounds_reached",
  "막힘",
  "실패",
  "중단",
  "보류",
  "라운드",
  "패치 요청",
  "중지 사유"
] as const;

const RUN_ACTION_HINTS = [
  "resume",
  "continue",
  "reopen",
  "advance",
  "close out",
  "closeout",
  "fix",
  "hold",
  "decide",
  "next step",
  "재개",
  "이어가기",
  "다시 열기",
  "계속",
  "마감",
  "닫기",
  "보류",
  "결정"
] as const;

const RUN_REFERENCE_PATTERN =
  /(evals[\\/]+runs[\\/]+run-\d+|(?:[A-Za-z]:\\|\.{1,2}[\\/])?[^\r\n\s]*run-\d+[^\r\n\s]*)/i;

const PRODUCT_CONTEXT_PATTERN =
  /\b(?:build|create|ship|prototype|design)\b.{0,48}\b(?:app|service|editor|dashboard|api|agent|workspace|storyboard)\b|\b(?:app|service|editor|dashboard|api|agent|workspace|storyboard)\b.{0,48}\b(?:build|create|ship|prototype|design)\b|(?:구현|만들|개발|설계).{0,24}(?:앱|서비스|에디터|대시보드|api|agent)|(?:앱|서비스|에디터|대시보드|api|agent).{0,24}(?:구현|만들|개발|설계)/i;

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();

const lowerText = (value: string): string => normalizeText(value).toLowerCase();

const includesAny = (value: string, keywords: readonly string[]): boolean =>
  keywords.some((keyword) => value.includes(keyword));

const collectMatchedKeywords = (value: string, keywords: readonly string[]): string[] =>
  keywords.filter((keyword) => value.includes(keyword));

const roundScore = (value: number): number => Number(value.toFixed(3));

const buildHarnessFieldStates = (
  request: string,
  normalizedLower: string,
  matchedKeywords: readonly string[]
): IntentFieldState<HarnessIntentFieldId>[] => {
  const normalized = normalizeText(request);
  const goalSignal =
    includesAny(normalizedLower, NON_PRODUCT_CHANGE_HINTS) || matchedKeywords.length >= 2;

  return [
    {
      id: "change_goal",
      satisfied: normalized.length >= 32 && goalSignal,
      question: "What harness surface or operator path should change first?"
    },
    {
      id: "current_gap",
      satisfied: includesAny(normalizedLower, GAP_HINTS),
      question: "What concrete gap, failure mode, or operator pain exists in the current flow?"
    },
    {
      id: "success_criteria",
      satisfied: includesAny(normalizedLower, SUCCESS_HINTS) || /\b1\.\s|\b2\.\s/.test(request),
      question: "What outcome would tell us the harness change worked?"
    }
  ];
};

const buildResumeFieldStates = (
  request: string,
  normalizedLower: string
): IntentFieldState<ResumeIntentFieldId>[] => {
  const runReference = extractRunReference(request);

  return [
    {
      id: "run_reference",
      satisfied: runReference !== undefined,
      question: "Which run should be resumed? Provide the run directory or run id."
    },
    {
      id: "current_state",
      satisfied: includesAny(normalizedLower, RUN_STATE_HINTS),
      question: "What is the current run state, stop reason, or latest patch status?"
    },
    {
      id: "next_step",
      satisfied: includesAny(normalizedLower, RUN_ACTION_HINTS),
      question: "What should happen next: reopen, continue, hold, or close out?"
    }
  ];
};

const buildEvaluatorFieldStates = (
  request: string,
  normalizedLower: string,
  matchedKeywords: readonly string[]
): IntentFieldState<EvaluatorIntentFieldId>[] => [
  {
    id: "calibration_focus",
    satisfied:
      matchedKeywords.length >= 2 ||
      /(?:browser-app|dashboard|api-service|chat-agent|fullstack-app|browser-editor|light lane|heavy lane)/i.test(
        request
      ),
    question: "Which evaluator lane, family, or rubric surface needs calibration?"
  },
  {
    id: "failure_examples",
    satisfied: includesAny(normalizedLower, EVALUATOR_EXAMPLE_HINTS),
    question: "What examples show the evaluator getting it wrong today?"
  },
  {
    id: "success_criteria",
    satisfied: includesAny(normalizedLower, SUCCESS_HINTS),
    question: "What lift or calibration outcome should count as a successful evaluator change?"
  }
];

const extractRunReference = (request: string): string | undefined => {
  const match = request.match(RUN_REFERENCE_PATTERN)?.[0]?.trim();
  return match && match.length > 0 ? match : undefined;
};

const calculateConfidence = (score: number): number => roundScore(Math.min(0.55 + score * 0.08, 0.97));

const buildQuestions = (states: IntentFieldState[]): string[] =>
  states.filter((field) => !field.satisfied).map((field) => field.question);

const buildMissingFields = <TFieldId extends IntentFieldId>(
  states: IntentFieldState<TFieldId>[]
): TFieldId[] => states.filter((field) => !field.satisfied).map((field) => field.id);

const buildSatisfiedFields = <TFieldId extends IntentFieldId>(
  states: IntentFieldState<TFieldId>[]
): TFieldId[] => states.filter((field) => field.satisfied).map((field) => field.id);

const buildIntentRationale = (label: string, matchedKeywords: readonly string[]): string[] => {
  if (matchedKeywords.length === 0) {
    return [`Matched ${label} signals from the request.`];
  }

  return [`Matched ${label} signals: ${matchedKeywords.slice(0, 5).join(", ")}.`];
};

const buildProductResult = (
  intake: IntakeGateResult,
  rationale: string[]
): LoopIntentResult => ({
  intent: "product_build",
  status: "route_to_product_intake",
  phase: intake.status === "ready_for_confirmation" ? "handoff" : "intent",
  confidence: intake.status === "ready_for_confirmation" ? 0.96 : 0.91,
  route_target: "product_intake",
  questions: intake.questions,
  missing_fields: [],
  satisfied_fields: [],
  rationale,
  intake,
  intake_status: intake.status,
  intake_phase: intake.phase,
  intake_missing_fields: intake.missing_fields
});

export const evaluateLoopIntent = (request: string): LoopIntentResult => {
  const normalizedLower = lowerText(request);
  const runReference = extractRunReference(request);
  const intake = evaluateIntakeRequest(request);

  const harnessMatched = collectMatchedKeywords(normalizedLower, HARNESS_SURFACE_KEYWORDS);
  const harnessPathMatched = collectMatchedKeywords(normalizedLower, HARNESS_PATH_KEYWORDS);
  const resumeMatched = collectMatchedKeywords(normalizedLower, RUN_RESUME_KEYWORDS);
  const evaluatorMatched = collectMatchedKeywords(normalizedLower, EVALUATOR_SURFACE_KEYWORDS);

  const mentionsHarnessSurface = harnessMatched.length > 0 || harnessPathMatched.length > 0;
  const mentionsRepoSurface = harnessPathMatched.length > 0;
  const hasNonProductChangeHint = includesAny(normalizedLower, NON_PRODUCT_CHANGE_HINTS);
  const hasGapSignal = includesAny(normalizedLower, GAP_HINTS);
  const hasSuccessSignal =
    includesAny(normalizedLower, SUCCESS_HINTS) || /\b1\.\s|\b2\.\s/.test(request);
  const hasEvaluatorOverrideHint = includesAny(normalizedLower, EVALUATOR_OVERRIDE_HINTS);
  const hasEvaluatorExampleHint = includesAny(normalizedLower, EVALUATOR_EXAMPLE_HINTS);
  const hasProductContext = PRODUCT_CONTEXT_PATTERN.test(normalizedLower);

  const productScore =
    intake.is_product_build_request
      ? 4 +
        (intake.status === "ready_for_confirmation" ? 2 : 0) +
        (intake.status === "ask_execution_questions" ? 1 : 0)
      : 0;

  const resumeScore =
    resumeMatched.length +
    (runReference !== undefined ? 3 : 0) +
    (includesAny(normalizedLower, ["resume", "resume-run", "--resume-run", "재개", "이어서"]) ? 1 : 0);

  const explicitHarnessChange =
    mentionsHarnessSurface && (hasNonProductChangeHint || hasGapSignal || hasSuccessSignal);
  const harnessScore = explicitHarnessChange
    ? harnessMatched.length +
      harnessPathMatched.length +
      (mentionsRepoSurface ? 2 : 0) +
      (hasNonProductChangeHint ? 1 : 0)
    : 0;

  const explicitEvaluatorChange =
    evaluatorMatched.length > 0 &&
    (hasEvaluatorOverrideHint || hasEvaluatorExampleHint || hasSuccessSignal) &&
    (!intake.is_product_build_request || mentionsRepoSurface || hasNonProductChangeHint);
  const evaluatorScore = explicitEvaluatorChange
    ? evaluatorMatched.length +
      (hasEvaluatorOverrideHint ? 2 : 0) +
      (hasEvaluatorExampleHint ? 1 : 0)
    : 0;

  if (resumeScore >= 3 && resumeScore >= productScore && resumeScore >= harnessScore && resumeScore >= evaluatorScore) {
    const states = buildResumeFieldStates(request, normalizedLower);
    const missingFields = buildMissingFields(states);
    return {
      intent: "run_resume",
      status: missingFields.length > 0 ? "ask_resume_questions" : "ready_for_handoff",
      phase: missingFields.length > 0 ? "intent" : "handoff",
      confidence: calculateConfidence(resumeScore),
      route_target: "run_resume",
      questions: buildQuestions(states),
      missing_fields: missingFields,
      satisfied_fields: buildSatisfiedFields(states),
      rationale: buildIntentRationale("run-resume", [
        ...resumeMatched,
        ...(runReference ? [runReference] : [])
      ]),
      extracted_run_reference: runReference
    };
  }

  if (intake.is_product_build_request) {
    const productRationale = [
      `Detected a product-build request and kept loop:intake authoritative (${intake.status}).`
    ];

    const explicitHarnessOverride =
      explicitHarnessChange && harnessScore >= productScore + 2 && !hasProductContext;
    const explicitEvaluatorOverride =
      explicitEvaluatorChange &&
      evaluatorScore >= productScore + 2 &&
      !hasProductContext &&
      (mentionsRepoSurface || hasNonProductChangeHint);

    if (!explicitHarnessOverride && !explicitEvaluatorOverride) {
      if (evaluatorMatched.length > 0 && !explicitEvaluatorOverride) {
        productRationale.push(
          "Evaluator words appeared as product context rather than as a harness-surface change."
        );
      }
      return buildProductResult(intake, productRationale);
    }
  }

  if (harnessScore >= evaluatorScore && harnessScore >= 2) {
    const states = buildHarnessFieldStates(request, normalizedLower, [
      ...harnessMatched,
      ...harnessPathMatched
    ]);
    const missingFields = buildMissingFields(states);
    return {
      intent: "harness_design",
      status: missingFields.length > 0 ? "ask_harness_questions" : "ready_for_handoff",
      phase: missingFields.length > 0 ? "intent" : "handoff",
      confidence: calculateConfidence(harnessScore),
      route_target: "harness_design",
      questions: buildQuestions(states),
      missing_fields: missingFields,
      satisfied_fields: buildSatisfiedFields(states),
      rationale: buildIntentRationale("harness-design", [...harnessMatched, ...harnessPathMatched])
    };
  }

  if (evaluatorScore >= 2) {
    const states = buildEvaluatorFieldStates(request, normalizedLower, evaluatorMatched);
    const missingFields = buildMissingFields(states);
    return {
      intent: "evaluator_tuning",
      status: missingFields.length > 0 ? "ask_evaluator_questions" : "ready_for_handoff",
      phase: missingFields.length > 0 ? "intent" : "handoff",
      confidence: calculateConfidence(evaluatorScore),
      route_target: "evaluator_tuning",
      questions: buildQuestions(states),
      missing_fields: missingFields,
      satisfied_fields: buildSatisfiedFields(states),
      rationale: buildIntentRationale("evaluator-tuning", evaluatorMatched)
    };
  }

  if (intake.is_product_build_request) {
    return buildProductResult(intake, [
      `Detected a product-build request and delegated to loop:intake (${intake.status}).`
    ]);
  }

  return {
    intent: "unknown",
    status: "unclassified",
    phase: "none",
    confidence: 0.4,
    route_target: "clarify",
    questions: [
      "Is this a product-build, harness-design, run-resume, or evaluator-tuning request?",
      "What concrete output should the harness produce next?"
    ],
    missing_fields: [],
    satisfied_fields: [],
    rationale: ["The request did not contain enough stable signals to classify a lane."]
  };
};

const renderReadyRoute = (result: LoopIntentResult): string => {
  const routeLine =
    result.route_target === "product_intake"
      ? "Route: proceed through product intake."
      : result.route_target === "harness_design"
        ? "Route: proceed in the harness-design lane."
        : result.route_target === "run_resume"
          ? "Route: resume the existing run."
          : result.route_target === "evaluator_tuning"
            ? "Route: proceed in the evaluator-calibration lane."
            : "Route: clarify the request.";

  const lines = [`Intent: ${result.intent}`, routeLine];
  if (result.extracted_run_reference) {
    lines.push(`Run reference: ${result.extracted_run_reference}`);
  }
  if (result.rationale.length > 0) {
    lines.push(result.rationale[0]!);
  }
  return lines.join("\n");
};

export const renderLoopIntentResponse = (result: LoopIntentResult): string => {
  if (result.intent === "product_build" && result.intake) {
    return renderIntakeGateResponse(result.intake);
  }

  if (
    result.status === "ask_harness_questions" ||
    result.status === "ask_resume_questions" ||
    result.status === "ask_evaluator_questions" ||
    result.status === "unclassified"
  ) {
    return result.questions.map((question, index) => `${index + 1}. ${question}`).join("\n");
  }

  return renderReadyRoute(result);
};
