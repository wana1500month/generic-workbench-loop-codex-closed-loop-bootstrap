import { join, relative } from "node:path";

import { loadJsonIfExists, writeJson, writeText } from "./file-system.js";
import type { DurableMemoryContext } from "./durable-memory.js";
import type {
  BuildBriefArtifact,
  BuildBriefAuthMode,
  BuildBriefDataMode,
  BuildBriefDeliveryLevel,
  BuildBriefExecutionPreference,
  BuildBriefSurface,
  IdeaBrief,
  LoopPlan,
  OperatorSurfaceSessionProjection,
  LoopScenario,
  OperatorWorkspaceSurface,
  SessionApprovalBoundary,
  SessionAttention,
  SessionLoopStatus,
  SessionReadiness,
  SessionReviewBoundary,
  SessionStatusArtifact,
  SessionRunContractArtifact,
  SessionSteeringTrigger,
  TargetFamily,
  TargetManifestKey
} from "./types.js";

type SessionIntakeSnapshot = {
  product_title?: string;
  product_summary?: string;
  target_users?: string[];
  core_features?: string[];
  reference_apps?: string[];
  finish_line?: string;
  target_family?: TargetFamily;
  goal_level?: BuildBriefDeliveryLevel;
  target_score?: number;
  max_rounds?: number;
  target_root?: string;
  project_mode?: "new" | "existing";
  framework_hint?: string;
  package_manager?: string;
  run_command?: string;
  check_command?: string;
  app_url?: string;
  health_url?: string;
  api_base_url?: string;
  constraints?: string[];
  quality_bar?: string[];
  reference_signals?: string[];
  non_goals?: string[];
};

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
  executionPlanPath: string;
}

export interface SessionPreparationArtifactsInput {
  runId: string;
  runDirectory: string;
  rootDirectory: string;
  buildBriefPath: string;
  runContractPath: string;
  openQuestionsPath: string;
  sessionStatusPath: string;
  operatorSurfacePath: string;
  executionPlanPath: string;
  idea: IdeaBrief;
  durableMemory: DurableMemoryContext;
  scenario: LoopScenario;
  plan: LoopPlan;
  workspaceMode: OperatorWorkspaceSurface;
  targetFamily?: TargetFamily;
  sessionStatus?: SessionLoopStatus;
  currentObjective?: string;
  steeringNotes?: string[];
  reviewFeedback?: string[];
  externalBlockers?: string[];
  scopeGuardrails?: string[];
  latestRound?: number;
  latestStopReason?: string;
}

const sessionLoopStatuses: SessionLoopStatus[] = [
  "asking",
  "preparing",
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
  operatorSurfacePath: string;
  executionPlanPath: string;
}): SessionStatusArtifact => ({
  run_id: input.runId,
  updated_at: input.updatedAt,
  session_status: input.sessionStatus,
  readiness: sessionReadinessForStatus(input.sessionStatus),
  next_attention: sessionAttentionForStatus(input.sessionStatus),
  objective: input.objective,
  workspace_mode: input.workspaceMode,
  current_thread_required: input.currentThreadRequired ?? true,
  deferred_question_count: input.openQuestions.questions.length,
  steering_note_count: input.openQuestions.steering_notes.length,
  review_feedback_count: input.openQuestions.review_feedback.length,
  external_blocker_count: input.openQuestions.external_blockers.length,
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
    operator_surface_path: relativeToRun(input.runDirectory, input.operatorSurfacePath),
    execution_plan_path: relativeToRun(input.runDirectory, input.executionPlanPath)
  }
});

export const buildOperatorSurfaceSessionProjection = (
  artifact: SessionStatusArtifact
): OperatorSurfaceSessionProjection => ({
  objective: artifact.objective,
  session_status: artifact.session_status,
  readiness: artifact.readiness,
  next_attention: artifact.next_attention,
  deferred_question_count: artifact.deferred_question_count,
  steering_note_count: artifact.steering_note_count,
  review_feedback_count: artifact.review_feedback_count,
  external_blocker_count: artifact.external_blocker_count,
  ...(artifact.latest_round !== undefined
    ? { latest_round: artifact.latest_round }
    : {}),
  ...(artifact.latest_stop_reason
    ? { latest_stop_reason: artifact.latest_stop_reason }
    : {})
});

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
    `- Objective: ${input.objective}`,
    `- Workspace mode: ${input.workspaceMode}`,
    `- Primary surface: ${input.primarySurface}`,
    `- Delivery level: ${input.deliveryLevel}`,
    `- Target root: ${input.targetRoot}`,
    `- Build brief: ${input.buildBriefPath}`,
    `- Session run contract: ${input.runContractPath}`,
    `- Session status: ${input.sessionStatusPath}`,
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
  const targetManifestHints = buildTargetManifestHints(intake);
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
    targetUsers: input.durableMemory.targetUsers,
    references,
    authMode,
    dataMode,
    primarySurface
  });
  const steeringNotes = unique(input.steeringNotes ?? []);
  const reviewFeedback = unique(input.reviewFeedback ?? []);
  const externalBlockers = unique(input.externalBlockers ?? []);
  const successDefinition = unique([
    input.durableMemory.finishLine ?? "",
    ...(intake?.quality_bar ?? input.durableMemory.qualityBar)
  ]).slice(0, 4);
  const targetRoot = intake?.target_root ?? input.rootDirectory;
  const objective =
    input.currentObjective ??
    (input.durableMemory.finishLine
      ? `Ship a reviewable build that reaches: ${input.durableMemory.finishLine}`
      : `Ship a reviewable build for ${input.durableMemory.title} without leaving the current Codex thread.`);

  const buildBrief: BuildBriefArtifact = {
    brief_id:
      existingBuildBrief?.brief_id ??
      `brief-${slugify(input.durableMemory.title)}-${slugify(input.runId)}`,
    source_request: intake?.product_summary ?? input.idea.summary,
    created_at: existingBuildBrief?.created_at ?? now,
    updated_at: now,
    product: {
      title: intake?.product_title ?? input.durableMemory.title,
      summary: intake?.product_summary ?? input.durableMemory.summary,
      target_users: input.durableMemory.targetUsers,
      core_workflows: input.durableMemory.coreFeatures,
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

  const sessionStatus = input.sessionStatus ?? "preparing";
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
    operatorSurfacePath: input.operatorSurfacePath,
    executionPlanPath: input.executionPlanPath
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
    workspace_mode: input.workspaceMode,
    objective,
    non_goals: buildBrief.constraints.non_goals,
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
      review_surface: "codex_review_pane"
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
        input.durableMemory.finishLine ?? "",
        "the latest diff is ready for user review"
      ]),
      stop_on: [
        "explicit user stop",
        "external blocker that needs human resolution",
        "new run required for a boundary change"
      ]
    }
  };

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
        operatorSurfacePath: relativeToRun(input.runDirectory, input.operatorSurfacePath),
        scenario: input.scenario,
        plan: input.plan,
        openQuestions
      })
    )
  ]);

  return {
    buildBrief,
    runContract,
    openQuestions,
    sessionStatus: sessionStatusArtifact,
    executionPlanPath: input.executionPlanPath
  };
};
