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

const listJoinPattern = /\s*(?:,|;|\band\b|\bor\b|\/)\s*/i;
const explicitTargetScorePattern = /\btarget\s*score\b|\bscore\b/i;
const explicitMaxRoundsPattern = /\bmax(?:imum)?\s*rounds?\b|\brounds?\b/i;

const uniqueStrings = (values: readonly string[]): string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))];

const normalizeInlineValue = (value: string): string =>
  value
    .replace(/^[:\-]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

const splitInlineList = (value: string): string[] =>
  uniqueStrings(
    value
      .replace(/\b(?:and|or)\b|및/gi, ",")
      .split(listJoinPattern)
      .map((entry) => normalizeInlineValue(entry))
  );

const splitAnswerLines = (message: string): string[] =>
  message
    .split(/\r?\n|(?<=\.)\s+(?=\d+[.)]\s*)/)
    .map((line) =>
      line
        .replace(/^\s*(?:\d+[.)]|[-*])\s*/, "")
        .trim()
    )
    .filter(Boolean);

const isNoneAnswer = (value: string): boolean =>
  /^(?:none|no|no references?|없음|없어요|없습니다|없다)$/i.test(value.trim());

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
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .find(Boolean);

const extractTargetUsers = (message: string): string[] | undefined => {
  const explicitMatch = firstMatch(message, [
    /\b(?:target users?|primary users?|users?)\s*(?:are|is|:)?\s*(.+?)(?:[.!?]|$)/i,
    /\bfor\s+(.+?)(?:[.!?]|$)/i
  ]);
  if (explicitMatch) {
    return splitInlineList(explicitMatch);
  }

  const sentences = message
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (
    sentences.length >= 1 &&
    sentences[0] !== undefined &&
    sentences[0].split(/\s+/).length <= 6 &&
    !/\b(build|create|make|prototype|ship|references?|good enough|finish line|this is|target root|target score|max rounds?|run command|ready url)\b/i.test(
      sentences[0]
    )
  ) {
    return [sentences[0].replace(/[.!?]+$/u, "").trim()];
  }

  return undefined;
};

const extractCoreFeatures = (message: string): string[] | undefined => {
  const explicitMatch = firstMatch(message, [
    /\b(?:core workflows?|workflows?|core features?|features?)\s*(?:are|is|:)?\s*(.+?)(?:[.!?]|$)/i,
    /\b(?:the )?first version needs\s+(.+?)(?:[.!?]|$)/i,
    /\bmust\s+(.+?)(?:[.!?]|$)/i,
    /\bneeds? to\s+(.+?)(?:[.!?]|$)/i
  ]);
  return explicitMatch ? splitInlineList(explicitMatch) : undefined;
};

const extractReferenceApps = (message: string): string[] | undefined => {
  if (
    /\b(?:references?|reference products?|reference apps?|visuals?)\b.*\bnone\b/i.test(
      message
    )
  ) {
    return [];
  }

  const explicitMatch = firstMatch(message, [
    /\b(?:reference products?|reference apps?|reference visuals?|references?|visual direction)\s*(?:can be|are|is|:)?\s*(.+?)(?:[.!?]|$)/i,
    /\blike\s+(.+?)(?:[.!?]|$)/i
  ]);
  return explicitMatch ? splitInlineList(explicitMatch) : undefined;
};

const extractFinishLine = (message: string): string | undefined =>
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

const extractCandidatesFromQuestionOrder = (
  message: string,
  questionIds: readonly SessionIntakeFieldId[]
): Partial<SessionIntakeSnapshot> => {
  const lines = splitAnswerLines(message);
  if (lines.length === 0 || questionIds.length === 0) {
    return {};
  }
  if (questionIds.length > 1 && lines.length < 2) {
    return {};
  }

  const result: Partial<SessionIntakeSnapshot> = {};
  questionIds.forEach((fieldId, index) => {
    const answer = lines[index];
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
        if (/\bnew\b/i.test(answer)) {
          result.project_mode = "new";
        } else if (/\bexisting\b/i.test(answer)) {
          result.project_mode = "existing";
        }
        break;
      case "target_root":
        result.target_root = normalizeInlineValue(answer);
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
        result.run_command = normalizeInlineValue(answer);
        break;
      case "ready_url":
        result.ready_url = normalizeInlineValue(answer);
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
  const explicit = explicitFieldMentions(message);
  const productSummary =
    intakeResult.extracted_summary ??
    firstSentence(sourceRequest) ??
    firstSentence(message);

  const targetUsers = extractTargetUsers(message) ?? extractTargetUsers(sourceRequest);
  const coreFeatures =
    extractCoreFeatures(message) ??
    (message === sourceRequest ? extractCoreFeatures(sourceRequest) : undefined);
  const referenceApps =
    extractReferenceApps(message) ??
    (message === sourceRequest ? extractReferenceApps(sourceRequest) : undefined);
  const finishLine =
    extractFinishLine(message) ??
    (message === sourceRequest ? extractFinishLine(sourceRequest) : undefined);
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
    ...extractCandidatesFromQuestionOrder(message, input.previousQuestionIds ?? [])
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

const applyScalarField = (
  target: SessionIntakeSnapshot,
  field: ScalarFieldKey,
  candidate: SessionIntakeSnapshot[ScalarFieldKey],
  sourceTurn: number,
  conflicts: FrontDoorSessionConflict[]
): void => {
  const targetRecord = target as Partial<
    Record<ScalarFieldKey, SessionIntakeSnapshot[ScalarFieldKey]>
  >;
  if (candidate === undefined) {
    return;
  }
  const existing = targetRecord[field];
  if (existing === undefined) {
    targetRecord[field] = candidate;
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
  conflicts: FrontDoorSessionConflict[]
): void => {
  if (candidate === undefined) {
    return;
  }
  const normalizedCandidate = uniqueStrings(candidate);
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

const defaultAcceptanceSet = (
  existing: readonly string[],
  intakeResult: IntakeGateResult,
  message: string
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

  return [...accepted].sort();
};

export const buildDiscoveryAggregateRequest = (input: {
  sourceRequest: string;
  intake: SessionIntakeSnapshot;
  latestMessage?: string;
}): string => {
  const lines = [input.sourceRequest.trim()];
  const { intake } = input;

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

  applyScalarField(nextIntake, "product_summary", candidates.product_summary, input.turnCount, conflicts);
  applyScalarField(nextIntake, "target_family", candidates.target_family, input.turnCount, conflicts);
  applyScalarField(nextIntake, "project_mode", candidates.project_mode, input.turnCount, conflicts);
  applyScalarField(nextIntake, "target_root", candidates.target_root, input.turnCount, conflicts);
  applyScalarField(nextIntake, "target_score", candidates.target_score, input.turnCount, conflicts);
  applyScalarField(nextIntake, "max_rounds", candidates.max_rounds, input.turnCount, conflicts);
  applyScalarField(nextIntake, "run_command", candidates.run_command, input.turnCount, conflicts);
  applyScalarField(nextIntake, "check_command", candidates.check_command, input.turnCount, conflicts);
  applyScalarField(nextIntake, "ready_url", candidates.ready_url, input.turnCount, conflicts);
  applyScalarField(nextIntake, "app_url", candidates.app_url, input.turnCount, conflicts);
  applyScalarField(nextIntake, "health_url", candidates.health_url, input.turnCount, conflicts);
  applyScalarField(nextIntake, "api_base_url", candidates.api_base_url, input.turnCount, conflicts);
  applyScalarField(nextIntake, "finish_line", candidates.finish_line, input.turnCount, conflicts);
  applyArrayField(nextIntake, "target_users", candidates.target_users, input.turnCount, conflicts);
  applyArrayField(nextIntake, "core_features", candidates.core_features, input.turnCount, conflicts);
  applyArrayField(nextIntake, "reference_apps", candidates.reference_apps, input.turnCount, conflicts);

  return {
    intake: nextIntake,
    unresolvedConflicts: conflicts,
    defaultsAccepted: defaultAcceptanceSet(
      input.existingSession?.defaults_accepted ?? [],
      input.intakeResult,
      input.message
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
