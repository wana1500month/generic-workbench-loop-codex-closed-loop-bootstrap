import type { ContractReviewArtifact, EvalReport, PatchRequestArtifact, QualityCritiqueArtifact } from "../types.js";
export declare const reviewFeedbackFromArtifacts: (input: {
    contractReviewArtifact?: ContractReviewArtifact;
    patchRequestArtifact?: PatchRequestArtifact;
    qualityCritiqueArtifact?: QualityCritiqueArtifact;
    evalReport?: EvalReport;
}) => string[];
export declare const steeringNotesFromContractReview: (contractReviewArtifact: ContractReviewArtifact | undefined) => string[];
export declare const externalBlockersFromPatchRequest: (patchRequestArtifact: PatchRequestArtifact | undefined) => string[];
export declare const scopeGuardrailsFromPatchRequest: (patchRequestArtifact: PatchRequestArtifact | undefined) => string[];
//# sourceMappingURL=runtime-warning-summary.d.ts.map