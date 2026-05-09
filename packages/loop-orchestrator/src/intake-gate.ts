import {
  adapterPlanPreviewLines,
  buildAdapterPlanFromIntake,
  hasExplicitApiNegation,
  normalizeVerificationSurfacesForFamily,
  parseVerificationSurfacesAnswer,
  parseWorkflowChecksAnswer
} from "./adapter-plan.js";
import type {
  AdapterIntakeFieldId,
  ExecutionIntakeFieldId as ExecutionFieldId,
  ProductIntakeFieldId as ProductFieldId,
  SessionIntakeSnapshot,
  SessionWorkflowCheck,
  VerificationSurface
} from "./intake-schema.js";
import {
  detectProductBuildIntent,
  type ProductBuildDetection
} from "./product-build-signals.js";
import type { TargetFamily } from "./types.js";

type IntakeFieldId = ProductFieldId | ExecutionFieldId | AdapterIntakeFieldId;

type IntakeGateStatus =
  | "not_product_build_request"
  | "ask_product_questions"
  | "ask_execution_questions"
  | "ask_adapter_questions"
  | "ready_for_prepare";

type IntakePhase = "none" | "product" | "execution" | "adapter" | "prepare";

interface IntakeFieldState<TFieldId extends IntakeFieldId = IntakeFieldId> {
  id: TFieldId;
  satisfied: boolean;
  question: string;
}

export interface IntakeGateResult {
  status: IntakeGateStatus;
  phase: IntakePhase;
  locale: "en" | "ko";
  is_product_build_request: boolean;
  product_build_detection?: ProductBuildDetection;
  missing_fields: IntakeFieldId[];
  missing_product_fields: ProductFieldId[];
  missing_execution_fields: ExecutionFieldId[];
  missing_adapter_fields: AdapterIntakeFieldId[];
  satisfied_fields: IntakeFieldId[];
  questions: string[];
  internal_working_hypothesis?: Exclude<TargetFamily, "generic-core" | "editor-app">;
  extracted_summary?: string;
  extracted_project_mode?: "new" | "existing";
  extracted_target_root?: string;
  extracted_target_score?: number;
  extracted_max_rounds?: number;
  extracted_verification_surfaces?: VerificationSurface[];
  extracted_workflow_checks?: SessionWorkflowCheck[];
  preparation_summary?: string[];
  adapter_plan_preview?: string[];
  auto_prepare?: boolean;
  next_step?: "prepare";
}

const PRODUCT_BUILD_NOUNS = [
  "앱",
  "서비스",
  "웹",
  "웹앱",
  "사이트",
  "대시보드",
  "에디터",
  "편집기",
  "편집툴",
  "툴",
  "api",
  "agent",
  "관리툴",
  "workspace",
  "storyboard",
  "스토리보드",
  "editor",
  "dashboard"
];

const PRODUCT_BUILD_VERBS = [
  "만들",
  "만든",
  "만든다",
  "구현",
  "설계",
  "개발",
  "build",
  "create",
  "make",
  "prototype",
  "기획",
  "원한다",
  "생각중",
  "구상",
  "하려고"
];

const USER_HINTS = [
  "사용자",
  "유저",
  "창작자",
  "스트리머",
  "팀",
  "운영자",
  "관리자",
  "viewer",
  "user",
  "creator",
  "operator",
  "admin",
  "for "
];

const WORKFLOW_HINTS = [
  "로그인",
  "drag",
  "drop",
  "드래그",
  "편집",
  "정렬",
  "추가",
  "삭제",
  "저장",
  "공유",
  "동기화",
  "관리",
  "검색",
  "업로드",
  "export",
  "import",
  "workflow",
  "job",
  "플로우",
  "작업"
];

const REFERENCE_HINTS = [
  "참고",
  "레퍼런스",
  "reference",
  "similar",
  "like",
  "비슷",
  "피그마",
  "notion",
  "linear",
  "jira",
  "trello",
  "figma",
  "화면",
  "톤",
  "스타일",
  "visual"
];

const FINISH_LINE_HINTS = [
  "mvp",
  "prototype",
  "첫 버전",
  "1차",
  "good enough",
  "성공",
  "성공 기준",
  "완성",
  "usable",
  "production",
  "finish line",
  "must work",
  "반드시",
  "가능해야"
];

const PROJECT_MODE_HINTS = [
  "새 프로젝트",
  "new project",
  "from scratch",
  "기존",
  "existing",
  "현재 repo",
  "current repo",
  "existing folder",
  "new repo"
];

const WINDOWS_PATH_PATTERN =
  /[a-zA-Z]:\\[^\r\n]*?(?=(?:[),.;!?]|\s+(?:target score|max rounds|run command|ready url|app url|api url|health url|이다|입니다|이고|이며)(?:\s|$)|$))/i;
const PATH_PATTERN = /((?:\/|\.\/|\.\.\/)[^\r\n\s),.;!?]+)/;
const RELATIVE_PATH_PATTERN =
  /(?<![A-Za-z0-9._/-])((?:\.{1,2}[\\/]|[A-Za-z0-9._-]+[\\/])[^\r\n\s),.;!?]+)/;
const TARGET_ROOT_VALUE_PATTERN_SOURCE = String.raw`(?:[A-Za-z]:\\[^\r\n\s),.;!?]+|(?:\/|\.\/|\.\.\/)[^\r\n\s),.;!?]+|[A-Za-z0-9._-]+(?:[\\/][^\r\n\s),.;!?]+)+)`;
const TARGET_ROOT_CONTEXT_PATTERNS = [
  new RegExp(
    String.raw`(?:target root|root(?: directory)?|working directory|project root|target folder|working folder|\uC791\uC5C5\s*\uD3F4\uB354|\uC791\uC5C5\uD3F4\uB354|\uB300\uC0C1\s*\uD3F4\uB354|\uD504\uB85C\uC81D\uD2B8\s*\uD3F4\uB354|\uACBD\uB85C)\s*(?:is|\uB294|\uC740|:|=)\s*(${TARGET_ROOT_VALUE_PATTERN_SOURCE})`,
    "iu"
  ),
  new RegExp(
    String.raw`(?:target root|root(?: directory)?|working directory|project root|target folder|working folder|\uC791\uC5C5\s*\uD3F4\uB354|\uC791\uC5C5\uD3F4\uB354|\uB300\uC0C1\s*\uD3F4\uB354|\uD504\uB85C\uC81D\uD2B8\s*\uD3F4\uB354|\uD3F4\uB354|\uACBD\uB85C)\s+(${TARGET_ROOT_VALUE_PATTERN_SOURCE})`,
    "iu"
  )
];
const READY_URL_CONTEXT_PATTERNS = [
  /(?:ready url|app url|health url|api url|준비\s*URL|앱\s*URL|헬스\s*URL)\s*(?:is|는|은|:|=)?\s*(https?:\/\/[^\s)]+)/iu
];
const RUN_COMMAND_PATTERN =
  /\b(?:npm|pnpm|yarn|bun|node|python|python3|uvicorn|docker(?: compose)?|make)\s+[^\r\n]+/i;
const MAX_QUESTIONS_PER_TURN = 3;
const DEFAULT_TARGET_SCORE = 0.9;
const DEFAULT_MAX_ROUNDS = 3;
const KOREAN_PATH_SENTENCE_ENDINGS = [
  "\uC785\uB2C8\uB2E4",
  "\uC774\uC5D0\uC694",
  "\uC608\uC694",
  "\uC774\uC57C",
  "\uC774\uB2E4",
  "\uC774\uACE0",
  "\uC774\uBA70",
  "\uC57C",
  "\uB2E4",
  "\uC784"
] as const;
const SUMMARY_STOP_PATTERN =
  /(?:^|[.!?]\s+)(?:(?:this|it)\s+is\s+(?:an?\s+)?(?:existing|new)\s+(?:project|repo|folder)\b|(?:the\s+)?(?:target root|root directory|working directory|project root|target folder|working folder|target score|goal score|max(?:imum)? rounds?|max iterations?|run command|ready url|app url|api url|health url)\s*(?:is|:|=)|(?:\uC774\uAC74|\uC774\uAC83\uC740)?\s*(?:\uAE30\uC874|\uC0C8)\s*(?:\uD504\uB85C\uC81D\uD2B8|\uB808\uD3EC|\uD3F4\uB354)(?:\uACE0|\uC774\uACE0|\uC785\uB2C8\uB2E4|\uC774\uB2E4|\uC608\uC694)?|(?:\uC791\uC5C5\s*\uD3F4\uB354|\uC791\uC5C5\uD3F4\uB354|\uB300\uC0C1\s*\uD3F4\uB354|\uD504\uB85C\uC81D\uD2B8\s*\uD3F4\uB354|\uACBD\uB85C|\uBAA9\uD45C\s*\uC810\uC218|\uBAA9\uD45C\uC810\uC218|\uCD5C\uB300\s*(?:\uB77C\uC6B4\uB4DC|\uD69F\uC218|\uD68C\uCC28|\uBC18\uBCF5)|\uC2E4\uD589\s*\uBA85\uB839)\s*(?:\uB294|\uC740|:|=))/iu;

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();

const lowerText = (value: string): string => normalizeText(value).toLowerCase();

const detectLocale = (value: string): "en" | "ko" =>
  /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/u.test(value) ? "ko" : "en";

const localizedQuestion = (
  locale: "en" | "ko",
  ko: string,
  en: string
): string => (locale === "ko" ? ko : en);

const limitQuestions = <TFieldId extends IntakeFieldId>(
  fields: IntakeFieldState<TFieldId>[],
  locale: "en" | "ko"
): string[] =>
  fields
    .filter((field) => !field.satisfied)
    .slice(0, MAX_QUESTIONS_PER_TURN)
    .map((field) => {
      switch (field.id) {
        case "product_summary":
          return localizedQuestion(
            locale,
            "\uC815\uD655\uD788 \uBB50\uB97C \uB9CC\uB4DC\uB294\uC9C0 \uD55C \uBB38\uC7A5\uC73C\uB85C \uACE0\uC815\uD574\uC918.",
            "Summarize exactly what needs to be built in one sentence."
          );
        case "target_users":
          return localizedQuestion(
            locale,
            "\uB204\uAC00 \uC774\uAC78 \uC8FC\uB85C \uC4F0\uB294\uC9C0 \uB9D0\uD574\uC918. \uAC00\uC7A5 \uC911\uC694\uD55C \uC0AC\uC6A9\uC790 \uD55C \uC885\uB958\uBD80\uD130 \uC801\uC5B4\uC918.",
            "Who is the primary user for the first version?"
          );
        case "core_workflows":
          return localizedQuestion(
            locale,
            "\uCCAB \uBC84\uC804\uC5D0\uC11C \uC0AC\uC6A9\uC790\uAC00 \uBC18\uB4DC\uC2DC \uD574\uC57C \uD558\uB294 \uD575\uC2EC \uC791\uC5C5 2~3\uAC1C\uB97C \uC801\uC5B4\uC918.",
            "Which 2-3 core workflows must work in the first version?"
          );
        case "references":
          return localizedQuestion(
            locale,
            "\uCC38\uACE0 \uC81C\uD488\uC774\uB098 \uCC38\uACE0 \uD654\uBA74\uC774 \uC788\uB098? \uC5C6\uC73C\uBA74 \uC5C6\uB2E4\uACE0 \uC801\uC5B4\uC918.",
            "Are there reference products or visuals to follow? If not, say none."
          );
        case "finish_line":
          return localizedQuestion(
            locale,
            "\uCCAB \uBC84\uC804\uC5D0\uC11C \uC5B4\uB514\uAE4C\uC9C0 \uB418\uBA74 \uC131\uACF5\uC778\uC9C0 \uC9E7\uAC8C \uC801\uC5B4\uC918.",
            "What does good enough for the first version mean?"
          );
        case "project_mode":
          return localizedQuestion(
            locale,
            "\uC0C8 \uD504\uB85C\uC81D\uD2B8\uC778\uC9C0 \uAE30\uC874 \uD504\uB85C\uC81D\uD2B8\uC778\uC9C0 \uC54C\uB824\uC918.",
            "Is this a new project or an existing project?"
          );
        case "target_root":
          return localizedQuestion(
            locale,
            "\uC791\uC5C5 \uD3F4\uB354\uAC00 \uC5B4\uB514\uC778\uC9C0 \uACBD\uB85C\uB97C \uADF8\uB300\uB85C \uC801\uC5B4\uC918.",
            "What is the working folder path?"
          );
        case "target_score":
          return localizedQuestion(
            locale,
            "target score\uB97C 0~1 \uC0AC\uC774 \uC22B\uC790\uB85C \uC801\uC5B4\uC918. \uC608: 0.9",
            "What target score should the loop use between 0 and 1? Example: 0.9"
          );
        case "max_rounds":
          return localizedQuestion(
            locale,
            "max rounds\uB97C \uBA87 \uBC88\uC73C\uB85C \uB458\uC9C0 \uC801\uC5B4\uC918. \uC608: 4",
            "How many max rounds should the loop use? Example: 4"
          );
        case "run_command":
          return localizedQuestion(
            locale,
            "\uAE30\uC874 \uD504\uB85C\uC81D\uD2B8\uBA74 \uC2E4\uD589 \uBA85\uB839\uC744 \uC801\uC5B4\uC918. \uC608: npm run dev",
            "If this is an existing project, what run command should the loop use? Example: npm run dev"
          );
        case "ready_url":
          return localizedQuestion(
            locale,
            "\uAE30\uC874 \uD504\uB85C\uC81D\uD2B8\uBA74 \uC900\uBE44 \uC644\uB8CC\uB97C \uD655\uC778\uD560 URL\uC744 \uC801\uC5B4\uC918. \uC608: http://127.0.0.1:3000/",
            "If this is an existing project, what ready URL should the loop check? Example: http://127.0.0.1:3000/"
          );
        case "verification_surface":
          return localizedQuestion(
            locale,
            "\uC774 \uACB0\uACFC\uB97C \uBB34\uC5C7\uC73C\uB85C \uAC80\uC99D\uD558\uBA74 \uB418\uB098\uC694? \uD654\uBA74, API, \uD14C\uC2A4\uD2B8 \uBA85\uB839, \uD30C\uC77C/DB \uACB0\uACFC \uC911 \uACE8\uB77C\uC918.",
            "How should the loop verify this result: browser screen, API, test command, file, or DB evidence?"
          );
        case "workflow_checks":
          return localizedQuestion(
            locale,
            "\uD575\uC2EC \uC791\uC5C5\uBCC4\uB85C \uC5B4\uB5A4 \uC2E4\uC81C \uB3D9\uC791\uC744 \uD558\uBA74 \uC131\uACF5\uC778\uC9C0 \uC801\uC5B4\uC918. \uC608: \uAC70\uB798 \uCD94\uAC00 -> \uBAA9\uB85D\uACFC \uC6D4\uBCC4 \uD569\uACC4\uAC00 \uBC14\uB00C\uB2E4.",
            "For each core workflow, what action and result prove success? Example: add transaction -> list and monthly total update."
          );
        case "quality_metrics":
          return localizedQuestion(
            locale,
            "\uCD94\uAC00\uB85C \uC810\uC218\uD654\uD560 \uD488\uC9C8 \uAE30\uC900\uC774 \uC788\uB098\uC694? \uC5C6\uC73C\uBA74 \uC5C6\uB2E4\uACE0 \uC801\uC5B4\uC918.",
            "Any extra quality metric the evaluator should score? If not, say none."
          );
        default:
          return field.question;
      }
    });

const includesAny = (value: string, keywords: readonly string[]): boolean =>
  keywords.some((keyword) => value.includes(keyword));

const countKeywordMatches = (value: string, keywords: readonly string[]): number =>
  keywords.filter((keyword) => value.includes(keyword)).length;

const roundScore = (value: number): number => Number(value.toFixed(3));

export const inferProductTargetFamily = (
  request: string
): Exclude<TargetFamily, "generic-core" | "editor-app"> => {
  const normalizedLower = lowerText(request);
  const apiExplicitlyNegated = hasExplicitApiNegation(normalizedLower);

  if (
    includesAny(normalizedLower, [
      "storyboard",
      "스토리보드",
      "editor",
      "에디터",
      "편집기",
      "편집툴",
      "canvas",
      "workspace",
      "builder"
    ])
  ) {
    return "browser-editor";
  }

  if (
    !apiExplicitlyNegated &&
    includesAny(normalizedLower, ["crud", "rest api", "resource", "백오피스 api"])
  ) {
    return "crud-api";
  }

  if (includesAny(normalizedLower, ["chat agent", "에이전트", "tool use", "툴 사용"])) {
    return "chat-agent";
  }

  if (includesAny(normalizedLower, ["dashboard", "analytics", "admin", "모니터링"])) {
    return "dashboard";
  }

  if (
    !apiExplicitlyNegated &&
    includesAny(normalizedLower, ["api", "webhook", "backend", "백엔드"])
  ) {
    return "api-service";
  }

  if (includesAny(normalizedLower, ["auth", "로그인", "postgres", "db", "database"])) {
    return "fullstack-app";
  }

  return "browser-app";
};

const cleanBuildRequestSummary = (request: string): string | undefined => {
  const normalized = normalizeText(request)
    .replace(/[.!?。！？]+$/u, "")
    .trim();

  const ko = normalized
    .replace(
      /(?:을|를)?\s*(?:만들어줘|만들어 줘|만들어|구현해줘|구현해 줘|구현|개발해줘|제작해줘|빌드해줘)\s*$/u,
      ""
    )
    .trim();

  if (ko !== normalized && ko.length >= 2) {
    return ko;
  }

  const en = normalized.match(
    /\b(?:build|create|make|prototype|ship)\b\s+(?:me\s+|us\s+|a\s+|an\s+|the\s+)?(.+?)(?:[.!?]|$)/i
  )?.[1];

  return en?.trim();
};

const extractSummary = (request: string): string | undefined => {
  const buildObjectSummary = cleanBuildRequestSummary(request);
  if (buildObjectSummary) {
    return buildObjectSummary.length <= 160
      ? buildObjectSummary
      : `${buildObjectSummary.slice(0, 157).trimEnd()}...`;
  }

  const normalized = normalizeText(request);
  if (normalized.length < 12) {
    return undefined;
  }

  const stopIndex = normalized.search(SUMMARY_STOP_PATTERN);
  const productOnly = (stopIndex >= 0 ? normalized.slice(0, stopIndex) : normalized).trim();
  const firstSentence =
    productOnly.match(/^.+?(?:[.!?]|[。！？]|$)/u)?.[0]?.trim() ?? productOnly;
  const cleaned = firstSentence.replace(/[\s,;:]+$/u, "").trim();

  if (cleaned.length === 0) {
    return undefined;
  }

  return cleaned.length <= 160 ? cleaned : `${cleaned.slice(0, 157).trimEnd()}...`;
};

const detectProductBuildRequest = (
  request: string,
  normalizedLower: string
): ProductBuildDetection => {
  const detection = detectProductBuildIntent(normalizedLower);
  if (detection.is_product_build || detection.strength === "rejected") {
    return detection;
  }

  const continuationSignalCount = [
    usersExplicitlyProvided(normalizedLower),
    workflowsExplicitlyProvided(normalizedLower),
    includesAny(normalizedLower, REFERENCE_HINTS) || referencesExplicitlyAbsent(normalizedLower),
    finishLineExplicitlyProvided(normalizedLower),
    extractProjectModeEnhanced(normalizedLower) !== undefined,
    extractTargetRoot(request) !== undefined,
    extractTargetScoreEnhanced(normalizedLower) !== undefined,
    extractMaxRoundsEnhanced(normalizedLower) !== undefined
  ].filter(Boolean).length;

  return continuationSignalCount >= 2 && normalizeText(request).length >= 16
    ? {
        is_product_build: true,
        strength: "weak",
        matched_nouns: detection.matched_nouns,
        matched_verbs: detection.matched_verbs,
        rejected_by: detection.rejected_by
      }
    : detection;
};

const extractProjectMode = (normalizedLower: string): "new" | "existing" | undefined => {
  const patterns: Array<{ mode: "new" | "existing"; pattern: RegExp }> = [
    {
      mode: "existing",
      pattern:
        /(?:^|[.!?]\s+)(?:this|it)\s+is\s+(?:an?\s+)?existing\s+(?:project|repo|folder)\b/i
    },
    {
      mode: "existing",
      pattern:
        /(?:^|[.!?]\s*)(?:\uC774\uAC74|\uC774\uAC83\uC740)?\s*\uAE30\uC874\s*(?:\uD504\uB85C\uC81D\uD2B8|\uB808\uD3EC|\uD3F4\uB354)(?:\uACE0|\uC774\uACE0|\uC785\uB2C8\uB2E4|\uC774\uB2E4|\uC608\uC694)?/u
    },
    {
      mode: "new",
      pattern:
        /(?:^|[.!?]\s+)(?:this|it)\s+is\s+(?:an?\s+)?new\s+(?:project|repo|folder)\b/i
    },
    {
      mode: "new",
      pattern: /(?:^|[.!?]\s+)(?:this|it)\s+(?:starts?|begins?)\s+from scratch\b/i
    },
    {
      mode: "new",
      pattern:
        /(?:^|[.!?]\s*)(?:\uC774\uAC74|\uC774\uAC83\uC740)?\s*\uC0C8\s*(?:\uD504\uB85C\uC81D\uD2B8|\uB808\uD3EC|\uD3F4\uB354)(?:\uACE0|\uC774\uACE0|\uC785\uB2C8\uB2E4|\uC774\uB2E4|\uC608\uC694)?/u
    },
    {
      mode: "new",
      pattern:
        /(?:^|[.!?\n]\s*)(?:\uC774\uAC74|\uC774\uAC83\uC740)?\s*\uC0C8\s*(?:\uD504\uB85C\uC81D\uD2B8|\uB808\uD3EC|\uD3F4\uB354)(?:\uB85C\s*(?:\uC9C4\uD589|\uC2DC\uC791|\uC0DD\uC131|\uB9CC\uB4E4)[^\s.!?]*)?/u
    },
    {
      mode: "new",
      pattern: /(?:^|[.!?]\s*)(?:\uCC98\uC74C\uBD80\uD130|\uC0C8\uB85C)\b/u
    }
  ];

  for (const { mode, pattern } of patterns) {
    if (pattern.test(normalizedLower)) {
      return mode;
    }
  }

  return undefined;
};

const sanitizeExtractedPath = (value: string): string | undefined => {
  let sanitized = value
    .trim()
    .replace(/^[("'`]+/, "")
    .replace(/[)"'`]+$/, "")
    .replace(/[),.;!?]+$/g, "");

  for (const ending of KOREAN_PATH_SENTENCE_ENDINGS) {
    if (!sanitized.endsWith(ending)) {
      continue;
    }

    const boundaryIndex = sanitized.length - ending.length - 1;
    const boundaryCharacter = boundaryIndex >= 0 ? sanitized[boundaryIndex] : "";
    if (/[A-Za-z0-9._/\-\\]/.test(boundaryCharacter)) {
      sanitized = sanitized.slice(0, -ending.length);
      break;
    }
  }

  return sanitized.length > 0 ? sanitized : undefined;
};

const extractTargetRoot = (request: string): string | undefined => {
  for (const pattern of TARGET_ROOT_CONTEXT_PATTERNS) {
    const contextual = pattern.exec(request)?.[1];
    if (!contextual) {
      continue;
    }

    const match =
      contextual.match(WINDOWS_PATH_PATTERN)?.[0] ??
      contextual.match(RELATIVE_PATH_PATTERN)?.[1] ??
      contextual.match(PATH_PATTERN)?.[0] ??
      contextual;
    const sanitized = sanitizeExtractedPath(match);
    if (sanitized) {
      return sanitized;
    }
  }

  return undefined;
};

const normalizeTargetScoreValue = (raw: string): number | undefined => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    return undefined;
  }

  return roundScore(parsed <= 1 ? parsed : parsed / 100);
};

const extractTargetScore = (normalizedLower: string): number | undefined => {
  const flexiblePatterns = [
    /(?:target score|goal score|\uBAA9\uD45C\s*\uC810\uC218|\uBAA9\uD45C\uC810\uC218|\uD0C0\uAC9F\s*\uC810\uC218|targetscore)\s*(?:\uB294|\uC740|is|:|=)?\s*([0-9]{1,3}(?:\.\d+)?)/i,
    /(?:score|\uC810\uC218)\s*(?:\uB294|\uC740|is|:|=)?\s*([0-9]{1,3}(?:\.\d+)?)/i
  ];

  for (const pattern of flexiblePatterns) {
    const raw = pattern.exec(normalizedLower)?.[1];
    if (!raw) {
      continue;
    }

    const normalizedScore = normalizeTargetScoreValue(raw);
    if (normalizedScore !== undefined) {
      return normalizedScore;
    }

    return undefined;
  }

  const patterns = [
    /(?:target score|목표 점수|타겟 스코어)\s*(?:는|은|:|=)?\s*([01](?:\.\d+)?)/i,
    /(?:score)\s*(?:는|은|:|=)?\s*([01](?:\.\d+)?)/i
  ];

  for (const pattern of patterns) {
    const raw = pattern.exec(normalizedLower)?.[1];
    if (!raw) {
      continue;
    }
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
      return roundScore(parsed);
    }
  }

  return undefined;
};

const extractMaxRounds = (normalizedLower: string): number | undefined => {
  const patterns = [
    /(?:max(?:imum)? rounds?|max iterations?|최대\s*(?:rounds?|라운드|반복|횟수|회수))\s*(?:는|은|:|=)?\s*(\d+)/i,
    /(\d+)\s*(?:rounds?|라운드)\b/i
  ];

  for (const pattern of patterns) {
    const raw = pattern.exec(normalizedLower)?.[1];
    if (!raw) {
      continue;
    }
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 1) {
      return parsed;
    }
  }

  return undefined;
};

const extractTargetScoreEnhanced = (
  normalizedLower: string
): number | undefined => extractTargetScore(normalizedLower);

const extractProjectModeEnhanced = (
  normalizedLower: string
): "new" | "existing" | undefined => extractProjectMode(normalizedLower);

const extractMaxRoundsEnhanced = (
  normalizedLower: string
): number | undefined => {
  const legacy = extractMaxRounds(normalizedLower);
  if (legacy !== undefined) {
    return legacy;
  }

  const patterns = [
    /(?:max(?:imum)? rounds?|max iterations?|\uCD5C\uB300\s*(?:rounds?|\uB77C\uC6B4\uB4DC|\uBC18\uBCF5|\uD69F\uC218|\uD68C\uCC28))\s*(?:\uB294|\uC740|is|:|=)?\s*(\d+)/i,
    /\uCD5C\uB300\s*(\d+)\s*(?:rounds?|\uB77C\uC6B4\uB4DC|\uBC18\uBCF5|\uD69F\uC218|\uD68C\uCC28)/i,
    /(\d+)\s*(?:rounds?|\uB77C\uC6B4\uB4DC|\uBC18\uBCF5|\uD69F\uC218|\uD68C\uCC28)\b/i
  ];

  for (const pattern of patterns) {
    const raw = pattern.exec(normalizedLower)?.[1];
    if (!raw) {
      continue;
    }
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 1) {
      return parsed;
    }
  }

  return undefined;
};

const extractRunCommand = (request: string): string | undefined => {
  const match = request.match(RUN_COMMAND_PATTERN)?.[0]?.trim();
  return match && match.length > 0 ? match : undefined;
};

const extractReadyUrl = (request: string): string | undefined => {
  for (const pattern of READY_URL_CONTEXT_PATTERNS) {
    const match = pattern.exec(request)?.[1]?.trim();
    if (match) {
      return match;
    }
  }

  return undefined;
};

const referencesExplicitlyAbsent = (normalizedLower: string): boolean =>
  /(?:참고|레퍼런스|reference|visual|ui).{0,24}(?:없|none|없음|no)|(?:없|none|없음|no).{0,24}(?:참고|레퍼런스|reference|visual|ui)/i.test(
    normalizedLower
  );

const finishLineExplicitlyProvided = (normalizedLower: string): boolean =>
  includesAny(normalizedLower, FINISH_LINE_HINTS) ||
  /(?:첫 버전|mvp|prototype).{0,40}(?:가능|동작|성공|완료)/i.test(normalizedLower) ||
  /(?:반드시|must).{0,40}(?:가능|work|동작)/i.test(normalizedLower);

const usersExplicitlyProvided = (normalizedLower: string): boolean =>
  includesAny(normalizedLower, USER_HINTS) ||
  /(?:누가|for)\s+[^.\n]+/i.test(normalizedLower);

const workflowsExplicitlyProvided = (normalizedLower: string): boolean =>
  countKeywordMatches(normalizedLower, WORKFLOW_HINTS) >= 2 ||
  /(?:핵심 작업|핵심 플로우|workflow|jobs?-to-be-done)/i.test(normalizedLower);

const buildProductFieldStates = (
  request: string,
  locale: "en" | "ko"
): IntakeFieldState<ProductFieldId>[] => {
  const normalized = normalizeText(request);
  const normalizedLower = normalized.toLowerCase();
  const extractedSummary = extractSummary(request);

  return [
    {
      id: "product_summary",
      satisfied: extractedSummary !== undefined,
      question: "정확히 뭘 만드는지 한 문장으로 고정해줘."
    },
    {
      id: "target_users",
      satisfied: usersExplicitlyProvided(normalizedLower),
      question: "누가 이걸 주로 쓰는지 말해줘. 가장 중요한 사용자 한 종류부터 적어줘."
    },
    {
      id: "core_workflows",
      satisfied: workflowsExplicitlyProvided(normalizedLower),
      question: "첫 버전에서 사용자가 반드시 해야 하는 핵심 작업 2~3개를 적어줘."
    },
    {
      id: "references",
      satisfied: true,
      question: "참고 제품이나 참고 화면이 있나? 없으면 없다고 적어줘."
    },
    {
      id: "finish_line",
      satisfied: finishLineExplicitlyProvided(normalizedLower),
      question: "첫 버전에서 어디까지 되면 성공인지 짧게 적어줘."
    }
  ];
};

const buildExecutionFieldStates = (
  request: string,
  projectMode: "new" | "existing" | undefined
): IntakeFieldState<ExecutionFieldId>[] => {
  const normalizedLower = lowerText(request);
  const targetScore = extractTargetScoreEnhanced(normalizedLower) ?? DEFAULT_TARGET_SCORE;
  const maxRounds = extractMaxRoundsEnhanced(normalizedLower) ?? DEFAULT_MAX_ROUNDS;
  const targetRoot = extractTargetRoot(request);
  const runCommand = extractRunCommand(request);
  const readyUrl = extractReadyUrl(request);
  const needsLiveRuntimeHints = projectMode === "existing";

  return [
    {
      id: "project_mode",
      satisfied: projectMode !== undefined,
      question: "새 프로젝트인지 기존 프로젝트인지 알려줘."
    },
    {
      id: "target_root",
      satisfied: targetRoot !== undefined,
      question: "작업 폴더가 어디인지 경로를 그대로 적어줘."
    },
    {
      id: "target_score",
      satisfied: targetScore !== undefined,
      question: "target score를 0~1 사이 숫자로 적어줘. 예: 0.9"
    },
    {
      id: "max_rounds",
      satisfied: maxRounds !== undefined,
      question: "max rounds를 몇 번으로 할지 적어줘. 예: 4"
    },
    {
      id: "run_command",
      satisfied: !needsLiveRuntimeHints || runCommand !== undefined,
      question: "기존 프로젝트면 실행 명령을 적어줘. 예: npm run dev"
    },
    {
      id: "ready_url",
      satisfied: !needsLiveRuntimeHints || readyUrl !== undefined,
      question: "기존 프로젝트면 준비 완료를 확인할 URL을 적어줘. 예: http://127.0.0.1:3000/"
    }
  ];
};

const buildAdapterFieldStates = (
  request: string,
  targetFamily: Exclude<TargetFamily, "generic-core" | "editor-app">
): IntakeFieldState<AdapterIntakeFieldId>[] => {
  const extractedVerificationSurfaces = parseVerificationSurfacesAnswer(request);
  const verificationSurfaces = normalizeVerificationSurfacesForFamily(
    targetFamily,
    extractedVerificationSurfaces
  );
  const defaultSurface = verificationSurfaces[0] ?? "browser";
  const workflowChecks = parseWorkflowChecksAnswer(request, defaultSurface);

  return [
    {
      id: "verification_surface",
      satisfied: extractedVerificationSurfaces.length > 0,
      question:
        "How should the loop verify this result: browser, API, test command, file, or DB?"
    },
    {
      id: "workflow_checks",
      satisfied: workflowChecks.length > 0,
      question:
        "For each core workflow, what action and result prove success? Example: add transaction -> list and monthly total update."
    },
    {
      id: "quality_metrics",
      satisfied: true,
      question: "Any additional scored quality metric?"
    }
  ];
};

const extractCoreFeaturesForAdapterPreview = (request: string): string[] => {
  const match = request.match(
    /\b(?:core workflows?|core features?)\s*(?:are|:)?\s*(.+?)(?:\.\s|$)/i
  )?.[1];
  if (!match) {
    return [];
  }
  return match
    .split(/\s*,\s*|\s+and\s+/i)
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const formatPreparationProjectMode = (
  projectMode: "new" | "existing" | undefined,
  locale: "en" | "ko"
): string | undefined => {
  if (projectMode === "new") {
    return locale === "ko" ? "새 프로젝트" : "new project";
  }
  if (projectMode === "existing") {
    return locale === "ko" ? "기존 프로젝트" : "existing project";
  }
  return undefined;
};

const buildPreparationSummary = (input: {
  extractedSummary?: string;
  projectMode?: "new" | "existing";
  targetRoot?: string;
  targetScore?: number;
  maxRounds?: number;
  locale: "en" | "ko";
}): string[] => {
  const projectModeLabel = formatPreparationProjectMode(input.projectMode, input.locale);
  const summaryLines = [
    input.extractedSummary
      ? `${input.locale === "ko" ? "목표" : "Goal"}: ${input.extractedSummary}`
      : undefined,
    projectModeLabel
      ? `${input.locale === "ko" ? "프로젝트 모드" : "Project mode"}: ${projectModeLabel}`
      : undefined,
    input.targetRoot
      ? `${input.locale === "ko" ? "작업 폴더" : "Working folder"}: ${input.targetRoot}`
      : undefined,
    input.targetScore !== undefined
      ? `${input.locale === "ko" ? "\uBAA9\uD45C \uC810\uC218" : "Target score"}: ${input.targetScore}`
      : undefined,
    input.maxRounds !== undefined
      ? `${input.locale === "ko" ? "\uCD5C\uB300 \uB77C\uC6B4\uB4DC" : "Max rounds"}: ${input.maxRounds}`
      : undefined
  ].filter((line): line is string => Boolean(line));

  if (summaryLines.length > 0) {
    return summaryLines;
  }

  return [
    input.locale === "ko"
      ? "제품과 실행 제어가 준비됐습니다."
      : "Product and execution controls are ready."
  ];
};

export const evaluateIntakeRequest = (request: string): IntakeGateResult => {
  const normalized = normalizeText(request);
  const normalizedLower = lowerText(request);
  const locale = detectLocale(request);
  const productBuildDetection = detectProductBuildRequest(request, normalizedLower);
  const isProductBuildRequest = productBuildDetection.is_product_build;

  if (!isProductBuildRequest) {
    return {
      status: "not_product_build_request",
      phase: "none",
      locale,
      is_product_build_request: false,
      product_build_detection: productBuildDetection,
      missing_fields: [],
      missing_product_fields: [],
      missing_execution_fields: [],
      missing_adapter_fields: [],
      satisfied_fields: [],
      questions: []
    };
  }

  const productFields = buildProductFieldStates(request, locale);
  const missingProductFields = productFields
    .filter((field) => !field.satisfied)
    .map((field) => field.id);
  const satisfiedProductFields = productFields
    .filter((field) => field.satisfied)
    .map((field) => field.id);
  const internalWorkingHypothesis = inferProductTargetFamily(normalizedLower);
  const extractedSummary = extractSummary(normalized);
  const extractedProjectMode = extractProjectModeEnhanced(normalizedLower);
  const extractedTargetRoot = extractTargetRoot(request);
  const extractedTargetScore = extractTargetScoreEnhanced(normalizedLower);
  const extractedMaxRounds = extractMaxRoundsEnhanced(normalizedLower);
  const resolvedTargetScore = extractedTargetScore ?? DEFAULT_TARGET_SCORE;
  const resolvedMaxRounds = extractedMaxRounds ?? DEFAULT_MAX_ROUNDS;

  if (missingProductFields.length > 0) {
    return {
      status: "ask_product_questions",
      phase: "product",
      locale,
      is_product_build_request: true,
      product_build_detection: productBuildDetection,
      missing_fields: missingProductFields,
      missing_product_fields: missingProductFields,
      missing_execution_fields: [],
      missing_adapter_fields: [],
      satisfied_fields: satisfiedProductFields,
      questions: limitQuestions(productFields, locale),
      internal_working_hypothesis: internalWorkingHypothesis,
      extracted_summary: extractedSummary,
      extracted_project_mode: extractedProjectMode,
      extracted_target_root: extractedTargetRoot,
      extracted_target_score: resolvedTargetScore,
      extracted_max_rounds: resolvedMaxRounds
    };
  }

  const executionFields = buildExecutionFieldStates(request, extractedProjectMode);
  const missingExecutionFields = executionFields
    .filter((field) => !field.satisfied)
    .map((field) => field.id);
  const satisfiedExecutionFields = executionFields
    .filter((field) => field.satisfied)
    .map((field) => field.id);

  if (missingExecutionFields.length > 0) {
    return {
      status: "ask_execution_questions",
      phase: "execution",
      locale,
      is_product_build_request: true,
      product_build_detection: productBuildDetection,
      missing_fields: [...missingProductFields, ...missingExecutionFields],
      missing_product_fields: [],
      missing_execution_fields: missingExecutionFields,
      missing_adapter_fields: [],
      satisfied_fields: [...satisfiedProductFields, ...satisfiedExecutionFields],
      questions: limitQuestions(executionFields, locale),
      internal_working_hypothesis: internalWorkingHypothesis,
      extracted_summary: extractedSummary,
      extracted_project_mode: extractedProjectMode,
      extracted_target_root: extractedTargetRoot,
      extracted_target_score: resolvedTargetScore,
      extracted_max_rounds: resolvedMaxRounds
    };
  }

  const adapterFields = buildAdapterFieldStates(request, internalWorkingHypothesis);
  const missingAdapterFields = adapterFields
    .filter((field) => !field.satisfied)
    .map((field) => field.id);
  const satisfiedAdapterFields = adapterFields
    .filter((field) => field.satisfied)
    .map((field) => field.id);
  const extractedVerificationSurfaces = parseVerificationSurfacesAnswer(request);
  const defaultVerificationSurfaces = normalizeVerificationSurfacesForFamily(
    internalWorkingHypothesis,
    extractedVerificationSurfaces
  );
  const extractedWorkflowChecks = parseWorkflowChecksAnswer(
    request,
    defaultVerificationSurfaces[0] ?? "browser"
  );

  if (missingAdapterFields.length > 0) {
    return {
      status: "ask_adapter_questions",
      phase: "adapter",
      locale,
      is_product_build_request: true,
      product_build_detection: productBuildDetection,
      missing_fields: [
        ...missingProductFields,
        ...missingExecutionFields,
        ...missingAdapterFields
      ],
      missing_product_fields: [],
      missing_execution_fields: [],
      missing_adapter_fields: missingAdapterFields,
      satisfied_fields: [
        ...satisfiedProductFields,
        ...satisfiedExecutionFields,
        ...satisfiedAdapterFields
      ],
      questions: limitQuestions(adapterFields, locale),
      internal_working_hypothesis: internalWorkingHypothesis,
      extracted_summary: extractedSummary,
      extracted_project_mode: extractedProjectMode,
      extracted_target_root: extractedTargetRoot,
      extracted_target_score: resolvedTargetScore,
      extracted_max_rounds: resolvedMaxRounds,
      ...(extractedVerificationSurfaces.length
        ? { extracted_verification_surfaces: extractedVerificationSurfaces }
        : {}),
      ...(extractedWorkflowChecks.length
        ? { extracted_workflow_checks: extractedWorkflowChecks }
        : {})
    };
  }

  const adapterPlan = buildAdapterPlanFromIntake({
    targetFamily: internalWorkingHypothesis,
    intake: {
      product_summary: extractedSummary,
      core_features: extractCoreFeaturesForAdapterPreview(request),
      run_command: extractRunCommand(request),
      ready_url: extractReadyUrl(request),
      project_mode: extractedProjectMode,
      target_root: extractedTargetRoot,
      verification_surfaces: defaultVerificationSurfaces,
      workflow_checks: extractedWorkflowChecks
    } satisfies SessionIntakeSnapshot
  });

  return {
    status: "ready_for_prepare",
    phase: "prepare",
    locale,
    is_product_build_request: true,
    product_build_detection: productBuildDetection,
    missing_fields: [],
    missing_product_fields: [],
    missing_execution_fields: [],
    missing_adapter_fields: [],
    satisfied_fields: [
      ...satisfiedProductFields,
      ...satisfiedExecutionFields,
      ...satisfiedAdapterFields
    ],
    questions: [],
    internal_working_hypothesis: internalWorkingHypothesis,
    extracted_summary: extractedSummary,
    extracted_project_mode: extractedProjectMode,
    extracted_target_root: extractedTargetRoot,
    extracted_target_score: resolvedTargetScore,
    extracted_max_rounds: resolvedMaxRounds,
    extracted_verification_surfaces: defaultVerificationSurfaces,
    extracted_workflow_checks: adapterPlan.workflow_checks,
    auto_prepare: true,
    next_step: "prepare",
    preparation_summary: buildPreparationSummary({
      extractedSummary,
      projectMode: extractedProjectMode,
      targetRoot: extractedTargetRoot,
      targetScore: resolvedTargetScore,
      maxRounds: resolvedMaxRounds,
      locale
    }),
    adapter_plan_preview: adapterPlanPreviewLines(adapterPlan, locale)
  };
};

export const renderIntakeGateResponse = (result: IntakeGateResult): string => {
  if (
    result.status === "ask_product_questions" ||
    result.status === "ask_execution_questions" ||
    result.status === "ask_adapter_questions"
  ) {
    return result.questions.map((question, index) => `${index + 1}. ${question}`).join("\n");
  }

  if (result.status === "ready_for_prepare") {
    return result.locale === "ko"
      ? [
          "준비 완료.",
          ...(result.preparation_summary ?? []),
          ...(result.adapter_plan_preview ?? []),
          "세션 상태는 ready_to_start입니다.",
          "루프를 시작하려면 '루프 시작'이라고 말하세요."
        ].join("\n")
      : [
          "Preparation is complete.",
          ...(result.preparation_summary ?? []),
          ...(result.adapter_plan_preview ?? []),
          "Session status: ready_to_start.",
          "Say '루프 시작' or 'start loop' to begin the same-thread loop."
        ].join("\n");
  }

  return result.locale === "ko"
    ? "이 요청은 제품 빌드 요청으로 보이지 않습니다."
    : "This request does not look like a product-build request.";
};
