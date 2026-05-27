import type { AppServerTransportController } from "../app-server-runtime.js";
import type { EvaluationPolicy, RoundScorecard } from "../evaluation-policy.js";
import type { AdapterCapabilityExecution, AdapterDriftReport, AdapterMigrationApplied, AdapterMigrationProposal, ActiveContractFrame, ClosedLoopResult, ContractAgreementArtifact, ContractReviewArtifact, CoreVerificationProbeExecution, ControllerPhaseStatus, ControllerRoundPhase, CurrentThreadCheckpointKind, EvalReport, EvaluatorVerdictArtifact, ExecutorMode, FailureLineage, GeneratorPlanArtifact, LoadedAdapterContract, LoopRubric, PatchRequestArtifact, QualityCritiqueArtifact, RoundArtifacts, RoundContractArtifact, RoundResultArtifact, RoundSummary, TargetManifest, TrajectoryDecisionArtifact, TransportMode } from "../types.js";
type WithPhaseBudget = <T>(phase: ControllerRoundPhase, work: () => Promise<T>) => Promise<T>;
type RecordRoundPhase = (input: {
    round: number;
    phase: ControllerRoundPhase;
    status: ControllerPhaseStatus;
    artifacts?: Record<string, string>;
    notes?: string[];
}) => Promise<void>;
type CheckpointForCurrentThreadWork = (input: {
    round: number;
    phase: ControllerRoundPhase;
    checkpointKind: CurrentThreadCheckpointKind;
    artifacts: Record<string, string>;
    notes: string[];
}) => Promise<ClosedLoopResult>;
export type EvaluatorStepResult = {
    checkpointResult: ClosedLoopResult;
} | {
    checkpointResult?: undefined;
    evalReport: EvalReport;
    previousPatchRequestResolved: boolean;
    evaluatorVerdictArtifact: EvaluatorVerdictArtifact;
    qualityCritiqueArtifact: QualityCritiqueArtifact;
    patchRequestArtifact: PatchRequestArtifact;
    trajectoryDecisionArtifact: TrajectoryDecisionArtifact;
    roundResultArtifact: RoundResultArtifact;
    roundScorecard?: RoundScorecard;
    failureLineage?: FailureLineage;
    adapterDriftReport?: AdapterDriftReport;
    adapterMigrationStopPreview?: AdapterMigrationProposal;
    runtimeWarnings: string[];
};
export declare const runEvaluatorStep: (input: {
    resumedRoundPhase: {
        phase: ControllerRoundPhase;
        status: ControllerPhaseStatus;
    } | undefined;
    artifacts: RoundArtifacts;
    roundDirectory: string;
    round: number;
    rubric: LoopRubric;
    contractArtifact: RoundContractArtifact;
    contractReviewArtifact: ContractReviewArtifact;
    contractAgreementArtifact: ContractAgreementArtifact;
    generatorPlanArtifact: GeneratorPlanArtifact;
    plannerBriefPath: string;
    planPath: string;
    loadedAdapter?: LoadedAdapterContract;
    adapterExecutions: AdapterCapabilityExecution[];
    coreProbeResults: CoreVerificationProbeExecution[];
    targetManifest?: TargetManifest;
    previousPatchTargetCheckIds: string[];
    previousPatchRequestAddressed: boolean;
    evaluationPolicy?: EvaluationPolicy;
    activeContractFrame?: ActiveContractFrame;
    history: RoundSummary[];
    scoreDeltas: number[];
    plateauCount: number;
    plateauLimit: number;
    bestScore?: number;
    previousRoundSummary?: RoundSummary;
    adapterMigrationProposal?: AdapterMigrationProposal;
    adapterMigrationApplied?: AdapterMigrationApplied;
    runId: string;
    transportMode: TransportMode;
    transportProtocolCurrentPath: string;
    appServerTransport?: AppServerTransportController;
    idea: import("../types.js").IdeaBrief;
    executorMode: ExecutorMode;
    withPhaseBudget: WithPhaseBudget;
    recordRoundPhase: RecordRoundPhase;
    checkpointForCurrentThreadWork: CheckpointForCurrentThreadWork;
    markProgress(note: string): Promise<void>;
}) => Promise<EvaluatorStepResult>;
export {};
//# sourceMappingURL=evaluator-step.d.ts.map