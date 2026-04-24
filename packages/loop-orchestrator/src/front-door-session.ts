import { evaluateIntakeRequest } from "./intake-gate.js";
import {
  buildDiscoveryAggregateRequest,
  mergeFrontDoorSessionTurn,
  questionIdsForIntakeResult
} from "./front-door-session-merge.js";
import {
  appendFrontDoorSessionEvent,
  frontDoorSessionPathsForThread,
  loadFrontDoorSessionArtifact,
  writeFrontDoorSessionArtifact
} from "./front-door-session-store.js";
import type {
  DiscoveryPhase,
  FrontDoorSessionArtifact,
  FrontDoorSessionStatus,
  ProductIntakeFieldId,
  ExecutionIntakeFieldId,
  SessionIntakeFieldId,
  SessionIntakeSnapshot
} from "./intake-schema.js";

export interface FrontDoorSessionTurnResult {
  status: FrontDoorSessionStatus;
  phase: DiscoveryPhase | "none";
  session_id?: string;
  thread_id?: string;
  front_door_session_path?: string;
  front_door_session_events_path?: string;
  questions: string[];
  missing_product_fields: ProductIntakeFieldId[];
  missing_execution_fields: ExecutionIntakeFieldId[];
  asked_question_ids: SessionIntakeFieldId[];
  last_question_ids: SessionIntakeFieldId[];
  intake: SessionIntakeSnapshot;
  defaults_accepted: string[];
  unresolved_conflicts: FrontDoorSessionArtifact["unresolved_conflicts"];
  turn_count: number;
}

const statusForPhase = (
  phase: DiscoveryPhase
): FrontDoorSessionTurnResult["status"] => {
  if (phase === "product") {
    return "ask_product_questions";
  }
  if (phase === "execution") {
    return "ask_execution_questions";
  }
  if (phase === "ready_for_prepare") {
    return "ready_for_prepare";
  }
  return "prepared";
};

const uniqueFieldIds = (
  values: readonly SessionIntakeFieldId[]
): SessionIntakeFieldId[] => [...new Set(values)];

const toDiscoveryPhase = (
  status: FrontDoorSessionTurnResult["status"]
): DiscoveryPhase | "none" => {
  if (status === "ask_product_questions") {
    return "product";
  }
  if (status === "ask_execution_questions") {
    return "execution";
  }
  if (status === "ready_for_prepare") {
    return "ready_for_prepare";
  }
  if (status === "prepared") {
    return "prepared";
  }
  return "none";
};

const buildArtifactResult = (
  artifact: FrontDoorSessionArtifact,
  sessionPath: string,
  eventsPath: string,
  status: FrontDoorSessionTurnResult["status"]
): FrontDoorSessionTurnResult => ({
  status,
  phase: artifact.phase,
  session_id: artifact.session_id,
  thread_id: artifact.thread_id,
  front_door_session_path: sessionPath,
  front_door_session_events_path: eventsPath,
  questions: artifact.last_question_batch,
  missing_product_fields: artifact.missing_product_fields,
  missing_execution_fields: artifact.missing_execution_fields,
  asked_question_ids: artifact.asked_question_ids,
  last_question_ids: artifact.last_question_ids ?? [],
  intake: artifact.intake,
  defaults_accepted: artifact.defaults_accepted,
  unresolved_conflicts: artifact.unresolved_conflicts,
  turn_count: artifact.turn_count
});

export const getFrontDoorSessionStatus = async (
  threadId: string
): Promise<FrontDoorSessionTurnResult | undefined> => {
  const artifact = await loadFrontDoorSessionArtifact(threadId);
  if (!artifact) {
    return undefined;
  }
  const paths = frontDoorSessionPathsForThread(threadId);
  return buildArtifactResult(
    artifact,
    paths.session_path,
    paths.events_path,
    statusForPhase(artifact.phase)
  );
};

export const runFrontDoorDiscoveryTurn = async (input: {
  threadId: string;
  message: string;
  now?: string;
}): Promise<FrontDoorSessionTurnResult> => {
  const message = input.message.trim();
  const now = input.now ?? new Date().toISOString();
  const existingSession = await loadFrontDoorSessionArtifact(input.threadId);
  const sourceRequest = existingSession?.source_request ?? message;

  if (!message) {
    throw new Error("A discovery message is required.");
  }

  if (existingSession?.phase === "prepared") {
    const paths = frontDoorSessionPathsForThread(input.threadId);
    return buildArtifactResult(
      existingSession,
      paths.session_path,
      paths.events_path,
      "prepared"
    );
  }

  const initialAggregate = existingSession
    ? buildDiscoveryAggregateRequest({
        sourceRequest,
        intake: existingSession.intake,
        latestMessage: message
      })
    : message;

  const initialResult = evaluateIntakeRequest(initialAggregate);
  if (!existingSession && !initialResult.is_product_build_request) {
    return {
      status: "not_product_build_request",
      phase: "none",
      questions: [],
      missing_product_fields: [],
      missing_execution_fields: [],
      asked_question_ids: [],
      last_question_ids: [],
      intake: {},
      defaults_accepted: [],
      unresolved_conflicts: [],
      turn_count: 0
    };
  }

  const turnCount = (existingSession?.turn_count ?? 0) + 1;
  const mergeResult = mergeFrontDoorSessionTurn({
    existingSession,
    sourceRequest,
    message,
    intakeResult: initialResult,
    turnCount
  });
  const aggregateRequest = buildDiscoveryAggregateRequest({
    sourceRequest,
    intake: mergeResult.intake
  });
  const resolvedResult = evaluateIntakeRequest(aggregateRequest);
  const status = resolvedResult.status;
  const phase = toDiscoveryPhase(status);
  if (phase === "none") {
    throw new Error("Discovery session fell out of the product_build lane.");
  }

  const questionIds = questionIdsForIntakeResult(resolvedResult);
  const artifact: FrontDoorSessionArtifact = {
    session_id: frontDoorSessionPathsForThread(input.threadId).session_id,
    thread_id: input.threadId,
    lane: "product_build",
    source_request: sourceRequest,
    phase,
    intake: mergeResult.intake,
    missing_product_fields: resolvedResult.missing_product_fields,
    missing_execution_fields: resolvedResult.missing_execution_fields,
    asked_question_ids: uniqueFieldIds([
      ...(existingSession?.asked_question_ids ?? []),
      ...questionIds
    ]),
    last_question_ids: questionIds,
    last_question_batch: resolvedResult.questions,
    defaults_accepted: mergeResult.defaultsAccepted,
    unresolved_conflicts: mergeResult.unresolvedConflicts,
    turn_count: turnCount,
    created_at: existingSession?.created_at ?? now,
    updated_at: now
  };

  const paths = await writeFrontDoorSessionArtifact(input.threadId, artifact);
  await appendFrontDoorSessionEvent(input.threadId, {
    type: existingSession ? "session_updated" : "session_created",
    session_id: artifact.session_id,
    thread_id: artifact.thread_id,
    turn_count: artifact.turn_count,
    status,
    phase,
    message,
    updated_at: now
  });
  await appendFrontDoorSessionEvent(input.threadId, {
    type: "session_status",
    session_id: artifact.session_id,
    thread_id: artifact.thread_id,
    turn_count: artifact.turn_count,
    status,
    phase,
    updated_at: now
  });

  return buildArtifactResult(artifact, paths.session_path, paths.events_path, status);
};
