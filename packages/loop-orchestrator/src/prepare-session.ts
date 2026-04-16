import { mkdir, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import {
  ensureDurableMemoryArtifacts,
  loadDurableMemoryContext
} from "./durable-memory.js";
import {
  loadJson,
  loadJsonIfExists,
  nextRunId,
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
import type {
  ControllerMode,
  LoopRubric,
  OperatorWorkspaceSurface,
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

export const findLatestPreparedRunAwaitingStart = async (
  runsDirectory: string,
  currentThreadId?: string
): Promise<{ runId: string; runDirectory: string } | undefined> => {
  try {
    const marker = await loadReadyToStartSessionMarker(runsDirectory);
    if (
      marker &&
      (currentThreadId === undefined || marker.thread_id === currentThreadId)
    ) {
      const markerSessionStatus = await loadJsonIfExists<SessionStatusArtifact>(
        runtimeStatePathsForRun(marker.run_directory).sessionStatusPath
      );
      const markerPreparedSeed = await loadPreparedSessionSeedForRun(
        marker.run_directory
      );
      if (
        markerSessionStatus?.session_status === "ready_to_start" &&
        markerPreparedSeed
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
        sessionStatus?.session_status === "ready_to_start" &&
        (currentThreadId === undefined ||
          sessionStatus.session_binding.thread_id === currentThreadId) &&
        preparedSeed
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
  const rubric = await loadJson<LoopRubric>(
    resolve(input.rubricPath ?? defaultRubricPath)
  );
  if (input.targetScore !== undefined) {
    rubric.target_total_score = input.targetScore;
  } else if (intake?.target_score !== undefined) {
    rubric.target_total_score = intake.target_score;
  }

  const maxRounds =
    input.maxRounds ??
    intake?.max_rounds ??
    durableMemory.context.maxRounds ??
    3;
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
    targetFamily: input.targetFamily ?? intake?.target_family
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
      "Preparation is complete. Say \"루프 시작\" or \"start loop\" to begin running on the same Codex session."
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
    executionPlanPath
  };
};
