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

const HARNESS_DESIGN_KEYWORDS = [
  "harness",
  "closed-loop",
  "control plane",
  "planner",
  "generator",
  "evaluator",
  "operator surface",
  "codex app",
  "loop:intent",
  "loop:intake",
  ".agents/skills",
  ".codex/agents",
  "subagent",
  "subagents",
  "thread fork",
  "worktree",
  "durable memory",
  "feature ledger",
  "quality critique",
  "patch-request",
  "trajectory-decision",
  "round-contract",
  "bootstrap",
  "intake gate"
] as const;

const RUN_RESUME_KEYWORDS = [
  "resume",
  "resume-run",
  "--resume-run",
  "continue run",
  "reopen",
  "pick up",
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

const EVALUATOR_TUNING_KEYWORDS = [
  "evaluator tuning",
  "evaluator",
  "rubric",
  "quality lift",
  "calibration",
  "calibrate",
  "threshold",
  "few-shot",
  "golden",
  "goldens",
  "exemplar",
  "false positive",
  "false negatives",
  "false negative",
  "subjective metrics",
  "quality_contract",
  "quality contract",
  "verification profile",
  "release gate",
  "light lane",
  "heavy lane",
  "probe",
  "target score",
  "best_passing"
] as const;

const HARNESS_GOAL_HINTS = [
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
  "upgrade"
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
  "operator surface",
  "still"
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
  "lift"
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
  "signature repeat"
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
  "max_rounds_reached"
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
  "next step"
] as const;

const RUN_REFERENCE_PATTERN =
  /(evals[\\/]+runs[\\/]+run-\d+|(?:[A-Za-z]:\\|\.{1,2}[\\/])?[^\r\n\s]*run-\d+[^\r\n\s]*)/i;

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();

const lowerText = (value: string): string => normalizeText(value).toLowerCase();

const includesAny = (value: string, keywords: readonly string[]): boolean =>
  keywords.some((keyword) => value.includes(keyword));

const collectMatchedKeywords = (value: string, keywords: readonly string[]): string[] =>
  keywords.filter((keyword) => value.includes(keyword));

const roundScore = (value: number): number => Number(value.toFixed(3));

const buildHarnessFieldStates = (
  request: string,
  normalizedLower: string
): IntentFieldState<HarnessIntentFieldId>[] => {
  const normalized = normalizeText(request);
  const goalSignal =
    includesAny(normalizedLower, HARNESS_GOAL_HINTS) ||
    collectMatchedKeywords(normalizedLower, HARNESS_DESIGN_KEYWORDS).length >= 2;

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
  normalizedLower: string
): IntentFieldState<EvaluatorIntentFieldId>[] => [
  {
    id: "calibration_focus",
    satisfied:
      collectMatchedKeywords(normalizedLower, EVALUATOR_TUNING_KEYWORDS).length >= 2 ||
      /(?:browser-app|dashboard|api-service|chat-agent|fullstack-app|light lane|heavy lane)/i.test(
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

  return [
    `Matched ${label} signals: ${matchedKeywords.slice(0, 5).join(", ")}.`
  ];
};

export const evaluateLoopIntent = (request: string): LoopIntentResult => {
  const normalizedLower = lowerText(request);
  const runReference = extractRunReference(request);
  const harnessMatched = collectMatchedKeywords(normalizedLower, HARNESS_DESIGN_KEYWORDS);
  const resumeMatched = collectMatchedKeywords(normalizedLower, RUN_RESUME_KEYWORDS);
  const evaluatorMatched = collectMatchedKeywords(normalizedLower, EVALUATOR_TUNING_KEYWORDS);

  const harnessScore =
    harnessMatched.length +
    (includesAny(normalizedLower, ["loop:intent", ".agents/skills", "operator surface"]) ? 2 : 0);
  const resumeScore =
    resumeMatched.length +
    (runReference !== undefined ? 2 : 0) +
    (includesAny(normalizedLower, ["resume", "resume-run", "--resume-run"]) ? 1 : 0);
  const evaluatorScore =
    evaluatorMatched.length +
    (includesAny(normalizedLower, ["false positive", "false negative", "golden", "exemplar"]) ? 2 : 0);

  if (resumeScore >= harnessScore && resumeScore >= evaluatorScore && resumeScore >= 2) {
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

  if (harnessScore >= evaluatorScore && harnessScore >= 2) {
    const states = buildHarnessFieldStates(request, normalizedLower);
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
      rationale: buildIntentRationale("harness-design", harnessMatched)
    };
  }

  if (evaluatorScore >= 2) {
    const states = buildEvaluatorFieldStates(request, normalizedLower);
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

  const intake = evaluateIntakeRequest(request);
  if (intake.is_product_build_request) {
    return {
      intent: "product_build",
      status: "route_to_product_intake",
      phase: intake.status === "ready_for_confirmation" ? "handoff" : "intent",
      confidence: intake.status === "ready_for_confirmation" ? 0.96 : 0.9,
      route_target: "product_intake",
      questions: intake.questions,
      missing_fields: [],
      satisfied_fields: [],
      rationale: [
        `Detected a product-build request and delegated to loop:intake (${intake.status}).`
      ],
      intake,
      intake_status: intake.status,
      intake_phase: intake.phase,
      intake_missing_fields: intake.missing_fields
    };
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
