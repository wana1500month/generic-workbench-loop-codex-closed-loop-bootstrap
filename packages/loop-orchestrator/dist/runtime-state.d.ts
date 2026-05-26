import type { ControllerLeaseArtifact, ControllerMode, ControllerPhaseStatus, ControllerRoundPhase, ExecutionState, ExecutorMode, OperatorSurfaceArtifact, RunStopReason, SupervisorStateArtifact, TransportMode, TransportStateArtifact, RuntimeLiveStateArtifact, RuntimeRoundPhaseArtifact } from "./types.js";
export interface RuntimeStatePaths {
    runtimeDirectory: string;
    controllerLeasePath: string;
    liveStatePath: string;
    roundPhasePath: string;
    transportStatePath: string;
    supervisorStatePath: string;
    buildBriefPath: string;
    runContractPath: string;
    openQuestionsPath: string;
    sessionStatusPath: string;
    sessionStatusEventsPath: string;
    sessionStreamPath: string;
    appServerSessionEventsPath: string;
    operatorSurfacePath: string;
    operatorSurfaceMarkdownPath: string;
    plannerEnhancementTaskPath: string;
    plannerEnhancementPromptPath: string;
    plannerEnhancementResponsePath: string;
}
export interface RuntimeHeartbeatSnapshot {
    roundCount: number;
    round?: number;
    phase?: ControllerRoundPhase;
    phaseStatus?: ControllerPhaseStatus;
    executionState: ExecutionState;
    leaseStatus: ControllerLeaseArtifact["status"];
    lastProgressAt?: string;
    lastProgressNote?: string;
    phaseTimeoutMs?: number;
    stallThresholdMs?: number;
    phaseStartedAt?: string;
    latestRoundSummaryPath?: string;
    latestEvalReportPath?: string;
    bestRound?: number;
    bestTotalScore?: number;
    stopReason?: RunStopReason;
    summaryPath?: string;
    notes?: string[];
}
export interface RuntimeHeartbeatController {
    tick: () => Promise<void>;
    stop: (status?: ControllerLeaseArtifact["status"]) => Promise<void>;
}
export declare const runtimeStatePathsForRun: (runDirectory: string) => RuntimeStatePaths;
export declare const readRuntimeRoundPhaseArtifact: (path: string) => Promise<RuntimeRoundPhaseArtifact | undefined>;
export declare const readRuntimeLiveStateArtifact: (path: string) => Promise<RuntimeLiveStateArtifact | undefined>;
export declare const readControllerLeaseArtifact: (path: string) => Promise<ControllerLeaseArtifact | undefined>;
export declare const readTransportStateArtifact: (path: string) => Promise<TransportStateArtifact | undefined>;
export declare const readSupervisorStateArtifact: (path: string) => Promise<SupervisorStateArtifact | undefined>;
export declare const readOperatorSurfaceArtifact: (path: string) => Promise<OperatorSurfaceArtifact | undefined>;
export declare const writeRuntimeRoundPhaseArtifact: (path: string, artifact: RuntimeRoundPhaseArtifact) => Promise<void>;
export declare const writeRuntimeLiveStateArtifact: (path: string, artifact: RuntimeLiveStateArtifact) => Promise<void>;
export declare const writeControllerLeaseArtifact: (path: string, artifact: ControllerLeaseArtifact) => Promise<void>;
export declare const writeTransportStateArtifact: (path: string, artifact: TransportStateArtifact) => Promise<void>;
export declare const writeSupervisorStateArtifact: (path: string, artifact: SupervisorStateArtifact) => Promise<void>;
export declare const writeOperatorSurfaceArtifact: (path: string, artifact: OperatorSurfaceArtifact) => Promise<void>;
export declare const startRuntimeHeartbeat: (input: {
    runId: string;
    controllerMode: ControllerMode;
    transportMode: TransportMode;
    executorMode?: ExecutorMode;
    paths: RuntimeStatePaths;
    getSnapshot: () => RuntimeHeartbeatSnapshot;
    intervalMs?: number;
}) => RuntimeHeartbeatController;
//# sourceMappingURL=runtime-state.d.ts.map