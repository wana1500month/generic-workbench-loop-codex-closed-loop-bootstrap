import type { FailureLineage, LoopRunSummary, PatchRequestArtifact, ReleaseThresholdResults, RoundSummary } from "../types.js";
export interface RoundTargetDecisionState {
    score: number;
    controlPlaneScore: number;
    proofScore: number;
    verdict: RoundSummary["overall_verdict"];
    unresolvedCheckIds: string[];
    patchNextAction?: PatchRequestArtifact["next_action"];
    patchMustFixCount: number;
    thresholdResults?: ReleaseThresholdResults;
    failureLineage?: FailureLineage;
    staticAdapterContractInvalid?: boolean;
}
export declare const stopReasonForRoundTargetDecision: (input: {
    state: RoundTargetDecisionState;
    plateauCount: number;
    plateauLimit: number;
    completedRounds: number;
    maxRounds: number;
}) => LoopRunSummary["stop_reason"] | undefined;
export declare const stopReasonForMissingRoundTargetDecision: (input: {
    state?: RoundTargetDecisionState;
    plateauCount: number;
    plateauLimit: number;
    completedRounds: number;
    maxRounds: number;
}) => LoopRunSummary["stop_reason"] | undefined;
//# sourceMappingURL=round-target-decision.d.ts.map