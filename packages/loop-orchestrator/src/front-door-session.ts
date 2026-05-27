import { evaluateIntakeRequest } from "./intake-gate.js";
import { adapterPlanPreviewLines, buildAdapterPlanFromIntake } from "./adapter-plan.js";
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
  AdapterIntakeFieldId,
  ProductIntakeFieldId,
  ExecutionIntakeFieldId,
  SessionIntakeFieldId,
  SessionIntakeSnapshot
} from "./intake-schema.js";

type SessionLocale = "en" | "ko";

export interface FrontDoorSessionTurnResult {
  status: FrontDoorSessionStatus;
  phase: DiscoveryPhase | "none";
  locale: SessionLocale;
  session_id?: string;
  thread_id?: string;
  front_door_session_path?: string;
  front_door_session_events_path?: string;
  questions: string[];
  missing_product_fields: ProductIntakeFieldId[];
  missing_execution_fields: ExecutionIntakeFieldId[];
  missing_adapter_fields: AdapterIntakeFieldId[];
  asked_question_ids: SessionIntakeFieldId[];
  last_question_ids: SessionIntakeFieldId[];
  intake: SessionIntakeSnapshot;
  defaults_accepted: string[];
  unresolved_conflicts: FrontDoorSessionArtifact["unresolved_conflicts"];
  turn_count: number;
  preparation_summary?: string[];
  adapter_plan_preview?: string[];
}

const statusForPhase = (
  phase: DiscoveryPhase
): FrontDoorSessionTurnResult["status"] => {
  if (phase === "clarification") {
    return "ambiguous_document_request";
  }
  if (phase === "product") {
    return "ask_product_questions";
  }
  if (phase === "execution") {
    return "ask_execution_questions";
  }
  if (phase === "adapter") {
    return "ask_adapter_questions";
  }
  if (phase === "ready_for_prepare") {
    return "ready_for_prepare";
  }
  if (phase === "prepared_with_blockers") {
    return "prepared_with_blockers";
  }
  return "prepared";
};

const uniqueFieldIds = (
  values: readonly SessionIntakeFieldId[]
): SessionIntakeFieldId[] => [...new Set(values)];

const toDiscoveryPhase = (
  status: FrontDoorSessionTurnResult["status"]
): DiscoveryPhase | "none" => {
  if (status === "ambiguous_document_request") {
    return "clarification";
  }
  if (status === "ask_product_questions") {
    return "product";
  }
  if (status === "ask_execution_questions") {
    return "execution";
  }
  if (status === "ask_adapter_questions") {
    return "adapter";
  }
  if (status === "ready_for_prepare") {
    return "ready_for_prepare";
  }
  if (status === "prepared") {
    return "prepared";
  }
  if (status === "prepared_with_blockers") {
    return "prepared_with_blockers";
  }
  return "none";
};

const detectLocaleFromText = (value: string): SessionLocale =>
  /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/u.test(value) ? "ko" : "en";

const localeForArtifact = (artifact: FrontDoorSessionArtifact): SessionLocale =>
  detectLocaleFromText(
    [
      artifact.source_request,
      artifact.intake.product_title,
      artifact.intake.product_summary,
      ...(artifact.intake.target_users ?? []),
      ...(artifact.intake.core_features ?? []),
      artifact.intake.finish_line
    ]
      .filter(Boolean)
      .join("\n")
  );

const preparationSummaryLinesFromIntake = (
  intake: SessionIntakeSnapshot,
  locale: SessionLocale
): string[] => {
  if (locale === "ko") {
    return [
      "\uC900\uBE44\uB41C \uBA85\uC138:",
      `- \uC81C\uD488: ${intake.product_title ?? intake.product_summary ?? "unknown"}`,
      ...(intake.target_users?.length
        ? [`- \uC0AC\uC6A9\uC790: ${intake.target_users.join(", ")}`]
        : []),
      ...(intake.core_features?.length
        ? [`- \uD575\uC2EC \uC791\uC5C5: ${intake.core_features.join(", ")}`]
        : []),
      ...(intake.finish_line
        ? [`- \uC131\uACF5 \uAE30\uC900: ${intake.finish_line}`]
        : []),
      ...(intake.project_mode
        ? [`- \uD504\uB85C\uC81D\uD2B8: ${intake.project_mode}`]
        : []),
      ...(intake.target_root
        ? [`- \uC791\uC5C5 \uD3F4\uB354: ${intake.target_root}`]
        : []),
      `- \uBAA9\uD45C \uC810\uC218: ${intake.target_score ?? 0.9}`,
      `- \uCD5C\uB300 \uB77C\uC6B4\uB4DC: ${intake.max_rounds ?? 3}`,
      ...(intake.run_command
        ? [`- \uC2E4\uD589 \uBA85\uB839: ${intake.run_command}`]
        : []),
      ...(intake.ready_url ? [`- ready URL: ${intake.ready_url}`] : [])
    ];
  }

  return [
    "Prepared brief:",
    `- product: ${intake.product_title ?? intake.product_summary ?? "unknown"}`,
    ...(intake.target_users?.length
      ? [`- users: ${intake.target_users.join(", ")}`]
      : []),
    ...(intake.core_features?.length
      ? [`- core workflows: ${intake.core_features.join(", ")}`]
      : []),
    ...(intake.finish_line ? [`- finish line: ${intake.finish_line}`] : []),
    ...(intake.project_mode ? [`- project mode: ${intake.project_mode}`] : []),
    ...(intake.target_root ? [`- target root: ${intake.target_root}`] : []),
    `- target score: ${intake.target_score ?? 0.9}`,
    `- max rounds: ${intake.max_rounds ?? 3}`,
    ...(intake.run_command ? [`- run command: ${intake.run_command}`] : []),
    ...(intake.ready_url ? [`- ready URL: ${intake.ready_url}`] : [])
  ];
};

const missingProductFieldsFromSnapshot = (
  intake: SessionIntakeSnapshot
): ProductIntakeFieldId[] => {
  const missing: ProductIntakeFieldId[] = [];

  if (!intake.product_summary?.trim() && !intake.product_title?.trim()) {
    missing.push("product_summary");
  }
  if (!intake.target_users?.length) {
    missing.push("target_users");
  }
  if (!intake.core_features?.length) {
    missing.push("core_workflows");
  }
  if (!intake.finish_line?.trim() && !intake.quality_bar?.length) {
    missing.push("finish_line");
  }

  return missing;
};

const productQuestionForField = (
  field: ProductIntakeFieldId,
  locale: SessionLocale
): string => {
  if (locale === "ko") {
    switch (field) {
      case "product_summary":
        return "\uC815\uD655\uD788 \uBB50\uB97C \uB9CC\uB4DC\uB294\uC9C0 \uD55C \uBB38\uC7A5\uC73C\uB85C \uACE0\uC815\uD574\uC918.";
      case "target_users":
        return "\uB204\uAC00 \uC774\uAC78 \uC8FC\uB85C \uC4F0\uB294\uC9C0 \uB9D0\uD574\uC918.";
      case "core_workflows":
        return "\uCCAB \uBC84\uC804\uC5D0\uC11C \uC0AC\uC6A9\uC790\uAC00 \uBC18\uB4DC\uC2DC \uD574\uC57C \uD558\uB294 \uD575\uC2EC \uC791\uC5C5 2~3\uAC1C\uB97C \uC801\uC5B4\uC918.";
      case "references":
        return "\uCC38\uACE0 \uC81C\uD488\uC774\uB098 \uCC38\uACE0 \uD654\uBA74\uC774 \uC788\uB098? \uC5C6\uC73C\uBA74 \uC5C6\uB2E4\uACE0 \uC801\uC5B4\uC918.";
      case "finish_line":
        return "\uCCAB \uBC84\uC804\uC5D0\uC11C \uC5B4\uB514\uAE4C\uC9C0 \uB418\uBA74 \uC131\uACF5\uC778\uC9C0 \uC9E7\uAC8C \uC801\uC5B4\uC918.";
    }
  }

  switch (field) {
    case "product_summary":
      return "Summarize exactly what needs to be built in one sentence.";
    case "target_users":
      return "Who is the primary user for the first version?";
    case "core_workflows":
      return "Which 2-3 core workflows must work in the first version?";
    case "references":
      return "Are there reference products or visuals to follow? If not, say none.";
    case "finish_line":
      return "What does good enough for the first version mean?";
  }
};

const buildArtifactResult = (
  artifact: FrontDoorSessionArtifact,
  sessionPath: string,
  eventsPath: string,
  status: FrontDoorSessionTurnResult["status"]
): FrontDoorSessionTurnResult => {
  const locale = localeForArtifact(artifact);
  const adapterPlan =
    artifact.intake.adapter_plan ??
    (artifact.intake.target_family
      ? buildAdapterPlanFromIntake({
          intake: artifact.intake,
          targetFamily: artifact.intake.target_family
        })
      : undefined);

  return {
    status,
    phase: artifact.phase,
    locale,
    session_id: artifact.session_id,
    thread_id: artifact.thread_id,
    front_door_session_path: sessionPath,
    front_door_session_events_path: eventsPath,
    questions: artifact.last_question_batch,
    missing_product_fields: artifact.missing_product_fields,
    missing_execution_fields: artifact.missing_execution_fields,
    missing_adapter_fields: artifact.missing_adapter_fields ?? [],
    asked_question_ids: artifact.asked_question_ids,
    last_question_ids: artifact.last_question_ids ?? [],
    intake: artifact.intake,
    defaults_accepted: artifact.defaults_accepted,
    unresolved_conflicts: artifact.unresolved_conflicts,
    turn_count: artifact.turn_count,
    ...(status === "ready_for_prepare" || status === "prepared"
      ? { preparation_summary: preparationSummaryLinesFromIntake(artifact.intake, locale) }
      : {}),
    ...(adapterPlan && (status === "ready_for_prepare" || status === "prepared")
      ? { adapter_plan_preview: adapterPlanPreviewLines(adapterPlan, locale) }
      : {})
  };
};

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
  if (!existingSession && initialResult.status === "ambiguous_document_request") {
    const artifact: FrontDoorSessionArtifact = {
      session_id: frontDoorSessionPathsForThread(input.threadId).session_id,
      thread_id: input.threadId,
      lane: "product_build",
      source_request: sourceRequest,
      phase: "clarification",
      intake: initialResult.extracted_summary
        ? { product_summary: initialResult.extracted_summary }
        : {},
      missing_product_fields: [],
      missing_execution_fields: [],
      missing_adapter_fields: [],
      asked_question_ids: [],
      last_question_ids: [],
      last_question_batch: initialResult.questions,
      defaults_accepted: [],
      unresolved_conflicts: [],
      turn_count: 1,
      created_at: now,
      updated_at: now
    };
    const paths = await writeFrontDoorSessionArtifact(input.threadId, artifact);
    await appendFrontDoorSessionEvent(input.threadId, {
      type: "session_created",
      session_id: artifact.session_id,
      thread_id: artifact.thread_id,
      turn_count: artifact.turn_count,
      status: "ambiguous_document_request",
      phase: "clarification",
      message,
      updated_at: now
    });
    await appendFrontDoorSessionEvent(input.threadId, {
      type: "session_status",
      session_id: artifact.session_id,
      thread_id: artifact.thread_id,
      turn_count: artifact.turn_count,
      status: "ambiguous_document_request",
      phase: "clarification",
      updated_at: now
    });
    return buildArtifactResult(
      artifact,
      paths.session_path,
      paths.events_path,
      "ambiguous_document_request"
    );
  }
  if (!existingSession && !initialResult.is_product_build_request) {
    return {
      status: "not_product_build_request",
      phase: "none",
      locale: initialResult.locale,
      questions: [],
      missing_product_fields: [],
      missing_execution_fields: [],
      missing_adapter_fields: [],
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
  const snapshotMissingProductFields =
    resolvedResult.status === "ask_product_questions"
      ? []
      : missingProductFieldsFromSnapshot(mergeResult.intake);
  const status =
    snapshotMissingProductFields.length > 0
      ? "ask_product_questions"
      : resolvedResult.status;
  const phase = toDiscoveryPhase(status);
  if (phase === "none") {
    throw new Error("Discovery session fell out of the product_build lane.");
  }

  const missingProductFields =
    snapshotMissingProductFields.length > 0
      ? snapshotMissingProductFields
      : resolvedResult.missing_product_fields;
  const missingExecutionFields =
    snapshotMissingProductFields.length > 0
      ? []
      : resolvedResult.missing_execution_fields;
  const missingAdapterFields =
    snapshotMissingProductFields.length > 0
      ? []
      : resolvedResult.missing_adapter_fields;
  const questions =
    snapshotMissingProductFields.length > 0
      ? snapshotMissingProductFields
          .slice(0, 3)
          .map((field) => productQuestionForField(field, resolvedResult.locale))
      : resolvedResult.questions;
  const questionIds =
    snapshotMissingProductFields.length > 0
      ? snapshotMissingProductFields.slice(0, questions.length)
      : questionIdsForIntakeResult(resolvedResult);
  const artifact: FrontDoorSessionArtifact = {
    session_id: frontDoorSessionPathsForThread(input.threadId).session_id,
    thread_id: input.threadId,
    lane: "product_build",
    source_request: sourceRequest,
    phase,
    intake: mergeResult.intake,
    missing_product_fields: missingProductFields,
    missing_execution_fields: missingExecutionFields,
    missing_adapter_fields: missingAdapterFields,
    asked_question_ids: uniqueFieldIds([
      ...(existingSession?.asked_question_ids ?? []),
      ...questionIds
    ]),
    last_question_ids: questionIds,
    last_question_batch: questions,
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
