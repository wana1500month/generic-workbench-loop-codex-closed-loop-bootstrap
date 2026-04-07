import type {
  FailureLineage,
  PatchRequestArtifact,
  QualityCritiqueArtifact,
  RemediationHistory,
  RoundSummary,
  TrajectoryDecisionArtifact,
  TrajectoryDirective,
  TrajectoryMode,
  TrajectoryRestartFrom
} from "./types.js";

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

type TrajectoryRoundCandidate = Pick<
  RoundSummary,
  | "round"
  | "total_score"
  | "release_score"
  | "overall_verdict"
  | "previous_patch_request_resolved"
  | "threshold_results"
>;

const isStableRound = (round: TrajectoryRoundCandidate): boolean =>
  round.threshold_results.dimension_thresholds_met ||
  round.previous_patch_request_resolved ||
  round.overall_verdict === "advance";

const isPassingRound = (round: TrajectoryRoundCandidate): boolean =>
  round.threshold_results.contract_completed && round.overall_verdict !== "hold";

const isParallelPivotTrigger = (
  triggerCode?: FailureLineage["policy_snapshot"] extends infer Snapshot
    ? Snapshot extends { dominant_trigger_code: infer Code }
      ? Code
      : never
    : never
): boolean =>
  triggerCode === "plateau_without_progress" ||
  triggerCode === "repeated_same_failure_signature" ||
  triggerCode === "patch_entropy_spike";

const modeForFailurePolicy = (
  failureLineage?: FailureLineage,
  fallback: TrajectoryMode = "pivot"
): TrajectoryMode => {
  const dominantTrigger = failureLineage?.policy_snapshot?.dominant_trigger_code;
  return isParallelPivotTrigger(dominantTrigger) ? "parallel_pivot" : fallback;
};

const noveltyTargetForMode = (mode: TrajectoryMode): number => {
  switch (mode) {
    case "tighten":
      return 0.15;
    case "refine":
      return 0.35;
    case "pivot":
      return 0.75;
    case "parallel_pivot":
      return 0.9;
  }
};

const restartFromForMode = (input: {
  mode: TrajectoryMode;
  bestPassingRound?: number;
  lastStableRound?: number;
}): TrajectoryRestartFrom => {
  if (input.mode === "pivot" || input.mode === "parallel_pivot") {
    if (input.bestPassingRound !== undefined) {
      return "best_passing";
    }
    if (input.lastStableRound !== undefined) {
      return "last_stable";
    }
  }
  return "current_head";
};

const anchorReasonForRestart = (input: {
  restartFrom: TrajectoryRestartFrom;
  round: number;
  bestPassingRound?: number;
  lastStableRound?: number;
}): { selectedRound?: number; anchorReason: string } => {
  if (input.restartFrom === "best_passing") {
    return {
      selectedRound: input.bestPassingRound,
      anchorReason:
        input.bestPassingRound !== undefined
          ? `Restart from round ${input.bestPassingRound}, the strongest contract-complete baseline recorded so far.`
          : "No passing baseline exists yet, so stay on the current head."
    };
  }
  if (input.restartFrom === "last_stable") {
    return {
      selectedRound: input.lastStableRound,
      anchorReason:
        input.lastStableRound !== undefined
          ? `Restart from round ${input.lastStableRound}, the latest stable remediation boundary.`
          : "No stable baseline exists yet, so stay on the current head."
    };
  }
  return {
    selectedRound: input.round,
    anchorReason:
      "Continue from the current head and keep the existing implementation lineage."
  };
};

const reasonForTrajectory = (input: {
  patchRequest: PatchRequestArtifact;
  qualityCritique: QualityCritiqueArtifact;
  failureLineage?: FailureLineage;
  mode: TrajectoryMode;
}): string => {
  const policyReasons = input.failureLineage?.policy_snapshot?.reasons ?? [];
  if (policyReasons.length > 0) {
    return policyReasons.join(" ");
  }
  if (input.patchRequest.next_action === "complete") {
    return "The contract completed cleanly, so preserve the strongest signals and keep any follow-up polish bounded.";
  }
  if (input.qualityCritique.findings.length > 0) {
    return input.qualityCritique.findings[0].summary;
  }
  return input.mode === "refine"
    ? "Refine the current direction without reopening the broad contract."
    : input.mode === "tighten"
      ? "Close the carried failures on the current head before widening scope."
      : "Re-open the direction of travel instead of continuing patch-only drift.";
};

export const fallbackTrajectoryDirective = (input: {
  previousPatchRequest?: PatchRequestArtifact;
  remediationHistory?: RemediationHistory;
}): TrajectoryDirective => {
  const preserveSignals = unique([
    ...(input.previousPatchRequest?.preserve_signals ?? []),
    ...(input.previousPatchRequest?.must_preserve ?? [])
  ]).slice(0, 8);
  const discardableSurface = unique(
    input.previousPatchRequest?.must_fix.map((item) => item.expected_change) ?? []
  ).slice(0, 6);
  let mode: TrajectoryMode = "tighten";
  if (input.remediationHistory?.policy_snapshot?.recommended_action === "recontract") {
    mode = isParallelPivotTrigger(
      input.remediationHistory.policy_snapshot.dominant_trigger_code
    )
      ? "parallel_pivot"
      : "pivot";
  } else if (input.previousPatchRequest?.remediation_strategy === "refine") {
    mode = "refine";
  } else if (input.previousPatchRequest?.remediation_strategy === "pivot") {
    mode = "pivot";
  }

  return {
    mode,
    restart_from: "current_head",
    preserve_signals: preserveSignals,
    discardable_surface:
      mode === "pivot" || mode === "parallel_pivot" ? discardableSurface : [],
    novelty_target: noveltyTargetForMode(mode),
    reason:
      input.remediationHistory?.policy_snapshot?.reasons.join(" ") ||
      input.previousPatchRequest?.promotion_rule ||
      "No persisted trajectory decision exists yet."
  };
};

export const buildTrajectoryDecisionArtifact = (input: {
  round: number;
  contractId: string;
  history: readonly RoundSummary[];
  currentRound: TrajectoryRoundCandidate;
  patchRequest: PatchRequestArtifact;
  qualityCritique: QualityCritiqueArtifact;
  failureLineage?: FailureLineage;
}): TrajectoryDecisionArtifact => {
  const candidates = [...input.history, input.currentRound];
  const lastStable = [...candidates].reverse().find((round) => isStableRound(round));
  const bestPassing = [...candidates]
    .filter((round) => isPassingRound(round))
    .sort((left, right) => {
      if (right.release_score !== left.release_score) {
        return right.release_score - left.release_score;
      }
      if (right.total_score !== left.total_score) {
        return right.total_score - left.total_score;
      }
      return right.round - left.round;
    })[0];

  let mode: TrajectoryMode;
  let decisionSource: TrajectoryDecisionArtifact["decision_source"];

  if (input.patchRequest.next_action === "complete") {
    mode = "refine";
    decisionSource = "terminal_complete";
  } else if (
    input.failureLineage?.policy_snapshot?.recommended_action === "recontract" ||
    input.qualityCritique.remediation_strategy === "pivot"
  ) {
    mode = modeForFailurePolicy(input.failureLineage, "pivot");
    decisionSource = input.failureLineage?.policy_snapshot ? "failure_policy" : "quality_critique";
  } else if (input.qualityCritique.remediation_strategy === "refine") {
    mode = "refine";
    decisionSource = "quality_critique";
  } else {
    mode = "tighten";
    decisionSource = "quality_critique";
  }

  const restartFrom = restartFromForMode({
    mode,
    bestPassingRound: bestPassing?.round,
    lastStableRound: lastStable?.round
  });
  const { selectedRound, anchorReason } = anchorReasonForRestart({
    restartFrom,
    round: input.round,
    bestPassingRound: bestPassing?.round,
    lastStableRound: lastStable?.round
  });
  const preserveSignals = unique([
    ...input.qualityCritique.preserve_signals,
    ...input.patchRequest.must_preserve
  ]).slice(0, 8);
  const discardableSurface = unique([
    ...input.patchRequest.must_fix.map((item) => item.expected_change),
    ...input.qualityCritique.findings.map((finding) => finding.summary)
  ]).slice(0, 6);

  return {
    trajectory_id: `${input.contractId}-trajectory-decision`,
    contract_id: input.contractId,
    round: input.round,
    mode,
    restart_from: restartFrom,
    preserve_signals: preserveSignals,
    discardable_surface:
      mode === "pivot" || mode === "parallel_pivot" ? discardableSurface : [],
    novelty_target: noveltyTargetForMode(mode),
    reason: reasonForTrajectory({
      patchRequest: input.patchRequest,
      qualityCritique: input.qualityCritique,
      failureLineage: input.failureLineage,
      mode
    }),
    decision_source: decisionSource,
    ...(selectedRound !== undefined ? { selected_round: selectedRound } : {}),
    frontier: {
      current_head: input.round,
      ...(lastStable ? { last_stable: lastStable.round } : {}),
      ...(bestPassing ? { best_passing: bestPassing.round } : {})
    },
    anchor_reason: anchorReason
  };
};
