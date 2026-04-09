import { readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import {
  buildActiveContractFrame,
  targetCheckIdsFromPatchRequest,
  unresolvedSignatureFor
} from "./attempt-lifecycle.js";
import {
  buildFailureLineageArtifact,
  loadFailureLineageArtifact
} from "./failure-lineage.js";
import { loadJson, loadJsonIfExists } from "./file-system.js";
import {
  readControllerLeaseArtifact,
  readRuntimeLiveStateArtifact,
  readRuntimeRoundPhaseArtifact,
  readTransportStateArtifact,
  runtimeStatePathsForRun
} from "./runtime-state.js";
import type {
  ActiveContractFrame,
  ContractAgreementArtifact,
  ControllerLeaseArtifact,
  ControllerRoundPhase,
  EvalReport,
  FailureLineage,
  LoadedAdapterContract,
  LoopPlan,
  LoopRubric,
  LoopRunSummary,
  LoopScenario,
  PatchRequestArtifact,
  ReleaseThresholdResults,
  RemediationHistory,
  RuntimeLiveStateArtifact,
  RuntimeRoundPhaseArtifact,
  RoundContractArtifact,
  RoundSummary,
  TransportStateArtifact,
  TrajectoryDecisionArtifact
} from "./types.js";

export interface RestoredRunState {
  runDirectory: string;
  runId: string;
  summary: LoopRunSummary;
  scenario: LoopScenario;
  plan: LoopPlan;
  rubric: LoopRubric;
  plannedScenarioPath: string;
  planPath: string;
  plannerBriefPath: string;
  previousPatchRequest?: PatchRequestArtifact;
  previousPatchRequestPath?: string;
  previousTrajectoryDecision?: TrajectoryDecisionArtifact;
  previousTrajectoryDecisionPath?: string;
  activeContractFrame?: ActiveContractFrame;
  latestEvalReport?: EvalReport;
  latestFailureLineage?: FailureLineage;
  previousFailureLineage?: FailureLineage;
  latestRoundSummary?: RoundSummary;
  previousRoundSummary?: RoundSummary;
  bestScore?: number;
  bestControlPlaneScore: number;
  bestProofScore: number;
  bestReleaseScore: number;
  bestThresholdResults?: ReleaseThresholdResults;
  bestRound: number;
  bestEvalReportPath: string;
  bestPatchRequestPath: string;
  plateauCount: number;
  repeatedUnresolvedCount: number;
  roundStart: number;
  summaryWasRecovered: boolean;
  repairNotes: string[];
  runtimeLiveState?: RuntimeLiveStateArtifact;
  runtimeRoundPhase?: RuntimeRoundPhaseArtifact;
  controllerLease?: ControllerLeaseArtifact;
  transportState?: TransportStateArtifact;
  interruptedRound?: {
    round: number;
    roundDirectory: string;
    resumeFromPhase: ControllerRoundPhase;
    phaseStatus: RuntimeRoundPhaseArtifact["status"];
  };
}

const isImproved = (nextScore: number, currentBest: number | undefined): boolean =>
  currentBest === undefined || nextScore > currentBest + 0.001;

const scoreDeltasFromHistory = (history: readonly RoundSummary[]): number[] =>
  history.slice(1).map((summary, index) =>
    Number((summary.total_score - history[index].total_score).toFixed(3))
  );

export const failureLineageForEvalReport = (
  input:
    | EvalReport
    | {
        evalReport?: EvalReport;
        loadedAdapter?: LoadedAdapterContract;
        previousRoundSummary?: RoundSummary;
      }
): FailureLineage | undefined => {
  const normalized =
    "generated_at" in input
      ? { evalReport: input, loadedAdapter: undefined, previousRoundSummary: undefined }
      : input;

  if (!normalized.evalReport) {
    return undefined;
  }

  const targetManifest = normalized.evalReport.adapter_results.find(
    (execution) => execution.capability === "run_target" && execution.result.ok
  )?.result.target_manifest;

  return buildFailureLineageArtifact({
    evalReport: normalized.evalReport,
    loadedAdapter: normalized.loadedAdapter,
    targetManifest,
    previousRoundSummary: normalized.previousRoundSummary
  });
};

const plateauCountFromHistory = (history: readonly RoundSummary[]): number => {
  let bestScore: number | undefined;
  let plateauCount = 0;
  for (const summary of history) {
    if (isImproved(summary.total_score, bestScore)) {
      bestScore = summary.total_score;
      plateauCount = 0;
    } else {
      plateauCount += 1;
    }
  }

  return plateauCount;
};

const repeatedUnresolvedCountFromHistory = (history: readonly RoundSummary[]): number => {
  let lastSignature: string | undefined;
  let repeatedCount = 0;

  for (const summary of history) {
    const signature = unresolvedSignatureFor(summary.unresolved_check_ids);
    if (!signature) {
      lastSignature = undefined;
      repeatedCount = 0;
      continue;
    }

    if (signature === lastSignature) {
      repeatedCount += 1;
    } else {
      lastSignature = signature;
      repeatedCount = 1;
    }
  }

  return repeatedCount;
};

const activeContractFrameForHistory = async (
  history: readonly RoundSummary[]
): Promise<ActiveContractFrame | undefined> => {
  for (const round of [...history].reverse()) {
    if (!round.contract_agreement_path) {
      continue;
    }

    const [contractArtifact, contractAgreementArtifact] = await Promise.all([
      loadJson<RoundContractArtifact>(round.contract_path),
      loadJson<ContractAgreementArtifact>(round.contract_agreement_path)
    ]);

    if (contractAgreementArtifact.status !== "agreed") {
      continue;
    }

    return buildActiveContractFrame({
      round: round.round,
      contractArtifact,
      contractAgreementArtifact
    });
  }

  return undefined;
};

const resolvedRunDirectory = (runPath: string): string => resolve(runPath);
const controllerLeaseStaleMs = 30_000;

const roundDirectoryPattern = /^round-(\d+)$/;

const isLeaseStale = (
  lease: ControllerLeaseArtifact | undefined,
  now = Date.now()
): boolean => {
  if (!lease || lease.status !== "running") {
    return false;
  }

  const heartbeatAt = Date.parse(lease.heartbeat_at);
  if (Number.isNaN(heartbeatAt)) {
    return true;
  }

  return now - heartbeatAt > controllerLeaseStaleMs;
};

const loadRoundSummariesFromDisk = async (
  runDirectory: string
): Promise<RoundSummary[]> => {
  const entries = await readdir(runDirectory, { withFileTypes: true });
  const summaries = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && roundDirectoryPattern.test(entry.name))
      .map(async (entry) => {
        const roundSummaryPath = join(runDirectory, entry.name, "round_summary.json");
        return loadJsonIfExists<RoundSummary>(roundSummaryPath);
      })
  );

  return summaries
    .filter((summary): summary is RoundSummary => Boolean(summary))
    .sort((left, right) => left.round - right.round);
};

const mergeRoundHistory = (
  summaryHistory: readonly RoundSummary[],
  diskHistory: readonly RoundSummary[]
): RoundSummary[] =>
  [...new Map(
    [...summaryHistory, ...diskHistory]
      .sort((left, right) => left.round - right.round)
      .map((summary) => [summary.round, summary] as const)
  ).values()];

const bestRoundSummaryFromHistory = (
  history: readonly RoundSummary[]
): RoundSummary | undefined => {
  let bestRoundSummary: RoundSummary | undefined;

  for (const summary of history) {
    if (!bestRoundSummary || isImproved(summary.total_score, bestRoundSummary.total_score)) {
      bestRoundSummary = summary;
    }
  }

  return bestRoundSummary;
};

const hydrateSummaryFromHistory = (input: {
  runId: string;
  scenario: LoopScenario;
  rubric: LoopRubric;
  summary?: LoopRunSummary;
  history: RoundSummary[];
  runtimeLiveState?: RuntimeLiveStateArtifact;
  runtimeRoundPhase?: RuntimeRoundPhaseArtifact;
  controllerLease?: ControllerLeaseArtifact;
  transportState?: TransportStateArtifact;
}): LoopRunSummary => {
  const latestRoundSummary = input.history[input.history.length - 1];
  const bestRoundSummary = bestRoundSummaryFromHistory(input.history);
  const stopReason =
    latestRoundSummary?.round_stop_reason &&
    latestRoundSummary.round_stop_reason !== "continue"
      ? latestRoundSummary.round_stop_reason
      : input.summary?.stop_reason;

  return {
    run_id: input.summary?.run_id ?? input.runId,
    scenario_id: input.summary?.scenario_id ?? input.scenario.scenario_id,
    rubric_id: input.summary?.rubric_id ?? input.rubric.rubric_id,
    ...(input.summary ?? {}),
    ...(input.summary?.controller_mode
      ? {}
      : input.runtimeLiveState?.controller_mode
        ? { controller_mode: input.runtimeLiveState.controller_mode }
        : input.runtimeRoundPhase?.controller_mode
          ? { controller_mode: input.runtimeRoundPhase.controller_mode }
          : input.controllerLease?.controller_mode
            ? { controller_mode: input.controllerLease.controller_mode }
            : {}),
    ...(input.summary?.transport_mode
      ? {}
      : input.runtimeLiveState?.transport_mode
        ? { transport_mode: input.runtimeLiveState.transport_mode }
        : input.runtimeRoundPhase?.transport_mode
          ? { transport_mode: input.runtimeRoundPhase.transport_mode }
          : input.controllerLease?.transport_mode
            ? { transport_mode: input.controllerLease.transport_mode }
            : {}),
    ...(input.summary?.transport_protocol_path
      ? {}
      : input.transportState?.protocol_path
        ? { transport_protocol_path: input.transportState.protocol_path }
        : {}),
    total_score: latestRoundSummary?.total_score ?? input.summary?.total_score ?? 0,
    control_plane_score:
      latestRoundSummary?.control_plane_score ?? input.summary?.control_plane_score ?? 0,
    proof_score: latestRoundSummary?.proof_score ?? input.summary?.proof_score ?? 0,
    release_score: latestRoundSummary?.release_score ?? input.summary?.release_score ?? 0,
    round_count: input.history.length,
    round_history: input.history,
    ...(latestRoundSummary?.round !== undefined
      ? { terminal_round: latestRoundSummary.round }
      : {}),
    ...(latestRoundSummary?.threshold_results
      ? { threshold_results: latestRoundSummary.threshold_results }
      : {}),
    ...(latestRoundSummary?.dimension_scores
      ? { dimension_scores: latestRoundSummary.dimension_scores }
      : {}),
    ...(bestRoundSummary
      ? {
          best_round: bestRoundSummary.round,
          best_scoring_total_score: bestRoundSummary.total_score,
          best_scoring_control_plane_score: bestRoundSummary.control_plane_score,
          best_scoring_proof_score: bestRoundSummary.proof_score,
          best_scoring_release_score: bestRoundSummary.release_score,
          best_scoring_threshold_results: bestRoundSummary.threshold_results
        }
      : {}),
    ...(stopReason ? { stop_reason: stopReason } : {})
  };
};

const interruptedRoundStateFor = (input: {
  runDirectory: string;
  history: readonly RoundSummary[];
  runtimeRoundPhase?: RuntimeRoundPhaseArtifact;
}):
  | {
      round: number;
      roundDirectory: string;
      resumeFromPhase: ControllerRoundPhase;
      phaseStatus: RuntimeRoundPhaseArtifact["status"];
    }
  | undefined => {
  if (!input.runtimeRoundPhase) {
    return undefined;
  }

  if (input.runtimeRoundPhase.round <= input.history.length) {
    return undefined;
  }

  return {
    round: input.runtimeRoundPhase.round,
    roundDirectory: join(
      input.runDirectory,
      `round-${String(input.runtimeRoundPhase.round).padStart(3, "0")}`
    ),
    resumeFromPhase: input.runtimeRoundPhase.phase,
    phaseStatus: input.runtimeRoundPhase.status
  };
};

export const restoreRunState = async (
  runPath: string
): Promise<RestoredRunState> => {
  const runDirectory = resolvedRunDirectory(runPath);
  const runId = basename(runDirectory);
  const summaryPath = join(runDirectory, "summary.json");
  const plannedScenarioPath = join(runDirectory, "planned-scenario.json");
  const planPath = join(runDirectory, "plan.json");
  const plannerBriefPath = join(runDirectory, "planner-brief.md");
  const rubricPath = join(runDirectory, "effective-rubric.json");
  const runtimePaths = runtimeStatePathsForRun(runDirectory);

  const [
    summary,
    scenario,
    plan,
    rubric,
    runtimeLiveState,
    runtimeRoundPhase,
    controllerLease,
    transportState,
    diskHistory
  ] = await Promise.all([
    loadJsonIfExists<LoopRunSummary>(summaryPath),
    loadJson<LoopScenario>(plannedScenarioPath),
    loadJson<LoopPlan>(planPath),
    loadJson<LoopRubric>(rubricPath),
    readRuntimeLiveStateArtifact(runtimePaths.liveStatePath),
    readRuntimeRoundPhaseArtifact(runtimePaths.roundPhasePath),
    readControllerLeaseArtifact(runtimePaths.controllerLeasePath),
    readTransportStateArtifact(runtimePaths.transportStatePath),
    loadRoundSummariesFromDisk(runDirectory)
  ]);

  const history = mergeRoundHistory(summary?.round_history ?? [], diskHistory);
  const hydratedSummary = hydrateSummaryFromHistory({
    runId,
    scenario,
    rubric,
    summary,
    history,
    runtimeLiveState,
    runtimeRoundPhase,
    controllerLease,
    transportState
  });
  hydratedSummary.runtime_live_state_path ??= runtimePaths.liveStatePath;
  hydratedSummary.runtime_round_phase_path ??= runtimePaths.roundPhasePath;
  hydratedSummary.controller_lease_path ??= runtimePaths.controllerLeasePath;
  hydratedSummary.transport_state_path ??= runtimePaths.transportStatePath;
  const latestRoundSummary = history[history.length - 1];
  const previousRoundSummary =
    history.length > 1 ? history[history.length - 2] : undefined;
  const previousPatchRequestPath = latestRoundSummary?.patch_request_path;
  const previousPatchRequest = previousPatchRequestPath
    ? await loadJson<PatchRequestArtifact>(previousPatchRequestPath)
    : undefined;
  const previousTrajectoryDecisionPath = latestRoundSummary?.trajectory_decision_path;
  const previousTrajectoryDecision = previousTrajectoryDecisionPath
    ? await loadJson<TrajectoryDecisionArtifact>(previousTrajectoryDecisionPath)
    : undefined;
  const latestEvalReport = latestRoundSummary?.eval_report_path
    ? await loadJson<EvalReport>(latestRoundSummary.eval_report_path)
    : undefined;
  const latestFailureLineage =
    (await loadFailureLineageArtifact(latestRoundSummary?.failure_lineage_path)) ??
    failureLineageForEvalReport({
      evalReport: latestEvalReport,
      previousRoundSummary,
      loadedAdapter: undefined
    });
  const previousFailureLineage =
    previousRoundSummary
      ? (await loadFailureLineageArtifact(previousRoundSummary.failure_lineage_path)) ??
        failureLineageForEvalReport({
          evalReport: previousRoundSummary.eval_report_path
            ? await loadJson<EvalReport>(previousRoundSummary.eval_report_path)
            : undefined,
          loadedAdapter: undefined
        })
      : undefined;
  const interruptedRound = interruptedRoundStateFor({
    runDirectory,
    history,
    runtimeRoundPhase
  });
  const staleLeaseDetected = isLeaseStale(controllerLease);

  return {
    runDirectory,
    runId,
    summary: hydratedSummary,
    scenario,
    plan,
    rubric,
    plannedScenarioPath,
    planPath,
    plannerBriefPath,
    previousPatchRequest,
    previousPatchRequestPath,
    previousTrajectoryDecision,
    previousTrajectoryDecisionPath,
    activeContractFrame: await activeContractFrameForHistory(history),
    latestEvalReport,
    latestFailureLineage,
    previousFailureLineage,
    latestRoundSummary,
    previousRoundSummary,
    bestScore:
      hydratedSummary.best_scoring_total_score ?? hydratedSummary.total_score,
    bestControlPlaneScore:
      hydratedSummary.best_scoring_control_plane_score ??
      hydratedSummary.control_plane_score,
    bestProofScore:
      hydratedSummary.best_scoring_proof_score ?? hydratedSummary.proof_score,
    bestReleaseScore:
      hydratedSummary.best_scoring_release_score ?? hydratedSummary.release_score,
    bestThresholdResults:
      hydratedSummary.best_scoring_threshold_results ??
      hydratedSummary.threshold_results,
    bestRound:
      hydratedSummary.best_round ??
      hydratedSummary.terminal_round ??
      Math.max(history.length, 1),
    bestEvalReportPath:
      history.find(
        (round) =>
          round.round === (hydratedSummary.best_round ?? hydratedSummary.terminal_round)
      )
        ?.eval_report_path ?? latestRoundSummary?.eval_report_path ?? "",
    bestPatchRequestPath:
      history.find(
        (round) =>
          round.round === (hydratedSummary.best_round ?? hydratedSummary.terminal_round)
      )
        ?.patch_request_path ?? latestRoundSummary?.patch_request_path ?? "",
    plateauCount: plateauCountFromHistory(history),
    repeatedUnresolvedCount: repeatedUnresolvedCountFromHistory(history),
    roundStart: interruptedRound?.round ?? history.length + 1,
    summaryWasRecovered:
      !summary || diskHistory.length !== (summary?.round_history ?? []).length,
    repairNotes: [
      ...(!summary ? ["summary.json was missing; rebuilt summary state from run artifacts."] : []),
      ...(diskHistory.length > (summary?.round_history ?? []).length
        ? [
            `Recovered ${diskHistory.length - (summary?.round_history ?? []).length} committed round checkpoint(s) from round directories.`
          ]
        : []),
      ...(staleLeaseDetected
        ? [
            `Detected stale controller lease from ${controllerLease?.heartbeat_at ?? "unknown heartbeat"} while restoring run state.`
          ]
        : []),
      ...(interruptedRound
        ? [
            `Interrupted round ${interruptedRound.round} will resume from phase '${interruptedRound.resumeFromPhase}'.`
          ]
        : [])
    ],
    runtimeLiveState,
    runtimeRoundPhase,
    controllerLease,
    transportState,
    interruptedRound
  };
};

export const buildRemediationHistory = (input: {
  previousPatchRequest?: PatchRequestArtifact;
  activeContractFrame?: ActiveContractFrame;
  latestFailureLineage?: FailureLineage;
  repeatedUnresolvedCount: number;
  scoreDeltas: number[];
}): RemediationHistory | undefined => {
  if (!input.previousPatchRequest && !input.latestFailureLineage) {
    return undefined;
  }

  const failingCheckIds = input.latestFailureLineage?.failing_check_ids ?? [];
  const allowedCheckIds = new Set([
    ...(input.activeContractFrame?.acceptance_checks ?? []),
    ...failingCheckIds,
    "target_signal_thresholds_met",
    "adapter_execution_healthy",
    "release_blockers_recorded"
  ]);
  const patchTargetCheckIds = targetCheckIdsFromPatchRequest(input.previousPatchRequest);
  const targetManifestKeysMissing = [
    ...new Set(input.latestFailureLineage?.missing_target_manifest_keys ?? [])
  ];
  const regressionCheckIds = input.latestFailureLineage?.release_regression_ids ?? [];

  return {
    repeated_unresolved_signature_count: input.repeatedUnresolvedCount,
    repeated_failure_classification_count:
      input.latestFailureLineage?.policy_snapshot
        ?.repeated_failure_classification_count ?? 0,
    unresolved_signature: input.latestFailureLineage?.unresolved_signature,
    failing_assertion_ids: input.latestFailureLineage?.failing_assertion_ids ?? [],
    failing_release_gate_probe_ids: input.latestFailureLineage?.failing_probe_ids ?? [],
    target_manifest_keys_missing: targetManifestKeysMissing,
    regression_check_ids: regressionCheckIds,
    contradiction_count:
      input.latestFailureLineage?.contradictory_witness_assertion_ids.length ?? 0,
    environment_blocked:
      input.latestFailureLineage?.failure_classification === "environment_blocked",
    score_deltas: input.scoreDeltas.slice(-3),
    patch_entropy: Number(
      (
        patchTargetCheckIds.length > 0
          ? input.previousPatchRequest?.must_fix.length ?? patchTargetCheckIds.length
          : 0
      ).toFixed(3)
    ),
    scope_drift_detected: patchTargetCheckIds.some((checkId) => !allowedCheckIds.has(checkId)),
    patch_authority_state:
      input.latestFailureLineage?.policy_snapshot?.patch_authority_state,
    policy_snapshot: input.latestFailureLineage?.policy_snapshot
  };
};

export const scoreDeltasForHistory = scoreDeltasFromHistory;
