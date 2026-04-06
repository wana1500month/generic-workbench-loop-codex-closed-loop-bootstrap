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
import { loadJson } from "./file-system.js";
import type {
  ActiveContractFrame,
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
  RoundContractArtifact,
  RoundSummary,
  ContractAgreementArtifact
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

  const [summary, scenario, plan, rubric] = await Promise.all([
    loadJson<LoopRunSummary>(summaryPath),
    loadJson<LoopScenario>(plannedScenarioPath),
    loadJson<LoopPlan>(planPath),
    loadJson<LoopRubric>(rubricPath)
  ]);

  const history = summary.round_history ?? [];
  const latestRoundSummary = history[history.length - 1];
  const previousRoundSummary =
    history.length > 1 ? history[history.length - 2] : undefined;
  const previousPatchRequestPath = latestRoundSummary?.patch_request_path;
  const previousPatchRequest = previousPatchRequestPath
    ? await loadJson<PatchRequestArtifact>(previousPatchRequestPath)
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

  return {
    runDirectory,
    runId,
    summary,
    scenario,
    plan,
    rubric,
    plannedScenarioPath,
    planPath,
    plannerBriefPath,
    previousPatchRequest,
    previousPatchRequestPath,
    activeContractFrame: await activeContractFrameForHistory(history),
    latestEvalReport,
    latestFailureLineage,
    previousFailureLineage,
    latestRoundSummary,
    previousRoundSummary,
    bestScore: summary.best_scoring_total_score ?? summary.total_score,
    bestControlPlaneScore:
      summary.best_scoring_control_plane_score ?? summary.control_plane_score,
    bestProofScore: summary.best_scoring_proof_score ?? summary.proof_score,
    bestReleaseScore: summary.best_scoring_release_score ?? summary.release_score,
    bestThresholdResults:
      summary.best_scoring_threshold_results ?? summary.threshold_results,
    bestRound: summary.best_round ?? summary.terminal_round ?? Math.max(history.length, 1),
    bestEvalReportPath:
      history.find((round) => round.round === (summary.best_round ?? summary.terminal_round))
        ?.eval_report_path ?? latestRoundSummary?.eval_report_path ?? "",
    bestPatchRequestPath:
      history.find((round) => round.round === (summary.best_round ?? summary.terminal_round))
        ?.patch_request_path ?? latestRoundSummary?.patch_request_path ?? "",
    plateauCount: plateauCountFromHistory(history),
    repeatedUnresolvedCount: repeatedUnresolvedCountFromHistory(history),
    roundStart: history.length + 1
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
