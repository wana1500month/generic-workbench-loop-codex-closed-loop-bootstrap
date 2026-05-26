import type { AdapterDriftReport, ContractReviewArtifact, FailureLineage } from "./types.js";
export declare const buildAdapterDriftReport: (input: {
    contractId: string;
    round: number;
    contractReviewArtifact: ContractReviewArtifact;
    failureLineage?: FailureLineage;
}) => AdapterDriftReport | undefined;
//# sourceMappingURL=adapter-drift.d.ts.map