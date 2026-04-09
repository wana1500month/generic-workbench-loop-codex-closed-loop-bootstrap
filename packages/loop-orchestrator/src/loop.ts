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
  restoreAdapterCapabilityExecutions,
  loadVerificationProfile
} from "./adapter-runtime.js";
import {
  executeCoreVerificationProbes,
  restoreCoreVerificationProbeExecutions
} from "./core-verifier.js";
import { writeRunCodexHandoff } from "./codex-handoff.js";
import {
  detectDurableMemoryPaths,
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
  defaultControllerMode,
  isControllerMode
} from "./controller-mode.js";
import { defaultExecutorMode, isExecutorMode } from "./executor-mode.js";
import {
  buildTransportStateArtifact,
  defaultTransportModeForControllerMode,
  isCurrentThreadTransport,
  isTransportMode,
  transportRuntimeWarningsForMode,
  validateTransportMode
} from "./transport-mode.js";
import {
  startAppServerTransport,
  type AppServerTransportController
} from "./app-server-runtime.js";
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
import {
  runtimeStatePathsForRun,
  startRuntimeHeartbeat,
  writeRuntimeRoundPhaseArtifact,
  writeTransportStateArtifact
} from "./runtime-state.js";
import { transportProtocolPathForRun, writeTransportProtocol } from "./transport-protocol.js";
import { buildTrajectoryDecisionArtifact } from "./trajectory-controller.js";
import type {
  AdapterCapabilityExecution,
  AdapterCapabilityName,
  ActiveContractFrame,
  ClosedLoopResult,
  ContractAgreementArtifact,
  ContractReviewArtifact,
  CoreVerificationProbeExecution,
  ControllerMode,
  ControllerPhaseStatus,
  ControllerRoundPhase,
  EvalReport,
  EvaluatorVerdictArtifact,
  FailureLineage,
  GeneratorPlanArtifact,
  LoadedAdapterContract,
  LoopRubric,
  LoopRunSummary,
  PatchRequestArtifact,
  QualityCritiqueArtifact,
  ReleaseThresholdResults,
  RemediationHistory,
  ResumeDecisionArtifact,
  RoundContractArtifact,
  RoundResultArtifact,
  RoundSummary,
  TransportMode,
  RuntimeEvent,
  RuntimeEventCode,
  TargetManifest,
  TrajectoryDecisionArtifact,
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

const preVerificationCapabilities: AdapterCapabilityName[] = [
  "prepare_target",
  "apply_change",
  "run_target",
  "capture_evidence"
];

const postVerificationCapabilities: AdapterCapabilityName[] = [
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
  capabilities: AdapterCapabilityName[];
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
  previousTrajectoryDecisionPath?: string;
  extraEnv?: Record<string, string>;
}): Promise<AdapterCapabilityExecution[]> => {
  if (!input.loadedAdapter) {
    return [];
  }

  const executions: AdapterCapabilityExecution[] = [];
  for (const capability of input.capabilities) {
    executions.push(
      await executeAdapterCapability({
        loadedAdapter: input.loadedAdapter,
        capability,
        roundDirectory: input.roundDirectory,
        extraEnv: input.extraEnv,
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
          patch_request_path: input.previousPatchRequestPath,
          trajectory_decision_path: input.previousTrajectoryDecisionPath
        }
      })
    );
  }

  return executions;
};

const orderedAdapterExecutions = (
  capabilities: readonly AdapterCapabilityName[],
  executions: readonly AdapterCapabilityExecution[]
): AdapterCapabilityExecution[] => {
  const capabilityOrder = new Map(
    capabilities.map((capability, index) => [capability, index] as const)
  );
  return [...new Map(executions.map((execution) => [execution.capability, execution] as const)).values()]
    .sort(
      (left, right) =>
        (capabilityOrder.get(left.capability) ?? Number.MAX_SAFE_INTEGER) -
        (capabilityOrder.get(right.capability) ?? Number.MAX_SAFE_INTEGER)
    );
};

const controllerPhaseOrder: readonly ControllerRoundPhase[] = [
  "negotiation",
  "pre_verification",
  "core_probes",
  "post_verification",
  "evaluation",
  "round_commit",
  "run_finalize"
];

const controllerPhaseIndex = (phase: ControllerRoundPhase): number =>
  controllerPhaseOrder.indexOf(phase);

const phaseCompletedAtOrBeyond = (
  resumeState:
    | {
        phase: ControllerRoundPhase;
        status: ControllerPhaseStatus;
      }
    | undefined,
  targetPhase: ControllerRoundPhase
): boolean => {
  if (!resumeState) {
    return false;
  }

  const currentIndex = controllerPhaseIndex(resumeState.phase);
  const targetIndex = controllerPhaseIndex(targetPhase);
  if (currentIndex > targetIndex) {
    return true;
  }

  return currentIndex === targetIndex && resumeState.status === "completed";
};

const buildCheckpointSummary = (input: {
  runId: string;
  scenarioId: string;
  rubricId: string;
  controllerMode: ControllerMode;
  transportMode: TransportMode;
  executorMode: LoopRunSummary["executor_mode"];
  targetFamily?: LoopRunSummary["target_family"];
  validationLane?: LoopRunSummary["validation_lane"];
  evaluatorProfilePath?: string;
  adapterContractSha256?: string;
  evaluatorBundleSha256?: string;
  rubricSha256?: string;
  plannerBriefPath?: string;
  plannedScenarioPath?: string;
  planPath?: string;
  ideaPath?: string;
  featureListPath?: string;
  progressPath?: string;
  progressLogPath?: string;
  doneWhenPath?: string;
  initScriptPath?: string;
  adapterContractPath?: string;
  adapterId?: string;
  verificationProviderId?: string;
  adapterAttached: boolean;
  codexSessionRegistryPath?: string;
  resumeIdentityPath?: string;
  runtimeLiveStatePath: string;
  runtimeRoundPhasePath: string;
  controllerLeasePath: string;
  transportStatePath: string;
  transportProtocolPath?: string;
  stopReason?: LoopRunSummary["stop_reason"];
  bestRound?: number;
  bestScore?: number;
  bestControlPlaneScore?: number;
  bestProofScore?: number;
  bestReleaseScore?: number;
  bestThresholdResults?: ReleaseThresholdResults;
  bestDimensionScores?: LoopRunSummary["dimension_scores"];
  history: RoundSummary[];
  runtimeEvents: RuntimeEvent[];
  runtimeWarnings: string[];
  resumeMigrationPath?: string;
  previousBundleFingerprint?: string;
  newBundleFingerprint?: string;
  resumeDecisionPath?: string;
  resumedFromRunId?: string;
}): LoopRunSummary => {
  const latestRoundSummary = input.history[input.history.length - 1];
  const terminalRound = latestRoundSummary?.round ?? input.bestRound;
  const terminalTotalScore =
    latestRoundSummary?.total_score ?? input.bestScore ?? 0;
  const terminalControlPlaneScore =
    latestRoundSummary?.control_plane_score ?? input.bestControlPlaneScore ?? 0;
  const terminalProofScore =
    latestRoundSummary?.proof_score ?? input.bestProofScore ?? 0;
  const terminalReleaseScore =
    latestRoundSummary?.release_score ?? input.bestReleaseScore ?? 0;
  const terminalThresholdResults =
    latestRoundSummary?.threshold_results ?? input.bestThresholdResults;
  const terminalDimensionScores =
    latestRoundSummary?.dimension_scores ?? input.bestDimensionScores;

  return {
    run_id: input.runId,
    round_count: input.history.length,
    scenario_id: input.scenarioId,
    rubric_id: input.rubricId,
    controller_mode: input.controllerMode,
    transport_mode: input.transportMode,
    ...(input.executorMode ? { executor_mode: input.executorMode } : {}),
    ...(input.targetFamily ? { target_family: input.targetFamily } : {}),
    ...(input.validationLane ? { validation_lane: input.validationLane } : {}),
    ...(input.evaluatorProfilePath
      ? { evaluator_profile_path: input.evaluatorProfilePath }
      : {}),
    ...(input.adapterContractSha256
      ? { adapter_contract_sha256: input.adapterContractSha256 }
      : {}),
    ...(input.evaluatorBundleSha256
      ? { evaluator_bundle_sha256: input.evaluatorBundleSha256 }
      : {}),
    ...(input.rubricSha256 ? { rubric_sha256: input.rubricSha256 } : {}),
    total_score: terminalTotalScore,
    control_plane_score: terminalControlPlaneScore,
    proof_score: terminalProofScore,
    release_score: terminalReleaseScore,
    ...(input.plannerBriefPath ? { planner_brief_path: input.plannerBriefPath } : {}),
    ...(input.ideaPath ? { idea_path: input.ideaPath } : {}),
    ...(input.featureListPath ? { feature_list_path: input.featureListPath } : {}),
    ...(input.progressPath ? { progress_path: input.progressPath } : {}),
    ...(input.progressLogPath ? { progress_log_path: input.progressLogPath } : {}),
    ...(input.doneWhenPath ? { done_when_path: input.doneWhenPath } : {}),
    ...(input.initScriptPath ? { init_script_path: input.initScriptPath } : {}),
    ...(input.plannedScenarioPath
      ? { planned_scenario_path: input.plannedScenarioPath }
      : {}),
    ...(input.planPath ? { plan_path: input.planPath } : {}),
    ...(input.adapterContractPath
      ? { adapter_contract_path: input.adapterContractPath }
      : {}),
    ...(input.adapterId ? { adapter_id: input.adapterId } : {}),
    ...(input.verificationProviderId
      ? { verification_provider_id: input.verificationProviderId }
      : {}),
    adapter_attached: input.adapterAttached,
    ...(input.codexSessionRegistryPath
      ? { codex_session_registry_path: input.codexSessionRegistryPath }
      : {}),
    ...(input.resumeIdentityPath
      ? { resume_identity_path: input.resumeIdentityPath }
      : {}),
    runtime_live_state_path: input.runtimeLiveStatePath,
    runtime_round_phase_path: input.runtimeRoundPhasePath,
    controller_lease_path: input.controllerLeasePath,
    transport_state_path: input.transportStatePath,
    ...(input.transportProtocolPath
      ? { transport_protocol_path: input.transportProtocolPath }
      : {}),
    ...(input.stopReason ? { stop_reason: input.stopReason } : {}),
    ...(terminalRound !== undefined
      ? {
          selection_basis: "terminal_round",
          terminal_round: terminalRound
        }
      : {}),
    ...(input.bestRound !== undefined ? { best_round: input.bestRound } : {}),
    ...(terminalThresholdResults
      ? { threshold_results: terminalThresholdResults }
      : {}),
    ...(terminalDimensionScores ? { dimension_scores: terminalDimensionScores } : {}),
    ...(input.bestScore !== undefined
      ? { best_scoring_total_score: input.bestScore }
      : {}),
    ...(input.bestControlPlaneScore !== undefined
      ? { best_scoring_control_plane_score: input.bestControlPlaneScore }
      : {}),
    ...(input.bestProofScore !== undefined
      ? { best_scoring_proof_score: input.bestProofScore }
      : {}),
    ...(input.bestReleaseScore !== undefined
      ? { best_scoring_release_score: input.bestReleaseScore }
      : {}),
    ...(input.bestThresholdResults
      ? { best_scoring_threshold_results: input.bestThresholdResults }
      : {}),
    round_history: input.history,
    ...(input.runtimeEvents.length > 0 ? { runtime_events: input.runtimeEvents } : {}),
    ...(input.runtimeWarnings.length > 0
      ? { runtime_warnings: input.runtimeWarnings }
      : {}),
    ...(input.resumeMigrationPath
      ? {
          bundle_migrated: true,
          previous_bundle_fingerprint: input.previousBundleFingerprint,
          new_bundle_fingerprint: input.newBundleFingerprint,
          resume_migration_path: input.resumeMigrationPath
        }
      : {}),
    ...(input.resumeDecisionPath
      ? { resume_decision_path: input.resumeDecisionPath }
      : {}),
    ...(input.resumedFromRunId ? { resumed_from_run_id: input.resumedFromRunId } : {})
  };
};

const writeRunCheckpoint = async (input: {
  runDirectory: string;
  summary: LoopRunSummary;
  currentBest: {
    round?: number;
    totalScore?: number;
    controlPlaneScore?: number;
    proofScore?: number;
    releaseScore?: number;
    thresholdResults?: ReleaseThresholdResults;
    dimensionScores?: LoopRunSummary["dimension_scores"];
    patchRequestPath?: string;
    evalReportPath?: string;
    bestScoringRound?: number;
    bestScoringTotalScore?: number;
    bestScoringControlPlaneScore?: number;
    bestScoringProofScore?: number;
    bestScoringReleaseScore?: number;
    bestScoringThresholdResults?: ReleaseThresholdResults;
    bestScoringDimensionScores?: LoopRunSummary["dimension_scores"];
    bestScoringPatchRequestPath?: string;
    bestScoringEvalReportPath?: string;
  };
}): Promise<void> => {
  const writes: Promise<unknown>[] = [
    writeJson(join(input.runDirectory, "summary.json"), input.summary),
    writeRunControllerSummary({
      runDirectory: input.runDirectory,
      summary: input.summary
    })
  ];

  if (input.summary.terminal_round !== undefined) {
    writes.push(
      writeJson(join(input.runDirectory, "current_best.json"), {
        round: input.currentBest.round ?? input.summary.terminal_round,
        selection_basis: "terminal_round",
        total_score: input.currentBest.totalScore ?? input.summary.total_score,
        control_plane_score:
          input.currentBest.controlPlaneScore ?? input.summary.control_plane_score,
        proof_score: input.currentBest.proofScore ?? input.summary.proof_score,
        release_score: input.currentBest.releaseScore ?? input.summary.release_score,
        threshold_results:
          input.currentBest.thresholdResults ?? input.summary.threshold_results,
        dimension_scores:
          input.currentBest.dimensionScores ?? input.summary.dimension_scores,
        patch_request_path: input.currentBest.patchRequestPath,
        eval_report_path: input.currentBest.evalReportPath,
        best_scoring_round:
          input.currentBest.bestScoringRound ?? input.summary.best_round,
        best_scoring_total_score:
          input.currentBest.bestScoringTotalScore ??
          input.summary.best_scoring_total_score,
        best_scoring_control_plane_score:
          input.currentBest.bestScoringControlPlaneScore ??
          input.summary.best_scoring_control_plane_score,
        best_scoring_proof_score:
          input.currentBest.bestScoringProofScore ??
          input.summary.best_scoring_proof_score,
        best_scoring_release_score:
          input.currentBest.bestScoringReleaseScore ??
          input.summary.best_scoring_release_score,
        best_scoring_threshold_results:
          input.currentBest.bestScoringThresholdResults ??
          input.summary.best_scoring_threshold_results,
        best_scoring_dimension_scores:
          input.currentBest.bestScoringDimensionScores,
        best_scoring_patch_request_path:
          input.currentBest.bestScoringPatchRequestPath,
        best_scoring_eval_report_path:
          input.currentBest.bestScoringEvalReportPath
      })
    );
  }

  await Promise.all(writes);
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
  controllerMode?: ControllerMode;
  transportMode?: TransportMode;
  repairOnly?: boolean;
  resumePhase?: ControllerRoundPhase;
  executorMode?: "harness" | "subagents-experimental";
}): Promise<ClosedLoopResult> => {
  const includeRemediationBudget = input.includeRemediationBudget ?? true;
  const restoredRun = input.resumeRunPath
    ? await restoreRunState(input.resumeRunPath)
    : undefined;
  if (input.repairOnly && !restoredRun) {
    throw new Error("Repair mode requires --resume-run so the controller can restore persisted state.");
  }
  const attemptBudget =
    input.maxRounds ?? restoredRun?.plan.max_rounds ?? 3;
  const runId =
    restoredRun?.runId ??
    (await nextRunId(join(repoRoot, "evals", "runs")));
  const runDirectory =
    restoredRun?.runDirectory ?? join(repoRoot, "evals", "runs", runId);
  const controllerMode =
    input.controllerMode ??
    (isControllerMode(process.env.HARNESS_CONTROLLER_MODE)
      ? process.env.HARNESS_CONTROLLER_MODE
      : undefined) ??
    restoredRun?.summary.controller_mode ??
    defaultControllerMode;
  const transportMode =
    input.transportMode ??
    (isTransportMode(process.env.HARNESS_TRANSPORT)
      ? process.env.HARNESS_TRANSPORT
      : undefined) ??
    restoredRun?.summary.transport_mode ??
    defaultTransportModeForControllerMode(controllerMode);
  const transportValidationError = validateTransportMode({
    controllerMode,
    transportMode
  });
  if (transportValidationError) {
    throw new Error(transportValidationError);
  }
  const currentThreadTransport = isCurrentThreadTransport(transportMode);
  const executorMode =
    input.executorMode ??
    (isExecutorMode(process.env.HARNESS_EXECUTOR_MODE)
      ? process.env.HARNESS_EXECUTOR_MODE
      : undefined) ??
    restoredRun?.summary.executor_mode ??
    defaultExecutorMode;
  await mkdir(runDirectory, { recursive: true });
  const runtimeStatePaths = runtimeStatePathsForRun(runDirectory);
  const runRuntimeDirectory = runtimeStatePaths.runtimeDirectory;
  const summaryPath = join(runDirectory, "summary.json");
  const transportProtocolPath = transportProtocolPathForRun(
    runDirectory,
    transportMode
  );
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
    transportMode,
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
  ,
    ...(restoredRun?.summaryWasRecovered
      ? [
          buildRuntimeEvent(
            "resume.recovered_round_checkpoint",
            `Recovered committed round checkpoint(s) for run '${runId}' from round directories before continuing.`,
            {
              resumed_run_id: runId,
              recovered_round_count:
                restoredRun.summary.round_history?.length ?? 0
            }
          )
        ]
      : []),
    ...(restoredRun?.interruptedRound
      ? [
          buildRuntimeEvent(
            "resume.repaired_interrupted_round",
            `Detected interrupted round ${restoredRun.interruptedRound.round} at phase '${input.resumePhase ?? restoredRun.interruptedRound.resumeFromPhase}'. Resume will continue from the persisted runtime journal.`,
            {
              resumed_run_id: runId,
              round: restoredRun.interruptedRound.round,
              phase: input.resumePhase ?? restoredRun.interruptedRound.resumeFromPhase
            }
          )
        ]
      : [])
  ]);

  let runtimeWarnings = unique([
    ...previousPersistentWarnings,
    ...transportRuntimeWarningsForMode({
      controllerMode,
      transportMode
    }),
    ...(bundleSelection.runtimeWarnings ?? []),
    ...(loadedAdapter?.runtime_warnings ?? []),
    ...(executorMode === "subagents-experimental"
      ? [experimentalExecutorRuntimeWarning]
      : []),
    ...currentRuntimeEvents.map((event) => event.message)
  ]);
  await writeTransportStateArtifact(
    runtimeStatePaths.transportStatePath,
    buildTransportStateArtifact({
      runId,
      controllerMode,
      transportMode,
      executorMode,
      summaryPath,
      protocolPath: transportProtocolPath,
      status: transportMode === "app-server" ? "blocked" : "configured",
      notes: transportRuntimeWarningsForMode({
        controllerMode,
        transportMode
      }),
      ...(transportMode === "app-server"
        ? {
            lastError:
              "App Server transport was not opened because this invocation may return before the live controller session starts."
          }
        : {})
    })
  );

  if (
    restoredRun &&
    !input.forceReopenTerminal &&
    resumeIdentityMismatches.length === 0 &&
    isResumeNoopTerminalStopReason(restoredStopReason)
  ) {
    const noopTransportProtocolPath = await writeTransportProtocol({
      runDirectory,
      transportMode,
      summary: {
        run_id: runId,
        controller_mode: controllerMode,
        transport_mode: transportMode,
        transport_state_path: runtimeStatePaths.transportStatePath,
        resume_identity_path: currentResumeIdentityPath,
        runtime_round_phase_path: runtimeStatePaths.roundPhasePath
      },
      activeRound: restoredRun.interruptedRound?.round,
      activePhase: input.resumePhase ?? restoredRun.interruptedRound?.resumeFromPhase,
      activeStatus: restoredRun.interruptedRound?.phaseStatus,
      latestPatchRequestPath: restoredRun.previousPatchRequestPath,
      latestRoundContractPath: restoredRun.latestRoundSummary?.contract_path,
      notes: [
        ...restoredRun.repairNotes,
        ...(transportMode === "current-thread"
          ? [
              "Use the attached-loop skill and keep the current thread as the generator/controller surface."
            ]
          : [])
      ]
    });
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
      controller_mode: controllerMode,
      transport_mode: transportMode,
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
      planner_brief_path: restoredRun.plannerBriefPath,
      planned_scenario_path: restoredRun.plannedScenarioPath,
      plan_path: restoredRun.planPath,
      ...(await detectDurableMemoryPaths(
        dirname(restoredRun.summary.idea_path ?? defaultIdeaPath)
      )),
      codex_handoff_path: undefined,
      adapter_contract_path:
        loadedAdapter?.contract_path ?? restoredRun.summary.adapter_contract_path,
      adapter_id: loadedAdapter?.contract.adapter_id ?? restoredRun.summary.adapter_id,
      verification_provider_id:
        loadedAdapter?.contract.verification_provider?.provider_id ??
        restoredRun.summary.verification_provider_id,
      adapter_attached: Boolean(loadedAdapter),
      resume_identity_path: currentResumeIdentityPath,
      runtime_live_state_path: runtimeStatePaths.liveStatePath,
      runtime_round_phase_path: runtimeStatePaths.roundPhasePath,
      controller_lease_path: runtimeStatePaths.controllerLeasePath,
      transport_state_path: runtimeStatePaths.transportStatePath,
      transport_protocol_path: noopTransportProtocolPath,
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
  const durableMemory = await loadDurableMemoryContext(idea);
  const durableMemoryPaths = await ensureDurableMemoryArtifacts(
    durableMemory.rootDirectory,
    durableMemory.context
  );
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
    const plannerEnhancement =
      currentThreadTransport
        ? {
            value: {
              scenario: baseScenario,
              plan: basePlan
            },
            runtimeWarnings: [
              `Transport '${transportMode}' skipped nested Codex planner enhancement during run initialization.`
            ]
          }
        : await enhancePlanWithCodex({
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
  let previousTrajectoryDecision: TrajectoryDecisionArtifact | undefined =
    restoredRun?.previousTrajectoryDecision;
  let previousTrajectoryDecisionPath: string | undefined =
    restoredRun?.previousTrajectoryDecisionPath;
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
  let activeHeartbeatRound = restoredRun?.interruptedRound?.round;
  let activeHeartbeatPhase = input.resumePhase ?? restoredRun?.interruptedRound?.resumeFromPhase;
  let activeHeartbeatPhaseStatus = restoredRun?.interruptedRound?.phaseStatus;
  let activeHeartbeatPhaseStartedAt = restoredRun?.runtimeRoundPhase?.phase_started_at;
  let currentCheckpointStopReason = restoredRun?.summary.stop_reason;
  let latestRoundSummaryPath =
    restoredRun?.latestRoundSummary && restoredRun.latestRoundSummary.round > 0
      ? join(
          roundDirectoryFor(runDirectory, restoredRun.latestRoundSummary.round),
          "round_summary.json"
        )
      : undefined;
  let latestEvalReportPath = restoredRun?.latestRoundSummary?.eval_report_path;
  const heartbeatNotes = [...(restoredRun?.repairNotes ?? [])];
  let transportProtocolCurrentPath =
    restoredRun?.summary.transport_protocol_path ?? transportProtocolPath;
  const writeLiveTransportProtocol = async (): Promise<void> => {
    transportProtocolCurrentPath = await writeTransportProtocol({
      runDirectory,
      transportMode,
      summary: {
        run_id: runId,
        controller_mode: controllerMode,
        transport_mode: transportMode,
        transport_state_path: runtimeStatePaths.transportStatePath,
        resume_identity_path: currentResumeIdentityPath,
        runtime_round_phase_path: runtimeStatePaths.roundPhasePath
      },
      activeRound: activeHeartbeatRound,
      activePhase: activeHeartbeatPhase,
      activeStatus: activeHeartbeatPhaseStatus,
      latestPatchRequestPath: previousPatchRequestPath,
      latestRoundContractPath: history[history.length - 1]?.contract_path,
      notes: [
        ...heartbeatNotes,
        ...(transportMode === "current-thread"
          ? [
              "Use the attached-loop skill and keep the current thread as the generator/controller surface."
            ]
          : [])
      ]
    });
  };
  let appServerTransport: AppServerTransportController | undefined;
  await writeLiveTransportProtocol();
  if (transportMode === "app-server") {
    appServerTransport = await startAppServerTransport({
      runId,
      controllerMode,
      executorMode,
      transportStatePath: runtimeStatePaths.transportStatePath,
      summaryPath,
      protocolPath: transportProtocolCurrentPath,
      restoredThreadId: restoredRun?.transportState?.app_server?.thread_id,
      initialRound: activeHeartbeatRound ?? restoredRun?.roundStart ?? history.length + 1,
      initialPhase: activeHeartbeatPhase ?? "negotiation",
      initialStatus: activeHeartbeatPhaseStatus ?? "in_progress",
      initialNotes: heartbeatNotes
    });
    runtimeWarnings = unique([
      ...runtimeWarnings,
      "App Server transport keeps a live thread/turn container through codex app-server."
    ]);
  } else {
    await writeTransportStateArtifact(
      runtimeStatePaths.transportStatePath,
      buildTransportStateArtifact({
        runId,
        controllerMode,
        transportMode,
        executorMode,
        summaryPath,
        protocolPath: transportProtocolCurrentPath,
        status: "configured",
        notes: transportRuntimeWarningsForMode({
          controllerMode,
          transportMode
        })
      })
    );
  }
  const heartbeat = startRuntimeHeartbeat({
    runId,
    controllerMode,
    transportMode,
    executorMode,
    paths: runtimeStatePaths,
    getSnapshot: () => ({
      roundCount: history.length,
      ...(activeHeartbeatRound !== undefined ? { round: activeHeartbeatRound } : {}),
      ...(activeHeartbeatPhase ? { phase: activeHeartbeatPhase } : {}),
      ...(activeHeartbeatPhaseStatus
        ? { phaseStatus: activeHeartbeatPhaseStatus }
        : {}),
      ...(activeHeartbeatPhaseStartedAt
        ? { phaseStartedAt: activeHeartbeatPhaseStartedAt }
        : {}),
      ...(latestRoundSummaryPath
        ? { latestRoundSummaryPath }
        : {}),
      ...(latestEvalReportPath ? { latestEvalReportPath } : {}),
      ...(bestRound !== undefined ? { bestRound } : {}),
      ...(bestScore !== undefined ? { bestTotalScore: bestScore } : {}),
      ...(summaryPath ? { summaryPath } : {}),
      ...(currentCheckpointStopReason
        ? { stopReason: currentCheckpointStopReason }
        : {}),
      ...(heartbeatNotes.length > 0 ? { notes: heartbeatNotes } : {})
    })
  });
  const recordRoundPhase = async (inputPhase: {
    round: number;
    phase: ControllerRoundPhase;
    status: ControllerPhaseStatus;
    artifacts?: Record<string, string>;
    notes?: string[];
  }): Promise<void> => {
    const now = new Date().toISOString();
    activeHeartbeatRound = inputPhase.round;
    activeHeartbeatPhase = inputPhase.phase;
    activeHeartbeatPhaseStatus = inputPhase.status;
    if (inputPhase.status === "in_progress") {
      activeHeartbeatPhaseStartedAt = now;
    }
    if (inputPhase.notes?.length) {
      heartbeatNotes.splice(0, heartbeatNotes.length, ...inputPhase.notes);
    }
    await writeRuntimeRoundPhaseArtifact(runtimeStatePaths.roundPhasePath, {
      run_id: runId,
      round: inputPhase.round,
      controller_mode: controllerMode,
      transport_mode: transportMode,
      executor_mode: executorMode,
      phase: inputPhase.phase,
      status: inputPhase.status,
      updated_at: now,
      heartbeat_at: now,
      owner_pid: process.pid,
      ...(activeHeartbeatPhaseStartedAt
        ? { phase_started_at: activeHeartbeatPhaseStartedAt }
        : {}),
      ...(inputPhase.status === "completed"
        ? { phase_completed_at: now }
        : {}),
      ...(appServerTransport?.snapshot().thread_id
        ? { session: { thread_id: appServerTransport.snapshot().thread_id } }
        : {}),
      ...(inputPhase.artifacts ? { artifacts: inputPhase.artifacts } : {}),
      ...(heartbeatNotes.length > 0 ? { notes: heartbeatNotes } : {})
    });
    await writeLiveTransportProtocol();
    if (appServerTransport) {
      await appServerTransport.syncPhase({
        round: inputPhase.round,
        phase: inputPhase.phase,
        status: inputPhase.status,
        notes: heartbeatNotes
      });
    }
    await heartbeat.tick();
  };
  const writeCheckpoint = async (
    stopReason: LoopRunSummary["stop_reason"] | undefined
  ): Promise<LoopRunSummary> => {
    const summary = buildCheckpointSummary({
      runId,
      scenarioId: scenario.scenario_id,
      rubricId: hydratedRubric.rubric_id,
      controllerMode,
      transportMode,
      executorMode,
      targetFamily: resolvedTargetFamily,
      validationLane: resolvedValidationLane,
      evaluatorProfilePath: bundleSelection.evaluatorProfilePath,
      adapterContractSha256: currentResumeIdentity.adapter_contract_sha256,
      evaluatorBundleSha256: currentResumeIdentity.evaluator_bundle_sha256,
      rubricSha256: currentResumeIdentity.rubric_sha256,
      plannerBriefPath,
      plannedScenarioPath,
      planPath,
      ideaPath: defaultIdeaPath,
      featureListPath: durableMemoryPaths.feature_list_path,
      progressPath: durableMemoryPaths.progress_path,
      progressLogPath: durableMemoryPaths.progress_log_path,
      doneWhenPath: durableMemoryPaths.done_when_path,
      initScriptPath: durableMemoryPaths.init_script_path,
      adapterContractPath: loadedAdapter?.contract_path,
      adapterId: loadedAdapter?.contract.adapter_id,
      verificationProviderId:
        loadedAdapter?.contract.verification_provider?.provider_id,
      adapterAttached: Boolean(loadedAdapter),
      codexSessionRegistryPath,
      resumeIdentityPath: currentResumeIdentityPath,
      runtimeLiveStatePath: runtimeStatePaths.liveStatePath,
      runtimeRoundPhasePath: runtimeStatePaths.roundPhasePath,
      controllerLeasePath: runtimeStatePaths.controllerLeasePath,
      transportStatePath: runtimeStatePaths.transportStatePath,
      transportProtocolPath: transportProtocolCurrentPath,
      stopReason,
      bestRound,
      bestScore,
      bestControlPlaneScore,
      bestProofScore,
      bestReleaseScore,
      bestThresholdResults,
      bestDimensionScores,
      history,
      runtimeEvents: currentRuntimeEvents,
      runtimeWarnings,
      resumeMigrationPath,
      previousBundleFingerprint: resumeMigrationPath
        ? resumeIdentityFingerprint(previousResumeIdentity)
        : undefined,
      newBundleFingerprint: resumeMigrationPath
        ? resumeIdentityFingerprint(currentResumeIdentity)
        : undefined,
      resumeDecisionPath: undefined,
      resumedFromRunId: input.resumeRunPath ? runId : undefined
    });

    await writeRunCheckpoint({
      runDirectory,
      summary,
      currentBest: {
        round: history[history.length - 1]?.round,
        totalScore: history[history.length - 1]?.total_score ?? bestScore,
        controlPlaneScore:
          history[history.length - 1]?.control_plane_score ?? bestControlPlaneScore,
        proofScore: history[history.length - 1]?.proof_score ?? bestProofScore,
        releaseScore:
          history[history.length - 1]?.release_score ?? bestReleaseScore,
        thresholdResults:
          history[history.length - 1]?.threshold_results ?? bestThresholdResults,
        dimensionScores:
          history[history.length - 1]?.dimension_scores ?? bestDimensionScores,
        patchRequestPath:
          history[history.length - 1]?.patch_request_path ?? bestPatchRequestPath,
        evalReportPath:
          history[history.length - 1]?.eval_report_path ?? bestEvalReportPath,
        bestScoringRound: bestRound,
        bestScoringTotalScore: bestScore,
        bestScoringControlPlaneScore: bestControlPlaneScore,
        bestScoringProofScore: bestProofScore,
        bestScoringReleaseScore: bestReleaseScore,
        bestScoringThresholdResults: bestThresholdResults,
        bestScoringDimensionScores: bestDimensionScores,
        bestScoringPatchRequestPath: bestPatchRequestPath,
        bestScoringEvalReportPath: bestEvalReportPath
      }
    });
    currentCheckpointStopReason = summary.stop_reason;
    await heartbeat.tick();
    return summary;
  };
  await writeCheckpoint(restoredRun?.summary.stop_reason);
  const repairRoundLimit = input.repairOnly
    ? restoredRun?.interruptedRound?.round
    : undefined;
  if (input.repairOnly && !repairRoundLimit) {
    const repairedSummary = await writeCheckpoint(restoredRun?.summary.stop_reason);
    if (appServerTransport) {
      await appServerTransport.stop({
        stopReason: repairedSummary.stop_reason,
        notes: heartbeatNotes
      });
    }
    await heartbeat.stop("stopped");
    return {
      plan,
      summary: repairedSummary,
      runDirectory,
      plannedScenarioPath
    };
  }

  for (
    let round = restoredRun?.roundStart ?? 1;
    round <= (repairRoundLimit ?? executionMaxRounds);
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
      previousTrajectoryDecision,
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
        label:
          lifecycleDecision.trajectory.mode === "refine"
            ? `patch-only refine attempt ${round - 1}`
            : `patch-only repair attempt ${round - 1}`
      };
    } else if (lifecycleDecision.negotiation_mode === "recontract") {
      directive = {
        ...directive,
        label:
          lifecycleDecision.trajectory.mode === "parallel_pivot"
            ? `parallel pivot attempt ${round - 1}`
            : lifecycleDecision.trajectory.mode === "pivot"
              ? `pivot attempt ${round - 1}`
              : `recontract attempt ${round - 1}`,
        objective: `Re-open contract negotiation before continuing the build from ${lifecycleDecision.trajectory.restart_from}: ${lifecycleDecision.reason}`
      };
    }
    const artifacts = artifactsForRound(roundDirectory);
    const resumedRoundPhase =
      restoredRun?.interruptedRound?.round === round
        ? {
            phase: input.resumePhase ?? restoredRun.interruptedRound.resumeFromPhase,
            status: restoredRun.interruptedRound.phaseStatus
          }
        : undefined;
    let persistContractReviewArtifact = false;
    let persistContractAgreementArtifact = false;
    let contractArtifact: RoundContractArtifact;
    let contractReviewArtifact: ContractReviewArtifact;
    let contractAgreementArtifact: ContractAgreementArtifact;
    let generatorPlanArtifact: GeneratorPlanArtifact;

    if (phaseCompletedAtOrBeyond(resumedRoundPhase, "negotiation")) {
      const negotiationState = await loadJson<{
        contractArtifact: RoundContractArtifact;
        contractReviewArtifact: ContractReviewArtifact;
        contractAgreementArtifact: ContractAgreementArtifact;
        generatorPlanArtifact: GeneratorPlanArtifact;
        persistContractReviewArtifact: boolean;
        persistContractAgreementArtifact: boolean;
      }>(artifacts.negotiation_state_path);
      contractArtifact = negotiationState.contractArtifact;
      contractReviewArtifact = negotiationState.contractReviewArtifact;
      contractAgreementArtifact = negotiationState.contractAgreementArtifact;
      generatorPlanArtifact = negotiationState.generatorPlanArtifact;
      persistContractReviewArtifact =
        negotiationState.persistContractReviewArtifact;
      persistContractAgreementArtifact =
        negotiationState.persistContractAgreementArtifact;
    } else {
      await recordRoundPhase({
        round,
        phase: "negotiation",
        status: "in_progress",
        notes: resumedRoundPhase
          ? [
              ...heartbeatNotes,
              `Re-entering round ${round} negotiation from persisted phase '${resumedRoundPhase.phase}'.`
            ]
          : heartbeatNotes
      });
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
      contractArtifact = buildRoundContractArtifact({
        round,
        negotiationMode: lifecycleDecision.negotiation_mode,
        continuationAuthority: lifecycleDecision.continuation_authority,
        recontractReason: lifecycleDecision.recontract_reason,
        trajectory: lifecycleDecision.trajectory,
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
      const contractReviewEnhancement =
        currentThreadTransport
          ? {
              value: baseContractReviewArtifact,
              runtimeWarnings: [
                `Transport '${transportMode}' skipped nested Codex contract review enhancement for round ${round}.`
              ]
            }
          : await enhanceContractReviewWithCodex({
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
      contractReviewArtifact = contractReviewEnhancement.value;
      contractAgreementArtifact =
        lifecycleDecision.negotiation_mode === "patch_only" && previousPatchRequest
          ? buildSyntheticPatchCarryForwardAgreement({
              contractArtifact,
              previousPatchRequest
            })
          : buildContractAgreementArtifact({
              contractArtifact,
              contractReviewArtifact
            });
      const baseGeneratorPlanArtifact = buildGeneratorPlanArtifact({
        contractArtifact,
        contractAgreementArtifact,
        previousPatchRequest,
        trajectory: lifecycleDecision.trajectory,
        adapterAttached: Boolean(loadedAdapter)
      });
      const generatorPlanEnhancement =
        currentThreadTransport
          ? {
              value: baseGeneratorPlanArtifact,
              runtimeWarnings: [
                `Transport '${transportMode}' skipped nested Codex generator-plan enhancement for round ${round}.`
              ]
            }
          : await enhanceGeneratorPlanWithCodex({
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
      generatorPlanArtifact = generatorPlanEnhancement.value;
      const reviewChecksRequired = contractArtifact.acceptance_checks.some(
        (checkId) =>
          checkId === "contract_review_written" || checkId === "contract_review_quality"
      );
      const agreementChecksRequired = contractArtifact.acceptance_checks.some(
        (checkId) =>
          checkId === "contract_agreement_written" || checkId === "agreement_matches_review"
      );
      persistContractReviewArtifact =
        lifecycleDecision.persist_contract_review ||
        contractReviewArtifact.decision !== "accept" ||
        reviewChecksRequired;
      persistContractAgreementArtifact =
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
        writeJson(artifacts.negotiation_state_path, {
          contractArtifact,
          contractReviewArtifact,
          contractAgreementArtifact,
          generatorPlanArtifact,
          persistContractReviewArtifact,
          persistContractAgreementArtifact
        }),
        writeRoundEvaluationPlaceholders({ roundDirectory }),
        writeRoundHandoffPlaceholders({ roundDirectory })
      ]);
      await recordRoundPhase({
        round,
        phase: "negotiation",
        status: "completed",
        artifacts: {
          negotiation_state_path: artifacts.negotiation_state_path,
          contract_path: artifacts.contract_json_path,
          generator_plan_path: artifacts.generator_plan_json_path
        }
      });
    }
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
    const previousPatchTargetCheckIds = unique(
      previousPatchRequest?.must_fix.flatMap((item) => item.target_check_ids) ?? []
    );
    const previousPatchRequestAddressed =
      previousPatchTargetCheckIds.length === 0 ||
      previousPatchTargetCheckIds.every((checkId) =>
        contractArtifact.carry_over_check_ids.includes(checkId)
      );
    const persistedPreVerificationExecutions =
      await loadJsonIfExists<AdapterCapabilityExecution[]>(
        artifacts.pre_verification_executions_path
      );
    let preVerificationExecutions =
      persistedPreVerificationExecutions ??
      orderedAdapterExecutions(
        preVerificationCapabilities,
        await restoreAdapterCapabilityExecutions({
          loadedAdapter,
          capabilities: preVerificationCapabilities,
          roundDirectory
        })
      );
    const restoredPreVerificationExecutions =
      !persistedPreVerificationExecutions && preVerificationExecutions.length > 0;
    const persistedTargetManifest =
      await loadJsonIfExists<TargetManifest>(artifacts.target_manifest_path);
    let targetManifest =
      persistedTargetManifest ??
      preVerificationExecutions.find(
        (execution) => execution.capability === "run_target" && execution.result.ok
      )?.result.target_manifest;
    if (restoredPreVerificationExecutions) {
      runtimeWarnings = unique([
        ...runtimeWarnings,
        `Reconstructed pre_verification capability aggregate from adapter result files for round ${round}.`
      ]);
      await Promise.all([
        writeJson(
          artifacts.pre_verification_executions_path,
          preVerificationExecutions
        ),
        writeJson(artifacts.target_manifest_path, targetManifest ?? {})
      ]);
    } else if (!persistedTargetManifest) {
      await writeJson(artifacts.target_manifest_path, targetManifest ?? {});
    }
    if (!phaseCompletedAtOrBeyond(resumedRoundPhase, "pre_verification")) {
      await recordRoundPhase({
        round,
        phase: "pre_verification",
        status: "in_progress"
      });
      const repairedPreVerificationCapabilities = new Set(
        preVerificationExecutions.map((execution) => execution.capability)
      );
      const missingPreVerificationCapabilities = preVerificationCapabilities.filter(
        (capability) => !repairedPreVerificationCapabilities.has(capability)
      );
      const resumedPreVerificationExecutions =
        loadedAdapter &&
        contractAgreementArtifact.status === "agreed" &&
        missingPreVerificationCapabilities.length > 0
          ? await runAdapterCapabilities({
              loadedAdapter,
              capabilities: missingPreVerificationCapabilities,
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
              previousPatchRequestPath,
              previousTrajectoryDecisionPath,
              extraEnv: {
                HARNESS_CONTROLLER_MODE: controllerMode,
                HARNESS_TRANSPORT: transportMode,
                HARNESS_EXECUTOR_MODE: executorMode
              }
            })
          : [];
      preVerificationExecutions = orderedAdapterExecutions(
        preVerificationCapabilities,
        [...preVerificationExecutions, ...resumedPreVerificationExecutions]
      );
      targetManifest = preVerificationExecutions.find(
        (execution) => execution.capability === "run_target" && execution.result.ok
      )?.result.target_manifest;
      await Promise.all([
        writeJson(
          artifacts.pre_verification_executions_path,
          preVerificationExecutions
        ),
        writeJson(artifacts.target_manifest_path, targetManifest ?? {})
      ]);
      await recordRoundPhase({
        round,
        phase: "pre_verification",
        status: "completed",
        artifacts: {
          pre_verification_executions_path:
            artifacts.pre_verification_executions_path,
          target_manifest_path: artifacts.target_manifest_path
        }
      });
    }
    const persistedCoreProbeResults =
      await loadJsonIfExists<CoreVerificationProbeExecution[]>(
        artifacts.core_probe_results_path
      );
    let coreProbeResults =
      persistedCoreProbeResults ??
      (await restoreCoreVerificationProbeExecutions({
        loadedAdapter,
        roundDirectory
      }));
    const restoredCoreProbeResults =
      !persistedCoreProbeResults && coreProbeResults.length > 0;
    if (restoredCoreProbeResults) {
      runtimeWarnings = unique([
        ...runtimeWarnings,
        `Reconstructed core_probes aggregate from probe result files for round ${round}.`
      ]);
      await writeJson(artifacts.core_probe_results_path, coreProbeResults);
    }
    if (!phaseCompletedAtOrBeyond(resumedRoundPhase, "core_probes")) {
      await recordRoundPhase({
        round,
        phase: "core_probes",
        status: "in_progress"
      });
      const restoredProbeIds = new Set(
        coreProbeResults.map((probeExecution) => probeExecution.probe_id)
      );
      const missingCoreProbeIds =
        loadedAdapter?.verification_profile?.profile.core_probes
          ?.map((probe) => probe.probe_id)
          .filter((probeId) => !restoredProbeIds.has(probeId)) ?? [];
      const resumedCoreProbeResults =
        loadedAdapter &&
        contractAgreementArtifact.status === "agreed" &&
        missingCoreProbeIds.length > 0
          ? await executeCoreVerificationProbes({
              loadedAdapter,
              runDirectory,
              roundDirectory,
              targetManifest,
              probeIds: missingCoreProbeIds
            })
          : [];
      coreProbeResults = [
        ...new Map(
          [...coreProbeResults, ...resumedCoreProbeResults].map((probeExecution) => [
            probeExecution.probe_id,
            probeExecution
          ] as const)
        ).values()
      ];
      await writeJson(artifacts.core_probe_results_path, coreProbeResults);
      await recordRoundPhase({
        round,
        phase: "core_probes",
        status: "completed",
        artifacts: {
          core_probe_results_path: artifacts.core_probe_results_path
        }
      });
    }
    const persistedPostVerificationExecutions =
      await loadJsonIfExists<AdapterCapabilityExecution[]>(
        artifacts.post_verification_executions_path
      );
    let postVerificationExecutions =
      persistedPostVerificationExecutions ??
      orderedAdapterExecutions(
        postVerificationCapabilities,
        await restoreAdapterCapabilityExecutions({
          loadedAdapter,
          capabilities: postVerificationCapabilities,
          roundDirectory
        })
      );
    const restoredPostVerificationExecutions =
      !persistedPostVerificationExecutions && postVerificationExecutions.length > 0;
    const persistedAdapterExecutions =
      await loadJsonIfExists<AdapterCapabilityExecution[]>(
        artifacts.adapter_executions_path
      );
    let adapterExecutions =
      persistedAdapterExecutions ??
      orderedAdapterExecutions(
        [...preVerificationCapabilities, ...postVerificationCapabilities],
        [...preVerificationExecutions, ...postVerificationExecutions]
      );
    if (restoredPostVerificationExecutions) {
      runtimeWarnings = unique([
        ...runtimeWarnings,
        `Reconstructed post_verification capability aggregate from adapter result files for round ${round}.`
      ]);
      await Promise.all([
        writeJson(
          artifacts.post_verification_executions_path,
          postVerificationExecutions
        ),
        writeJson(artifacts.adapter_executions_path, adapterExecutions)
      ]);
    } else if (!persistedAdapterExecutions) {
      await writeJson(artifacts.adapter_executions_path, adapterExecutions);
    }
    if (!phaseCompletedAtOrBeyond(resumedRoundPhase, "post_verification")) {
      await recordRoundPhase({
        round,
        phase: "post_verification",
        status: "in_progress"
      });
      const repairedPostVerificationCapabilities = new Set(
        postVerificationExecutions.map((execution) => execution.capability)
      );
      const missingPostVerificationCapabilities = postVerificationCapabilities.filter(
        (capability) => !repairedPostVerificationCapabilities.has(capability)
      );
      const resumedPostVerificationExecutions =
        loadedAdapter &&
        contractAgreementArtifact.status === "agreed" &&
        missingPostVerificationCapabilities.length > 0
          ? await runAdapterCapabilities({
              loadedAdapter,
              capabilities: missingPostVerificationCapabilities,
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
              previousPatchRequestPath,
              previousTrajectoryDecisionPath,
              extraEnv: {
                HARNESS_CORE_PROBE_RESULTS_PATH: artifacts.core_probe_results_path,
                HARNESS_TARGET_MANIFEST_PATH: artifacts.target_manifest_path,
                HARNESS_CONTROLLER_MODE: controllerMode,
                HARNESS_TRANSPORT: transportMode,
                HARNESS_EXECUTOR_MODE: executorMode,
                ...(selectedVerificationProfile
                  ? {
                      HARNESS_VERIFICATION_PROFILE_PATH:
                        selectedVerificationProfile.profile_path
                    }
                  : {})
              }
            })
          : [];
      postVerificationExecutions = orderedAdapterExecutions(
        postVerificationCapabilities,
        [...postVerificationExecutions, ...resumedPostVerificationExecutions]
      );
      adapterExecutions = orderedAdapterExecutions(
        [...preVerificationCapabilities, ...postVerificationCapabilities],
        [...preVerificationExecutions, ...postVerificationExecutions]
      );
      await Promise.all([
        writeJson(
          artifacts.post_verification_executions_path,
          postVerificationExecutions
        ),
        writeJson(artifacts.adapter_executions_path, adapterExecutions)
      ]);
      await recordRoundPhase({
        round,
        phase: "post_verification",
        status: "completed",
        artifacts: {
          post_verification_executions_path:
            artifacts.post_verification_executions_path,
          adapter_executions_path: artifacts.adapter_executions_path
        }
      });
    }
    let evalReport: EvalReport;
    let previousPatchRequestResolved: boolean;
    let evaluatorVerdictArtifact: EvaluatorVerdictArtifact;
    let qualityCritiqueArtifact: QualityCritiqueArtifact;
    let patchRequestArtifact: PatchRequestArtifact;
    let trajectoryDecisionArtifact: TrajectoryDecisionArtifact;
    let roundResultArtifact: RoundResultArtifact;
    let failureLineage: FailureLineage | undefined;

    if (phaseCompletedAtOrBeyond(resumedRoundPhase, "evaluation")) {
      evalReport = await loadJson<EvalReport>(artifacts.eval_report_path);
      evaluatorVerdictArtifact = await loadJson<EvaluatorVerdictArtifact>(
        artifacts.evaluator_verdict_json_path
      );
      qualityCritiqueArtifact = await loadJson<QualityCritiqueArtifact>(
        artifacts.quality_critique_json_path
      );
      patchRequestArtifact = await loadJson<PatchRequestArtifact>(
        artifacts.patch_request_json_path
      );
      trajectoryDecisionArtifact = await loadJson<TrajectoryDecisionArtifact>(
        artifacts.trajectory_decision_json_path
      );
      roundResultArtifact = await loadJson<RoundResultArtifact>(
        artifacts.round_result_json_path
      );
      failureLineage =
        (await loadJsonIfExists<FailureLineage>(artifacts.failure_lineage_path)) ??
        failureLineageForEvalReport({
          evalReport,
          loadedAdapter,
          previousRoundSummary
        });
      previousPatchRequestResolved =
        roundResultArtifact.previous_patch_request_resolved;
    } else {
      await recordRoundPhase({
        round,
        phase: "evaluation",
        status: "in_progress"
      });
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
      const evalEnhancement =
        currentThreadTransport
          ? {
              value: baseEvalReport,
              runtimeWarnings: [
                `Transport '${transportMode}' skipped nested Codex eval enhancement for round ${round}.`
              ]
            }
          : await enhanceEvalReportWithCodex({
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
      evalReport = evalEnhancement.value;
      previousPatchRequestResolved =
        previousPatchTargetCheckIds.length === 0 ||
        evalReport.check_results.some(
          (result) =>
            result.check_id === "previous_patch_request_resolved" &&
            result.status === "pass"
        );
      evaluatorVerdictArtifact = buildEvaluatorVerdictArtifact({
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
        ...(activeContractFrame?.acceptance_checks ??
          contractAgreementArtifact.acceptance_checks),
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
                (
                  evalReport.total_score - history[history.length - 1].total_score
                ).toFixed(3)
              )
            ].slice(-6)
          : scoreDeltas.slice(-6);
      const projectedPlateauCount = isImproved(evalReport.total_score, bestScore)
        ? 0
        : plateauCount + 1;
      failureLineage = rawFailureLineage
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
      qualityCritiqueArtifact = buildQualityCritiqueArtifact({
        round,
        contractArtifact,
        evalReport,
        loadedAdapter,
        failureLineage
      });
      patchRequestArtifact = buildPatchRequestArtifact({
        round,
        evalReport,
        evaluatorVerdictArtifact,
        qualityCritiqueArtifact,
        adapterAttached: Boolean(loadedAdapter),
        staticContractBlockers: contractReviewArtifact.static_blockers,
        failureLineage
      });
      trajectoryDecisionArtifact = buildTrajectoryDecisionArtifact({
        round,
        contractId: contractArtifact.contract_id,
        history,
        currentRound: {
          round,
          total_score: evalReport.total_score,
          release_score: evalReport.release_score,
          overall_verdict: evalReport.overall_verdict,
          previous_patch_request_resolved: previousPatchRequestResolved,
          threshold_results: evalReport.threshold_results
        },
        patchRequest: patchRequestArtifact,
        qualityCritique: qualityCritiqueArtifact,
        failureLineage
      });
      roundResultArtifact = buildRoundResultArtifact({
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
        trajectoryDecisionArtifact,
        roundResultArtifact,
        evalReport,
        failureLineage
      });
      await recordRoundPhase({
        round,
        phase: "evaluation",
        status: "completed",
        artifacts: {
          eval_report_path: artifacts.eval_report_path,
          patch_request_path: artifacts.patch_request_json_path,
          round_result_path: artifacts.round_result_json_path
        }
      });
    }
    latestEvalReport = evalReport;
    const improved = isImproved(evalReport.total_score, bestScore);

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
      controller_mode: controllerMode,
      transport_mode: transportMode,
      ...(lifecycleDecision.recontract_reason
        ? { recontract_reason: lifecycleDecision.recontract_reason }
        : {}),
      label: directive?.label ?? `round ${round}`,
      controller_reason: lifecycleDecision.reason,
      trajectory: trajectoryDecisionArtifact,
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
      trajectory_decision_path: artifacts.trajectory_decision_json_path,
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
    await recordRoundPhase({
      round,
      phase: "round_commit",
      status: "in_progress",
      artifacts: {
        round_summary_path: join(roundDirectory, "round_summary.json")
      }
    });
    history.push(roundSummary);
    await writeRoundSummary(roundDirectory, roundSummary);
    latestRoundSummaryPath = join(roundDirectory, "round_summary.json");
    latestEvalReportPath = artifacts.eval_report_path;

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
      trajectoryDecision: trajectoryDecisionArtifact,
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
    previousTrajectoryDecision = trajectoryDecisionArtifact;
    previousTrajectoryDecisionPath = artifacts.trajectory_decision_json_path;
    previousRoundSummary = roundSummary;
    const roundCheckpointSummary = await writeCheckpoint(stopReason);
    await recordRoundPhase({
      round,
      phase: "round_commit",
      status: "completed",
      artifacts: {
        round_summary_path: latestRoundSummaryPath,
        summary_path: summaryPath
      }
    });
    if (repairRoundLimit === round) {
      if (appServerTransport) {
        await appServerTransport.stop({
          stopReason: roundCheckpointSummary.stop_reason,
          notes: heartbeatNotes
        });
      }
      await heartbeat.stop("stopped");
      return {
        plan,
        summary: roundCheckpointSummary,
        runDirectory,
        plannedScenarioPath
      };
    }

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

  let summary: LoopRunSummary = buildCheckpointSummary({
    runId,
    scenarioId: scenario.scenario_id,
    rubricId: hydratedRubric.rubric_id,
    controllerMode,
    transportMode,
    executorMode,
    targetFamily: resolvedTargetFamily,
    validationLane: resolvedValidationLane,
    evaluatorProfilePath: bundleSelection.evaluatorProfilePath,
    adapterContractSha256: currentResumeIdentity.adapter_contract_sha256,
    evaluatorBundleSha256: currentResumeIdentity.evaluator_bundle_sha256,
    rubricSha256: currentResumeIdentity.rubric_sha256,
    plannerBriefPath,
    plannedScenarioPath,
    planPath,
    ideaPath: defaultIdeaPath,
    featureListPath: durableMemoryPaths.feature_list_path,
    progressPath: durableMemoryPaths.progress_path,
    progressLogPath: durableMemoryPaths.progress_log_path,
    doneWhenPath: durableMemoryPaths.done_when_path,
    initScriptPath: durableMemoryPaths.init_script_path,
    adapterContractPath: loadedAdapter?.contract_path,
    adapterId: loadedAdapter?.contract.adapter_id,
    verificationProviderId:
      loadedAdapter?.contract.verification_provider?.provider_id,
    adapterAttached: Boolean(loadedAdapter),
    codexSessionRegistryPath,
    resumeIdentityPath: currentResumeIdentityPath,
    runtimeLiveStatePath: runtimeStatePaths.liveStatePath,
    runtimeRoundPhasePath: runtimeStatePaths.roundPhasePath,
    controllerLeasePath: runtimeStatePaths.controllerLeasePath,
    transportStatePath: runtimeStatePaths.transportStatePath,
    transportProtocolPath: transportProtocolCurrentPath,
    stopReason: finalStopReason ?? resolvedStopReason,
    bestRound,
    bestScore: bestScore ?? terminalTotalScore,
    bestControlPlaneScore,
    bestProofScore,
    bestReleaseScore,
    bestThresholdResults: bestThresholdResults ?? terminalThresholdResults,
    bestDimensionScores,
    history,
    runtimeEvents: finalRuntimeEvents,
    runtimeWarnings,
    resumeMigrationPath,
    previousBundleFingerprint: resumeMigrationPath
      ? resumeIdentityFingerprint(previousResumeIdentity)
      : undefined,
    newBundleFingerprint: resumeMigrationPath
      ? resumeIdentityFingerprint(currentResumeIdentity)
      : undefined,
    resumeDecisionPath,
    resumedFromRunId: input.resumeRunPath ? runId : undefined
  });
  currentCheckpointStopReason = summary.stop_reason;
  await recordRoundPhase({
    round: terminalRound ?? 0,
    phase: "run_finalize",
    status: "in_progress",
    artifacts: {
      summary_path: summaryPath
    }
  });

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
      : [])
  ]);
  await writeRunCheckpoint({
    runDirectory,
    summary,
    currentBest: {
      round: terminalRound,
      totalScore: terminalRoundSummary?.total_score ?? bestScore ?? 0,
      controlPlaneScore:
        terminalRoundSummary?.control_plane_score ?? bestControlPlaneScore,
      proofScore: terminalRoundSummary?.proof_score ?? bestProofScore,
      releaseScore: terminalRoundSummary?.release_score ?? bestReleaseScore,
      thresholdResults:
        terminalRoundSummary?.threshold_results ?? bestThresholdResults,
      dimensionScores:
        terminalRoundSummary?.dimension_scores ?? bestDimensionScores,
      patchRequestPath:
        terminalRoundSummary?.patch_request_path ?? bestPatchRequestPath,
      evalReportPath:
        terminalRoundSummary?.eval_report_path ?? bestEvalReportPath,
      bestScoringRound: bestRound,
      bestScoringTotalScore: bestScore ?? 0,
      bestScoringControlPlaneScore: bestControlPlaneScore,
      bestScoringProofScore: bestProofScore,
      bestScoringReleaseScore: bestReleaseScore,
      bestScoringThresholdResults: bestThresholdResults,
      bestScoringDimensionScores: bestDimensionScores,
      bestScoringPatchRequestPath: bestPatchRequestPath,
      bestScoringEvalReportPath: bestEvalReportPath
    }
  });
  await recordRoundPhase({
    round: terminalRound ?? 0,
    phase: "run_finalize",
    status: "completed",
    artifacts: {
      summary_path: summaryPath,
      codex_handoff_path: codexHandoffPath
    }
  });
  if (appServerTransport) {
    await appServerTransport.stop({
      stopReason: summary.stop_reason,
      notes: heartbeatNotes
    });
  }
  await heartbeat.stop("stopped");

  return {
    plan,
    summary,
    runDirectory,
    plannedScenarioPath
  };
};
