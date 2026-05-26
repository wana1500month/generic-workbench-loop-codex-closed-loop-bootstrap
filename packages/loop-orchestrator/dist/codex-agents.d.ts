import type { AppServerTransportController } from "./app-server-runtime.js";
import { experimentalExecutorRuntimeWarning } from "./codex-agent-manifest.js";
import type { AdapterCapabilityExecution, ContractAgreementArtifact, ContractReviewArtifact, CoreVerificationProbeExecution, EvalReport, ExecutorMode, GeneratorPlanArtifact, IdeaBrief, LoadedAdapterContract, LoopPlan, LoopRubric, LoopScenario, PatchRequestArtifact, RoundContractArtifact, TargetManifest } from "./types.js";
export type EnhancementResult<T> = {
    value: T;
    runtimeWarnings: string[];
};
export declare const enhancePlanWithCodex: (input: {
    runDirectory: string;
    idea: IdeaBrief;
    rubric: LoopRubric;
    scenario: LoopScenario;
    plan: LoopPlan;
    executorMode: ExecutorMode;
}) => Promise<EnhancementResult<{
    scenario: LoopScenario;
    plan: LoopPlan;
}>>;
export declare const enhanceContractReviewWithCodex: (input: {
    roundDirectory: string;
    contractArtifact: RoundContractArtifact;
    contractReviewArtifact: ContractReviewArtifact;
    loadedAdapter?: LoadedAdapterContract;
    executorMode: ExecutorMode;
}) => Promise<EnhancementResult<ContractReviewArtifact>>;
export declare const enhanceGeneratorPlanWithCodex: (input: {
    roundDirectory: string;
    idea: IdeaBrief;
    contractArtifact: RoundContractArtifact;
    contractAgreementArtifact: ContractAgreementArtifact;
    generatorPlanArtifact: GeneratorPlanArtifact;
    previousPatchRequest?: PatchRequestArtifact;
    executorMode: ExecutorMode;
}) => Promise<EnhancementResult<GeneratorPlanArtifact>>;
export declare const enhanceEvalReportWithCodex: (input: {
    roundDirectory: string;
    idea: IdeaBrief;
    contractArtifact: RoundContractArtifact;
    generatorPlanArtifact: GeneratorPlanArtifact;
    evalReport: EvalReport;
    adapterExecutions: AdapterCapabilityExecution[];
    coreProbeResults: CoreVerificationProbeExecution[];
    targetManifest?: TargetManifest;
    executorMode: ExecutorMode;
}) => Promise<EnhancementResult<EvalReport>>;
export declare const enhancePlanWithAppServer: (input: {
    transport: AppServerTransportController;
    runDirectory: string;
    idea: IdeaBrief;
    rubric: LoopRubric;
    scenario: LoopScenario;
    plan: LoopPlan;
    executorMode: ExecutorMode;
}) => Promise<EnhancementResult<{
    scenario: LoopScenario;
    plan: LoopPlan;
}>>;
export declare const enhanceContractReviewWithAppServer: (input: {
    transport: AppServerTransportController;
    round: number;
    contractArtifact: RoundContractArtifact;
    contractReviewArtifact: ContractReviewArtifact;
    loadedAdapter?: LoadedAdapterContract;
    executorMode: ExecutorMode;
}) => Promise<EnhancementResult<ContractReviewArtifact>>;
export declare const enhanceGeneratorPlanWithAppServer: (input: {
    transport: AppServerTransportController;
    round: number;
    idea: IdeaBrief;
    contractArtifact: RoundContractArtifact;
    contractAgreementArtifact: ContractAgreementArtifact;
    generatorPlanArtifact: GeneratorPlanArtifact;
    previousPatchRequest?: PatchRequestArtifact;
    executorMode: ExecutorMode;
}) => Promise<EnhancementResult<GeneratorPlanArtifact>>;
export declare const enhanceEvalReportWithAppServer: (input: {
    transport: AppServerTransportController;
    round: number;
    idea: IdeaBrief;
    contractArtifact: RoundContractArtifact;
    generatorPlanArtifact: GeneratorPlanArtifact;
    evalReport: EvalReport;
    adapterExecutions: AdapterCapabilityExecution[];
    coreProbeResults: CoreVerificationProbeExecution[];
    targetManifest?: TargetManifest;
    executorMode: ExecutorMode;
}) => Promise<EnhancementResult<EvalReport>>;
export { experimentalExecutorRuntimeWarning };
//# sourceMappingURL=codex-agents.d.ts.map