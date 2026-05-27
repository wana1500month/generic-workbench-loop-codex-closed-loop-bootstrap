import type { ControllerMode, ControllerPhaseStatus, ControllerRoundPhase, ExecutorMode, TransportMode } from "../types.js";
export interface PersistRoundPhaseInput {
    runId: string;
    roundPhasePath: string;
    controllerMode: ControllerMode;
    transportMode: TransportMode;
    executorMode: ExecutorMode;
    round: number;
    phase: ControllerRoundPhase;
    status: ControllerPhaseStatus;
    updatedAt: string;
    lastProgressAt?: string;
    lastProgressNote?: string;
    activePhaseTimeoutMs?: number;
    activeStallThresholdMs?: number;
    activeHeartbeatPhaseStartedAt?: string;
    appServerThreadId?: string;
    artifacts?: Record<string, string>;
    heartbeatNotes: string[];
    writeLiveTransportProtocol: () => Promise<void>;
    writeOperatorSurface: (input: {
        round: number;
        phase: ControllerRoundPhase;
        phaseStatus: ControllerPhaseStatus;
        activePromptPath?: string;
        activeResponsePath?: string;
        notes: string[];
    }) => Promise<void>;
    syncAppServerPhase?: (input: {
        round: number;
        phase: ControllerRoundPhase;
        status: ControllerPhaseStatus;
        notes: string[];
    }) => Promise<void>;
    tickHeartbeat: () => Promise<void>;
}
export declare const persistRoundPhase: (input: PersistRoundPhaseInput) => Promise<{
    activePromptPath?: string;
    activeResponsePath?: string;
}>;
//# sourceMappingURL=round-phase-recorder.d.ts.map