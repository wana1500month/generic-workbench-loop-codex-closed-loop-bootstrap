import { join, relative } from "node:path";

import {
  appendJsonLine,
  loadJsonIfExists,
  loadJsonLinesIfExists,
  writeJson,
  writeText
} from "./file-system.js";
import {
  foregroundOwnerForAttention,
  uiVisibilityForAttention
} from "./foreground-surface.js";
import type { SessionIntakeSnapshot } from "./intake-schema.js";
import { validatePreparedProductSessionIntegrity } from "./prepared-session-integrity.js";
import type { DurableMemoryContext } from "./durable-memory.js";
import type {
  AdapterMigrationDecision,
  BuildBriefArtifact,
  BuildBriefAuthMode,
  BuildBriefDataMode,
  BuildBriefDeliveryLevel,
  BuildBriefExecutionPreference,
  BuildBriefSurface,
  CurrentThreadCheckpointKind,
  IdeaBrief,
  LoopPlan,
  OperatorRecommendedSkill,
  OperatorSurfaceSessionProjection,
  LoopScenario,
  OperatorWorkspaceSurface,
  SessionApprovalBoundary,
  SessionAttention,
  SessionAttentionKind,
  SessionBindingArtifact,
  SessionLoopStatus,
  SessionReadiness,
  SessionReviewBoundary,
  SessionStreamContractArtifact,
  SessionStatusEventArtifact,
  SessionStatusArtifact,
  SessionRunContractArtifact,
  SessionSteeringTrigger,
  TargetFamily,
  TargetManifestKey,
  ThreadBindingState,
  TransportMode
} from "./types.js";

type OpenQuestionArtifact = {
  id: string;
  prompt: string;
  status: "deferred";
  impact: "medium" | "high";
  source: "discovery" | "steering" | "review" | "external";
  related_round?: number;
};

export interface SessionOpenQuestionsArtifact {
  updated_at: string;
  session_status: SessionLoopStatus;
  objective: string;
  latest_round?: number;
  latest_stop_reason?: string;
  steering_notes: string[];
  review_feedback: string[];
  external_blockers: string[];
  questions: OpenQuestionArtifact[];
}

export interface SessionPreparationArtifactsResult {
  buildBrief: BuildBriefArtifact;
  runContract: SessionRunContractArtifact;
  openQuestions: SessionOpenQuestionsArtifact;
  sessionStatus: SessionStatusArtifact;
  sessionStream: SessionStreamContractArtifact;
  executionPlanPath: string;
}

export interface PreparedSessionSeed {
  buildBrief: BuildBriefArtifact;
  runContract: SessionRunContractArtifact;
  idea: IdeaBrief;
  durableMemory: DurableMemoryContext;
}

export interface SessionPreparationArtifactsInput {
  runId: string;
  runDirectory: string;
  rootDirectory: string;
  buildBriefPath: string;
  runContractPath: string;
  openQuestionsPath: string;
  sessionStatusPath: string;
  sessionStatusEventsPath: string;
  sessionStreamPath: string;
  operatorSurfacePath: string;
  executionPlanPath: string;
  transportMode: TransportMode;
  appServerSessionEventsPath?: string;
  threadBindingState?: ThreadBindingState;
  threadId?: string;
  turnId?: string;
  idea: IdeaBrief;
  durableMemory: DurableMemoryContext;
  scenario: LoopScenario;
  plan: LoopPlan;
  workspaceMode: OperatorWorkspaceSurface;
  targetFamily?: TargetFamily;
  validationBundle?: SessionRunContractArtifact["validation_strategy"]["validation_bundle"];
  discoverySource?: SessionRunContractArtifact["discovery_source"];
  sessionStatus?: SessionLoopStatus;
  currentObjective?: string;
  steeringNotes?: string[];
  reviewFeedback?: string[];
  externalBlockers?: string[];
  scopeGuardrails?: string[];
  latestRound?: number;
  latestStopReason?: string;
  checkpointKind?: CurrentThreadCheckpointKind;
  checkpointId?: string;
  checkpointPromptPath?: string;
  checkpointResponsePath?: string;
  checkpointSkill?: OperatorRecommendedSkill;
  decisionOptions?: AdapterMigrationDecision[];
}

const sessionLoopStatuses: SessionLoopStatus[] = [
  "asking",
  "preparing",
  "ready_to_start",
  "running",
  "needs_steering",
  "blocked_externally",
  "ready_for_review",
  "done"
];

const sessionReviewBoundaries: SessionReviewBoundary[] = [
  "diff_ready",
  "milestone_scope_complete",
  "risk_gate",
  "release_candidate"
];

const sessionApprovalBoundaries: SessionApprovalBoundary[] = [
  "scope_change",
  "destructive_change",
  "external_access",
  "deploy",
  "new_run_required"
];

const sessionSteeringTriggers: SessionSteeringTrigger[] = [
  "product_ambiguity",
  "priority_conflict",
  "blocked_external",
  "review_feedback",
  "risk_gate_failure"
];

const requiredPrepareArtifacts = [
  "runtime/build-brief.json",
  "runtime/run-contract.json",
  "runtime/operator-surface.json",
  "runtime/open-questions.json",
  "runtime/session-status.json",
  "runtime/session-status-events.jsonl",
  "runtime/session-stream.json",
  "docs/EXECUTION_PLAN.md"
];

const derivedAttemptArtifacts = [
  "round-contract.json",
  "generator-plan.json",
  "patch-request.json",
  "eval_report.json"
];

const repoConstraints = [
  "Keep long-running state in files, not chat history.",
  "Do not bundle a sample product surface, domain fixture, or reference app into this harness repository.",
  "Do not replace attempt-level round contracts with session-level summaries."
];

const unique = (values: readonly string[]): string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))];

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "session";

const titleCase = (value: string): string =>
  value
    .split(/\s+/)
    .map((word) => (word.length > 0 ? `${word[0]!.toUpperCase()}${word.slice(1)}` : word))
    .join(" ");

const deriveTitleFromSummary = (summary: string | undefined): string | undefined => {
  const cleaned = summary
    ?.replace(/[.!?。！？]+$/u, "")
    .replace(
      /^(?:build|create|make|prototype|ship)\s+(?:me\s+|us\s+|a\s+|an\s+|the\s+)?/i,
      ""
    )
    .replace(
      /(?:을|를)?\s*(?:만들어줘|만들어 줘|만들어|구현해줘|구현해 줘|구현|개발해줘|제작해줘|빌드해줘)\s*$/u,
      ""
    )
    .trim();

  if (!cleaned) {
    return undefined;
  }

  return /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/u.test(cleaned)
    ? cleaned.slice(0, 80)
    : titleCase(cleaned.slice(0, 80));
};

const inferGoalLevelFromTargetScore = (
  targetScore: number | undefined
): BuildBriefDeliveryLevel => {
  if (targetScore === undefined) {
    return "usable";
  }
  if (targetScore <= 0.66) {
    return "prototype";
  }
  if (targetScore <= 0.81) {
    return "mvp";
  }
  if (targetScore <= 0.91) {
    return "usable";
  }
  if (targetScore <= 0.96) {
    return "production-like";
  }
  return "custom";
};

const inferExecutionPreference = (
  deliveryLevel: BuildBriefDeliveryLevel
): BuildBriefExecutionPreference => {
  if (deliveryLevel === "prototype") {
    return "speed";
  }
  if (deliveryLevel === "production-like" || deliveryLevel === "custom") {
    return "correctness";
  }
  return "balanced";
};

const inferPrimarySurface = (
  targetFamily: TargetFamily | undefined
): BuildBriefSurface => {
  if (
    targetFamily === "api-service" ||
    targetFamily === "crud-api"
  ) {
    return "api";
  }
  if (targetFamily === "chat-agent") {
    return "agent";
  }
  if (targetFamily === "dashboard") {
    return "dashboard";
  }
  if (targetFamily === "browser-editor") {
    return "editor";
  }
  return "web";
};

const inferSecondarySurfaces = (input: {
  targetFamily?: TargetFamily;
  targetManifestHints?: Partial<Record<TargetManifestKey, string>>;
}): BuildBriefSurface[] | undefined => {
  const surfaces = new Set<BuildBriefSurface>();

  if (
    input.targetFamily === "fullstack-app" ||
    input.targetFamily === "dashboard" ||
    input.targetFamily === "browser-editor" ||
    input.targetFamily === "chat-agent" ||
    input.targetManifestHints?.api_base_url
  ) {
    surfaces.add("api");
  }

  const result = [...surfaces].filter(
    (surface) => surface !== inferPrimarySurface(input.targetFamily)
  );
  return result.length > 0 ? result : undefined;
};

const inferAuthMode = (
  intake: SessionIntakeSnapshot | undefined
): BuildBriefAuthMode => {
  const summary = `${intake?.product_summary ?? ""} ${(intake?.quality_bar ?? []).join(" ")}`.toLowerCase();
  if (/\b(auth|login|sign in|account|workspace member|team seat)\b/.test(summary)) {
    return "required";
  }
  return "unknown";
};

const inferDataMode = (input: {
  intake: SessionIntakeSnapshot | undefined;
  targetManifestHints: Partial<Record<TargetManifestKey, string>>;
  projectMode: "new" | "existing";
}): BuildBriefDataMode => {
  const combinedHints = [
    ...(input.intake?.constraints ?? []),
    ...(input.intake?.quality_bar ?? []),
    ...(input.intake?.reference_signals ?? [])
  ]
    .join(" ")
    .toLowerCase();

  if (/\bmock\b/.test(combinedHints)) {
    return "mock";
  }
  if (/\b(seed|fixture|demo data|sample data)\b/.test(combinedHints)) {
    return "seeded";
  }
  if (/\breal\b/.test(combinedHints)) {
    return "real";
  }
  if (input.projectMode === "new") {
    return "seeded";
  }
  if (input.targetManifestHints.api_base_url || input.targetManifestHints.health_url) {
    return "real";
  }
  return "unknown";
};

const bulletList = (values: readonly string[], emptyText: string): string =>
  values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : `- ${emptyText}`;

const relativeToRun = (runDirectory: string, path: string): string =>
  relative(runDirectory, path).replace(/\\/g, "/");

const sessionReadinessForStatus = (
  status: SessionLoopStatus
): SessionReadiness => {
  switch (status) {
    case "asking":
    case "needs_steering":
      return "needs_input";
    case "preparing":
    case "ready_to_start":
      return "ready_to_run";
    case "running":
      return "running";
    case "blocked_externally":
      return "blocked";
    case "ready_for_review":
      return "ready_for_review";
    case "done":
      return "complete";
  }
};

const sessionAttentionForStatus = (
  status: SessionLoopStatus
): SessionAttention => {
  switch (status) {
    case "asking":
    case "needs_steering":
      return "human";
    case "ready_to_start":
      return "human";
    case "preparing":
    case "running":
      return "codex";
    case "blocked_externally":
      return "external";
    case "ready_for_review":
      return "review";
    case "done":
      return "none";
  }
};

const sessionAttentionKindForStatus = (input: {
  status: SessionLoopStatus;
  decisionOptions?: AdapterMigrationDecision[];
}): SessionAttentionKind => {
  if ((input.decisionOptions?.length ?? 0) > 0) {
    return "decision";
  }

  switch (input.status) {
    case "asking":
    case "needs_steering":
      return "steering";
    case "ready_to_start":
      return "decision";
    case "blocked_externally":
      return "external_block";
    case "ready_for_review":
      return "review";
    case "preparing":
    case "running":
    case "done":
      return "none";
  }
};

const buildSessionBindingArtifact = (input: {
  transportMode: TransportMode;
  threadBindingState?: ThreadBindingState;
  threadId?: string;
  turnId?: string;
}): SessionBindingArtifact => {
  const surface =
    input.transportMode === "app-server"
      ? "app-server"
      : input.transportMode === "current-thread" &&
          input.threadBindingState !== "unbound"
        ? "current-thread"
        : "manual-protocol";
  const bindingState =
    surface === "app-server"
      ? input.threadId
        ? "bound"
        : "unbound"
      : surface === "current-thread"
        ? input.threadBindingState === "bound" && input.threadId
          ? "bound"
          : "degraded"
        : "degraded";

  return {
    surface,
    binding_state: bindingState,
    ...(input.threadId ? { thread_id: input.threadId } : {}),
    ...(surface === "app-server" && input.turnId ? { turn_id: input.turnId } : {})
  };
};

const buildSessionActiveCheckpointArtifact = (input: {
  sessionStatus: SessionLoopStatus;
  transportMode: TransportMode;
  checkpointKind?: CurrentThreadCheckpointKind;
  checkpointId?: string;
  checkpointPromptPath?: string;
  checkpointResponsePath?: string;
  checkpointSkill?: OperatorRecommendedSkill;
}) => {
  if (
    !input.checkpointKind ||
    input.sessionStatus === "ready_to_start" ||
    input.sessionStatus === "ready_for_review" ||
    input.sessionStatus === "done"
  ) {
    return undefined;
  }

  const defaultSkill: OperatorRecommendedSkill =
    input.transportMode === "current-thread" ? "loop-control" : "run-resume";

  return {
    ...(input.checkpointId ? { checkpoint_id: input.checkpointId } : {}),
    kind: input.checkpointKind,
    skill: input.checkpointSkill ?? defaultSkill,
    ...(input.checkpointPromptPath
      ? { prompt_path: input.checkpointPromptPath }
      : {}),
    ...(input.checkpointResponsePath
      ? { response_path: input.checkpointResponsePath }
      : {})
  };
};

const buildTargetManifestHints = (
  intake: SessionIntakeSnapshot | undefined
): Partial<Record<TargetManifestKey, string>> => ({
  ...(intake?.app_url ? { app_url: intake.app_url } : {}),
  ...(intake?.health_url ? { health_url: intake.health_url } : {}),
  ...(intake?.api_base_url ? { api_base_url: intake.api_base_url } : {})
});

const buildDefaultAcceptanceNotes = (input: {
  workspaceMode: OperatorWorkspaceSurface;
  projectMode: "new" | "existing";
  authMode: BuildBriefAuthMode;
  dataMode: BuildBriefDataMode;
  references: string[];
}): string[] => {
  const defaults: string[] = [];

  if (input.projectMode === "new" && input.workspaceMode === "worktree") {
    defaults.push("Defaulted to worktree for a new build session.");
  }
  if (input.authMode === "unknown") {
    defaults.push("Left auth mode unknown until the product explicitly requires authentication.");
  }
  if (input.dataMode === "seeded") {
    defaults.push("Defaulted to seeded local data until a real external data source becomes necessary.");
  }
  if (input.references.length === 0) {
    defaults.push("Proceeded without a named reference product or visual direction.");
  }

  return defaults;
};

const buildUnresolvedQuestions = (input: {
  targetUsers: string[];
  references: string[];
  authMode: BuildBriefAuthMode;
  dataMode: BuildBriefDataMode;
  primarySurface: BuildBriefSurface;
}): string[] => {
  const questions: string[] = [];

  if (input.targetUsers.length === 0) {
    questions.push("Who the first release is primarily for is still implicit.");
  }
  if (input.authMode === "unknown" && input.primarySurface !== "api") {
    questions.push("Whether the first release needs authentication or can stay unauthenticated.");
  }
  if (input.references.length === 0) {
    questions.push("Whether the first release should follow a specific reference product or visual direction.");
  }
  if (input.dataMode === "unknown" || input.dataMode === "seeded") {
    questions.push("Whether seeded local data is sufficient for the first release or a real integration is required.");
  }

  return unique(questions);
};

const buildOpenQuestions = (input: {
  unresolvedQuestions: string[];
  steeringNotes: string[];
  reviewFeedback: string[];
  externalBlockers: string[];
  latestRound?: number;
}): OpenQuestionArtifact[] => {
  const entries: OpenQuestionArtifact[] = [
    ...unique(input.unresolvedQuestions).map((question, index) => ({
      id: `discovery-question-${String(index + 1).padStart(2, "0")}`,
      prompt: question,
      status: "deferred" as const,
      impact: "medium" as const,
      source: "discovery" as const
    })),
    ...unique(input.steeringNotes).map((note, index) => ({
      id: `steering-question-${String(index + 1).padStart(2, "0")}`,
      prompt: note,
      status: "deferred" as const,
      impact: "high" as const,
      source: "steering" as const,
      ...(input.latestRound !== undefined ? { related_round: input.latestRound } : {})
    })),
    ...unique(input.reviewFeedback).map((feedback, index) => ({
      id: `review-question-${String(index + 1).padStart(2, "0")}`,
      prompt: feedback,
      status: "deferred" as const,
      impact: "high" as const,
      source: "review" as const,
      ...(input.latestRound !== undefined ? { related_round: input.latestRound } : {})
    })),
    ...unique(input.externalBlockers).map((blocker, index) => ({
      id: `external-question-${String(index + 1).padStart(2, "0")}`,
      prompt: blocker,
      status: "deferred" as const,
      impact: "high" as const,
      source: "external" as const,
      ...(input.latestRound !== undefined ? { related_round: input.latestRound } : {})
    }))
  ];

  return Array.from(
    entries.reduce((map, entry) => map.set(entry.prompt, entry), new Map<string, OpenQuestionArtifact>()).values()
  );
};

export const buildSessionStatusArtifact = (input: {
  updatedAt: string;
  runId: string;
  runDirectory: string;
  objective: string;
  sessionStatus: SessionLoopStatus;
  workspaceMode: OperatorWorkspaceSurface;
  currentThreadRequired?: boolean;
  openQuestions: SessionOpenQuestionsArtifact;
  buildBriefPath: string;
  runContractPath: string;
  openQuestionsPath: string;
  sessionStatusEventsPath: string;
  sessionStreamPath: string;
  operatorSurfacePath: string;
  executionPlanPath: string;
  transportMode: TransportMode;
  threadBindingState?: ThreadBindingState;
  threadId?: string;
  turnId?: string;
  checkpointKind?: CurrentThreadCheckpointKind;
  checkpointId?: string;
  checkpointPromptPath?: string;
  checkpointResponsePath?: string;
  checkpointSkill?: OperatorRecommendedSkill;
  decisionOptions?: AdapterMigrationDecision[];
}): SessionStatusArtifact => {
  const sessionBinding = buildSessionBindingArtifact({
    transportMode: input.transportMode,
    threadBindingState: input.threadBindingState,
    threadId: input.threadId,
    turnId: input.turnId
  });
  const activeCheckpoint = buildSessionActiveCheckpointArtifact({
    sessionStatus: input.sessionStatus,
    transportMode: input.transportMode,
    checkpointKind: input.checkpointKind,
    checkpointId: input.checkpointId,
    checkpointPromptPath: input.checkpointPromptPath,
    checkpointResponsePath: input.checkpointResponsePath,
    checkpointSkill: input.checkpointSkill
  });
  const nextAttention = sessionAttentionForStatus(input.sessionStatus);

  return {
    run_id: input.runId,
    updated_at: input.updatedAt,
    session_status: input.sessionStatus,
    readiness: sessionReadinessForStatus(input.sessionStatus),
    next_attention: nextAttention,
    attention_kind: sessionAttentionKindForStatus({
      status: input.sessionStatus,
      decisionOptions: input.decisionOptions
    }),
    ui_visibility: uiVisibilityForAttention(nextAttention),
    foreground_owner: foregroundOwnerForAttention(nextAttention),
    objective: input.objective,
    workspace_mode: input.workspaceMode,
    current_thread_required: input.currentThreadRequired ?? true,
    deferred_question_count: input.openQuestions.questions.length,
    steering_note_count: input.openQuestions.steering_notes.length,
    review_feedback_count: input.openQuestions.review_feedback.length,
    external_blocker_count: input.openQuestions.external_blockers.length,
    session_binding: sessionBinding,
    ...(activeCheckpoint ? { active_checkpoint: activeCheckpoint } : {}),
    ...(input.openQuestions.latest_round !== undefined
      ? { latest_round: input.openQuestions.latest_round }
      : {}),
    ...(input.openQuestions.latest_stop_reason
      ? { latest_stop_reason: input.openQuestions.latest_stop_reason }
      : {}),
    artifacts: {
      build_brief_path: relativeToRun(input.runDirectory, input.buildBriefPath),
      run_contract_path: relativeToRun(input.runDirectory, input.runContractPath),
      open_questions_path: relativeToRun(input.runDirectory, input.openQuestionsPath),
      operator_surface_path: relativeToRun(
        input.runDirectory,
        input.operatorSurfacePath
      ),
      session_status_events_path: relativeToRun(
        input.runDirectory,
        input.sessionStatusEventsPath
      ),
      session_stream_path: relativeToRun(input.runDirectory, input.sessionStreamPath),
      execution_plan_path: relativeToRun(input.runDirectory, input.executionPlanPath)
    }
  };
};

const stableSessionFields = (
  artifact: SessionStatusArtifact
): Record<string, string | number | boolean | null> => ({
  session_status: artifact.session_status,
  readiness: artifact.readiness,
  next_attention: artifact.next_attention,
  attention_kind: artifact.attention_kind,
  ui_visibility: artifact.ui_visibility,
  foreground_owner: artifact.foreground_owner,
  objective: artifact.objective,
  workspace_mode: artifact.workspace_mode,
  current_thread_required: artifact.current_thread_required,
  deferred_question_count: artifact.deferred_question_count,
  steering_note_count: artifact.steering_note_count,
  review_feedback_count: artifact.review_feedback_count,
  external_blocker_count: artifact.external_blocker_count,
  session_binding_surface: artifact.session_binding.surface,
  session_binding_state: artifact.session_binding.binding_state,
  session_binding_thread_id: artifact.session_binding.thread_id ?? null,
  session_binding_turn_id: artifact.session_binding.turn_id ?? null,
  active_checkpoint_kind: artifact.active_checkpoint?.kind ?? null,
  active_checkpoint_id: artifact.active_checkpoint?.checkpoint_id ?? null,
  active_checkpoint_skill: artifact.active_checkpoint?.skill ?? null,
  active_checkpoint_prompt_path: artifact.active_checkpoint?.prompt_path ?? null,
  active_checkpoint_response_path:
    artifact.active_checkpoint?.response_path ?? null,
  latest_round: artifact.latest_round ?? null,
  latest_stop_reason: artifact.latest_stop_reason ?? null
});

const diffSessionStatusFields = (
  previous: SessionStatusArtifact | undefined,
  next: SessionStatusArtifact
): string[] => {
  const nextStable = stableSessionFields(next);
  if (!previous) {
    return Object.keys(nextStable);
  }

  const previousStable = stableSessionFields(previous);
  return Object.keys(nextStable).filter(
    (field) => previousStable[field] !== nextStable[field]
  );
};

const buildSessionStatusEventArtifact = async (input: {
  now: string;
  runId: string;
  sessionStatusPath: string;
  sessionStatusEventsPath: string;
  previousSessionStatus?: SessionStatusArtifact;
  nextSessionStatus: SessionStatusArtifact;
}): Promise<SessionStatusEventArtifact | undefined> => {
  const changedFields = diffSessionStatusFields(
    input.previousSessionStatus,
    input.nextSessionStatus
  );
  if (changedFields.length === 0) {
    return undefined;
  }

  const existingEvents = await loadJsonLinesIfExists<SessionStatusEventArtifact>(
    input.sessionStatusEventsPath
  );
  const sequence = existingEvents.length + 1;
  return {
    event_id: `session-status-event-${String(sequence).padStart(4, "0")}`,
    run_id: input.runId,
    sequence,
    created_at: input.now,
    event_type: input.previousSessionStatus
      ? "session_changed"
      : "session_initialized",
    session_status_path: input.sessionStatusPath,
    changed_fields: changedFields,
    session: input.nextSessionStatus
  };
};

const sessionStartGateAuthorizedForStatus = (
  status: SessionLoopStatus
): boolean =>
  !(
    status === "asking" ||
    status === "preparing" ||
    status === "ready_to_start"
  );

export const buildOperatorSurfaceSessionProjection = (
  artifact: SessionStatusArtifact
): OperatorSurfaceSessionProjection => ({
  objective: artifact.objective,
  session_status: artifact.session_status,
  readiness: artifact.readiness,
  next_attention: artifact.next_attention,
  attention_kind: artifact.attention_kind,
  ui_visibility: artifact.ui_visibility,
  foreground_owner: artifact.foreground_owner,
  deferred_question_count: artifact.deferred_question_count,
  steering_note_count: artifact.steering_note_count,
  review_feedback_count: artifact.review_feedback_count,
  external_blocker_count: artifact.external_blocker_count,
  session_binding: artifact.session_binding,
  ...(artifact.active_checkpoint
    ? { active_checkpoint: artifact.active_checkpoint }
    : {}),
  ...(artifact.latest_round !== undefined
    ? { latest_round: artifact.latest_round }
    : {}),
  ...(artifact.latest_stop_reason
    ? { latest_stop_reason: artifact.latest_stop_reason }
    : {})
});

export const buildSessionStreamContractArtifact = (input: {
  updatedAt: string;
  runId: string;
  runDirectory: string;
  transportMode: TransportMode;
  sessionStatusPath: string;
  sessionStatusEventsPath: string;
  sessionStatus: SessionStatusArtifact;
  latestSourceSequence?: number;
  appServerSessionEventsPath?: string;
}): SessionStreamContractArtifact => ({
  contract_id: `session-stream-${slugify(input.runId)}`,
  run_id: input.runId,
  updated_at: input.updatedAt,
  transport_mode: input.transportMode,
  preferred_delivery:
    input.transportMode === "app-server" && input.appServerSessionEventsPath
      ? "app_server_notification_jsonl"
      : "file_tail_jsonl",
  snapshot_path: relativeToRun(input.runDirectory, input.sessionStatusPath),
  source_events_path: relativeToRun(
    input.runDirectory,
    input.sessionStatusEventsPath
  ),
  ...(input.appServerSessionEventsPath
    ? {
        app_server_events_path: relativeToRun(
          input.runDirectory,
          input.appServerSessionEventsPath
        )
      }
    : {}),
  event_type: "harness/session.changed",
  ...(input.latestSourceSequence !== undefined
    ? { latest_source_sequence: input.latestSourceSequence }
    : {}),
  latest_session: buildOperatorSurfaceSessionProjection(input.sessionStatus),
  widget: {
    kind: "session_status",
    title: "Harness Session Status",
    primary_fields: [
      "session_status",
      "readiness",
      "next_attention",
      "attention_kind",
      "objective"
    ],
    count_fields: [
      "deferred_question_count",
      "steering_note_count",
      "review_feedback_count",
      "external_blocker_count"
    ]
  }
});

const preparedIdeaRawMarkdown = (input: {
  buildBrief: BuildBriefArtifact;
  runContract: SessionRunContractArtifact;
}): string =>
  [
    `# ${input.buildBrief.product.title}`,
    "",
    input.buildBrief.product.summary,
    "",
    "## Goals",
    "",
    ...input.buildBrief.product.core_workflows.map((workflow) => `- ${workflow}`),
    "",
    "## Quality Bar",
    "",
    ...input.buildBrief.product.success_definition.map(
      (criterion) => `- ${criterion}`
    ),
    "",
    "## Constraints",
    "",
    ...unique([
      ...input.buildBrief.constraints.stack_preferences,
      ...input.buildBrief.constraints.integrations,
      ...input.buildBrief.constraints.non_goals,
      ...input.buildBrief.constraints.repo_constraints,
      `Target root: ${input.runContract.execution_controls.target_root}`,
      `Project mode: ${input.runContract.execution_controls.project_mode}`
    ]).map((constraint) => `- ${constraint}`)
  ].join("\n");

export const loadPreparedSessionSeed = async (input: {
  buildBriefPath: string;
  runContractPath: string;
}): Promise<PreparedSessionSeed | undefined> => {
  const [buildBrief, runContract] = await Promise.all([
    loadJsonIfExists<BuildBriefArtifact>(input.buildBriefPath),
    loadJsonIfExists<SessionRunContractArtifact>(input.runContractPath)
  ]);

  if (!buildBrief || !runContract) {
    return undefined;
  }

  const idea: IdeaBrief = {
    title: buildBrief.product.title,
    summary: buildBrief.product.summary,
    user_goals:
      buildBrief.product.core_workflows.length > 0
        ? [...buildBrief.product.core_workflows]
        : [...buildBrief.product.success_definition],
    constraints: unique([
      ...buildBrief.constraints.stack_preferences,
      ...buildBrief.constraints.integrations,
      ...buildBrief.constraints.non_goals,
      ...buildBrief.constraints.repo_constraints,
      `Target root: ${runContract.execution_controls.target_root}`,
      `Workspace mode: ${runContract.workspace_mode}`
    ]),
    quality_bar:
      buildBrief.product.success_definition.length > 0
        ? [...buildBrief.product.success_definition]
        : [...runContract.stop_rule.done_when],
    source_path: input.buildBriefPath,
    raw_markdown: preparedIdeaRawMarkdown({
      buildBrief,
      runContract
    })
  };

  return {
    buildBrief,
    runContract,
    idea,
    durableMemory: {
      title: buildBrief.product.title,
      summary: buildBrief.product.summary,
      finishLine: buildBrief.product.success_definition[0],
      targetUsers: [...buildBrief.product.target_users],
      coreFeatures: [...buildBrief.product.core_workflows],
      qualityBar:
        buildBrief.product.success_definition.length > 0
          ? [...buildBrief.product.success_definition]
          : [...runContract.stop_rule.done_when],
      constraints: unique([
        ...buildBrief.constraints.stack_preferences,
        ...buildBrief.constraints.integrations,
        ...buildBrief.constraints.repo_constraints
      ]),
      mustNotBreak: [...buildBrief.constraints.non_goals],
      targetScore: runContract.execution_controls.target_score,
      maxRounds: runContract.execution_controls.max_rounds
    }
  };
};

const executionPlanMarkdown = (input: {
  runId: string;
  title: string;
  summary: string;
  workspaceMode: OperatorWorkspaceSurface;
  objective: string;
  primarySurface: BuildBriefSurface;
  deliveryLevel: BuildBriefDeliveryLevel;
  targetRoot: string;
  buildBriefPath: string;
  runContractPath: string;
  openQuestionsPath: string;
  sessionStatusPath: string;
  sessionStreamPath: string;
  sessionStatusEventsPath: string;
  operatorSurfacePath: string;
  scenario: LoopScenario;
  plan: LoopPlan;
  openQuestions: SessionOpenQuestionsArtifact;
}): string =>
  [
    "# Execution Plan",
    "",
    "## Session",
    "",
    `- Run id: ${input.runId}`,
    `- Session status: ${input.openQuestions.session_status}`,
    ...(input.openQuestions.session_status === "ready_to_start"
      ? [
          "- Start gate: preparation is complete; say \"루프 시작\" or \"start loop\" to begin running on the same Codex thread."
        ]
      : []),
    `- Objective: ${input.objective}`,
    `- Workspace mode: ${input.workspaceMode}`,
    `- Primary surface: ${input.primarySurface}`,
    `- Delivery level: ${input.deliveryLevel}`,
    `- Target root: ${input.targetRoot}`,
    `- Build brief: ${input.buildBriefPath}`,
    `- Session run contract: ${input.runContractPath}`,
    `- Session status: ${input.sessionStatusPath}`,
    `- Session stream contract: ${input.sessionStreamPath}`,
    `- Session status events: ${input.sessionStatusEventsPath}`,
    `- Operator surface: ${input.operatorSurfacePath}`,
    `- Deferred questions: ${input.openQuestionsPath}`,
    "",
    "## Product Summary",
    "",
    `- Title: ${input.title}`,
    "",
    input.summary,
    "",
    "## Core User Goals",
    "",
    bulletList(input.scenario.user_goals, "No explicit user goals were recorded."),
    "",
    "## Acceptance Highlights",
    "",
    bulletList(
      input.scenario.acceptance_highlights,
      "No acceptance highlights were recorded yet."
    ),
    "",
    "## Controller Strategy",
    "",
    `- North star: ${input.plan.north_star}`,
    `- Attempt strategy: ${input.plan.attempt_strategy}`,
    `- Max rounds: ${input.plan.max_rounds}`,
    "",
    "## Planner Acceptance Checks",
    "",
    bulletList(
      input.plan.planner_acceptance_checks,
      "No planner acceptance checks were recorded."
    ),
    "",
    "## Remediation Policy",
    "",
    bulletList(
      input.plan.remediation_policy,
      "No remediation policy was recorded."
    ),
    "",
    "## Live Review Context",
    "",
    bulletList(
      input.openQuestions.review_feedback,
      "none"
    ),
    "",
    "## Steering Context",
    "",
    bulletList(
      input.openQuestions.steering_notes,
      "none"
    ),
    "",
    "## External Blockers",
    "",
    bulletList(
      input.openQuestions.external_blockers,
      "none"
    ),
    "",
    "## Deferred Questions",
    "",
    bulletList(
      input.openQuestions.questions.map((question) => question.prompt),
      "none"
    ),
    ""
  ].join("\n");

export const writeSessionPreparationArtifacts = async (
  input: SessionPreparationArtifactsInput
): Promise<SessionPreparationArtifactsResult> => {
  const now = new Date().toISOString();
  const intake = await loadJsonIfExists<SessionIntakeSnapshot>(
    join(input.rootDirectory, "intake.json")
  );
  const existingBuildBrief = await loadJsonIfExists<BuildBriefArtifact>(
    input.buildBriefPath
  );
  const existingRunContract =
    await loadJsonIfExists<SessionRunContractArtifact>(input.runContractPath);
  const existingSessionStatus =
    await loadJsonIfExists<SessionStatusArtifact>(input.sessionStatusPath);
  const targetManifestHints = buildTargetManifestHints(intake);
  const isProductBuild = Boolean(
    input.discoverySource || intake?.product_title || intake?.target_family
  );
  const projectMode = intake?.project_mode ?? "existing";
  const primarySurface = inferPrimarySurface(intake?.target_family ?? input.targetFamily);
  const secondarySurfaces = inferSecondarySurfaces({
    targetFamily: intake?.target_family ?? input.targetFamily,
    targetManifestHints
  });
  const authMode = inferAuthMode(intake);
  const dataMode = inferDataMode({
    intake,
    targetManifestHints,
    projectMode
  });
  const deliveryLevel =
    intake?.goal_level ?? inferGoalLevelFromTargetScore(intake?.target_score ?? input.plan.target_total_score);
  const executionPreference = inferExecutionPreference(deliveryLevel);
  const references = unique([
    ...(intake?.reference_apps ?? []),
    ...(intake?.reference_signals ?? [])
  ]);
  const productTitle =
    intake?.product_title ??
    deriveTitleFromSummary(intake?.product_summary) ??
    input.durableMemory.title;
  const productSummary = intake?.product_summary ?? input.durableMemory.summary;
  const targetUsers =
    intake?.target_users && intake.target_users.length > 0
      ? unique(intake.target_users)
      : isProductBuild
        ? []
        : input.durableMemory.targetUsers;
  const coreWorkflows =
    intake?.core_features && intake.core_features.length > 0
      ? unique(intake.core_features)
      : isProductBuild
        ? []
        : input.durableMemory.coreFeatures;
  const primaryFinishLine = isProductBuild
    ? intake?.finish_line ?? intake?.quality_bar?.[0]
    : intake?.finish_line ??
      input.durableMemory.finishLine ??
      input.durableMemory.qualityBar[0];
  const stackPreferences = unique([
    intake?.framework_hint ?? "",
    intake?.package_manager ?? ""
  ]);
  const defaultsAccepted = buildDefaultAcceptanceNotes({
    workspaceMode: input.workspaceMode,
    projectMode,
    authMode,
    dataMode,
    references
  });
  const unresolvedQuestions = buildUnresolvedQuestions({
    targetUsers,
    references,
    authMode,
    dataMode,
    primarySurface
  });
  const steeringNotes = unique(input.steeringNotes ?? []);
  const reviewFeedback = unique(input.reviewFeedback ?? []);
  const externalBlockers = unique(input.externalBlockers ?? []);
  const successDefinition = (isProductBuild
    ? unique([primaryFinishLine ?? "", ...(intake?.quality_bar ?? [])])
    : unique([
        primaryFinishLine ?? "",
        ...(intake?.quality_bar ?? []),
        ...(!intake?.finish_line ? input.durableMemory.qualityBar : [])
      ])).slice(0, 4);
  const targetRoot = intake?.target_root ?? input.rootDirectory;
  const objective =
    input.currentObjective ??
    (primaryFinishLine
      ? `Ship a reviewable build for ${productTitle} that reaches: ${primaryFinishLine}`
      : `Ship a reviewable build for ${productTitle} without leaving the current Codex thread.`);

  const buildBrief: BuildBriefArtifact = {
    brief_id:
      existingBuildBrief?.brief_id ??
      `brief-${slugify(productTitle)}-${slugify(input.runId)}`,
    source_request: productSummary,
    created_at: existingBuildBrief?.created_at ?? now,
    updated_at: now,
    product: {
      title: productTitle,
      summary: productSummary,
      target_users: targetUsers,
      core_workflows: coreWorkflows,
      success_definition: successDefinition,
      references
    },
    surface: {
      primary_surface: primarySurface,
      ...(secondarySurfaces ? { secondary_surfaces: secondarySurfaces } : {}),
      auth_mode: authMode
    },
    delivery: {
      level: deliveryLevel,
      execution_preference: executionPreference
    },
    execution_context: {
      project_mode: projectMode,
      target_root: targetRoot,
      workspace_mode_preference: input.workspaceMode,
      ...(intake?.run_command ? { run_command: intake.run_command } : {}),
      ...(intake?.check_command ? { check_command: intake.check_command } : {}),
      ...(Object.keys(targetManifestHints).length > 0
        ? { target_manifest_hints: targetManifestHints }
        : {})
    },
    constraints: {
      stack_preferences: stackPreferences,
      data_mode: dataMode,
      integrations: [],
      non_goals: unique([...(intake?.non_goals ?? []), ...(input.scopeGuardrails ?? [])]),
      repo_constraints: repoConstraints
    },
    defaults_accepted: defaultsAccepted,
    unresolved_questions: unresolvedQuestions,
    operator_status_vocabulary: sessionLoopStatuses
  };

  const sessionStatus = input.sessionStatus ?? "ready_to_start";
  const openQuestions: SessionOpenQuestionsArtifact = {
    updated_at: now,
    session_status: sessionStatus,
    objective,
    ...(input.latestRound !== undefined ? { latest_round: input.latestRound } : {}),
    ...(input.latestStopReason ? { latest_stop_reason: input.latestStopReason } : {}),
    steering_notes: steeringNotes,
    review_feedback: reviewFeedback,
    external_blockers: externalBlockers,
    questions: buildOpenQuestions({
      unresolvedQuestions,
      steeringNotes,
      reviewFeedback,
      externalBlockers,
      latestRound: input.latestRound
    })
  };
  const sessionStatusArtifact = buildSessionStatusArtifact({
    updatedAt: now,
    runId: input.runId,
    runDirectory: input.runDirectory,
    objective,
    sessionStatus,
    workspaceMode: input.workspaceMode,
    currentThreadRequired: true,
    openQuestions,
    buildBriefPath: input.buildBriefPath,
    runContractPath: input.runContractPath,
    openQuestionsPath: input.openQuestionsPath,
    sessionStatusEventsPath: input.sessionStatusEventsPath,
    sessionStreamPath: input.sessionStreamPath,
    operatorSurfacePath: input.operatorSurfacePath,
    executionPlanPath: input.executionPlanPath,
    transportMode: input.transportMode,
    threadBindingState: input.threadBindingState,
    threadId: input.threadId,
    turnId: input.turnId,
    checkpointKind: input.checkpointKind,
    checkpointId: input.checkpointId,
    checkpointPromptPath: input.checkpointPromptPath,
    checkpointResponsePath: input.checkpointResponsePath,
    checkpointSkill: input.checkpointSkill,
    decisionOptions: input.decisionOptions
  });
  const startGateAuthorized = sessionStartGateAuthorizedForStatus(sessionStatus);
  const sessionStatusEvent = await buildSessionStatusEventArtifact({
    now,
    runId: input.runId,
    sessionStatusPath: input.sessionStatusPath,
    sessionStatusEventsPath: input.sessionStatusEventsPath,
    previousSessionStatus: existingSessionStatus,
    nextSessionStatus: sessionStatusArtifact
  });

  const runContract: SessionRunContractArtifact = {
    contract_id:
      existingRunContract?.contract_id ??
      `run-contract-${slugify(input.runId)}`,
    brief_id: buildBrief.brief_id,
    created_at: existingRunContract?.created_at ?? now,
    updated_at: now,
    run_mode: "foreground_same_thread",
    current_thread_required: true,
    start_gate: {
      required: true,
      authorized: startGateAuthorized,
      authorized_at: startGateAuthorized
        ? existingRunContract?.start_gate?.authorized_at ?? now
        : null,
      authorized_by: startGateAuthorized
        ? existingRunContract?.start_gate?.authorized_by ?? "loop-control"
        : null
    },
    workspace_mode: input.workspaceMode,
    objective,
    non_goals: buildBrief.constraints.non_goals,
    ...(input.discoverySource ? { discovery_source: input.discoverySource } : {}),
    discovery_policy: {
      max_questions_per_turn: 3,
      ask_only_missing_high_impact_questions: true,
      prefer_defaults_over_low_value_questions: true
    },
    execution_controls: {
      project_mode: projectMode,
      target_root: targetRoot,
      target_score: intake?.target_score ?? input.plan.target_total_score,
      max_rounds: intake?.max_rounds ?? input.plan.max_rounds,
      ...(intake?.run_command ? { run_command: intake.run_command } : {}),
      ...(intake?.check_command ? { check_command: intake.check_command } : {}),
      ...(Object.keys(targetManifestHints).length > 0
        ? { target_manifest_hints: targetManifestHints }
        : {})
    },
    validation_strategy: {
      iteration_mode: "patch_oriented",
      evaluator_mode: "risk_triggered",
      review_surface: "codex_review_pane",
      ...(input.validationBundle
        ? { validation_bundle: input.validationBundle }
        : {})
    },
    continuation_policy: {
      mode: "patch_first",
      recontract_only_on: [
        "missing_patch_authority",
        "release_gate_regression",
        "scope_drift",
        "repeated_unresolved_signature",
        "plateau_without_progress"
      ]
    },
    review_boundaries: sessionReviewBoundaries,
    approval_boundaries: sessionApprovalBoundaries,
    steering_triggers: sessionSteeringTriggers,
    required_prepare_artifacts: requiredPrepareArtifacts,
    derived_attempt_artifacts: derivedAttemptArtifacts,
    operator_surface_path: "runtime/operator-surface.json",
    open_questions_path: "runtime/open-questions.json",
    execution_plan_path: "docs/EXECUTION_PLAN.md",
    stop_rule: {
      done_when: unique([
        primaryFinishLine ?? "",
        ...successDefinition,
        "the latest diff is ready for user review"
      ]),
      stop_on: [
        "explicit user stop",
        "external blocker that needs human resolution",
        "new run required for a boundary change"
      ]
    }
  };

  if (input.discoverySource || intake?.product_title || intake?.target_family) {
    const integrityErrors = validatePreparedProductSessionIntegrity({
      buildBrief,
      runContract
    });
    if (integrityErrors.length > 0) {
      throw new Error(
        `Prepared product session failed integrity checks:\n${integrityErrors
          .map((error) => `- ${error}`)
          .join("\n")}`
      );
    }
  }

  await Promise.all([
    writeJson(input.buildBriefPath, buildBrief),
    writeJson(input.runContractPath, runContract),
    writeJson(input.openQuestionsPath, openQuestions),
    writeJson(input.sessionStatusPath, sessionStatusArtifact),
    writeText(
      input.executionPlanPath,
      executionPlanMarkdown({
        runId: input.runId,
        title: buildBrief.product.title,
        summary: buildBrief.product.summary,
        workspaceMode: input.workspaceMode,
        objective,
        primarySurface,
        deliveryLevel,
        targetRoot,
        buildBriefPath: relativeToRun(input.runDirectory, input.buildBriefPath),
        runContractPath: relativeToRun(input.runDirectory, input.runContractPath),
        openQuestionsPath: relativeToRun(input.runDirectory, input.openQuestionsPath),
        sessionStatusPath: relativeToRun(input.runDirectory, input.sessionStatusPath),
        sessionStreamPath: relativeToRun(input.runDirectory, input.sessionStreamPath),
        sessionStatusEventsPath: relativeToRun(
          input.runDirectory,
          input.sessionStatusEventsPath
        ),
        operatorSurfacePath: relativeToRun(input.runDirectory, input.operatorSurfacePath),
        scenario: input.scenario,
        plan: input.plan,
        openQuestions
      })
    )
  ]);

  if (sessionStatusEvent) {
    await appendJsonLine(input.sessionStatusEventsPath, sessionStatusEvent);
  }

  const latestSourceSequence =
    sessionStatusEvent?.sequence ??
    (await loadJsonLinesIfExists<SessionStatusEventArtifact>(
      input.sessionStatusEventsPath
    )).at(-1)?.sequence;
  const sessionStream = buildSessionStreamContractArtifact({
    updatedAt: now,
    runId: input.runId,
    runDirectory: input.runDirectory,
    transportMode: input.transportMode,
    sessionStatusPath: input.sessionStatusPath,
    sessionStatusEventsPath: input.sessionStatusEventsPath,
    sessionStatus: sessionStatusArtifact,
    latestSourceSequence,
    appServerSessionEventsPath: input.appServerSessionEventsPath
  });
  await writeJson(input.sessionStreamPath, sessionStream);

  return {
    buildBrief,
    runContract,
    openQuestions,
    sessionStatus: sessionStatusArtifact,
    sessionStream,
    executionPlanPath: input.executionPlanPath
  };
};
