import { mkdir, readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  buildBootstrapAnswersFromSeed,
  createBootstrapArtifactPaths,
  normalizeBootstrapTargetFamily,
  scaffoldBootstrapArtifacts,
  type BootstrapCustomQualityMetric,
  type BootstrapProbeHints
} from "./bootstrap.js";
import {
  ensureDurableMemoryArtifacts,
  loadDurableMemoryContext
} from "./durable-memory.js";
import {
  loadJson,
  loadJsonIfExists,
  nextRunId,
  pathExists,
  repoRoot,
  writeJson
} from "./file-system.js";
import { defaultIdeaPath, readIdeaBrief } from "./idea-intake.js";
import {
  buildOperatorSurfaceArtifact,
  resolveOperatorSurfaceContext,
  writeOperatorSurfaceArtifacts
} from "./operator-surface.js";
import { buildLoopPlan, buildScenarioFromIdea } from "./planner.js";
import { runtimeStatePathsForRun } from "./runtime-state.js";
import {
  buildOperatorSurfaceSessionProjection,
  loadPreparedSessionSeed,
  type PreparedSessionSeed,
  writeSessionPreparationArtifacts
} from "./session-artifacts.js";
import { resolveTargetFamilySelection } from "./profile-selection.js";
import type {
  ControllerMode,
  LoopRubric,
  OperatorWorkspaceSurface,
  SessionRunContractArtifact,
  SessionStatusArtifact,
  TargetFamily,
  ThreadBindingState,
  TransportMode
} from "./types.js";

type SessionIntakeSnapshot = {
  project_mode?: "new" | "existing";
  target_family?: TargetFamily;
  target_score?: number;
  max_rounds?: number;
  product_title?: string;
  product_summary?: string;
  target_users?: string[];
  core_features?: string[];
  reference_apps?: string[];
  finish_line?: string;
  goal_level?: "prototype" | "mvp" | "usable" | "production-like" | "custom";
  target_root?: string;
  framework_hint?: string;
  package_manager?: string;
  run_command?: string;
  check_command?: string;
  ready_url?: string;
  app_url?: string;
  health_url?: string;
  api_base_url?: string;
  constraints?: string[];
  quality_bar?: string[];
  must_not_break?: string[];
  failure_expectations?: string[];
  continuity_boundaries?: string[];
  reference_signals?: string[];
  non_goals?: string[];
  probe_hints?: BootstrapProbeHints;
  custom_quality_metrics?: Array<{
    metric_id: string;
    label: string;
    description: string;
    minimum_score_out_of_ten: number;
    required?: boolean;
    weight?: number;
  }>;
  notes?: string;
};

export interface PrepareSessionResult {
  runId: string;
  runDirectory: string;
  buildBriefPath: string;
  runContractPath: string;
  openQuestionsPath: string;
  sessionStatusPath: string;
  sessionStatusEventsPath: string;
  sessionStreamPath: string;
  operatorSurfacePath: string;
  executionPlanPath: string;
  adapterPath?: string;
  rubricPath?: string;
  evaluatorProfilePath?: string;
}

export interface ReadyToStartSessionMarker {
  run_id: string;
  run_directory: string;
  updated_at: string;
  thread_id?: string;
}

const defaultRubricPath = join(
  repoRoot,
  "evals",
  "rubrics",
  "generic-harness-rubric.json"
);

const threadBindingStates = new Set<ThreadBindingState>([
  "bound",
  "assumed",
  "unbound"
]);

const workspaceModes = new Set<OperatorWorkspaceSurface>(["local", "worktree"]);

const readThreadBindingStateFromEnv = (): ThreadBindingState | undefined => {
  const value = process.env.HARNESS_THREAD_BINDING_STATE?.trim();
  return value && threadBindingStates.has(value as ThreadBindingState)
    ? (value as ThreadBindingState)
    : undefined;
};

const inferWorkspaceMode = (
  projectMode: SessionIntakeSnapshot["project_mode"] | undefined
): OperatorWorkspaceSurface => (projectMode === "new" ? "worktree" : "local");

export const readyToStartMarkerPathForRuns = (runsDirectory: string): string =>
  join(runsDirectory, "ready-to-start-session.json");

export const loadReadyToStartSessionMarker = async (
  runsDirectory: string
): Promise<ReadyToStartSessionMarker | undefined> =>
  loadJsonIfExists<ReadyToStartSessionMarker>(
    readyToStartMarkerPathForRuns(runsDirectory)
  );

export const loadPreparedSessionSeedForRun = async (
  runDirectory: string
): Promise<PreparedSessionSeed | undefined> => {
  const runtimePaths = runtimeStatePathsForRun(runDirectory);
  return loadPreparedSessionSeed({
    buildBriefPath: runtimePaths.buildBriefPath,
    runContractPath: runtimePaths.runContractPath
  });
};

const markerMatchesPreparedThread = (
  markerThreadId: string | undefined,
  currentThreadId: string | undefined
): boolean => (currentThreadId ? markerThreadId === currentThreadId : !markerThreadId);

const matchesPreparedThread = (
  sessionStatus: SessionStatusArtifact,
  currentThreadId: string | undefined
): boolean => {
  const preparedThreadId = sessionStatus.session_binding.thread_id;
  if (currentThreadId) {
    return preparedThreadId === currentThreadId;
  }
  return !preparedThreadId && sessionStatus.session_binding.binding_state !== "bound";
};

const isPreparedRunAwaitingStart = async (input: {
  runDirectory: string;
  currentThreadId?: string;
  sessionStatus?: SessionStatusArtifact;
  preparedSeed?: PreparedSessionSeed;
}): Promise<boolean> => {
  if (!input.sessionStatus || !input.preparedSeed) {
    return false;
  }
  if (input.sessionStatus.session_status !== "ready_to_start") {
    return false;
  }
  if (input.sessionStatus.latest_stop_reason !== undefined) {
    return false;
  }
  if (!matchesPreparedThread(input.sessionStatus, input.currentThreadId)) {
    return false;
  }
  return !(await pathExists(join(input.runDirectory, "summary.json")));
};

export const findLatestPreparedRunAwaitingStart = async (
  runsDirectory: string,
  currentThreadId?: string
): Promise<{ runId: string; runDirectory: string } | undefined> => {
  try {
    const marker = await loadReadyToStartSessionMarker(runsDirectory);
    if (marker && markerMatchesPreparedThread(marker.thread_id, currentThreadId)) {
      const markerSessionStatus = await loadJsonIfExists<SessionStatusArtifact>(
        runtimeStatePathsForRun(marker.run_directory).sessionStatusPath
      );
      const markerPreparedSeed = await loadPreparedSessionSeedForRun(
        marker.run_directory
      );
      if (
        await isPreparedRunAwaitingStart({
          runDirectory: marker.run_directory,
          currentThreadId,
          sessionStatus: markerSessionStatus,
          preparedSeed: markerPreparedSeed
        })
      ) {
        return {
          runId: marker.run_id,
          runDirectory: marker.run_directory
        };
      }
    }

    const entries = await readdir(runsDirectory, { withFileTypes: true });
    const runDirectories = entries
      .filter((entry) => entry.isDirectory() && /^run-\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => Number(right.slice(4)) - Number(left.slice(4)));

    for (const runId of runDirectories) {
      const runDirectory = join(runsDirectory, runId);
      const runtimePaths = runtimeStatePathsForRun(runDirectory);
      const [sessionStatus, preparedSeed] = await Promise.all([
        loadJsonIfExists<SessionStatusArtifact>(runtimePaths.sessionStatusPath),
        loadPreparedSessionSeedForRun(runDirectory)
      ]);
      if (
        await isPreparedRunAwaitingStart({
          runDirectory,
          currentThreadId,
          sessionStatus,
          preparedSeed
        })
      ) {
        return {
          runId,
          runDirectory
        };
      }
    }
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return undefined;
    }
    throw error;
  }

  return undefined;
};

export const prepareSessionRun = async (input: {
  runDirectory?: string;
  rubricPath?: string;
  targetFamily?: TargetFamily;
  targetScore?: number;
  maxRounds?: number;
  workspaceMode?: OperatorWorkspaceSurface;
  transportMode?: TransportMode;
  controllerMode?: ControllerMode;
  ideaPath?: string;
}): Promise<PrepareSessionResult> => {
  const runsDirectory = join(repoRoot, "evals", "runs");
  const resolvedRunDirectory = input.runDirectory
    ? resolve(input.runDirectory)
    : undefined;
  const runId =
    resolvedRunDirectory !== undefined
      ? basename(resolvedRunDirectory)
      : await nextRunId(runsDirectory);
  const runDirectory =
    resolvedRunDirectory ?? join(runsDirectory, runId);
  await mkdir(runDirectory, { recursive: true });

  const idea = await readIdeaBrief(input.ideaPath ?? defaultIdeaPath);
  const durableMemory = await loadDurableMemoryContext(idea);
  await ensureDurableMemoryArtifacts(
    durableMemory.rootDirectory,
    durableMemory.context
  );

  const intake = await loadJsonIfExists<SessionIntakeSnapshot>(
    join(durableMemory.rootDirectory, "intake.json")
  );
  const resolvedTargetFamily = input.targetFamily ?? intake?.target_family;
  const targetScore =
    input.targetScore ?? intake?.target_score ?? durableMemory.context.targetScore;
  const maxRounds =
    input.maxRounds ??
    intake?.max_rounds ??
    durableMemory.context.maxRounds ??
    3;
  const bootstrapTargetFamily = normalizeBootstrapTargetFamily(resolvedTargetFamily);
  const bootstrapPaths = createBootstrapArtifactPaths(durableMemory.rootDirectory);
  let preparedValidationBundle:
    | SessionRunContractArtifact["validation_strategy"]["validation_bundle"]
    | undefined;
  let resolvedRubricPath = resolve(input.rubricPath ?? defaultRubricPath);

  if (bootstrapTargetFamily && input.rubricPath === undefined) {
    if (!intake?.target_root?.trim()) {
      throw new Error(
        "Prepared product session is missing intake.target_root. Refusing to scaffold a product adapter bundle without execution target identity."
      );
    }

    const bootstrapResult = await scaffoldBootstrapArtifacts(
      buildBootstrapAnswersFromSeed({
        title: intake?.product_title ?? durableMemory.context.title,
        summary: intake?.product_summary ?? durableMemory.context.summary,
        targetUsers: intake?.target_users ?? durableMemory.context.targetUsers,
        coreFeatures: intake?.core_features ?? durableMemory.context.coreFeatures,
        referenceApps: intake?.reference_apps ?? [],
        finishLine:
          intake?.finish_line ??
          durableMemory.context.finishLine ??
          durableMemory.context.qualityBar[0],
        targetFamily: bootstrapTargetFamily,
        goalLevel: intake?.goal_level,
        targetScore,
        maxRounds,
        targetRoot: intake.target_root,
        projectMode: intake.project_mode,
        frameworkHint: intake.framework_hint,
        packageManager: intake.package_manager,
        runCommand: intake.run_command,
        checkCommand: intake.check_command,
        readyUrl: intake.ready_url,
        appUrl: intake.app_url,
        healthUrl: intake.health_url,
        apiBaseUrl: intake.api_base_url,
        constraints: intake?.constraints ?? durableMemory.context.constraints,
        qualityBar: intake?.quality_bar ?? durableMemory.context.qualityBar,
        notes: intake?.notes,
        mustNotBreak: intake?.must_not_break ?? durableMemory.context.mustNotBreak,
        failureExpectations: intake?.failure_expectations,
        continuityBoundaries: intake?.continuity_boundaries,
        referenceSignals: intake?.reference_signals,
        nonGoals: intake?.non_goals,
        probeHints: intake?.probe_hints,
        customQualityMetrics: intake?.custom_quality_metrics?.map(
          (metric): BootstrapCustomQualityMetric => ({
            metricId: metric.metric_id,
            label: metric.label,
            description: metric.description,
            minimumScoreOutOfTen: metric.minimum_score_out_of_ten,
            ...(metric.required !== undefined ? { required: metric.required } : {}),
            ...(metric.weight !== undefined ? { weight: metric.weight } : {})
          })
        )
      }),
      bootstrapPaths
    );
    const targetFamilySelection = resolveTargetFamilySelection(bootstrapResult.targetFamily);
    resolvedRubricPath = resolve(bootstrapResult.rubricPath);
    preparedValidationBundle = {
      target_family: bootstrapResult.targetFamily,
      ...(targetFamilySelection?.validation_lane
        ? { validation_lane: targetFamilySelection.validation_lane }
        : {}),
      adapter_contract_path: resolve(bootstrapResult.adapterPath),
      rubric_path: resolve(bootstrapResult.rubricPath),
      evaluator_profile_path: resolve(bootstrapResult.evaluatorProfilePath)
    };
  }

  const rubric = await loadJson<LoopRubric>(resolvedRubricPath);
  if (input.targetScore !== undefined) {
    rubric.target_total_score = input.targetScore;
  } else if (intake?.target_score !== undefined) {
    rubric.target_total_score = intake.target_score;
  }

  if (bootstrapTargetFamily && !preparedValidationBundle) {
    const targetFamilySelection = resolveTargetFamilySelection(bootstrapTargetFamily);
    const [hasGeneratedAdapter, hasGeneratedProfile] = await Promise.all([
      pathExists(bootstrapPaths.adapterPath),
      pathExists(bootstrapPaths.generatedVerificationProfilePath)
    ]);
    preparedValidationBundle = {
      target_family: targetFamilySelection?.target_family ?? bootstrapTargetFamily,
      ...(targetFamilySelection?.validation_lane
        ? { validation_lane: targetFamilySelection.validation_lane }
        : {}),
      ...(hasGeneratedAdapter
        ? { adapter_contract_path: resolve(bootstrapPaths.adapterPath) }
        : {}),
      rubric_path: resolvedRubricPath,
      ...(rubric.evaluator_profile_path
        ? {
            evaluator_profile_path: resolve(
              dirname(resolvedRubricPath),
              rubric.evaluator_profile_path
            )
          }
        : hasGeneratedProfile
          ? {
              evaluator_profile_path: resolve(
                bootstrapPaths.generatedVerificationProfilePath
              )
            }
          : targetFamilySelection?.profile_path
            ? { evaluator_profile_path: resolve(targetFamilySelection.profile_path) }
            : {})
    };
  }

  const scenario = buildScenarioFromIdea(idea);
  const plan = buildLoopPlan({
    scenario,
    rubric,
    maxRounds,
    idea
  });
  const runtimePaths = runtimeStatePathsForRun(runDirectory);
  const executionPlanPath = join(runDirectory, "docs", "EXECUTION_PLAN.md");
  const transportMode = input.transportMode ?? "current-thread";
  const controllerMode = input.controllerMode ?? "attached";
  const sessionContext = resolveOperatorSurfaceContext({
    controllerMode,
    transportMode,
    threadId: process.env.CODEX_THREAD_ID?.trim() || undefined
  });
  const workspaceMode =
    input.workspaceMode && workspaceModes.has(input.workspaceMode)
      ? input.workspaceMode
      : inferWorkspaceMode(intake?.project_mode);
  const result = await writeSessionPreparationArtifacts({
    runId,
    runDirectory,
    rootDirectory: durableMemory.rootDirectory,
    buildBriefPath: runtimePaths.buildBriefPath,
    runContractPath: runtimePaths.runContractPath,
    openQuestionsPath: runtimePaths.openQuestionsPath,
    sessionStatusPath: runtimePaths.sessionStatusPath,
    sessionStatusEventsPath: runtimePaths.sessionStatusEventsPath,
    sessionStreamPath: runtimePaths.sessionStreamPath,
    operatorSurfacePath: runtimePaths.operatorSurfacePath,
    executionPlanPath,
    transportMode,
    threadBindingState:
      readThreadBindingStateFromEnv() ??
      sessionContext.threadBindingState,
    threadId: sessionContext.threadId,
    turnId: undefined,
    idea,
    durableMemory: durableMemory.context,
    scenario,
    plan,
    workspaceMode,
    targetFamily: resolvedTargetFamily,
    ...(preparedValidationBundle
      ? { validationBundle: preparedValidationBundle }
      : {})
  });

  const operatorSurface = buildOperatorSurfaceArtifact({
    runId,
    controllerMode,
    transportMode,
    runDirectory,
    workspaceSurface: workspaceMode,
    executionState: "configured",
    attentionRequired: "human",
    transportStatePath: runtimePaths.transportStatePath,
    sessionStatusPath: runtimePaths.sessionStatusPath,
    sessionStatusEventsPath: runtimePaths.sessionStatusEventsPath,
    sessionStreamPath: runtimePaths.sessionStreamPath,
    threadId: sessionContext.threadId,
    launchOrigin: sessionContext.launchOrigin,
    surfaceOwner: sessionContext.surfaceOwner,
    threadBindingState:
      readThreadBindingStateFromEnv() ??
      sessionContext.threadBindingState,
    entrypoint: sessionContext.entrypoint,
    appVisibility: sessionContext.appVisibility,
    recommendedSkill: "loop-control",
    recommendedCommand: "npm run loop:start:codex -- --json",
    session: buildOperatorSurfaceSessionProjection(result.sessionStatus),
    nextAction:
      "Preparation is complete. The session is waiting at ready_to_start. Say \"루프 시작\" or \"start loop\" to begin running on the same Codex session."
  });
  await writeOperatorSurfaceArtifacts({
    jsonPath: runtimePaths.operatorSurfacePath,
    markdownPath: runtimePaths.operatorSurfaceMarkdownPath,
    artifact: operatorSurface
  });
  await writeJson(readyToStartMarkerPathForRuns(runsDirectory), {
    run_id: runId,
    run_directory: runDirectory,
    updated_at: new Date().toISOString(),
    ...(sessionContext.threadId ? { thread_id: sessionContext.threadId } : {})
  } satisfies ReadyToStartSessionMarker);

  return {
    runId,
    runDirectory,
    buildBriefPath: runtimePaths.buildBriefPath,
    runContractPath: runtimePaths.runContractPath,
    openQuestionsPath: runtimePaths.openQuestionsPath,
    sessionStatusPath: runtimePaths.sessionStatusPath,
    sessionStatusEventsPath: runtimePaths.sessionStatusEventsPath,
    sessionStreamPath: runtimePaths.sessionStreamPath,
    operatorSurfacePath: runtimePaths.operatorSurfacePath,
    executionPlanPath,
    ...(preparedValidationBundle?.adapter_contract_path
      ? { adapterPath: preparedValidationBundle.adapter_contract_path }
      : {}),
    ...(preparedValidationBundle?.rubric_path
      ? { rubricPath: preparedValidationBundle.rubric_path }
      : {}),
    ...(preparedValidationBundle?.evaluator_profile_path
      ? { evaluatorProfilePath: preparedValidationBundle.evaluator_profile_path }
      : {})
  };
};
