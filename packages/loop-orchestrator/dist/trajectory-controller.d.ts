import type { FailureLineage, PatchRequestArtifact, QualityCritiqueArtifact, RemediationHistory, RoundSummary, TrajectoryDecisionArtifact, TrajectoryDirective } from "./types.js";
type TrajectoryRoundCandidate = Pick<RoundSummary, "round" | "total_score" | "release_score" | "overall_verdict" | "previous_patch_request_resolved" | "threshold_results">;
export declare const fallbackTrajectoryDirective: (input: {
    previousPatchRequest?: PatchRequestArtifact;
    remediationHistory?: RemediationHistory;
}) => TrajectoryDirective;
export declare const buildTrajectoryDecisionArtifact: (input: {
    round: number;
    contractId: string;
    history: readonly RoundSummary[];
    currentRound: TrajectoryRoundCandidate;
    patchRequest: PatchRequestArtifact;
    qualityCritique: QualityCritiqueArtifact;
    failureLineage?: FailureLineage;
}) => TrajectoryDecisionArtifact;
export {};
//# sourceMappingURL=trajectory-controller.d.ts.map