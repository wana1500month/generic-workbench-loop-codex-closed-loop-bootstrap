import type { LoopRunSummary, ReleaseThresholdResults, RoundSummary } from "../types.js";
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
export declare const currentBestForRunCheckpoint: (input: {
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
}) => RunCheckpointCurrentBest;
//# sourceMappingURL=run-summary-finalization.d.ts.map