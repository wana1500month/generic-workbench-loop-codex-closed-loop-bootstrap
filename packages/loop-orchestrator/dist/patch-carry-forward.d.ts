import type { ActiveContractFrame, ContractAgreementArtifact, ContractReviewArtifact, LoopImprovementContract, PatchRequestArtifact, RoundContractArtifact } from "./types.js";
export declare const buildPatchCarryForwardContract: (input: {
    scenarioId: string;
    round: number;
    activeContractFrame: ActiveContractFrame;
    previousPatchRequest: PatchRequestArtifact;
}) => LoopImprovementContract;
export declare const buildSyntheticPatchCarryForwardReview: (input: {
    contractArtifact: RoundContractArtifact;
    previousPatchRequest: PatchRequestArtifact;
    reason: string;
}) => ContractReviewArtifact;
export declare const buildSyntheticPatchCarryForwardAgreement: (input: {
    contractArtifact: RoundContractArtifact;
    previousPatchRequest: PatchRequestArtifact;
}) => ContractAgreementArtifact;
//# sourceMappingURL=patch-carry-forward.d.ts.map