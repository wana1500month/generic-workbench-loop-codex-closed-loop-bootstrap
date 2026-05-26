import {
  buildRoundScorecard,
  type EvaluationPolicy,
  type RoundScorecard
} from "../evaluation-policy.js";
import type { EvalReport } from "../types.js";

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

export interface EvaluationPolicyGateResult {
  evalReport: EvalReport;
  scorecard: RoundScorecard;
}

export const applyEvaluationPolicyGate = (input: {
  policy: EvaluationPolicy;
  evalReport: EvalReport;
}): EvaluationPolicyGateResult => {
  const initialScorecard = buildRoundScorecard({
    policy: input.policy,
    evalReport: input.evalReport
  });

  if (initialScorecard.blocking_reasons.length === 0) {
    return {
      evalReport: input.evalReport,
      scorecard: initialScorecard
    };
  }

  const scorecardGapDetails = initialScorecard.blocking_reasons.map(
    (reason) =>
      `Evaluation policy dimension '${reason.dimension_id}' scored ${reason.score} below the minimum ${reason.minimum_score}. ${reason.reason}`
  );
  const gatedEvalReport: EvalReport = {
    ...input.evalReport,
    blockers: unique([
      ...input.evalReport.blockers,
      ...initialScorecard.blocking_reasons.map(
        (reason) => `Required evaluation dimension failed: ${reason.dimension_id}`
      )
    ]),
    next_actions: unique([
      ...initialScorecard.next_round_focus,
      ...input.evalReport.next_actions
    ]).slice(0, 10),
    threshold_gap_details: unique([
      ...input.evalReport.threshold_gap_details,
      ...scorecardGapDetails
    ]),
    threshold_results: {
      ...input.evalReport.threshold_results,
      dimension_thresholds_met: false,
      target_reached_eligible: false
    }
  };

  return {
    evalReport: gatedEvalReport,
    scorecard: buildRoundScorecard({
      policy: input.policy,
      evalReport: gatedEvalReport
    })
  };
};
