import type { IntakeGateResult } from "./intake-gate.js";
import type {
  FrontDoorSessionArtifact,
  FrontDoorSessionConflict,
  SessionIntakeFieldId,
  SessionIntakeSnapshot
} from "./intake-schema.js";

type ScalarFieldKey = Exclude<
  keyof SessionIntakeSnapshot,
  | "target_users"
  | "core_features"
  | "reference_apps"
  | "constraints"
  | "quality_bar"
  | "must_not_break"
  | "failure_expectations"
  | "continuity_boundaries"
  | "reference_signals"
  | "non_goals"
  | "probe_hints"
  | "custom_quality_metrics"
>;

const listJoinPattern = /\s*(?:,|;|\band\b|\bor\b)\s*|\s+\/\s+/i;
const urlPattern = /https?:\/\/[^\s,;]+/gi;
const targetUsersLabelPattern = String.raw`target users?|primary users?|주\s*사용자|대상\s*사용자|사용자|유저|주\s*유저`;
const coreFeaturesLabelPattern = String.raw`core workflows?|workflows?|core features?|features?|핵심\s*작업|핵심\s*기능|핵심\s*플로우|첫\s*버전\s*기능`;
const finishLineLabelPattern = String.raw`good enough means|finish line(?: is)?|success means|mvp means|성공\s*기준|완성\s*기준|첫\s*버전\s*기준|MVP\s*기준`;
const referenceLabelPattern = String.raw`reference products?|reference apps?|reference visuals?|visual direction|references?|visuals?|참고\s*제품|참고\s*앱|참고\s*화면|참고|레퍼런스`;
const productTitleLabelPattern = String.raw`product title|app name|product name|제품명|앱\s*이름|서비스\s*이름`;
const nextIntakeLabelPattern = String.raw`good enough means|finish line|success means|mvp means|target users?|primary users?|core workflows?|workflows?|core features?|features?|references?|target root|target score|max(?:imum)? rounds?|run command|ready url|주\s*사용자|대상\s*사용자|핵심\s*작업|핵심\s*기능|핵심\s*플로우|참고\s*앱|참고|레퍼런스|성공\s*기준|완성\s*기준|작업\s*폴더|프로젝트\s*폴더|대상\s*폴더|경로`;
const explicitTargetScorePattern = /\btarget\s*score\b|\bscore\b/i;
const explicitMaxRoundsPattern = /\bmax(?:imum)?\s*rounds?\b|\brounds?\b/i;

const uniqueStrings = (values: readonly string[]): string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))];

const normalizeInlineValue = (value: string): string =>
  value
    .replace(/^[:\-]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

const stripFinalSentencePunctuation = (value: string): string =>
  value
    .trim()
    .replace(/[!?]+$/u, "")
    .replace(/\.(?=\s*$)/u, "")
    .trim();

const protectUrls = (
  value: string
): { protectedValue: string; urls: Map<string, string> } => {
  const urls = new Map<string, string>();
  const protectedValue = value.replace(urlPattern, (url) => {
    const key = `__URL_${urls.size}__`;
    urls.set(key, stripFinalSentencePunctuation(url));
    return key;
  });

  return { protectedValue, urls };
};

const normalizeListEntry = (
  entry: string,
  urls: ReadonlyMap<string, string>
): string => {
  const normalized = normalizeInlineValue(entry);
  return urls.get(normalized) ?? stripFinalSentencePunctuation(normalized);
};

const splitInlineList = (value: string): string[] => {
  const { protectedValue, urls } = protectUrls(value);

  return uniqueStrings(
    protectedValue
      .replace(/\b(?:and|or)\b|및/gi, ",")
      .split(listJoinPattern)
      .map((entry) => normalizeListEntry(entry, urls))
  );
};

const splitAnswerLines = (message: string): string[] =>
  message
    .split(/\r?\n|(?<=\.)\s+(?=\d+[.)]\s*)/)
    .map((line) =>
      line
        .replace(/^\s*(?:\d+[.)]|[-*])\s*/, "")
        .trim()
    )
    .filter(Boolean);

const normalizeNoneAnswer = (value: string): string =>
  value
    .trim()
    .replace(/[.!?。！？]+$/u, "")
    .trim();

const trimAtNextIntakeLabel = (value: string): string =>
  value
    .replace(
      new RegExp(String.raw`\s+(?=(?:${nextIntakeLabelPattern})(?:\s*(?:can be|are|is|는|은|:|=)|\b)).+$`, "iu"),
      ""
    )
    .trim();

const extractLabeledRestOfLine = (
  message: string,
  labelPattern: string
): string | undefined => {
  const match = new RegExp(
    String.raw`(?:^|[\r\n]|[.;!?。！？]\s*)(?:${labelPattern})\s*(?:can be|are|is|는|은|:|=)?\s*(.+)$`,
    "imu"
  ).exec(message);
  return match?.[1]
    ? stripFinalSentencePunctuation(trimAtNextIntakeLabel(match[1]))
    : undefined;
};

const isNoneAnswer = (value: string): boolean =>
  /^(?:none|no|no references?|없음|없어|없어요|없습니다|없다)$/i.test(
    normalizeNoneAnswer(value)
  );

const parseTargetScoreAnswer = (value: string): number | undefined => {
  const match = value.match(/\b(?:0?\.\d+|1(?:\.0)?|\d{1,3})\b/);
  if (!match) {
    return undefined;
  }

  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  const normalized = parsed > 1 ? parsed / 100 : parsed;
  return normalized > 0 && normalized <= 1 ? normalized : undefined;
};

const parseMaxRoundsAnswer = (value: string): number | undefined => {
  const match = value.match(/\b\d{1,2}\b/);
  if (!match) {
    return undefined;
  }

  const parsed = Number(match[0]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const firstMatch = (value: string, patterns: readonly RegExp[]): string | undefined => {
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    const capture = match?.[1]?.trim();
    if (capture) {
      return normalizeInlineValue(capture);
    }
  }
  return undefined;
};

const firstSentence = (value: string): string | undefined =>
  value
    .split(/(?<=[.!?。！？])\s+/u)
    .map((sentence) => sentence.trim())
    .find(Boolean);

const koBuildVerbPattern =
  /(?:만들|만들어|만들어줘|구현|개발|제작|설계|기획|빌드)/u;
const koProductSurfacePattern =
  /(?:앱|웹앱|서비스|사이트|대시보드|툴|도구|시스템|포털|에디터|편집기|API|api)/u;
const enBuildVerbPattern = /\b(?:build|create|make|prototype|ship)\b/i;
const enProductSurfacePattern =
  /\b(?:app|application|web app|website|site|dashboard|tool|service|system|portal|editor|api|agent)\b/i;

const looksLikeProductBuildRequestSentence = (sentence: string): boolean => {
  const normalized = sentence.trim();
  return (
    (koBuildVerbPattern.test(normalized) && koProductSurfacePattern.test(normalized)) ||
    (enBuildVerbPattern.test(normalized) && enProductSurfacePattern.test(normalized))
  );
};

const titleCase = (value: string): string =>
  value
    .split(/\s+/)
    .map((word) => (word.length > 0 ? `${word[0]!.toUpperCase()}${word.slice(1)}` : word))
    .join(" ");

const deriveProductTitle = (request: string): string | undefined => {
  const normalized = normalizeInlineValue(request)
    .replace(/[.!?。！？]+$/u, "")
    .trim();

  if (!normalized) {
    return undefined;
  }

  const ko = normalized
    .replace(
      /(?:을|를)?\s*(?:만들어줘|만들어 줘|만들어|구현해줘|구현해 줘|구현|개발해줘|제작해줘|빌드해줘)\s*$/u,
      ""
    )
    .trim();

  if (ko !== normalized && ko.length >= 2 && ko.length <= 80) {
    return ko;
  }

  const enBuildObject = normalized.match(
    /\b(?:build|create|make|prototype|ship)\b\s+(?:me\s+|us\s+|a\s+|an\s+|the\s+)?(.+?)(?:\s+for\s+.+)?$/i
  )?.[1];

  if (enBuildObject) {
    return titleCase(enBuildObject.replace(/[.!?]+$/u, "").trim());
  }

  return normalized.length <= 80 ? normalized : undefined;
};

const extractExplicitTargetUsers = (message: string): string[] | undefined => {
  const labeledMatch = extractLabeledRestOfLine(message, targetUsersLabelPattern);
  const explicitMatch =
    labeledMatch ??
    firstMatch(message, [
      /\b(?:target users?|primary users?)\s*(?:are|is|:)\s*(.+?)(?:[.!?]|$)/i,
      /\b(?:target users?|primary users?)\s+(?!can\b)(.+?)(?:[.!?]|$)/i,
      /\busers?\s*(?:are|is|:)\s*(.+?)(?:[.!?]|$)/i
    ]);
  return explicitMatch ? splitInlineList(explicitMatch) : undefined;
};

const extractImplicitTargetUsers = (message: string): string[] | undefined => {
  const explicitForMatch = firstMatch(message, [/\bfor\s+(.+?)(?:[.!?]|$)/i]);
  if (explicitForMatch) {
    return splitInlineList(explicitForMatch);
  }

  const sentences = message
    .split(/(?<=[.!?。！？])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const first = sentences[0];
  if (first && looksLikeProductBuildRequestSentence(first)) {
    return undefined;
  }
  if (
    sentences.length >= 1 &&
    first !== undefined &&
    first.split(/\s+/).length <= 6 &&
    !/\b(build|create|make|prototype|ship|references?|good enough|finish line|this is|target root|target score|max rounds?|run command|ready url|new project|existing project)\b/i.test(
      first
    )
  ) {
    return [first.replace(/[.!?。！？]+$/u, "").trim()];
  }

  return undefined;
};

const extractExplicitCoreFeatures = (message: string): string[] | undefined => {
  const labeledMatch = extractLabeledRestOfLine(message, coreFeaturesLabelPattern);
  const explicitMatch =
    labeledMatch ??
    firstMatch(message, [
      /\b(?:core workflows?|workflows?|core features?|features?)\s*(?:are|is|:)?\s*(.+?)(?:[.!?]|$)/i
    ]);
  return explicitMatch ? splitInlineList(explicitMatch) : undefined;
};

const extractImplicitCoreFeatures = (message: string): string[] | undefined => {
  const explicitMatch = firstMatch(message, [
    /\b(?:the )?first version needs\s+(.+?)(?:[.!?]|$)/i,
    /\bmust\s+(.+?)(?:[.!?]|$)/i,
    /\bneeds? to\s+(.+?)(?:[.!?]|$)/i
  ]);
  return explicitMatch ? splitInlineList(explicitMatch) : undefined;
};

const extractExplicitReferenceApps = (message: string): string[] | undefined => {
  const value = extractLabeledRestOfLine(message, referenceLabelPattern);
  if (!value) {
    return undefined;
  }
  if (isNoneAnswer(value)) {
    return [];
  }
  return splitInlineList(value);
};

const extractImplicitReferenceApps = (message: string): string[] | undefined => {
  if (isNoneAnswer(message)) {
    return [];
  }

  const explicitMatch = firstMatch(message, [/\blike\s+(.+?)(?:[.!?]|$)/i]);
  return explicitMatch ? splitInlineList(explicitMatch) : undefined;
};

const extractFinishLine = (message: string): string | undefined =>
  extractLabeledRestOfLine(message, finishLineLabelPattern) ??
  firstMatch(message, [
    /\b(?:good enough means|finish line(?: is)?|success means|mvp means)\s+(.+?)(?:[.!?]|$)/i
  ]);

const extractCommand = (
  message: string,
  patterns: readonly RegExp[]
): string | undefined => firstMatch(message, patterns);

const extractUrl = (message: string, label: string): string | undefined => {
  const pattern = new RegExp(
    `\\b${label}\\s*(?:is|:)?\\s*(https?:\\/\\/[^\\s]+)`,
    "i"
  );
  return firstMatch(message, [pattern]);
};

const isExecutionQuestionPair = (
  questionIds: readonly SessionIntakeFieldId[]
): boolean =>
  questionIds.some((fieldId) =>
    [
      "project_mode",
      "target_root",
      "target_score",
      "max_rounds",
      "run_command",
      "ready_url"
    ].includes(fieldId)
  );

const answerForField = (
  lines: readonly string[],
  index: number,
  isExecutionPair: boolean
): string | undefined => {
  if (lines[index]) {
    return lines[index];
  }
  if (lines.length === 1 && isExecutionPair) {
    return lines[0];
  }
  return undefined;
};

const stripTrailingPunctuation = (value: string): string =>
  value.replace(/[.!?]+$/u, "");

const parsePathAnswer = (value: string): string | undefined => {
  const candidate =
    value.match(/[A-Za-z]:\\[^\r\n,;!?]+/)?.[0] ??
    value.match(/[A-Za-z0-9._-]+(?:[\\/][^\s,;.!?]+)+/)?.[0] ??
    value.match(/(?:\/|\.\/|\.\.\/)[^\s,;.!?]+/)?.[0];
  return candidate ? stripTrailingPunctuation(candidate).trim() : undefined;
};

const parseUrlAnswer = (value: string): string | undefined => {
  const candidate = value.match(/https?:\/\/[^\s,;]+/)?.[0];
  return candidate ? stripTrailingPunctuation(candidate).trim() : undefined;
};

const parseRunCommandAnswer = (value: string): string | undefined => {
  const withoutUrl = value.replace(/,?\s*https?:\/\/[^\s,;]+/i, "").trim();
  const candidate = withoutUrl.match(
    /\b(?:npm|pnpm|yarn|bun|node|python|python3|uvicorn|docker(?: compose)?|make)\s+[^\r\n,;]+/i
  )?.[0];
  return candidate?.trim();
};

const extractCandidatesFromQuestionOrder = (
  message: string,
  questionIds: readonly SessionIntakeFieldId[]
): Partial<SessionIntakeSnapshot> => {
  const lines = splitAnswerLines(message);
  if (lines.length === 0 || questionIds.length === 0) {
    return {};
  }
  const isExecutionPair = isExecutionQuestionPair(questionIds);
  if (questionIds.length > 1 && lines.length < 2 && !isExecutionPair) {
    return {};
  }

  const result: Partial<SessionIntakeSnapshot> = {};
  questionIds.forEach((fieldId, index) => {
    const answer = answerForField(lines, index, isExecutionPair);
    if (!answer) {
      return;
    }

    switch (fieldId) {
      case "target_users":
        result.target_users = splitInlineList(answer);
        break;
      case "core_workflows":
        result.core_features = splitInlineList(answer);
        break;
      case "references":
        result.reference_apps = isNoneAnswer(answer) ? [] : splitInlineList(answer);
        break;
      case "finish_line":
        result.finish_line = normalizeInlineValue(answer);
        break;
      case "project_mode":
        if (/\bnew\b|\bfrom scratch\b|\bnew project\b|새\s*프로젝트|처음부터|새로/u.test(answer)) {
          result.project_mode = "new";
        } else if (/\bexisting\b|\bcurrent\b|\bexisting project\b|기존\s*프로젝트|현재/u.test(answer)) {
          result.project_mode = "existing";
        }
        break;
      case "target_root":
        result.target_root =
          parsePathAnswer(answer) ??
          (isExecutionPair && questionIds.length > 1
            ? undefined
            : normalizeInlineValue(answer));
        break;
      case "target_score": {
        const targetScore = parseTargetScoreAnswer(answer);
        if (targetScore !== undefined) {
          result.target_score = targetScore;
        }
        break;
      }
      case "max_rounds": {
        const maxRounds = parseMaxRoundsAnswer(answer);
        if (maxRounds !== undefined) {
          result.max_rounds = maxRounds;
        }
        break;
      }
      case "run_command":
        result.run_command =
          parseRunCommandAnswer(answer) ?? normalizeInlineValue(answer);
        break;
      case "ready_url":
        result.ready_url = parseUrlAnswer(answer) ?? normalizeInlineValue(answer);
        break;
      default:
        break;
    }
  });

  return result;
};

const explicitFieldMentions = (message: string): { targetScore: boolean; maxRounds: boolean } => ({
  targetScore: explicitTargetScorePattern.test(message),
  maxRounds: explicitMaxRoundsPattern.test(message)
});

const extractCandidates = (input: {
  message: string;
  sourceRequest: string;
  intakeResult: IntakeGateResult;
  previousQuestionIds?: readonly SessionIntakeFieldId[];
}): Partial<SessionIntakeSnapshot> => {
  const { message, sourceRequest, intakeResult } = input;
  const previousQuestionIds = input.previousQuestionIds ?? [];
  const hasQuestionContext = previousQuestionIds.length > 0;
  const previousQuestionSet = new Set(previousQuestionIds);
  const shouldImplicitlyParse = (field: SessionIntakeFieldId): boolean =>
    !hasQuestionContext || previousQuestionSet.has(field);
  const explicit = explicitFieldMentions(message);
  const productTitle =
    extractLabeledRestOfLine(message, productTitleLabelPattern) ??
    deriveProductTitle(sourceRequest) ??
    deriveProductTitle(message);
  const productSummary =
    intakeResult.extracted_summary ??
    firstSentence(sourceRequest) ??
    firstSentence(message);

  const targetUsers =
    extractExplicitTargetUsers(message) ??
    (shouldImplicitlyParse("target_users")
      ? extractImplicitTargetUsers(message)
      : undefined) ??
    (!hasQuestionContext
      ? extractExplicitTargetUsers(sourceRequest) ??
        extractImplicitTargetUsers(sourceRequest)
      : undefined);
  const coreFeatures =
    extractExplicitCoreFeatures(message) ??
    (shouldImplicitlyParse("core_workflows")
      ? extractImplicitCoreFeatures(message)
      : undefined) ??
    (!hasQuestionContext && message === sourceRequest
      ? extractExplicitCoreFeatures(sourceRequest) ??
        extractImplicitCoreFeatures(sourceRequest)
      : undefined);
  const referenceApps =
    extractExplicitReferenceApps(message) ??
    (shouldImplicitlyParse("references")
      ? extractImplicitReferenceApps(message)
      : undefined) ??
    (!hasQuestionContext && message === sourceRequest
      ? extractExplicitReferenceApps(sourceRequest) ??
        extractImplicitReferenceApps(sourceRequest)
      : undefined);
  const finishLine =
    extractFinishLine(message) ??
    (!hasQuestionContext && message === sourceRequest
      ? extractFinishLine(sourceRequest)
      : undefined);
  const runCommand = extractCommand(message, [
    /\brun command\s*(?:is|:)?\s*(.+?)(?:[.!?]|$)/i,
    /\bstart command\s*(?:is|:)?\s*(.+?)(?:[.!?]|$)/i
  ]);
  const checkCommand = extractCommand(message, [
    /\bcheck command\s*(?:is|:)?\s*(.+?)(?:[.!?]|$)/i
  ]);
  const readyUrl = extractUrl(message, "ready url");
  const appUrl = extractUrl(message, "app url");
  const healthUrl = extractUrl(message, "health url");
  const apiBaseUrl = extractUrl(message, "api base url");

  const regexCandidates: Partial<SessionIntakeSnapshot> = {
    ...(productTitle ? { product_title: productTitle } : {}),
    ...(productSummary ? { product_summary: productSummary } : {}),
    ...(targetUsers ? { target_users: targetUsers } : {}),
    ...(coreFeatures ? { core_features: coreFeatures } : {}),
    ...(referenceApps ? { reference_apps: referenceApps } : {}),
    ...(finishLine ? { finish_line: finishLine } : {}),
    ...(intakeResult.internal_working_hypothesis
      ? { target_family: intakeResult.internal_working_hypothesis }
      : {}),
    ...(intakeResult.extracted_project_mode
      ? { project_mode: intakeResult.extracted_project_mode }
      : {}),
    ...(intakeResult.extracted_target_root
      ? { target_root: intakeResult.extracted_target_root }
      : {}),
    ...(explicit.targetScore && intakeResult.extracted_target_score !== undefined
      ? { target_score: intakeResult.extracted_target_score }
      : {}),
    ...(explicit.maxRounds && intakeResult.extracted_max_rounds !== undefined
      ? { max_rounds: intakeResult.extracted_max_rounds }
      : {}),
    ...(runCommand ? { run_command: runCommand } : {}),
    ...(checkCommand ? { check_command: checkCommand } : {}),
    ...(readyUrl ? { ready_url: readyUrl } : {}),
    ...(appUrl ? { app_url: appUrl } : {}),
    ...(healthUrl ? { health_url: healthUrl } : {}),
    ...(apiBaseUrl ? { api_base_url: apiBaseUrl } : {})
  };

  return {
    ...regexCandidates,
    ...extractCandidatesFromQuestionOrder(message, previousQuestionIds)
  };
};

const areArraysEquivalent = (
  left: readonly string[] | undefined,
  right: readonly string[] | undefined
): boolean => {
  if (!left && !right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((value, index) => value === rightSorted[index]);
};

const removeConflictsForField = (
  conflicts: FrontDoorSessionConflict[],
  field: keyof SessionIntakeSnapshot
): void => {
  for (let index = conflicts.length - 1; index >= 0; index -= 1) {
    if (conflicts[index]?.field === field) {
      conflicts.splice(index, 1);
    }
  }
};

const applyScalarField = (
  target: SessionIntakeSnapshot,
  field: ScalarFieldKey,
  candidate: SessionIntakeSnapshot[ScalarFieldKey],
  sourceTurn: number,
  conflicts: FrontDoorSessionConflict[],
  options: { replace?: boolean } = {}
): void => {
  const targetRecord = target as Partial<
    Record<ScalarFieldKey, SessionIntakeSnapshot[ScalarFieldKey]>
  >;
  if (candidate === undefined) {
    return;
  }
  const existing = targetRecord[field];
  if (existing === undefined || options.replace) {
    targetRecord[field] = candidate;
    removeConflictsForField(conflicts, field);
    return;
  }
  if (existing === candidate) {
    return;
  }
  conflicts.push({
    field,
    existing_value: existing,
    candidate_value: candidate,
    source_turn: sourceTurn
  });
};

const applyArrayField = (
  target: SessionIntakeSnapshot,
  field: keyof Pick<
    SessionIntakeSnapshot,
    "target_users" | "core_features" | "reference_apps"
  >,
  candidate: string[] | undefined,
  sourceTurn: number,
  conflicts: FrontDoorSessionConflict[],
  options: { replace?: boolean } = {}
): void => {
  if (candidate === undefined) {
    return;
  }
  const normalizedCandidate = uniqueStrings(candidate);
  if (options.replace) {
    target[field] = normalizedCandidate;
    removeConflictsForField(conflicts, field);
    return;
  }
  const existing = target[field];
  if (existing === undefined) {
    target[field] = normalizedCandidate;
    return;
  }
  if (normalizedCandidate.length === 0 && existing.length > 0) {
    conflicts.push({
      field,
      existing_value: existing,
      candidate_value: normalizedCandidate,
      source_turn: sourceTurn
    });
    return;
  }
  const merged = uniqueStrings([...existing, ...normalizedCandidate]);
  if (!areArraysEquivalent(existing, merged)) {
    target[field] = merged;
  }
};

const messageLooksLikeCorrection = (message: string): boolean =>
  /\b(?:actually|change|replace|set|correct)\b|(?:정정|수정|변경|바꿔|교체|실제로는)/iu.test(
    message
  );

const hasExplicitTargetRoot = (message: string): boolean =>
  /(?:target root|root directory|working directory|project root|target folder|working folder|작업\s*폴더|프로젝트\s*폴더|대상\s*폴더|경로)\s*(?:is|는|은|:|=)?/iu.test(
    message
  );

const hasExplicitProjectMode = (message: string): boolean =>
  /\b(?:new project|existing project|from scratch)\b|(?:새\s*프로젝트|기존\s*프로젝트|처음부터|새로)/iu.test(
    message
  );

const hasExplicitProductIdentity = (message: string): boolean =>
  new RegExp(
    String.raw`(?:${productTitleLabelPattern}|product\s*summary|product\s*brief|what\s+to\s+build)\s*(?:can be|are|is|는|은|:|=)?`,
    "iu"
  ).test(message);

const replaceFieldsForTurn = (
  message: string,
  previousQuestionIds: readonly SessionIntakeFieldId[]
): Set<keyof SessionIntakeSnapshot> => {
  const replace = new Set<keyof SessionIntakeSnapshot>();

  for (const field of previousQuestionIds) {
    switch (field) {
      case "target_users":
        replace.add("target_users");
        break;
      case "product_summary":
        replace.add("product_summary");
        break;
      case "core_workflows":
        replace.add("core_features");
        break;
      case "references":
        replace.add("reference_apps");
        break;
      case "finish_line":
        replace.add("finish_line");
        break;
      case "project_mode":
        replace.add("project_mode");
        break;
      case "target_root":
        replace.add("target_root");
        break;
      default:
        break;
    }
  }

  if (messageLooksLikeCorrection(message)) {
    if (hasExplicitTargetRoot(message)) {
      replace.add("target_root");
    }
    if (hasExplicitProjectMode(message)) {
      replace.add("project_mode");
    }
  }

  if (hasExplicitTargetRoot(message)) {
    replace.add("target_root");
  }
  if (hasExplicitProjectMode(message)) {
    replace.add("project_mode");
  }
  if (hasExplicitProductIdentity(message)) {
    replace.add("product_summary");
  }

  return replace;
};

const safePathSegment = (value: string): string =>
  value
    .normalize("NFKC")
    .trim()
    .replace(/[\\/:"*?<>|]+/g, " ")
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "app";

const defaultTargetRootForNewProject = (
  intake: SessionIntakeSnapshot
): string | undefined => {
  if (intake.project_mode !== "new") {
    return undefined;
  }
  if (intake.target_root?.trim()) {
    return intake.target_root;
  }

  const title = intake.product_title ?? intake.product_summary;
  return title?.trim() ? `./apps/${safePathSegment(title)}` : undefined;
};

const defaultAcceptanceSet = (
  existing: readonly string[],
  intakeResult: IntakeGateResult,
  message: string,
  intake: SessionIntakeSnapshot
): string[] => {
  const accepted = new Set(existing);
  const explicit = explicitFieldMentions(message);

  if (explicit.targetScore) {
    accepted.delete("target_score");
  } else if (
    intakeResult.extracted_target_score !== undefined &&
    intakeResult.missing_product_fields.length === 0 &&
    !intakeResult.missing_execution_fields.includes("target_score")
  ) {
    accepted.add("target_score");
  }

  if (explicit.maxRounds) {
    accepted.delete("max_rounds");
  } else if (
    intakeResult.extracted_max_rounds !== undefined &&
    intakeResult.missing_product_fields.length === 0 &&
    !intakeResult.missing_execution_fields.includes("max_rounds")
  ) {
    accepted.add("max_rounds");
  }

  if (intake.project_mode === "new" && intake.target_root?.trim()) {
    accepted.add("target_root");
  }

  return [...accepted].sort();
};

export const buildDiscoveryAggregateRequest = (input: {
  sourceRequest: string;
  intake: SessionIntakeSnapshot;
  latestMessage?: string;
}): string => {
  const { intake } = input;
  const lines = [input.sourceRequest.trim()];

  if (intake.product_title) {
    lines.push(`Product title: ${intake.product_title}.`);
  }
  if (intake.product_summary) {
    lines.push(`Product summary: ${intake.product_summary}.`);
  }
  if (intake.target_users?.length) {
    lines.push(`The target users are ${intake.target_users.join(", ")}.`);
  }
  if (intake.core_features?.length) {
    lines.push(`The core workflows are ${intake.core_features.join(", ")}.`);
  }
  if (intake.reference_apps) {
    lines.push(
      intake.reference_apps.length > 0
        ? `References can be ${intake.reference_apps.join(", ")}.`
        : "References can be none."
    );
  }
  if (intake.finish_line) {
    lines.push(`Good enough means ${intake.finish_line}.`);
  }
  if (intake.project_mode && intake.target_root) {
    lines.push(
      `This is a ${intake.project_mode} project and the target root is ${intake.target_root}.`
    );
  } else if (intake.project_mode) {
    lines.push(`This is a ${intake.project_mode} project.`);
  } else if (intake.target_root) {
    lines.push(`The target root is ${intake.target_root}.`);
  }
  if (intake.target_score !== undefined) {
    lines.push(`target score ${intake.target_score}.`);
  }
  if (intake.max_rounds !== undefined) {
    lines.push(`max rounds ${intake.max_rounds}.`);
  }
  if (intake.run_command) {
    lines.push(`run command is ${intake.run_command}.`);
  }
  if (intake.check_command) {
    lines.push(`check command is ${intake.check_command}.`);
  }
  if (intake.ready_url) {
    lines.push(`ready url is ${intake.ready_url}.`);
  }
  if (intake.app_url) {
    lines.push(`app url is ${intake.app_url}.`);
  }
  if (intake.health_url) {
    lines.push(`health url is ${intake.health_url}.`);
  }
  if (intake.api_base_url) {
    lines.push(`api base url is ${intake.api_base_url}.`);
  }
  if (input.latestMessage?.trim()) {
    lines.push(input.latestMessage.trim());
  }

  return lines.join(" ").replace(/\s+/g, " ").trim();
};

export interface MergeFrontDoorSessionTurnResult {
  intake: SessionIntakeSnapshot;
  unresolvedConflicts: FrontDoorSessionConflict[];
  defaultsAccepted: string[];
}

export const mergeFrontDoorSessionTurn = (input: {
  existingSession?: FrontDoorSessionArtifact;
  sourceRequest: string;
  message: string;
  intakeResult: IntakeGateResult;
  turnCount: number;
}): MergeFrontDoorSessionTurnResult => {
  const nextIntake: SessionIntakeSnapshot = {
    ...(input.existingSession?.intake ?? {})
  };
  const conflicts = [...(input.existingSession?.unresolved_conflicts ?? [])];
  const candidates = extractCandidates({
    message: input.message,
    sourceRequest: input.sourceRequest,
    intakeResult: input.intakeResult,
    previousQuestionIds: input.existingSession?.last_question_ids ?? []
  });
  const previousQuestionIds = input.existingSession?.last_question_ids ?? [];
  const replaceFields = replaceFieldsForTurn(input.message, previousQuestionIds);

  applyScalarField(nextIntake, "product_title", candidates.product_title, input.turnCount, conflicts);
  if (!nextIntake.product_summary || replaceFields.has("product_summary")) {
    applyScalarField(
      nextIntake,
      "product_summary",
      candidates.product_summary,
      input.turnCount,
      conflicts,
      { replace: replaceFields.has("product_summary") }
    );
  }
  applyScalarField(nextIntake, "target_family", candidates.target_family, input.turnCount, conflicts);
  applyScalarField(nextIntake, "project_mode", candidates.project_mode, input.turnCount, conflicts, {
    replace: replaceFields.has("project_mode")
  });
  applyScalarField(nextIntake, "target_root", candidates.target_root, input.turnCount, conflicts, {
    replace: replaceFields.has("target_root")
  });
  applyScalarField(nextIntake, "target_score", candidates.target_score, input.turnCount, conflicts);
  applyScalarField(nextIntake, "max_rounds", candidates.max_rounds, input.turnCount, conflicts);
  applyScalarField(nextIntake, "run_command", candidates.run_command, input.turnCount, conflicts);
  applyScalarField(nextIntake, "check_command", candidates.check_command, input.turnCount, conflicts);
  applyScalarField(nextIntake, "ready_url", candidates.ready_url, input.turnCount, conflicts);
  applyScalarField(nextIntake, "app_url", candidates.app_url, input.turnCount, conflicts);
  applyScalarField(nextIntake, "health_url", candidates.health_url, input.turnCount, conflicts);
  applyScalarField(nextIntake, "api_base_url", candidates.api_base_url, input.turnCount, conflicts);
  applyScalarField(nextIntake, "finish_line", candidates.finish_line, input.turnCount, conflicts, {
    replace: replaceFields.has("finish_line")
  });
  applyArrayField(nextIntake, "target_users", candidates.target_users, input.turnCount, conflicts, {
    replace: replaceFields.has("target_users")
  });
  applyArrayField(nextIntake, "core_features", candidates.core_features, input.turnCount, conflicts, {
    replace: replaceFields.has("core_features")
  });
  applyArrayField(nextIntake, "reference_apps", candidates.reference_apps, input.turnCount, conflicts, {
    replace: replaceFields.has("reference_apps")
  });

  if (!nextIntake.reference_apps) {
    nextIntake.reference_apps = [];
  }

  const defaultTargetRoot = defaultTargetRootForNewProject(nextIntake);
  if (defaultTargetRoot && !nextIntake.target_root) {
    nextIntake.target_root = defaultTargetRoot;
    removeConflictsForField(conflicts, "target_root");
  }

  return {
    intake: nextIntake,
    unresolvedConflicts: conflicts,
    defaultsAccepted: defaultAcceptanceSet(
      input.existingSession?.defaults_accepted ?? [],
      input.intakeResult,
      input.message,
      nextIntake
    )
  };
};

export const questionIdsForIntakeResult = (
  intakeResult: IntakeGateResult
): SessionIntakeFieldId[] => {
  if (intakeResult.status === "ask_product_questions") {
    return [...intakeResult.missing_product_fields].slice(0, intakeResult.questions.length);
  }
  if (intakeResult.status === "ask_execution_questions") {
    return [...intakeResult.missing_execution_fields].slice(0, intakeResult.questions.length);
  }
  return [];
};
