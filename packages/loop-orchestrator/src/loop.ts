import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  buildActiveContractFrame,
  decideAttemptLifecycle,
  targetCheckIdsFromPatchRequest,
  unresolvedSignatureFor
} from "./attempt-lifecycle.js";
import {
  writeRoundHandoffPlaceholders,
  writeRoundHandoff,
  writeRunControllerSummary,
  writeRunPlannerBrief
} from "./agent-handoff.js";
import {
  enhanceContractReviewWithCodex,
  enhanceEvalReportWithCodex,
  enhanceGeneratorPlanWithCodex,
  enhancePlanWithCodex,
  experimentalExecutorRuntimeWarning
} from "./codex-agents.js";
import {
  executeAdapterCapability,
  loadAdapterContract,
  loadVerificationProfile
} from "./adapter-runtime.js";
import { executeCoreVerificationProbes } from "./core-verifier.js";
import { writeRunCodexHandoff } from "./codex-handoff.js";
import { loadJson, nextRunId, repoRoot, writeJson } from "./file-system.js";
import { defaultIdeaPath, readIdeaBrief } from "./idea-intake.js";
import { defaultExecutorMode, isExecutorMode } from "./executor-mode.js";
import {
  buildPatchCarryForwardContract,
  buildSyntheticPatchCarryForwardAgreement,
  buildSyntheticPatchCarryForwardReview
} from "./patch-carry-forward.js";
import {
  buildAttemptDirective,
  buildLoopPlan,
  buildRoundContract,
  buildScenarioFromIdea
} from "./planner.js";
import {
  buildContractAgreementArtifact,
  buildContractReviewArtifact,
  buildEvalReport
} from "./round-evaluator.js";
import {
  artifactsForRound,
  buildEvaluatorVerdictArtifact,
  buildGeneratorPlanArtifact,
  buildPatchRequestArtifact,
  buildQualityCritiqueArtifact,
  buildRoundContractArtifact,
  buildRoundResultArtifact,
  writeNegotiationArtifacts,
  writeRoundEvaluationPlaceholders,
  writeRoundArtifacts
} from "./protocol-artifacts.js";
import { resolveTargetFamilySelection } from "./profile-selection.js";
import {
  applyFailureLineagePolicySnapshot,
  isPureEnvironmentBlockedLineage
} from "./failure-lineage.js";
import {
  buildResumeIdentityState,
  compareResumeIdentity,
  loadResumeIdentityArtifact,
  resumeIdentityArtifactPath,
  resumeIdentityFingerprint,
  summaryResumeIdentity
} from "./resume-identity.js";
import {
  buildRemediationHistory,
  failureLineageForEvalReport,
  restoreRunState,
  scoreDeltasForHistory
} from "./resume-state.js";
import type {
  AdapterCapabilityExecution,
  AdapterCapabilityName,
  ActiveContractFrame,
  ClosedLoopResult,
  FailureLineage,
  LoadedAdapterContract,
  LoopRubric,
  LoopRunSummary,
  PatchRequestArtifact,
  ReleaseThresholdResults,
  RemediationHistory,
  ResumeDecisionArtifact,
  RoundSummary,
  RuntimeEvent,
  RuntimeEventCode,
  ValidationLane
} from "./types.js";

const defaultRubricPath = join(
  repoRoot,
  "evals",
  "rubrics",
  "generic-harness-rubric.json"
);
const genericCoreProfilePath = join(
  repoRoot,
  "evals",
  "verification-profiles",
  "generic-core.profile.json"
);

const capabilityOrder: AdapterCapabilityName[] = [
  "prepare_target",
  "apply_change",
  "run_target",
  "capture_evidence",
  "run_checks",
  "grade_round"
];

const roundDirectoryFor = (runDirectory: string, round: number): string =>
  join(runDirectory, `round-${String(round).padStart(3, "0")}`);

const ensureJsonFile = async (
  path: string,
  fallbackValue: unknown
): Promise<void> => {
  try {
    await loadJson<unknown>(path);
  } catch {
    await writeJson(path, fallbackValue);
  }
};

const writeRoundSummary = async (
  roundDirectory: string,
  summary: RoundSummary
): Promise<void> => {
  await writeJson(join(roundDirectory, "round_summary.json"), summary);
};

const isImproved = (nextScore: number, currentBest: number | undefined): boolean =>
  currentBest === undefined || nextScore > currentBest + 0.001;

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const ephemeralRuntimeEventCodes = new Set<RuntimeEventCode>([
  "run.resumed_from_history",
  "resume.migration_override",
  "resume.noop_terminal",
  "resume.reopened_terminal",
  "resume.continued",
  "validation.environment_lane_hint"
]);

const buildRuntimeEvent = (
  code: RuntimeEventCode,
  message: string,
  metadata?: RuntimeEvent["metadata"]
): RuntimeEvent => ({
  code,
  message,
  created_at: new Date().toISOString(),
  ...(metadata ? { metadata } : {})
});

const mergeRuntimeEvents = (events: readonly RuntimeEvent[]): RuntimeEvent[] =>
  Array.from(
    events.reduce(
      (map, event) => map.set(`${event.code}:${JSON.stringify(event.metadata ?? {})}`, event),
      new Map<string, RuntimeEvent>()
    ).values()
  );

const resolveEvaluatorBundleSelection = (input: {
  explicitEvaluatorProfilePath?: string;
  explicitTargetFamily?: string;
  rubric?: LoopRubric;
  rubricPath?: string;
  summaryEvaluatorProfilePath?: string;
  summaryTargetFamily?: LoopRunSummary["target_family"];
  summaryValidationLane?: LoopRunSummary["validation_lane"];
  preferGenericCoreDefault?: boolean;
}): {
  evaluatorProfilePath?: string;
  targetFamily?: LoopRunSummary["target_family"];
  validationLane?: ValidationLane;
  runtimeWarnings: string[];
} => {
  const runtimeWarnings: string[] = [];
  const targetFamilySelection = input.explicitEvaluatorProfilePath
    ? undefined
    : resolveTargetFamilySelection(input.explicitTargetFamily);
  if (
    input.explicitTargetFamily &&
    !input.explicitEvaluatorProfilePath &&
    !targetFamilySelection
  ) {
    throw new Error(`Unknown target family '${input.explicitTargetFamily}'.`);
  }

  if (input.explicitEvaluatorProfilePath && input.explicitTargetFamily) {
    runtimeWarnings.push(
      `Ignoring target family '${input.explicitTargetFamily}' because an explicit evaluator profile path was provided.`
    );
  }

  const useGenericCoreDefault =
    input.preferGenericCoreDefault &&
    !input.explicitEvaluatorProfilePath &&
    !input.explicitTargetFamily &&
    !input.summaryEvaluatorProfilePath &&
    !input.summaryTargetFamily &&
    !input.summaryValidationLane;

  const evaluatorProfilePath = input.explicitEvaluatorProfilePath
    ? resolve(input.explicitEvaluatorProfilePath)
    : targetFamilySelection?.profile_path
      ? resolve(targetFamilySelection.profile_path)
      : useGenericCoreDefault
        ? genericCoreProfilePath
      : input.summaryEvaluatorProfilePath
        ? resolve(input.summaryEvaluatorProfilePath)
        : input.rubric?.evaluator_profile_path && input.rubricPath
          ? resolve(dirname(input.rubricPath), input.rubric.evaluator_profile_path)
          : undefined;

  return {
    evaluatorProfilePath,
    targetFamily:
      targetFamilySelection?.target_family ??
      (useGenericCoreDefault ? "generic-core" : undefined) ??
      input.summaryTargetFamily,
    validationLane:
      targetFamilySelection?.validation_lane ??
      (useGenericCoreDefault ? "deterministic_semantic" : undefined) ??
      input.summaryValidationLane,
    runtimeWarnings
  };
};

const stopReasonFromState = (input: {
  latestVerdict: RoundSummary["overall_verdict"];
  latestUnresolvedCheckIds: string[];
  latestPatchNextAction?: PatchRequestArtifact["next_action"];
  latestMustFixCount: number;
  latestThresholdResults?: ReleaseThresholdResults;
  latestFailureLineage?: FailureLineage;
  latestStaticAdapterContractInvalid?: boolean;
  plateauCount: number;
  plateauLimit: number;
  completedRounds: number;
  maxRounds: number;
}): LoopRunSummary["stop_reason"] | undefined => {
  const continuationRequested =
    input.latestPatchNextAction === "advance" ||
    (input.latestPatchNextAction === "revise" && input.latestMustFixCount > 0);
  const continuationStillPlanned =
    input.completedRounds < input.maxRounds && continuationRequested;
  const terminalContractCompleted =
    input.latestVerdict === "advance" &&
    input.latestUnresolvedCheckIds.length === 0 &&
    input.latestPatchNextAction === "complete";

  if (terminalContractCompleted && input.latestThresholdResults?.target_reached_eligible) {
    return "target_reached";
  }

  if (terminalContractCompleted) {
    return "contract_completed";
  }

  if (input.latestStaticAdapterContractInvalid) {
    return "adapter_contract_invalid";
  }

  if (
    input.latestPatchNextAction === "hold" &&
    isPureEnvironmentBlockedLineage(input.latestFailureLineage)
  ) {
    return "environment_blocked";
  }

  if (input.completedRounds >= input.maxRounds) {
    return "max_rounds_reached";
  }

  if (input.plateauCount >= input.plateauLimit && !continuationStillPlanned) {
    return "plateau_limit_reached";
  }

  return undefined;
};

const isResumeNoopTerminalStopReason = (
  stopReason: LoopRunSummary["stop_reason"] | undefined
): stopReason is Extract<
  LoopRunSummary["stop_reason"],
  | "target_reached"
  | "contract_completed"
  | "environment_blocked"
  | "adapter_contract_invalid"
> =>
  stopReason === "target_reached" ||
  stopReason === "contract_completed" ||
  stopReason === "environment_blocked" ||
  stopReason === "adapter_contract_invalid";

const runAdapterCapabilities = async (input: {
  loadedAdapter?: LoadedAdapterContract;
  runId: string;
  round: number;
  runDirectory: string;
  runtimeDirectory: string;
  codexSessionRegistryPath: string;
  roundDirectory: string;
  ideaPath?: string;
  plannedScenarioPath?: string;
  planPath?: string;
  roundContractPath: string;
  contractReviewPath?: string;
  contractAgreementPath?: string;
  generatorPlanPath: string;
  previousPatchRequestPath?: string;
}): Promise<AdapterCapabilityExecution[]> => {
  if (!input.loadedAdapter) {
    return [];
  }

  const executions: AdapterCapabilityExecution[] = [];
  for (const capability of capabilityOrder) {
    executions.push(
      await executeAdapterCapability({
        loadedAdapter: input.loadedAdapter,
        capability,
        roundDirectory: input.roundDirectory,
        packet: {
          adapter_id: input.loadedAdapter.contract.adapter_id,
          capability,
          run_id: input.runId,
          round: input.round,
          run_directory: input.runDirectory,
          round_directory: input.roundDirectory,
          runtime_directory: input.runtimeDirectory,
          codex_session_registry_path: input.codexSessionRegistryPath,
          target_root: join(
            input.loadedAdapter.base_directory,
            input.loadedAdapter.contract.target_root
          ),
          idea_path: input.ideaPath,
          planned_scenario_path: input.plannedScenarioPath,
          plan_path: input.planPath,
          round_contract_path: input.roundContractPath,
          contract_review_path: input.contractReviewPath,
          contract_agreement_path: input.contractAgreementPath,
          generator_plan_path: input.generatorPlanPath,
          patch_request_path: input.previousPatchRequestPath
        }
      })
    );
  }

  return executions;
};

export const runClosedLoop = async (input: {
  adapterPath?: string;
  rubricPath?: string;
  evaluatorProfilePath?: string;
  targetFamily?: string;
  resumeRunPath?: string;
  allowResumeMigration?: boolean;
  forceReopenTerminal?: boolean;
  maxRounds?: number;
  targetScore?: number;
  includeRemediationBudget?: boolean;
  executorMode?: "harness" | "subagents-experimental";
}): Promise<ClosedLoopResult> => {
  const includeRemediationBudget = input.includeRemediationBudget ?? true;
  const restoredRun = input.resumeRunPath
    ? await restoreRunState(input.resumeRunPath)
    : undefined;
  const attemptBudget =
    input.maxRounds ?? restoredRun?.plan.max_rounds ?? 3;
  const runId =
    restoredRun?.runId ??
    (await nextRunId(join(repoRoot, "evals", "runs")));
  const runDirectory =
    restoredRun?.runDirectory ?? join(repoRoot, "evals", "runs", runId);
  const executorMode =
    input.executorMode ??
    (isExecutorMode(process.env.HARNESS_EXECUTOR_MODE)
      ? process.env.HARNESS_EXECUTOR_MODE
      : undefined) ??
    restoredRun?.summary.executor_mode ??
    defaultExecutorMode;
  await mkdir(runDirectory, { recursive: true });
  const runRuntimeDirectory = join(runDirectory, "runtime");
  const codexSessionRegistryPath = join(runRuntimeDirectory, "codex-sessions.json");
  await mkdir(runRuntimeDirectory, { recursive: true });
  await ensureJsonFile(codexSessionRegistryPath, {});

  const absoluteRubricPath = restoredRun
    ? join(runDirectory, "effective-rubric.json")
    : resolve(input.rubricPath ?? defaultRubricPath);
  const hydratedRubric = restoredRun
    ? restoredRun.rubric
    : await loadJson<LoopRubric>(absoluteRubricPath);
  hydratedRubric.minimum_control_plane_score ??= 1;
  hydratedRubric.minimum_proof_score ??= 0.85;
  hydratedRubric.target_signal_requires_adapter ??= true;
  hydratedRubric.target_signal_requires_grade_score ??= true;
  let loadedAdapter = await loadAdapterContract(
    input.adapterPath ?? restoredRun?.summary.adapter_contract_path
  );

  const bundleSelection = resolveEvaluatorBundleSelection({
    explicitEvaluatorProfilePath: input.evaluatorProfilePath,
    explicitTargetFamily: input.targetFamily,
    rubric: hydratedRubric,
    rubricPath: absoluteRubricPath,
    summaryEvaluatorProfilePath: restoredRun?.summary.evaluator_profile_path,
    summaryTargetFamily: restoredRun?.summary.target_family,
    summaryValidationLane: restoredRun?.summary.validation_lane,
    preferGenericCoreDefault: !loadedAdapter
  });

  const selectedVerificationProfile = bundleSelection.evaluatorProfilePath
    ? await loadVerificationProfile(bundleSelection.evaluatorProfilePath)
    : undefined;
  const resolvedTargetFamily =
    selectedVerificationProfile?.profile.target_family ??
    bundleSelection.targetFamily ??
    restoredRun?.summary.target_family;
  const resolvedValidationLane =
    selectedVerificationProfile?.profile.validation_lane ??
    bundleSelection.validationLane ??
    restoredRun?.summary.validation_lane;
  if (loadedAdapter && selectedVerificationProfile) {
    loadedAdapter = {
      ...loadedAdapter,
      verification_profile: selectedVerificationProfile,
      verification_profile_source: "core"
    };
  }

  hydratedRubric.max_remediation_rounds ??= loadedAdapter ? 2 : 0;
  if (input.targetScore !== undefined) {
    hydratedRubric.target_total_score = input.targetScore;
  }

  const executionMaxRounds =
    attemptBudget +
    (loadedAdapter && includeRemediationBudget
      ? hydratedRubric.max_remediation_rounds
      : 0);
  const effectiveRubricPath = join(runDirectory, "effective-rubric.json");
  await writeJson(effectiveRubricPath, hydratedRubric);

  const currentResumeIdentity = await buildResumeIdentityState({
    adapterContractPath: loadedAdapter?.contract_path,
    evaluatorProfilePath: bundleSelection.evaluatorProfilePath,
    rubricPath: effectiveRubricPath,
    executorMode,
    targetFamily: resolvedTargetFamily,
    validationLane: resolvedValidationLane
  });
  const previousResumeIdentity =
    (restoredRun ? await loadResumeIdentityArtifact(runDirectory) : undefined) ??
    summaryResumeIdentity(restoredRun?.summary);
  const currentResumeIdentityPath = resumeIdentityArtifactPath(runDirectory);
  const resumeDecisionPath = input.resumeRunPath
    ? join(runDirectory, "resume-decision.json")
    : undefined;
  const resumeIdentityMismatches = restoredRun
    ? compareResumeIdentity({
        current: currentResumeIdentity,
        previous: previousResumeIdentity
      })
    : [];
  const restoredStopReason = restoredRun?.summary.stop_reason;
  if (resumeIdentityMismatches.length > 0 && !input.allowResumeMigration) {
    throw new Error(
      [
        `Resume identity mismatch for run '${runId}'. Refusing to continue because run history would no longer be directly comparable.`,
        ...resumeIdentityMismatches.map((mismatch) => `- ${mismatch}`),
        "Re-run with --allow-resume-migration only if you intentionally want to record a bundle migration on this run."
      ].join("\n")
    );
  }

  if (
    restoredRun &&
    resumeIdentityMismatches.length > 0 &&
    input.allowResumeMigration &&
    !input.forceReopenTerminal &&
    isResumeNoopTerminalStopReason(restoredStopReason)
  ) {
    throw new Error(
      [
        `Run '${runId}' already ended with terminal stop reason '${restoredStopReason}'. Terminal runs stay closed on default resume even when a migration override is requested.`,
        ...resumeIdentityMismatches.map((mismatch) => `- ${mismatch}`),
        "Re-run with both --allow-resume-migration and --force-reopen-terminal only if you intentionally want to reopen this terminal run and record the migration."
      ].join("\n")
    );
  }

  const resumeMigrationPath =
    restoredRun && resumeIdentityMismatches.length > 0
      ? join(runDirectory, "resume-migration.json")
      : undefined;
  if (resumeMigrationPath) {
    await writeJson(resumeMigrationPath, {
      run_id: runId,
      migrated_at: new Date().toISOString(),
      mismatches: resumeIdentityMismatches,
      previous_identity: previousResumeIdentity,
      new_identity: currentResumeIdentity
    });
  }

  const previousEphemeralEventMessages = new Set(
    (restoredRun?.summary.runtime_events ?? [])
      .filter((event) => ephemeralRuntimeEventCodes.has(event.code))
      .map((event) => event.message)
  );
  const previousPersistentWarnings = (restoredRun?.summary.runtime_warnings ?? []).filter(
    (warning) => !previousEphemeralEventMessages.has(warning)
  );

  const currentRuntimeEvents = mergeRuntimeEvents([
    ...((restoredRun?.summary.runtime_events ?? []).filter(
      (event) => !ephemeralRuntimeEventCodes.has(event.code)
    ) ?? []),
    ...(loadedAdapter && resolvedValidationLane === "environment_integration"
      ? [
          buildRuntimeEvent(
            "validation.environment_lane_hint",
            `Validation lane '${resolvedValidationLane}' depends on the local environment. Browser or fullstack probe failures may reflect sandbox or administrator policy, not only product defects.`,
            {
              validation_lane: resolvedValidationLane,
              target_family: resolvedTargetFamily ?? null
            }
          )
        ]
      : []),
    ...(resumeMigrationPath
      ? [
          buildRuntimeEvent(
            "resume.migration_override",
            `Resume identity migration override was accepted for run '${runId}'. This run now records a bundle migration.`,
            {
              mismatch_count: resumeIdentityMismatches.length,
              resumed_run_id: runId
            }
          )
        ]
      : []),
    ...(input.resumeRunPath
      ? [
          buildRuntimeEvent(
            "run.resumed_from_history",
            `Resumed run '${runId}' from persisted controller history.`,
            { resumed_run_id: runId }
          )
        ]
      : [])
  ]);

  let runtimeWarnings = unique([
    ...previousPersistentWarnings,
    ...(bundleSelection.runtimeWarnings ?? []),
    ...(loadedAdapter?.runtime_warnings ?? []),
    ...(executorMode === "subagents-experimental"
      ? [experimentalExecutorRuntimeWarning]
      : []),
    ...currentRuntimeEvents.map((event) => event.message)
  ]);

  if (
    restoredRun &&
    !input.forceReopenTerminal &&
    resumeIdentityMismatches.length === 0 &&
    isResumeNoopTerminalStopReason(restoredStopReason)
  ) {
    const noopRuntimeEvents = mergeRuntimeEvents([
      ...currentRuntimeEvents,
      buildRuntimeEvent(
        "resume.noop_terminal",
        `Run '${runId}' already ended with terminal stop reason '${restoredStopReason}'. Resume returned without opening a new round. Re-run with --force-reopen-terminal to override this default.`,
        {
          stop_reason: restoredStopReason ?? null,
          resumed_run_id: runId
        }
      )
    ]);
    runtimeWarnings = unique([
      ...previousPersistentWarnings,
      ...(bundleSelection.runtimeWarnings ?? []),
      ...(loadedAdapter?.runtime_warnings ?? []),
      ...noopRuntimeEvents.map((event) => event.message)
    ]);

    const resumeDecisionArtifact: ResumeDecisionArtifact | undefined = resumeDecisionPath
      ? {
          run_id: runId,
          decided_at: new Date().toISOString(),
          decision: "noop_terminal",
          previous_stop_reason: restoredStopReason,
          force_reopen_terminal: Boolean(input.forceReopenTerminal),
          allow_resume_migration: Boolean(input.allowResumeMigration),
          mismatches: resumeIdentityMismatches,
          runtime_event_codes: noopRuntimeEvents.map((event) => event.code)
        }
      : undefined;

    const summary: LoopRunSummary = {
      ...restoredRun.summary,
      ...(resolvedTargetFamily ? { target_family: resolvedTargetFamily } : {}),
      ...(resolvedValidationLane
        ? { validation_lane: resolvedValidationLane }
        : {}),
      ...(bundleSelection.evaluatorProfilePath
        ? { evaluator_profile_path: bundleSelection.evaluatorProfilePath }
        : {}),
      ...(currentResumeIdentity.adapter_contract_sha256
        ? { adapter_contract_sha256: currentResumeIdentity.adapter_contract_sha256 }
        : {}),
      ...(currentResumeIdentity.evaluator_bundle_sha256
        ? { evaluator_bundle_sha256: currentResumeIdentity.evaluator_bundle_sha256 }
        : {}),
      ...(currentResumeIdentity.rubric_sha256
        ? { rubric_sha256: currentResumeIdentity.rubric_sha256 }
        : {}),
      planner_brief_path: restoredRun.plannerBriefPath,
      planned_scenario_path: restoredRun.plannedScenarioPath,
      plan_path: restoredRun.planPath,
      codex_handoff_path: undefined,
      adapter_contract_path:
        loadedAdapter?.contract_path ?? restoredRun.summary.adapter_contract_path,
      adapter_id: loadedAdapter?.contract.adapter_id ?? restoredRun.summary.adapter_id,
      verification_provider_id:
        loadedAdapter?.contract.verification_provider?.provider_id ??
        restoredRun.summary.verification_provider_id,
      adapter_attached: Boolean(loadedAdapter),
      resume_identity_path: currentResumeIdentityPath,
      runtime_events: noopRuntimeEvents,
      ...(resumeDecisionPath ? { resume_decision_path: resumeDecisionPath } : {}),
      ...(runtimeWarnings.length > 0 ? { runtime_warnings: runtimeWarnings } : {}),
      resumed_from_run_id: runId
    };

    const codexHandoffPath = await writeRunCodexHandoff({
      runDirectory,
      summary,
      plan: restoredRun.plan,
      scenario: restoredRun.scenario
    });
    summary.codex_handoff_path = codexHandoffPath;

    await Promise.all([
      writeJson(currentResumeIdentityPath, currentResumeIdentity),
      ...(resumeDecisionArtifact && resumeDecisionPath
        ? [writeJson(resumeDecisionPath, resumeDecisionArtifact)]
        : []),
      writeJson(join(runDirectory, "summary.json"), summary),
      writeRunControllerSummary({
        runDirectory,
        summary
      })
    ]);

    return {
      plan: restoredRun.plan,
      summary,
      runDirectory,
      plannedScenarioPath: restoredRun.plannedScenarioPath
    };
  }

  const idea = await readIdeaBrief(defaultIdeaPath);
  let scenario = restoredRun?.scenario;
  let plan = restoredRun?.plan;
  const plannedScenarioPath =
    restoredRun?.plannedScenarioPath ?? join(runDirectory, "planned-scenario.json");
  const planPath = restoredRun?.planPath ?? join(runDirectory, "plan.json");
  let plannerBriefPath = restoredRun?.plannerBriefPath;
  if (!restoredRun) {
    const baseScenario = buildScenarioFromIdea(idea);
    const basePlan = buildLoopPlan({
      scenario: baseScenario,
      rubric: hydratedRubric,
      maxRounds: attemptBudget,
      idea
    });
    const plannerEnhancement = await enhancePlanWithCodex({
      runDirectory,
      idea,
      rubric: hydratedRubric,
      scenario: baseScenario,
      plan: basePlan,
      executorMode
    });
    scenario = plannerEnhancement.value.scenario;
    plan = plannerEnhancement.value.plan;
    runtimeWarnings = unique([
      ...runtimeWarnings,
      ...plannerEnhancement.runtimeWarnings
    ]);
    await Promise.all([
      writeJson(plannedScenarioPath, scenario),
      writeJson(planPath, plan)
    ]);
    plannerBriefPath = await writeRunPlannerBrief({
      runDirectory,
      idea,
      scenario,
      plan
    });
  }
  if (!scenario || !plan || !plannerBriefPath) {
    throw new Error("Run initialization did not produce a resumable scenario, plan, and planner brief.");
  }

  const history: RoundSummary[] = [...(restoredRun?.summary.round_history ?? [])];
  let previousPatchRequest: PatchRequestArtifact | undefined =
    restoredRun?.previousPatchRequest;
  let bestScore: number | undefined = restoredRun?.bestScore;
  let bestControlPlaneScore = restoredRun?.bestControlPlaneScore ?? 0;
  let bestProofScore = restoredRun?.bestProofScore ?? 0;
  let bestReleaseScore = restoredRun?.bestReleaseScore ?? 0;
  let bestThresholdResults: ReleaseThresholdResults | undefined =
    restoredRun?.bestThresholdResults;
  let bestDimensionScores = restoredRun?.summary.dimension_scores ?? [];
  let bestRound = restoredRun?.bestRound ?? 1;
  let bestEvalReportPath = restoredRun?.bestEvalReportPath ?? "";
  let bestPatchRequestPath = restoredRun?.bestPatchRequestPath ?? "";
  let plateauCount = restoredRun?.plateauCount ?? 0;
  let previousPatchRequestPath: string | undefined =
    restoredRun?.previousPatchRequestPath;
  let activeContractFrame: ActiveContractFrame | undefined =
    restoredRun?.activeContractFrame;
  let repeatedUnresolvedCount = restoredRun?.repeatedUnresolvedCount ?? 0;
  let latestFailureLineage: FailureLineage | undefined =
    restoredRun?.latestFailureLineage;
  let latestEvalReport = restoredRun?.latestEvalReport;
  let previousRoundSummary: RoundSummary | undefined =
    restoredRun?.previousRoundSummary;
  let scoreDeltas = scoreDeltasForHistory(history);
  let latestRoundState:
    | {
        score: number;
        controlPlaneScore: number;
        proofScore: number;
        verdict: RoundSummary["overall_verdict"];
        unresolvedCheckIds: string[];
        patchNextAction: PatchRequestArtifact["next_action"];
        patchMustFixCount: number;
        thresholdResults: ReleaseThresholdResults;
        failureLineage?: FailureLineage;
        staticAdapterContractInvalid: boolean;
      }
    | undefined =
      restoredRun?.latestRoundSummary
        ? {
            score: restoredRun.latestRoundSummary.total_score,
            controlPlaneScore: restoredRun.latestRoundSummary.control_plane_score,
            proofScore: restoredRun.latestRoundSummary.proof_score,
            verdict: restoredRun.latestRoundSummary.overall_verdict,
            unresolvedCheckIds: restoredRun.latestRoundSummary.unresolved_check_ids,
            patchNextAction: restoredRun.previousPatchRequest?.next_action ?? "revise",
            patchMustFixCount: restoredRun.previousPatchRequest?.must_fix.length ?? 0,
            thresholdResults:
              restoredRun.latestRoundSummary.threshold_results,
            failureLineage: restoredRun.latestFailureLineage,
            staticAdapterContractInvalid:
              restoredRun.summary.stop_reason === "adapter_contract_invalid"
          }
        : undefined;

  for (
    let round = restoredRun?.roundStart ?? 1;
    round <= executionMaxRounds;
    round += 1
  ) {
    const roundDirectory = roundDirectoryFor(runDirectory, round);
    await mkdir(roundDirectory, { recursive: true });

    const remediationHistory: RemediationHistory | undefined = buildRemediationHistory({
      previousPatchRequest,
      activeContractFrame,
      latestFailureLineage,
      repeatedUnresolvedCount,
      scoreDeltas
    });
    const lifecycleDecision = decideAttemptLifecycle({
      round,
      previousPatchRequest,
      hasActiveContractFrame: Boolean(activeContractFrame),
      remediationHistory
    });
    let directive = buildAttemptDirective({
      scenario,
      plan,
      round,
      previousPatchRequest
    });
    if (lifecycleDecision.negotiation_mode === "patch_only") {
      directive = {
        ...directive,
        label: `patch-only repair attempt ${round - 1}`
      };
    } else if (lifecycleDecision.negotiation_mode === "recontract") {
      directive = {
        ...directive,
        label: `recontract attempt ${round - 1}`,
        objective: `Re-open contract negotiation before continuing the build: ${lifecycleDecision.reason}`
      };
    }
    const artifacts = artifactsForRound(roundDirectory);
    const contract =
      lifecycleDecision.negotiation_mode === "patch_only" &&
      previousPatchRequest &&
      activeContractFrame
        ? buildPatchCarryForwardContract({
            scenarioId: scenario.scenario_id,
            round,
            activeContractFrame,
            previousPatchRequest
          })
        : buildRoundContract({
            scenario,
            directive,
            round,
            previousPatchRequest
          });
    const contractArtifact = buildRoundContractArtifact({
      round,
      negotiationMode: lifecycleDecision.negotiation_mode,
      continuationAuthority: lifecycleDecision.continuation_authority,
      recontractReason: lifecycleDecision.recontract_reason,
      contract,
      rubric: hydratedRubric,
      loadedAdapter,
      previousPatchRequest
    });
    const baseContractReviewArtifact =
      lifecycleDecision.negotiation_mode === "patch_only" && previousPatchRequest
        ? buildSyntheticPatchCarryForwardReview({
            contractArtifact,
            previousPatchRequest,
            reason: lifecycleDecision.reason
          })
        : buildContractReviewArtifact({
            contractArtifact,
            loadedAdapter
          });
    const contractReviewEnhancement = await enhanceContractReviewWithCodex({
      roundDirectory,
      contractArtifact,
      contractReviewArtifact: baseContractReviewArtifact,
      loadedAdapter,
      executorMode
    });
    runtimeWarnings = unique([
      ...runtimeWarnings,
      ...contractReviewEnhancement.runtimeWarnings
    ]);
    const contractReviewArtifact = contractReviewEnhancement.value;
    const contractAgreementArtifact =
      lifecycleDecision.negotiation_mode === "patch_only" && previousPatchRequest
        ? buildSyntheticPatchCarryForwardAgreement({
            contractArtifact,
            previousPatchRequest
          })
        : buildContractAgreementArtifact({
            contractArtifact,
            contractReviewArtifact
          });
    if (
      lifecycleDecision.negotiation_mode !== "patch_only" &&
      contractAgreementArtifact.status === "agreed"
    ) {
      activeContractFrame = buildActiveContractFrame({
        round,
        contractArtifact,
        contractAgreementArtifact
      });
    }
    const baseGeneratorPlanArtifact = buildGeneratorPlanArtifact({
      contractArtifact,
      contractAgreementArtifact,
      previousPatchRequest,
      adapterAttached: Boolean(loadedAdapter)
    });
    const generatorPlanEnhancement = await enhanceGeneratorPlanWithCodex({
      roundDirectory,
      idea,
      contractArtifact,
      contractAgreementArtifact,
      generatorPlanArtifact: baseGeneratorPlanArtifact,
      previousPatchRequest,
      executorMode
    });
    runtimeWarnings = unique([
      ...runtimeWarnings,
      ...generatorPlanEnhancement.runtimeWarnings
    ]);
    const generatorPlanArtifact = generatorPlanEnhancement.value;
    const reviewChecksRequired = contractArtifact.acceptance_checks.some(
      (checkId) =>
        checkId === "contract_review_written" || checkId === "contract_review_quality"
    );
    const agreementChecksRequired = contractArtifact.acceptance_checks.some(
      (checkId) =>
        checkId === "contract_agreement_written" || checkId === "agreement_matches_review"
    );
    const persistContractReviewArtifact =
      lifecycleDecision.persist_contract_review ||
      contractReviewArtifact.decision !== "accept" ||
      reviewChecksRequired;
    const persistContractAgreementArtifact =
      lifecycleDecision.persist_contract_agreement ||
      contractAgreementArtifact.status !== "agreed" ||
      agreementChecksRequired;
    await writeNegotiationArtifacts({
      roundDirectory,
      contractArtifact,
      contractReviewArtifact,
      contractAgreementArtifact,
      generatorPlanArtifact,
      persistContractReviewArtifact,
      persistContractAgreementArtifact
    });
    await Promise.all([
      writeRoundEvaluationPlaceholders({ roundDirectory }),
      writeRoundHandoffPlaceholders({ roundDirectory })
    ]);
    const previousPatchTargetCheckIds = unique(
      previousPatchRequest?.must_fix.flatMap((item) => item.target_check_ids) ?? []
    );
    const previousPatchRequestAddressed =
      previousPatchTargetCheckIds.length === 0 ||
      previousPatchTargetCheckIds.every((checkId) =>
        contractArtifact.carry_over_check_ids.includes(checkId)
      );
    const adapterExecutions =
      loadedAdapter && contractAgreementArtifact.status === "agreed"
        ? await runAdapterCapabilities({
            loadedAdapter,
            runId,
            round,
            runDirectory,
            runtimeDirectory: runRuntimeDirectory,
            codexSessionRegistryPath,
            roundDirectory,
            ideaPath: defaultIdeaPath,
            plannedScenarioPath,
            planPath,
            roundContractPath: artifacts.contract_json_path,
            contractReviewPath: persistContractReviewArtifact
              ? artifacts.contract_review_json_path
              : undefined,
            contractAgreementPath: persistContractAgreementArtifact
              ? artifacts.contract_agreement_json_path
              : undefined,
            generatorPlanPath: artifacts.generator_plan_json_path,
            previousPatchRequestPath
          })
        : [];
    const targetManifest = adapterExecutions.find(
      (execution) => execution.capability === "run_target" && execution.result.ok
    )?.result.target_manifest;
    const coreProbeResults =
      loadedAdapter && contractAgreementArtifact.status === "agreed"
        ? await executeCoreVerificationProbes({
            loadedAdapter,
            runDirectory,
            roundDirectory,
            targetManifest
          })
        : [];
    const baseEvalReport = buildEvalReport({
      round,
      rubric: hydratedRubric,
      contractArtifact,
      contractReviewArtifact,
      contractAgreementArtifact,
      artifacts,
      plannerBriefPath,
      planPath,
      loadedAdapter,
      adapterExecutions,
      coreProbeResults,
      targetManifest,
      previousPatchTargetCheckIds,
      previousPatchRequestAddressed
    });
    const evalEnhancement = await enhanceEvalReportWithCodex({
      roundDirectory,
      idea,
      contractArtifact,
      generatorPlanArtifact,
      evalReport: baseEvalReport,
      adapterExecutions,
      coreProbeResults,
      targetManifest,
      executorMode
    });
    runtimeWarnings = unique([
      ...runtimeWarnings,
      ...evalEnhancement.runtimeWarnings
    ]);
    const evalReport = evalEnhancement.value;
    latestEvalReport = evalReport;
    const previousPatchRequestResolved =
      previousPatchTargetCheckIds.length === 0 ||
      evalReport.check_results.some(
        (result) =>
          result.check_id === "previous_patch_request_resolved" && result.status === "pass"
      );
    const evaluatorVerdictArtifact = buildEvaluatorVerdictArtifact({
      contractArtifact,
      evalReport
    });
    const rawFailureLineage = failureLineageForEvalReport({
      evalReport,
      loadedAdapter,
      previousRoundSummary
    });
    const provisionalPatchRequestArtifact = buildPatchRequestArtifact({
      round,
      evalReport,
      evaluatorVerdictArtifact,
      qualityCritiqueArtifact: {
        critique_id: `${contractArtifact.contract_id}-quality-critique-provisional`,
        contract_id: contractArtifact.contract_id,
        round,
        remediation_strategy: evalReport.threshold_results.contract_completed
          ? "refine"
          : "tighten",
        quality_focus: [],
        preserve_signals: [],
        findings: [],
        notes: []
      },
      adapterAttached: Boolean(loadedAdapter),
      staticContractBlockers: contractReviewArtifact.static_blockers,
      failureLineage: rawFailureLineage
    });
    const allowedCheckIds = new Set([
      ...(activeContractFrame?.acceptance_checks ?? contractAgreementArtifact.acceptance_checks),
      ...evalReport.unresolved_check_ids,
      "target_signal_thresholds_met",
      "adapter_execution_healthy",
      "release_blockers_recorded"
    ]);
    const currentScopeDrift = targetCheckIdsFromPatchRequest(
      provisionalPatchRequestArtifact
    ).some((checkId) => !allowedCheckIds.has(checkId));
    const projectedScoreDeltas =
      history.length > 0
        ? [
            ...scoreDeltas,
            Number(
              (evalReport.total_score - history[history.length - 1].total_score).toFixed(3)
            )
          ].slice(-6)
        : scoreDeltas.slice(-6);
    const improved = isImproved(evalReport.total_score, bestScore);
    const projectedPlateauCount = improved ? 0 : plateauCount + 1;
    const failureLineage = rawFailureLineage
      ? applyFailureLineagePolicySnapshot({
          history,
          failureLineage: rawFailureLineage,
          scoreDeltas: projectedScoreDeltas,
          scopeDriftDetected: currentScopeDrift,
          patchEntropy: Number(
            (
              provisionalPatchRequestArtifact.must_fix.length > 0
                ? provisionalPatchRequestArtifact.must_fix.length
                : targetCheckIdsFromPatchRequest(provisionalPatchRequestArtifact).length
            ).toFixed(3)
          ),
          projectedPlateauCount,
          plateauLimit: hydratedRubric.stop_after_plateau_rounds
        })
      : undefined;
    const qualityCritiqueArtifact = buildQualityCritiqueArtifact({
      round,
      contractArtifact,
      evalReport,
      loadedAdapter,
      failureLineage
    });
    const patchRequestArtifact = buildPatchRequestArtifact({
      round,
      evalReport,
      evaluatorVerdictArtifact,
      qualityCritiqueArtifact,
      adapterAttached: Boolean(loadedAdapter),
      staticContractBlockers: contractReviewArtifact.static_blockers,
      failureLineage
    });
    const roundResultArtifact = buildRoundResultArtifact({
      roundDirectory,
      round,
      contractAgreementArtifact,
      generatorPlanArtifact,
      evaluatorVerdictArtifact,
      patchRequestArtifact,
      qualityCritiqueArtifact,
      evalReport,
      selectedForRun: false,
      previousPatchRequestAddressed,
      previousPatchRequestResolved
    });

    await writeRoundArtifacts({
      roundDirectory,
      evaluatorVerdictArtifact,
      patchRequestArtifact,
      qualityCritiqueArtifact,
      roundResultArtifact,
      evalReport,
      failureLineage
    });

    if (improved) {
      bestScore = evalReport.total_score;
      bestControlPlaneScore = evalReport.control_plane_score;
      bestProofScore = evalReport.proof_score;
      bestReleaseScore = evalReport.release_score;
      bestThresholdResults = evalReport.threshold_results;
      bestDimensionScores = evalReport.dimension_scores;
      bestRound = round;
      bestEvalReportPath = artifacts.eval_report_path;
      bestPatchRequestPath = artifacts.patch_request_json_path;
      plateauCount = 0;
    } else {
      plateauCount += 1;
    }

    const roundSummary: RoundSummary = {
      round,
      attempt_kind: directive.attempt_kind,
      negotiation_mode: lifecycleDecision.negotiation_mode,
      continuation_authority: lifecycleDecision.continuation_authority,
      decision_source: lifecycleDecision.decision_source,
      ...(lifecycleDecision.recontract_reason
        ? { recontract_reason: lifecycleDecision.recontract_reason }
        : {}),
      label: directive?.label ?? `round ${round}`,
      controller_reason: lifecycleDecision.reason,
      objective: contractArtifact.objective,
      ...(resolvedTargetFamily ? { target_family: resolvedTargetFamily } : {}),
      ...(resolvedValidationLane
        ? { validation_lane: resolvedValidationLane }
        : {}),
      total_score: evalReport.total_score,
      control_plane_score: evalReport.control_plane_score,
      proof_score: evalReport.proof_score,
      release_score: evalReport.release_score,
      overall_verdict: evalReport.overall_verdict,
      check_pass_rate: roundResultArtifact.check_pass_rate,
      contract_path: artifacts.contract_json_path,
      contract_review_path: persistContractReviewArtifact
        ? artifacts.contract_review_json_path
        : undefined,
      contract_agreement_path: persistContractAgreementArtifact
        ? artifacts.contract_agreement_json_path
        : undefined,
      generator_plan_path: artifacts.generator_plan_json_path,
      evaluator_verdict_path: artifacts.evaluator_verdict_json_path,
      patch_request_path: artifacts.patch_request_json_path,
      quality_critique_path: artifacts.quality_critique_json_path,
      eval_report_path: artifacts.eval_report_path,
      failure_lineage_path: artifacts.failure_lineage_path,
      planner_context_path: artifacts.planner_context_path,
      generator_brief_path: artifacts.generator_brief_path,
      qa_review_path: artifacts.qa_review_path,
      controller_decision_path: artifacts.controller_decision_path,
      evidence_paths: evalReport.evidence_paths,
      previous_patch_request_addressed: roundResultArtifact.previous_patch_request_addressed,
      previous_patch_request_resolved: roundResultArtifact.previous_patch_request_resolved,
      resolved_check_ids: roundResultArtifact.resolved_check_ids,
      unresolved_check_ids: roundResultArtifact.unresolved_check_ids,
      threshold_results: evalReport.threshold_results,
      dimension_scores: evalReport.dimension_scores,
      ...(failureLineage ? { failure_lineage: failureLineage } : {})
    };
    latestRoundState = {
      score: evalReport.total_score,
      controlPlaneScore: evalReport.control_plane_score,
      proofScore: evalReport.proof_score,
      verdict: evalReport.overall_verdict,
      unresolvedCheckIds: roundResultArtifact.unresolved_check_ids,
      patchNextAction: patchRequestArtifact.next_action,
      patchMustFixCount: patchRequestArtifact.must_fix.length,
      thresholdResults: evalReport.threshold_results,
      failureLineage,
      staticAdapterContractInvalid: contractReviewArtifact.static_blockers.length > 0
    };
    const roundStopReason =
      stopReasonFromState({
        latestVerdict: latestRoundState.verdict,
        latestUnresolvedCheckIds: latestRoundState.unresolvedCheckIds,
        latestPatchNextAction: latestRoundState.patchNextAction,
        latestMustFixCount: latestRoundState.patchMustFixCount,
        latestThresholdResults: latestRoundState.thresholdResults,
        latestFailureLineage: latestRoundState.failureLineage,
        latestStaticAdapterContractInvalid: latestRoundState.staticAdapterContractInvalid,
        plateauCount,
        plateauLimit: hydratedRubric.stop_after_plateau_rounds,
        completedRounds: round,
        maxRounds: executionMaxRounds
      }) ?? "continue";
    roundSummary.round_stop_reason = roundStopReason;
    const unresolvedSignature = unresolvedSignatureFor(roundResultArtifact.unresolved_check_ids);
    if (!unresolvedSignature) {
      repeatedUnresolvedCount = 0;
    } else if (unresolvedSignature === latestFailureLineage?.unresolved_signature) {
      repeatedUnresolvedCount += 1;
    } else {
      repeatedUnresolvedCount = 1;
    }
    latestFailureLineage = failureLineage;
    if (history.length > 0) {
      const previousScore = history[history.length - 1]?.total_score;
      if (previousScore !== undefined) {
        scoreDeltas = [
          ...scoreDeltas,
          Number((evalReport.total_score - previousScore).toFixed(3))
        ].slice(-6);
      }
    }
    history.push(roundSummary);
    await writeRoundSummary(roundDirectory, roundSummary);

    const stopReason = roundStopReason === "continue" ? undefined : roundStopReason;
    await writeRoundHandoff({
      roundDirectory,
      scenario,
      round,
      contractReview: contractReviewArtifact,
      contractAgreement: contractAgreementArtifact,
      evalReport,
      patchRequest: patchRequestArtifact,
      qualityCritique: qualityCritiqueArtifact,
      failureLineage,
      executorMode,
      targetFamily: resolvedTargetFamily,
      validationLane: resolvedValidationLane,
      decisionSource: lifecycleDecision.decision_source,
      previousPatchRequestAddressed,
      previousPatchRequestResolved,
      stopReason
    });

    previousPatchRequest = patchRequestArtifact;
    previousPatchRequestPath = artifacts.patch_request_json_path;
    previousRoundSummary = roundSummary;

    if (stopReason) {
      break;
    }
  }

  const finalStopReason =
    latestRoundState
      ? stopReasonFromState({
          latestVerdict: latestRoundState.verdict,
          latestUnresolvedCheckIds: latestRoundState.unresolvedCheckIds,
          latestPatchNextAction: latestRoundState.patchNextAction,
          latestMustFixCount: latestRoundState.patchMustFixCount,
          latestThresholdResults: latestRoundState.thresholdResults,
          latestFailureLineage: latestRoundState.failureLineage,
          latestStaticAdapterContractInvalid: latestRoundState.staticAdapterContractInvalid,
          plateauCount,
          plateauLimit: hydratedRubric.stop_after_plateau_rounds,
          completedRounds: history.length,
          maxRounds: executionMaxRounds
        })
      : undefined;

  const resolvedStopReason =
    stopReasonFromState({
      latestVerdict: latestRoundState?.verdict ?? "hold",
      latestUnresolvedCheckIds: latestRoundState?.unresolvedCheckIds ?? [],
      latestPatchNextAction: latestRoundState?.patchNextAction,
      latestMustFixCount: latestRoundState?.patchMustFixCount ?? 0,
      latestThresholdResults: latestRoundState?.thresholdResults,
      latestFailureLineage: latestRoundState?.failureLineage,
      latestStaticAdapterContractInvalid: latestRoundState?.staticAdapterContractInvalid,
      plateauCount,
      plateauLimit: hydratedRubric.stop_after_plateau_rounds,
      completedRounds: history.length,
      maxRounds: executionMaxRounds
    }) ?? "max_rounds_reached";

  const terminalRoundSummary = history[history.length - 1];
  const terminalRound = terminalRoundSummary?.round ?? bestRound;
  const terminalTotalScore = terminalRoundSummary?.total_score ?? bestScore ?? 0;
  const terminalControlPlaneScore =
    terminalRoundSummary?.control_plane_score ?? bestControlPlaneScore;
  const terminalProofScore = terminalRoundSummary?.proof_score ?? bestProofScore;
  const terminalReleaseScore = terminalRoundSummary?.release_score ?? bestReleaseScore;
  const terminalThresholdResults =
    terminalRoundSummary?.threshold_results ?? bestThresholdResults;
  const terminalDimensionScores =
    terminalRoundSummary?.dimension_scores ?? bestDimensionScores;
  const finalRuntimeEvents = mergeRuntimeEvents([
    ...currentRuntimeEvents,
    ...(restoredRun
      ? [
          buildRuntimeEvent(
            input.forceReopenTerminal &&
              isResumeNoopTerminalStopReason(restoredStopReason)
              ? "resume.reopened_terminal"
              : "resume.continued",
            input.forceReopenTerminal &&
              isResumeNoopTerminalStopReason(restoredStopReason)
              ? `Run '${runId}' reopened a terminal stop reason '${restoredStopReason}' because --force-reopen-terminal was supplied explicitly.`
              : `Resume for run '${runId}' continued by opening a new round.`,
            {
              stop_reason: restoredStopReason ?? null,
              resumed_run_id: runId
            }
          )
        ]
      : [])
  ]);
  runtimeWarnings = unique([
    ...runtimeWarnings,
    ...finalRuntimeEvents.map((event) => event.message)
  ]);
  const resumeDecisionArtifact: ResumeDecisionArtifact | undefined = resumeDecisionPath
    ? {
        run_id: runId,
        decided_at: new Date().toISOString(),
        decision:
          input.forceReopenTerminal &&
          isResumeNoopTerminalStopReason(restoredStopReason)
            ? "reopened_terminal"
            : "continue",
        previous_stop_reason: restoredStopReason,
        force_reopen_terminal: Boolean(input.forceReopenTerminal),
        allow_resume_migration: Boolean(input.allowResumeMigration),
        mismatches: resumeIdentityMismatches,
        runtime_event_codes: finalRuntimeEvents.map((event) => event.code)
      }
    : undefined;

  const summary: LoopRunSummary = {
    run_id: runId,
    round_count: history.length,
    scenario_id: scenario.scenario_id,
    rubric_id: hydratedRubric.rubric_id,
    executor_mode: executorMode,
    ...(resolvedTargetFamily ? { target_family: resolvedTargetFamily } : {}),
    ...(resolvedValidationLane
      ? { validation_lane: resolvedValidationLane }
      : {}),
    ...(bundleSelection.evaluatorProfilePath
      ? { evaluator_profile_path: bundleSelection.evaluatorProfilePath }
      : {}),
    ...(currentResumeIdentity.adapter_contract_sha256
      ? { adapter_contract_sha256: currentResumeIdentity.adapter_contract_sha256 }
      : {}),
    ...(currentResumeIdentity.evaluator_bundle_sha256
      ? { evaluator_bundle_sha256: currentResumeIdentity.evaluator_bundle_sha256 }
      : {}),
    ...(currentResumeIdentity.rubric_sha256
      ? { rubric_sha256: currentResumeIdentity.rubric_sha256 }
      : {}),
    total_score: terminalTotalScore,
    control_plane_score: terminalControlPlaneScore,
    proof_score: terminalProofScore,
    release_score: terminalReleaseScore,
    planner_brief_path: plannerBriefPath,
    idea_path: defaultIdeaPath,
    planned_scenario_path: plannedScenarioPath,
    plan_path: planPath,
    codex_handoff_path: undefined,
    adapter_contract_path: loadedAdapter?.contract_path,
    adapter_id: loadedAdapter?.contract.adapter_id,
    verification_provider_id: loadedAdapter?.contract.verification_provider?.provider_id,
    adapter_attached: Boolean(loadedAdapter),
    codex_session_registry_path: codexSessionRegistryPath,
    resume_identity_path: currentResumeIdentityPath,
    stop_reason: finalStopReason ?? resolvedStopReason,
    selection_basis: "terminal_round",
    best_round: bestRound,
    terminal_round: terminalRound,
    threshold_results: terminalThresholdResults,
    dimension_scores: terminalDimensionScores,
    best_scoring_total_score: bestScore ?? terminalTotalScore,
    best_scoring_control_plane_score: bestControlPlaneScore,
    best_scoring_proof_score: bestProofScore,
    best_scoring_release_score: bestReleaseScore,
    best_scoring_threshold_results: bestThresholdResults ?? terminalThresholdResults,
    round_history: history,
    ...(finalRuntimeEvents.length > 0 ? { runtime_events: finalRuntimeEvents } : {}),
    ...(runtimeWarnings.length > 0 ? { runtime_warnings: runtimeWarnings } : {}),
    ...(resumeMigrationPath
      ? {
          bundle_migrated: true,
          previous_bundle_fingerprint: resumeIdentityFingerprint(previousResumeIdentity),
          new_bundle_fingerprint: resumeIdentityFingerprint(currentResumeIdentity),
          resume_migration_path: resumeMigrationPath
        }
      : {}),
    ...(resumeDecisionPath ? { resume_decision_path: resumeDecisionPath } : {}),
    ...(input.resumeRunPath ? { resumed_from_run_id: runId } : {})
  };

  const codexHandoffPath = await writeRunCodexHandoff({
    runDirectory,
    summary,
    plan,
    scenario
  });
  summary.codex_handoff_path = codexHandoffPath;

  await Promise.all([
    writeJson(currentResumeIdentityPath, currentResumeIdentity),
    ...(resumeDecisionArtifact && resumeDecisionPath
      ? [writeJson(resumeDecisionPath, resumeDecisionArtifact)]
      : []),
    writeJson(join(runDirectory, "summary.json"), summary),
    writeJson(join(runDirectory, "current_best.json"), {
      round: terminalRound,
      selection_basis: "terminal_round",
      total_score: terminalRoundSummary?.total_score ?? bestScore ?? 0,
      control_plane_score:
        terminalRoundSummary?.control_plane_score ?? bestControlPlaneScore,
      proof_score: terminalRoundSummary?.proof_score ?? bestProofScore,
      release_score: terminalRoundSummary?.release_score ?? bestReleaseScore,
      threshold_results: terminalRoundSummary?.threshold_results ?? bestThresholdResults,
      dimension_scores:
        terminalRoundSummary?.dimension_scores ?? bestDimensionScores,
      patch_request_path:
        terminalRoundSummary?.patch_request_path ?? bestPatchRequestPath,
      eval_report_path:
        terminalRoundSummary?.eval_report_path ?? bestEvalReportPath,
      best_scoring_round: bestRound,
      best_scoring_total_score: bestScore ?? 0,
      best_scoring_control_plane_score: bestControlPlaneScore,
      best_scoring_proof_score: bestProofScore,
      best_scoring_release_score: bestReleaseScore,
      best_scoring_threshold_results: bestThresholdResults,
      best_scoring_dimension_scores: bestDimensionScores,
      best_scoring_patch_request_path: bestPatchRequestPath,
      best_scoring_eval_report_path: bestEvalReportPath
    }),
    writeRunControllerSummary({
      runDirectory,
      summary
    })
  ]);

  return {
    plan,
    summary,
    runDirectory,
    plannedScenarioPath
  };
};
