import type { ActiveContractFrame, ControllerLeaseArtifact, ControllerRoundPhase, EvalReport, FailureLineage, LoadedAdapterContract, LoopPlan, LoopRubric, LoopRunSummary, LoopScenario, PatchRequestArtifact, ReleaseThresholdResults, RemediationHistory, RuntimeLiveStateArtifact, RuntimeRoundPhaseArtifact, RoundSummary, SupervisorStateArtifact, TransportStateArtifact, TrajectoryDecisionArtifact } from "./types.js";
export interface RestoredRunState {
    runDirectory: string;
    runId: string;
    summary: LoopRunSummary;
    scenario?: LoopScenario;
    plan?: LoopPlan;
    rubric: LoopRubric;
    plannedScenarioPath: string;
    planPath: string;
    plannerBriefPath: string;
    initializationIncomplete: boolean;
    initializationMissingArtifacts: string[];
    previousPatchRequest?: PatchRequestArtifact;
    previousPatchRequestPath?: string;
    previousTrajectoryDecision?: TrajectoryDecisionArtifact;
    previousTrajectoryDecisionPath?: string;
    activeContractFrame?: ActiveContractFrame;
    latestEvalReport?: EvalReport;
    latestFailureLineage?: FailureLineage;
    previousFailureLineage?: FailureLineage;
    latestRoundSummary?: RoundSummary;
    previousRoundSummary?: RoundSummary;
    bestScore?: number;
    bestControlPlaneScore: number;
    bestProofScore: number;
    bestReleaseScore: number;
    bestThresholdResults?: ReleaseThresholdResults;
    bestRound: number;
    bestEvalReportPath: string;
    bestPatchRequestPath: string;
    plateauCount: number;
    repeatedUnresolvedCount: number;
    roundStart: number;
    summaryWasRecovered: boolean;
    repairNotes: string[];
    runtimeLiveState?: RuntimeLiveStateArtifact;
    runtimeRoundPhase?: RuntimeRoundPhaseArtifact;
    controllerLease?: ControllerLeaseArtifact;
    transportState?: TransportStateArtifact;
    supervisorState?: SupervisorStateArtifact;
    interruptedRound?: {
        round: number;
        roundDirectory: string;
        resumeFromPhase: ControllerRoundPhase;
        phaseStatus: RuntimeRoundPhaseArtifact["status"];
    };
}
export declare const failureLineageForEvalReport: (input: EvalReport | {
    evalReport?: EvalReport;
    loadedAdapter?: LoadedAdapterContract;
    previousRoundSummary?: RoundSummary;
}) => FailureLineage | undefined;
export declare const restoreRunState: (runPath: string) => Promise<RestoredRunState>;
export declare const buildRemediationHistory: (input: {
    previousPatchRequest?: PatchRequestArtifact;
    activeContractFrame?: ActiveContractFrame;
    latestFailureLineage?: FailureLineage;
    repeatedUnresolvedCount: number;
    scoreDeltas: number[];
}) => RemediationHistory | undefined;
export declare const scoreDeltasForHistory: (history: readonly RoundSummary[]) => number[];
//# sourceMappingURL=resume-state.d.ts.map