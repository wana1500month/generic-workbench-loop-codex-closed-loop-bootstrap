import { mkdir, readdir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

import {
  buildBootstrapAnswersFromSeed,
  createBootstrapArtifactPaths,
  normalizeBootstrapTargetFamily,
  scaffoldBootstrapArtifacts,
  type BootstrapCustomQualityMetric,
  type BootstrapProbeHints,
  type BootstrapWorkflowCheck
} from "./bootstrap.js";
import {
  ensureDurableMemoryArtifacts,
  loadDurableMemoryContext,
  type DurableMemoryContext
} from "./durable-memory.js";
import {
  appendJsonLine,
  loadJson,
  loadJsonIfExists,
  nextRunId,
  pathExists,
  repoRoot,
  removeIfExists,
  resolveRunsDirectory,
  writeJson,
  writeText
} from "./file-system.js";
import { defaultIdeaPath, readIdeaBrief } from "./idea-intake.js";
import type {
  FrontDoorSessionArtifact,
  SessionIntakeSnapshot
} from "./intake-schema.js";
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
import { validatePreparedProductSessionIntegrity } from "./prepared-session-integrity.js";
import { resolveTargetFamilySelection } from "./profile-selection.js";
import type {
  ControllerMode,
  IdeaBrief,
  LoopRubric,
  OperatorWorkspaceSurface,
  SessionRunContractArtifact,
  SessionStatusArtifact,
  TargetFamily,
  ThreadBindingState,
  TransportMode,
  VerificationProfile
} from "./types.js";

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
  adapterPlanPath?: string;
  adapterReviewTaskPath?: string;
  rubricPath?: string;
  evaluatorProfilePath?: string;
}

export interface ReadyToStartSessionMarker {
  run_id: string;
  run_directory: string;
  updated_at: string;
  thread_id?: string;
  binding_state?: ThreadBindingState;
  front_door_session_id?: string;
  front_door_session_path?: string;
}

export interface PrepareSessionRunInput {
  runDirectory?: string;
  ideaPath?: string;
  rubricPath?: string;
  targetFamily?: TargetFamily;
  targetScore?: number;
  maxRounds?: number;
  workspaceMode?: OperatorWorkspaceSurface;
  transportMode?: TransportMode;
  controllerMode?: ControllerMode;
  frontDoorSessionPath?: string;
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

const unique = (values: readonly string[]): string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))];

const readThreadBindingStateFromEnv = (): ThreadBindingState | undefined => {
  const value = process.env.HARNESS_THREAD_BINDING_STATE?.trim();
  return value && threadBindingStates.has(value as ThreadBindingState)
    ? (value as ThreadBindingState)
    : undefined;
};

const inferWorkspaceMode = (
  projectMode: SessionIntakeSnapshot["project_mode"] | undefined
): OperatorWorkspaceSurface => (projectMode === "new" ? "worktree" : "local");

const normalizeRelativePath = (path: string): string =>
  path.replace(/\\/g, "/");

const resolveTargetRootForIntake = (targetRoot: string): string =>
  resolve(repoRoot, targetRoot);

const eventsPathForFrontDoorSession = (sessionPath: string): string =>
  sessionPath.replace(/\.json$/u, ".events.jsonl");

const loadReadyFrontDoorSession = async (
  frontDoorSessionPath: string
): Promise<{
  artifact: FrontDoorSessionArtifact;
  path: string;
  discoverySource: SessionRunContractArtifact["discovery_source"];
}> => {
  const resolvedPath = resolve(repoRoot, frontDoorSessionPath);
  const artifact = await loadJson<FrontDoorSessionArtifact>(resolvedPath);
  if (artifact.lane !== "product_build") {
    throw new Error(
      `Front-door session ${frontDoorSessionPath} is not a product_build session.`
    );
  }
  if (artifact.phase !== "ready_for_prepare") {
    throw new Error(
      `Front-door session ${frontDoorSessionPath} is ${artifact.phase}, not ready_for_prepare.`
    );
  }
  if (!artifact.intake.target_root?.trim()) {
    throw new Error(
      `Front-door session ${frontDoorSessionPath} is missing intake.target_root.`
    );
  }

  return {
    artifact,
    path: resolvedPath,
    discoverySource: {
      front_door_session_path: normalizeRelativePath(relative(repoRoot, resolvedPath)),
      turn_count: artifact.turn_count,
      session_id: artifact.session_id,
      ...(artifact.thread_id ? { thread_id: artifact.thread_id } : {})
    }
  };
};

const fallbackFrontDoorThreadId = "local-codex-thread";

const isFallbackThreadId = (threadId: string | undefined): boolean =>
  threadId === fallbackFrontDoorThreadId;

const materializeFrontDoorSessionIntake = async (input: {
  rootDirectory: string;
  session: FrontDoorSessionArtifact;
}): Promise<void> => {
  const intake = input.session.intake;
  await Promise.all([
    writeJson(join(input.rootDirectory, "intake.json"), intake),
    writeJson(join(resolveTargetRootForIntake(intake.target_root!), "intake.json"), intake)
  ]);
};

const buildSessionIdeaFromIntake = (input: {
  baseIdea: IdeaBrief;
  durableMemory: DurableMemoryContext;
  intake?: SessionIntakeSnapshot;
  isProductBuild?: boolean;
}): IdeaBrief => {
  const title =
    input.intake?.product_title ??
    input.intake?.product_summary ??
    input.durableMemory.title;
  const summary = input.intake?.product_summary ?? input.durableMemory.summary;
  const userGoals =
    input.intake?.core_features && input.intake.core_features.length > 0
      ? input.intake.core_features
      : input.durableMemory.coreFeatures.length > 0
        ? input.durableMemory.coreFeatures
        : input.baseIdea.user_goals;
  const qualityBar = input.isProductBuild
    ? unique([
        input.intake?.finish_line ?? "",
        ...(input.intake?.quality_bar ?? [])
      ])
    : unique([
        input.intake?.finish_line ?? input.durableMemory.finishLine ?? "",
        ...(input.intake?.quality_bar ?? input.durableMemory.qualityBar)
      ]);
  const constraints = unique([
    ...(input.isProductBuild
      ? input.intake?.constraints ?? []
      : input.intake?.constraints ?? input.durableMemory.constraints),
    ...(input.intake?.target_root ? [`Target root: ${input.intake.target_root}`] : []),
    ...(input.intake?.project_mode ? [`Project mode: ${input.intake.project_mode}`] : [])
  ]);

  return {
    ...input.baseIdea,
    title,
    summary,
    user_goals: userGoals,
    quality_bar: qualityBar,
    constraints,
    raw_markdown: [
      `# ${title}`,
      "",
      summary,
      "",
      "## Core workflows",
      "",
      ...userGoals.map((goal) => `- ${goal}`),
      "",
      "## Quality bar",
      "",
      ...qualityBar.map((entry) => `- ${entry}`)
    ].join("\n")
  };
};

const markFrontDoorSessionPrepared = async (input: {
  sessionPath: string;
  session: FrontDoorSessionArtifact;
  runId: string;
  runDirectory: string;
}): Promise<void> => {
  const updatedAt = new Date().toISOString();
  const preparedSession: FrontDoorSessionArtifact = {
    ...input.session,
    phase: "prepared",
    last_question_ids: [],
    last_question_batch: [],
    prepared_run: {
      run_id: input.runId,
      run_directory: input.runDirectory,
      prepared_at: updatedAt
    },
    updated_at: updatedAt
  };
  await Promise.all([
    writeJson(input.sessionPath, preparedSession),
    appendJsonLine(eventsPathForFrontDoorSession(input.sessionPath), {
      type: "session_prepared",
      session_id: preparedSession.session_id,
      thread_id: preparedSession.thread_id,
      turn_count: preparedSession.turn_count,
      status: "prepared",
      phase: "prepared",
      run_id: input.runId,
      run_directory: input.runDirectory,
      updated_at: updatedAt
    })
  ]);
};

const encodeReadyToStartKey = (value: string): string =>
  encodeURIComponent(value).replace(/\./g, "%2E");

export const legacyReadyToStartMarkerPathForRuns = (runsDirectory: string): string =>
  join(runsDirectory, "ready-to-start-session.json");

export const readyToStartIndexDirectoryForRuns = (runsDirectory: string): string =>
  join(runsDirectory, "ready-to-start");

export const readyToStartMarkerPathForRuns = (runsDirectory: string): string =>
  join(readyToStartIndexDirectoryForRuns(runsDirectory), "latest.json");

export const readyToStartMarkerPathForRun = (
  runsDirectory: string,
  runId: string
): string =>
  join(
    readyToStartIndexDirectoryForRuns(runsDirectory),
    "by-run",
    `${encodeReadyToStartKey(runId)}.json`
  );

export const readyToStartMarkerPathForThread = (
  runsDirectory: string,
  threadId: string
): string =>
  join(
    readyToStartIndexDirectoryForRuns(runsDirectory),
    "by-thread",
    `${encodeReadyToStartKey(threadId)}.json`
  );

export const loadReadyToStartSessionMarker = async (
  runsDirectory: string
): Promise<ReadyToStartSessionMarker | undefined> =>
  (await loadJsonIfExists<ReadyToStartSessionMarker>(
    readyToStartMarkerPathForRuns(runsDirectory)
  )) ??
  (await loadJsonIfExists<ReadyToStartSessionMarker>(
    legacyReadyToStartMarkerPathForRuns(runsDirectory)
  ));

const loadReadyToStartSessionMarkerForRun = async (
  runsDirectory: string,
  runId: string
): Promise<ReadyToStartSessionMarker | undefined> =>
  loadJsonIfExists<ReadyToStartSessionMarker>(
    readyToStartMarkerPathForRun(runsDirectory, runId)
  );

const loadReadyToStartSessionMarkerForThread = async (
  runsDirectory: string,
  threadId: string
): Promise<ReadyToStartSessionMarker | undefined> =>
  loadJsonIfExists<ReadyToStartSessionMarker>(
    readyToStartMarkerPathForThread(runsDirectory, threadId)
  );

export const writeReadyToStartSessionMarker = async (
  runsDirectory: string,
  marker: ReadyToStartSessionMarker
): Promise<void> => {
  const writes = [
    removeIfExists(legacyReadyToStartMarkerPathForRuns(runsDirectory)),
    writeJson(readyToStartMarkerPathForRuns(runsDirectory), marker),
    writeJson(readyToStartMarkerPathForRun(runsDirectory, marker.run_id), marker)
  ];
  if (marker.thread_id && !isFallbackThreadId(marker.thread_id)) {
    writes.push(
      writeJson(readyToStartMarkerPathForThread(runsDirectory, marker.thread_id), marker)
    );
  }
  await Promise.all(writes);
};

export const clearReadyToStartSessionMarker = async (
  runsDirectory: string,
  marker: ReadyToStartSessionMarker
): Promise<void> => {
  const removals = [
    removeIfExists(readyToStartMarkerPathForRun(runsDirectory, marker.run_id)),
    removeIfExists(legacyReadyToStartMarkerPathForRuns(runsDirectory))
  ];
  const latest = await loadReadyToStartSessionMarker(runsDirectory);
  if (latest?.run_id === marker.run_id) {
    removals.push(removeIfExists(readyToStartMarkerPathForRuns(runsDirectory)));
  }
  if (marker.thread_id && !isFallbackThreadId(marker.thread_id)) {
    removals.push(
      removeIfExists(readyToStartMarkerPathForThread(runsDirectory, marker.thread_id))
    );
  }
  await Promise.all(removals);
};

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
  marker: ReadyToStartSessionMarker,
  currentThreadId: string | undefined
): boolean => {
  if (marker.binding_state === "unbound" || !marker.thread_id) {
    return true;
  }
  if (isFallbackThreadId(marker.thread_id)) {
    return true;
  }
  return currentThreadId
    ? marker.thread_id === currentThreadId
    : marker.binding_state !== "bound";
};

const matchesPreparedThread = (
  sessionStatus: SessionStatusArtifact,
  currentThreadId: string | undefined,
  allowAssumedForeground: boolean
): boolean => {
  const preparedThreadId = sessionStatus.session_binding.thread_id;
  if (sessionStatus.session_binding.binding_state === "unbound") {
    return true;
  }
  if (!preparedThreadId || isFallbackThreadId(preparedThreadId)) {
    return true;
  }
  if (currentThreadId) {
    return preparedThreadId === currentThreadId;
  }
  if (allowAssumedForeground) {
    return true;
  }
  return !preparedThreadId && sessionStatus.session_binding.binding_state !== "bound";
};

const isPreparedRunAwaitingStart = async (input: {
  runDirectory: string;
  currentThreadId?: string;
  allowAssumedForeground?: boolean;
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
  if (
    !matchesPreparedThread(
      input.sessionStatus,
      input.currentThreadId,
      input.allowAssumedForeground === true
    )
  ) {
    return false;
  }
  return !(await pathExists(join(input.runDirectory, "summary.json")));
};

export const findLatestPreparedRunAwaitingStart = async (
  runsDirectory: string,
  currentThreadId?: string,
  options: { runId?: string; allowAssumedForeground?: boolean } = {}
): Promise<
  | { runId: string; runDirectory: string; marker?: ReadyToStartSessionMarker }
  | undefined
> => {
  try {
    const markerCandidate = options.runId
      ? await loadReadyToStartSessionMarkerForRun(runsDirectory, options.runId)
      : currentThreadId
        ? await loadReadyToStartSessionMarkerForThread(runsDirectory, currentThreadId)
        : await loadReadyToStartSessionMarker(runsDirectory);
    if (
      markerCandidate &&
      (options.runId || markerMatchesPreparedThread(markerCandidate, currentThreadId))
    ) {
      const markerSessionStatus = await loadJsonIfExists<SessionStatusArtifact>(
        runtimeStatePathsForRun(markerCandidate.run_directory).sessionStatusPath
      );
      const markerPreparedSeed = await loadPreparedSessionSeedForRun(
        markerCandidate.run_directory
      );
      if (
        await isPreparedRunAwaitingStart({
          runDirectory: markerCandidate.run_directory,
          currentThreadId,
          allowAssumedForeground:
            options.allowAssumedForeground === true && Boolean(options.runId),
          sessionStatus: markerSessionStatus,
          preparedSeed: markerPreparedSeed
        })
      ) {
        return {
          runId: markerCandidate.run_id,
          runDirectory: markerCandidate.run_directory,
          marker: markerCandidate
        };
      }
    }

    if (options.runId) {
      const explicitRunDirectory = join(runsDirectory, options.runId);
      const runtimePaths = runtimeStatePathsForRun(explicitRunDirectory);
      const [sessionStatus, preparedSeed] = await Promise.all([
        loadJsonIfExists<SessionStatusArtifact>(runtimePaths.sessionStatusPath),
        loadPreparedSessionSeedForRun(explicitRunDirectory)
      ]);
      if (
        await isPreparedRunAwaitingStart({
          runDirectory: explicitRunDirectory,
          currentThreadId,
          allowAssumedForeground: options.allowAssumedForeground === true,
          sessionStatus,
          preparedSeed
        })
      ) {
        return {
          runId: options.runId,
          runDirectory: explicitRunDirectory
        };
      }
      return undefined;
    }

    const entries = await readdir(runsDirectory, { withFileTypes: true });
    const runDirectories = entries
      .filter((entry) => entry.isDirectory() && /^run-\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => Number(right.slice(4)) - Number(left.slice(4)));

    const candidates: Array<{ runId: string; runDirectory: string }> = [];
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
        candidates.push({ runId, runDirectory });
      }
    }

    if (candidates.length === 1) {
      return candidates[0];
    }
    if (candidates.length > 1) {
      throw new Error(
        `Multiple ready_to_start runs match this start request: ${candidates
          .map((candidate) => candidate.runId)
          .join(", ")}. Pass --run-id <run-id> to choose one explicitly.`
      );
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

export const prepareSessionRun = async (
  input: PrepareSessionRunInput
): Promise<PrepareSessionResult> => {
  const runsDirectory = resolveRunsDirectory();
  const resolvedRunDirectory = input.runDirectory
    ? resolve(input.runDirectory)
    : undefined;
  const runId =
    resolvedRunDirectory !== undefined
      ? basename(resolvedRunDirectory)
      : await nextRunId(runsDirectory);
  const runDirectory =
    resolvedRunDirectory ?? join(runsDirectory, runId);

  const frontDoorSession = input.frontDoorSessionPath
    ? await loadReadyFrontDoorSession(input.frontDoorSessionPath)
    : undefined;
  const envThreadId = process.env.CODEX_THREAD_ID?.trim() || undefined;
  const discoveryThreadId =
    frontDoorSession?.artifact.thread_id?.trim() || undefined;
  if (
    envThreadId &&
    discoveryThreadId &&
    !isFallbackThreadId(discoveryThreadId) &&
    envThreadId !== discoveryThreadId
  ) {
    throw new Error(
      `Front-door session belongs to thread ${discoveryThreadId}, but current CODEX_THREAD_ID is ${envThreadId}.`
    );
  }
  const effectiveThreadId = envThreadId ?? (
    isFallbackThreadId(discoveryThreadId) ? undefined : discoveryThreadId
  );
  const effectiveThreadBindingState: ThreadBindingState =
    envThreadId
      ? "bound"
      : discoveryThreadId && !isFallbackThreadId(discoveryThreadId)
        ? "bound"
      : readThreadBindingStateFromEnv() ?? "unbound";
  await mkdir(runDirectory, { recursive: true });
  const idea = await readIdeaBrief(input.ideaPath ?? defaultIdeaPath);
  if (frontDoorSession) {
    await materializeFrontDoorSessionIntake({
      rootDirectory: dirname(idea.source_path),
      session: frontDoorSession.artifact
    });
  }
  const durableMemory = await loadDurableMemoryContext(idea);
  await ensureDurableMemoryArtifacts(
    durableMemory.rootDirectory,
    durableMemory.context
  );

  let intake = await loadJsonIfExists<SessionIntakeSnapshot>(
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
  const isProductBuild = bootstrapTargetFamily !== undefined;
  const bootstrapPaths = createBootstrapArtifactPaths({
    rootDirectory: durableMemory.rootDirectory,
    runDirectory
  });
  let preparedValidationBundle:
    | SessionRunContractArtifact["validation_strategy"]["validation_bundle"]
    | undefined;
  let resolvedRubricPath = resolve(input.rubricPath ?? defaultRubricPath);

  if (bootstrapTargetFamily) {
    if (!intake?.target_root?.trim()) {
      throw new Error(
        "Prepared product session is missing intake.target_root. Refusing to scaffold a product adapter bundle without execution target identity."
      );
    }
    const missingProductFields: string[] = [];
    if (!intake?.target_users?.length) {
      missingProductFields.push("target_users");
    }
    if (!intake?.core_features?.length) {
      missingProductFields.push("core_features");
    }
    if (!intake?.finish_line?.trim() && !intake?.quality_bar?.length) {
      missingProductFields.push("finish_line");
    }
    if (missingProductFields.length > 0) {
      throw new Error(
        `Prepared product session is missing required product intake fields: ${missingProductFields.join(", ")}`
      );
    }

    const bootstrapResult = await scaffoldBootstrapArtifacts(
      buildBootstrapAnswersFromSeed({
        title: intake?.product_title ?? durableMemory.context.title,
        summary: intake?.product_summary ?? durableMemory.context.summary,
        targetUsers: intake?.target_users ?? [],
        coreFeatures: intake?.core_features ?? [],
        referenceApps: intake?.reference_apps ?? [],
        finishLine: intake?.finish_line ?? intake?.quality_bar?.[0] ?? "",
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
        constraints: isProductBuild
          ? intake?.constraints ?? []
          : intake?.constraints ?? durableMemory.context.constraints,
        qualityBar: isProductBuild
          ? unique([
              intake?.finish_line ?? "",
              ...(intake?.quality_bar ?? [])
            ])
          : intake?.quality_bar ?? durableMemory.context.qualityBar,
        notes: intake?.notes,
        mustNotBreak: isProductBuild
          ? intake?.must_not_break ?? []
          : intake?.must_not_break ?? durableMemory.context.mustNotBreak,
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
        ),
        verificationSurfaces: intake?.verification_surfaces,
        workflowChecks: intake?.workflow_checks?.map(
          (check): BootstrapWorkflowCheck => ({
            workflow: check.workflow,
            surface: check.surface,
            ...(check.trigger ? { trigger: check.trigger } : {}),
            expectedResult: check.expected_result,
            ...(check.selector_hints ? { selectorHints: check.selector_hints } : {}),
            ...(check.api_hint
              ? {
                  apiHint: {
                    ...(check.api_hint.method ? { method: check.api_hint.method } : {}),
                    ...(check.api_hint.path ? { path: check.api_hint.path } : {}),
                    ...(check.api_hint.expected_status !== undefined
                      ? { expectedStatus: check.api_hint.expected_status }
                      : {}),
                    ...(check.api_hint.expected_json_path
                      ? { expectedJsonPath: check.api_hint.expected_json_path }
                      : {}),
                    ...(check.api_hint.expected_value
                      ? { expectedValue: check.api_hint.expected_value }
                      : {})
                  }
                }
              : {}),
            ...(check.command_hint
              ? {
                  commandHint: {
                    ...(check.command_hint.command
                      ? { command: check.command_hint.command }
                      : {}),
                    ...(check.command_hint.expected_output
                      ? { expectedOutput: check.command_hint.expected_output }
                      : {})
                  }
                }
              : {})
          })
        ),
        adapterPlan: intake?.adapter_plan
      }),
      bootstrapPaths
    );
    const targetFamilySelection = resolveTargetFamilySelection(bootstrapResult.targetFamily);
    if (input.rubricPath === undefined) {
      resolvedRubricPath = resolve(bootstrapResult.rubricPath);
    }
    preparedValidationBundle = {
      target_family: bootstrapResult.targetFamily,
      ...(targetFamilySelection?.validation_lane
        ? { validation_lane: targetFamilySelection.validation_lane }
        : {}),
      adapter_contract_path: resolve(bootstrapResult.adapterPath),
      rubric_path: resolvedRubricPath,
      evaluator_profile_path: resolve(bootstrapResult.evaluatorProfilePath)
    };
  }

  if (frontDoorSession) {
    const refreshedIntake = await loadJsonIfExists<SessionIntakeSnapshot>(
      join(durableMemory.rootDirectory, "intake.json")
    );
    intake = refreshedIntake ?? intake;
    if (refreshedIntake?.target_root?.trim()) {
      await writeJson(
        join(resolveTargetRootForIntake(refreshedIntake.target_root), "intake.json"),
        refreshedIntake
      );
    }
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

  const sessionIdea = buildSessionIdeaFromIntake({
    baseIdea: idea,
    durableMemory: durableMemory.context,
    intake,
    isProductBuild
  });
  const scenario = buildScenarioFromIdea(sessionIdea);
  const plan = buildLoopPlan({
    scenario,
    rubric,
    maxRounds,
    idea: sessionIdea,
    planKind: bootstrapTargetFamily ? "product_build" : "harness"
  });
  const runtimePaths = runtimeStatePathsForRun(runDirectory);
  const executionPlanPath = join(runDirectory, "docs", "EXECUTION_PLAN.md");
  const transportMode = input.transportMode ?? "current-thread";
  const controllerMode = input.controllerMode ?? "attached";
  const sessionContext = resolveOperatorSurfaceContext({
    controllerMode,
    transportMode,
    threadId: effectiveThreadId,
    threadBindingState: effectiveThreadBindingState,
    launchOrigin: effectiveThreadId ? "codex-app-thread" : undefined
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
    threadBindingState: effectiveThreadBindingState,
    threadId: sessionContext.threadId,
    turnId: undefined,
    idea: sessionIdea,
    durableMemory: durableMemory.context,
    scenario,
    plan,
    workspaceMode,
    targetFamily: resolvedTargetFamily,
    ...(frontDoorSession?.discoverySource
      ? { discoverySource: frontDoorSession.discoverySource }
      : {}),
    ...(preparedValidationBundle
      ? { validationBundle: preparedValidationBundle }
      : {})
  });

  if (isProductBuild && preparedValidationBundle?.evaluator_profile_path) {
    const evaluatorProfile = await loadJson<VerificationProfile>(
      preparedValidationBundle.evaluator_profile_path
    );
    const integrityErrors = validatePreparedProductSessionIntegrity({
      buildBrief: result.buildBrief,
      runContract: result.runContract,
      evaluatorProfile
    });
    if (integrityErrors.length > 0) {
      throw new Error(
        `Prepared product session failed evaluator profile integrity checks:\n${integrityErrors
          .map((error) => `- ${error}`)
          .join("\n")}`
      );
    }
  }

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
    threadBindingState: effectiveThreadBindingState,
    entrypoint: sessionContext.entrypoint,
    appVisibility: sessionContext.appVisibility,
    recommendedSkill: "loop-control",
    recommendedCommand: "npm run loop:start:codex -- --json",
    ...(bootstrapTargetFamily
      ? {
          adapterPlanPath: resolve(bootstrapPaths.adapterPlanPath),
          adapterReviewTaskPath: resolve(bootstrapPaths.adapterReviewTaskPath)
        }
      : {}),
    ...(preparedValidationBundle?.adapter_contract_path
      ? { adapterContractPath: preparedValidationBundle.adapter_contract_path }
      : {}),
    ...(preparedValidationBundle?.evaluator_profile_path
      ? { evaluatorProfilePath: preparedValidationBundle.evaluator_profile_path }
      : {}),
    session: buildOperatorSurfaceSessionProjection(result.sessionStatus),
    nextAction:
      "Preparation is complete. The generated adapter plan is available for review. The session is waiting at ready_to_start. Say \"루프 시작\" or \"start loop\" to begin running on the same Codex session."
  });
  await writeOperatorSurfaceArtifacts({
    jsonPath: runtimePaths.operatorSurfacePath,
    markdownPath: runtimePaths.operatorSurfaceMarkdownPath,
    artifact: operatorSurface
  });
  await writeText(
    join(runDirectory, "runtime", "ready-to-start.md"),
    [
      "# Ready to start",
      "",
      `Run ID: ${runId}`,
      frontDoorSession?.artifact.session_id
        ? `Front-door session: ${frontDoorSession.artifact.session_id}`
        : undefined,
      "",
      "## Product brief",
      "",
      `- Product: ${intake?.product_title ?? durableMemory.context.title}`,
      `- Target users: ${(intake?.target_users ?? []).join(", ") || "unspecified"}`,
      "- Core workflows:",
      ...(intake?.core_features?.length
        ? intake.core_features.map((feature) => `  - ${feature}`)
        : ["  - unspecified"]),
      `- Finish line: ${intake?.finish_line ?? intake?.quality_bar?.[0] ?? "unspecified"}`,
      "",
      "## Verification",
      "",
      `- Surface: ${(intake?.verification_surfaces ?? []).join(", ") || "default"}`,
      `- Runtime: ${intake?.run_command ?? "npm run dev"}`,
      "- Release checks:",
      ...(intake?.workflow_checks?.length
        ? intake.workflow_checks.map((check) => `  - ${check.workflow}`)
        : (intake?.core_features ?? []).map((feature) => `  - ${feature}`)),
      "",
      "## Start",
      "",
      "Say: start loop / 루프 시작",
      ""
    ]
      .filter((line): line is string => typeof line === "string")
      .join("\n")
  );
  await writeReadyToStartSessionMarker(runsDirectory, {
    run_id: runId,
    run_directory: runDirectory,
    updated_at: new Date().toISOString(),
    binding_state: effectiveThreadBindingState,
    ...(sessionContext.threadId ? { thread_id: sessionContext.threadId } : {}),
    ...(frontDoorSession?.artifact.session_id
      ? { front_door_session_id: frontDoorSession.artifact.session_id }
      : {}),
    ...(frontDoorSession?.path
      ? {
          front_door_session_path: normalizeRelativePath(
            relative(repoRoot, frontDoorSession.path)
          )
        }
      : {})
  } satisfies ReadyToStartSessionMarker);
  if (frontDoorSession) {
    await markFrontDoorSessionPrepared({
      sessionPath: frontDoorSession.path,
      session: frontDoorSession.artifact,
      runId,
      runDirectory
    });
  }

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
    ...(bootstrapTargetFamily ? { adapterPlanPath: resolve(bootstrapPaths.adapterPlanPath) } : {}),
    ...(bootstrapTargetFamily
      ? { adapterReviewTaskPath: resolve(bootstrapPaths.adapterReviewTaskPath) }
      : {}),
    ...(preparedValidationBundle?.rubric_path
      ? { rubricPath: preparedValidationBundle.rubric_path }
      : {}),
    ...(preparedValidationBundle?.evaluator_profile_path
      ? { evaluatorProfilePath: preparedValidationBundle.evaluator_profile_path }
      : {})
  };
};
