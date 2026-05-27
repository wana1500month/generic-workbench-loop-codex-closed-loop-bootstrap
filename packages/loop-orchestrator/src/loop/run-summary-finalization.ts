import type {
  LoopRunSummary,
  ReleaseThresholdResults,
  RoundSummary
} from "../types.js";

export interface RunCheckpointCurrentBest {
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
}

export const currentBestForRunCheckpoint = (input: {
  history: RoundSummary[];
  bestRound?: number;
  bestScore?: number;
  bestControlPlaneScore?: number;
  bestProofScore?: number;
  bestReleaseScore?: number;
  bestThresholdResults?: ReleaseThresholdResults;
  bestDimensionScores?: LoopRunSummary["dimension_scores"];
  bestPatchRequestPath?: string;
  bestEvalReportPath?: string;
  bestScoringTotalScoreFallback?: number;
}): RunCheckpointCurrentBest => {
  const latestRoundSummary = input.history[input.history.length - 1];
  return {
    round: latestRoundSummary?.round,
    totalScore: latestRoundSummary?.total_score ?? input.bestScore,
    controlPlaneScore:
      latestRoundSummary?.control_plane_score ?? input.bestControlPlaneScore,
    proofScore: latestRoundSummary?.proof_score ?? input.bestProofScore,
    releaseScore: latestRoundSummary?.release_score ?? input.bestReleaseScore,
    thresholdResults:
      latestRoundSummary?.threshold_results ?? input.bestThresholdResults,
    dimensionScores: latestRoundSummary?.dimension_scores ?? input.bestDimensionScores,
    patchRequestPath:
      latestRoundSummary?.patch_request_path ?? input.bestPatchRequestPath,
    evalReportPath: latestRoundSummary?.eval_report_path ?? input.bestEvalReportPath,
    bestScoringRound: input.bestRound,
    bestScoringTotalScore:
      input.bestScore ?? input.bestScoringTotalScoreFallback,
    bestScoringControlPlaneScore: input.bestControlPlaneScore,
    bestScoringProofScore: input.bestProofScore,
    bestScoringReleaseScore: input.bestReleaseScore,
    bestScoringThresholdResults: input.bestThresholdResults,
    bestScoringDimensionScores: input.bestDimensionScores,
    bestScoringPatchRequestPath: input.bestPatchRequestPath,
    bestScoringEvalReportPath: input.bestEvalReportPath
  };
};
