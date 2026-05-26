import type { AdapterMigrationApplied, AdapterMigrationProposal, AdapterMigrationResponse, AdapterDriftReport, ContractAgreementArtifact, ContractReviewArtifact, BuildBriefArtifact, EvalReport, EvaluatorVerdictArtifact, FailureLineage, GeneratorPlanArtifact, LoadedAdapterContract, LoopRubric, PatchRequestArtifact, QualityCritiqueArtifact, TrajectoryDecisionArtifact, RoundArtifacts, RoundContractArtifact, RoundResultArtifact } from "./types.js";
export declare const PROTOCOL_ARTIFACT_SCHEMA_VERSION = "2026-05-08";
export declare const artifactsForRound: (roundDirectory: string) => RoundArtifacts;
export declare const buildRoundContractArtifact: (input: {
    runId: string;
    round: number;
    negotiationMode: RoundContractArtifact["negotiation_mode"];
    continuationAuthority: RoundContractArtifact["continuation_authority"];
    recontractReason?: RoundContractArtifact["recontract_reason"];
    trajectory: RoundContractArtifact["trajectory"];
    contract: {
        contract_id: string;
        attempt_kind: RoundContractArtifact["attempt_kind"];
        objective: string;
        rewrite_scope: RoundContractArtifact["rewrite_scope"];
        focus_areas: RoundContractArtifact["focus_areas"];
        acceptance_checks: string[];
        notes: string[];
        carry_over_patch_ids?: string[];
        carry_over_check_ids?: string[];
    };
    rubric: LoopRubric;
    loadedAdapter?: LoadedAdapterContract;
    previousPatchRequest?: PatchRequestArtifact;
    sessionKind?: "harness" | "product_build";
    productTargetRoot?: string;
}) => RoundContractArtifact;
export declare const buildGeneratorPlanArtifact: (input: {
    contractArtifact: RoundContractArtifact;
    contractAgreementArtifact: ContractAgreementArtifact;
    previousPatchRequest?: PatchRequestArtifact;
    trajectory: GeneratorPlanArtifact["trajectory"];
    adapterAttached: boolean;
    sessionKind?: "harness" | "product_build";
    targetRoot?: string;
    buildBrief?: BuildBriefArtifact;
}) => GeneratorPlanArtifact;
export declare const buildQualityCritiqueArtifact: (input: {
    round: number;
    contractArtifact: RoundContractArtifact;
    evalReport: EvalReport;
    loadedAdapter?: LoadedAdapterContract;
    failureLineage?: FailureLineage;
}) => QualityCritiqueArtifact;
export declare const buildEvaluatorVerdictArtifact: (input: {
    contractArtifact: RoundContractArtifact;
    evalReport: EvalReport;
}) => EvaluatorVerdictArtifact;
export declare const buildPatchRequestArtifact: (input: {
    round: number;
    evalReport: EvalReport;
    evaluatorVerdictArtifact: EvaluatorVerdictArtifact;
    qualityCritiqueArtifact: QualityCritiqueArtifact;
    adapterAttached: boolean;
    staticContractBlockers?: string[];
    failureLineage?: FailureLineage;
    adapterDriftReport?: AdapterDriftReport;
}) => PatchRequestArtifact;
export declare const buildRoundResultArtifact: (input: {
    roundDirectory: string;
    round: number;
    contractAgreementArtifact: ContractAgreementArtifact;
    generatorPlanArtifact: GeneratorPlanArtifact;
    evaluatorVerdictArtifact: EvaluatorVerdictArtifact;
    patchRequestArtifact: PatchRequestArtifact;
    qualityCritiqueArtifact: QualityCritiqueArtifact;
    evalReport: EvalReport;
    selectedForRun: boolean;
    previousPatchRequestAddressed: boolean;
    previousPatchRequestResolved: boolean;
}) => RoundResultArtifact;
export declare const writeNegotiationArtifacts: (input: {
    roundDirectory: string;
    contractArtifact: RoundContractArtifact;
    contractReviewArtifact: ContractReviewArtifact;
    contractAgreementArtifact: ContractAgreementArtifact;
    generatorPlanArtifact: GeneratorPlanArtifact;
    persistContractReviewArtifact?: boolean;
    persistContractAgreementArtifact?: boolean;
}) => Promise<RoundArtifacts>;
export declare const writeRoundEvaluationPlaceholders: (input: {
    roundDirectory: string;
}) => Promise<RoundArtifacts>;
export declare const writeAdapterMigrationProposalArtifacts: (input: {
    roundDirectory: string;
    proposal: AdapterMigrationProposal;
    responseTemplate?: AdapterMigrationResponse;
}) => Promise<RoundArtifacts>;
export declare const writeRoundArtifacts: (input: {
    roundDirectory: string;
    evaluatorVerdictArtifact: EvaluatorVerdictArtifact;
    patchRequestArtifact: PatchRequestArtifact;
    qualityCritiqueArtifact: QualityCritiqueArtifact;
    trajectoryDecisionArtifact: TrajectoryDecisionArtifact;
    roundResultArtifact: RoundResultArtifact;
    evalReport: EvalReport;
    failureLineage?: FailureLineage;
    adapterDriftReport?: AdapterDriftReport;
    adapterMigrationProposal?: AdapterMigrationProposal;
    adapterMigrationApplied?: AdapterMigrationApplied;
}) => Promise<RoundArtifacts>;
//# sourceMappingURL=protocol-artifacts.d.ts.map