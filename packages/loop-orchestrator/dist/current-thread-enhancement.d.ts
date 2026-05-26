import type { RuntimeStatePaths } from "./runtime-state.js";
import type { AdapterCapabilityExecution, ContractAgreementArtifact, ContractReviewArtifact, CoreVerificationProbeExecution, CurrentThreadCheckpointKind, EvalReport, ExecutorMode, GeneratorPlanArtifact, IdeaBrief, LoadedAdapterContract, LoopPlan, LoopRubric, LoopScenario, PatchRequestArtifact, RoundArtifacts, RoundContractArtifact, TargetManifest } from "./types.js";
export type CurrentThreadEnhancementOutcome<T> = {
    kind: "completed";
    value: T;
    runtimeWarnings: string[];
} | {
    kind: "checkpoint";
    consumer: "codex";
    checkpointKind: CurrentThreadCheckpointKind;
    autoResumeEligible: true;
    notes: string[];
    artifacts: Record<string, string>;
};
export declare const enhancePlanWithCurrentThread: (input: {
    runId: string;
    transportProtocolPath?: string;
    runtimePaths: RuntimeStatePaths;
    plannedScenarioPath: string;
    planPath: string;
    idea: IdeaBrief;
    rubric: LoopRubric;
    scenario: LoopScenario;
    plan: LoopPlan;
    executorMode: ExecutorMode;
}) => Promise<CurrentThreadEnhancementOutcome<{
    scenario: LoopScenario;
    plan: LoopPlan;
}>>;
export declare const enhanceContractReviewWithCurrentThread: (input: {
    runId: string;
    round: number;
    transportProtocolPath?: string;
    artifacts: RoundArtifacts;
    contractArtifact: RoundContractArtifact;
    contractReviewArtifact: ContractReviewArtifact;
    loadedAdapter?: LoadedAdapterContract;
    executorMode: ExecutorMode;
}) => Promise<CurrentThreadEnhancementOutcome<ContractReviewArtifact>>;
export declare const enhanceGeneratorPlanWithCurrentThread: (input: {
    runId: string;
    round: number;
    transportProtocolPath?: string;
    artifacts: RoundArtifacts;
    idea: IdeaBrief;
    contractArtifact: RoundContractArtifact;
    contractAgreementArtifact: ContractAgreementArtifact;
    generatorPlanArtifact: GeneratorPlanArtifact;
    previousPatchRequest?: PatchRequestArtifact;
    executorMode: ExecutorMode;
}) => Promise<CurrentThreadEnhancementOutcome<GeneratorPlanArtifact>>;
export declare const enhanceEvalReportWithCurrentThread: (input: {
    runId: string;
    round: number;
    transportProtocolPath?: string;
    artifacts: RoundArtifacts;
    idea: IdeaBrief;
    contractArtifact: RoundContractArtifact;
    generatorPlanArtifact: GeneratorPlanArtifact;
    evalReport: EvalReport;
    adapterExecutions: AdapterCapabilityExecution[];
    coreProbeResults: CoreVerificationProbeExecution[];
    targetManifest?: TargetManifest;
    executorMode: ExecutorMode;
}) => Promise<CurrentThreadEnhancementOutcome<EvalReport>>;
//# sourceMappingURL=current-thread-enhancement.d.ts.map