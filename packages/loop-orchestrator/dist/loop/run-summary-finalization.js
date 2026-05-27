export const currentBestForRunCheckpoint = (input) => {
    const latestRoundSummary = input.history[input.history.length - 1];
    return {
        round: latestRoundSummary?.round,
        totalScore: latestRoundSummary?.total_score ?? input.bestScore,
        controlPlaneScore: latestRoundSummary?.control_plane_score ?? input.bestControlPlaneScore,
        proofScore: latestRoundSummary?.proof_score ?? input.bestProofScore,
        releaseScore: latestRoundSummary?.release_score ?? input.bestReleaseScore,
        thresholdResults: latestRoundSummary?.threshold_results ?? input.bestThresholdResults,
        dimensionScores: latestRoundSummary?.dimension_scores ?? input.bestDimensionScores,
        patchRequestPath: latestRoundSummary?.patch_request_path ?? input.bestPatchRequestPath,
        evalReportPath: latestRoundSummary?.eval_report_path ?? input.bestEvalReportPath,
        bestScoringRound: input.bestRound,
        bestScoringTotalScore: input.bestScore ?? input.bestScoringTotalScoreFallback,
        bestScoringControlPlaneScore: input.bestControlPlaneScore,
        bestScoringProofScore: input.bestProofScore,
        bestScoringReleaseScore: input.bestReleaseScore,
        bestScoringThresholdResults: input.bestThresholdResults,
        bestScoringDimensionScores: input.bestDimensionScores,
        bestScoringPatchRequestPath: input.bestPatchRequestPath,
        bestScoringEvalReportPath: input.bestEvalReportPath
    };
};
//# sourceMappingURL=run-summary-finalization.js.map