import type { ActiveContractFrame, AttemptLifecycleDecision, RemediationHistory, PatchRequestArtifact, RoundContractArtifact, ContractAgreementArtifact, TrajectoryDecisionArtifact } from "./types.js";
export declare const targetCheckIdsFromPatchRequest: (patchRequest?: PatchRequestArtifact) => string[];
export declare const unresolvedSignatureFor: (unresolvedCheckIds: readonly string[]) => string | undefined;
export declare const decideAttemptLifecycle: (input: {
    round: number;
    previousPatchRequest?: PatchRequestArtifact;
    previousTrajectoryDecision?: TrajectoryDecisionArtifact;
    hasActiveContractFrame: boolean;
    remediationHistory?: RemediationHistory;
}) => AttemptLifecycleDecision;
export declare const buildActiveContractFrame: (input: {
    round: number;
    contractArtifact: RoundContractArtifact;
    contractAgreementArtifact: ContractAgreementArtifact;
}) => ActiveContractFrame;
//# sourceMappingURL=attempt-lifecycle.d.ts.map