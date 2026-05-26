import type { AdapterCapabilityExecution, CoreVerificationProbeExecution, ContractAgreementArtifact, ContractReviewArtifact, EvalReport, LoadedAdapterContract, LoopRubric, RoundArtifacts, RoundContractArtifact, TargetManifest } from "../types.js";
export declare const buildEvalReport: (input: {
    round: number;
    rubric: LoopRubric;
    contractArtifact: RoundContractArtifact;
    contractReviewArtifact: ContractReviewArtifact;
    contractAgreementArtifact: ContractAgreementArtifact;
    artifacts: RoundArtifacts;
    plannerBriefPath: string;
    planPath: string;
    loadedAdapter?: LoadedAdapterContract;
    adapterExecutions: AdapterCapabilityExecution[];
    coreProbeResults: CoreVerificationProbeExecution[];
    targetManifest?: TargetManifest;
    previousPatchTargetCheckIds: string[];
    previousPatchRequestAddressed: boolean;
}) => EvalReport;
//# sourceMappingURL=eval-report.d.ts.map