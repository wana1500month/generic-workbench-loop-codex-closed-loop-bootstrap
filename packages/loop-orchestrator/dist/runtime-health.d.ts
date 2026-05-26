import type { ControllerLeaseArtifact, ControllerPhaseStatus, ExecutionState, RunStopReason, RuntimeLiveStateArtifact, RuntimeRoundPhaseArtifact, TransportStateArtifact } from "./types.js";
export declare const pausedStopReasons: Set<RunStopReason>;
export declare const defaultStallThresholdMs = 60000;
export declare const defaultHeartbeatStaleMs = 30000;
export declare const defaultTransportEventStaleMs = 30000;
export declare const phaseBudgetToStallThresholdMs: (phaseTimeoutMs: number | undefined) => number;
export declare const heartbeatTimestampForRuntime: (input: {
    liveState?: RuntimeLiveStateArtifact;
    roundPhase?: RuntimeRoundPhaseArtifact;
    controllerLease?: ControllerLeaseArtifact;
}) => string | undefined;
export declare const progressTimestampForRuntime: (input: {
    liveState?: RuntimeLiveStateArtifact;
    roundPhase?: RuntimeRoundPhaseArtifact;
    controllerLease?: ControllerLeaseArtifact;
}) => string | undefined;
export interface RuntimeHealthAssessment {
    execution_state: ExecutionState;
    controller_status: ControllerLeaseArtifact["status"];
    phase_status?: ControllerPhaseStatus;
    heartbeat_at?: string;
    heartbeat_age_ms?: number;
    progress_at?: string;
    progress_age_ms?: number;
    transport_event_at?: string;
    transport_event_age_ms?: number;
    phase_timeout_ms?: number;
    stall_threshold_ms: number;
    heartbeat_stale: boolean;
    progress_stale: boolean;
    transport_stale: boolean;
    terminal: boolean;
    should_restart: boolean;
    summary: string;
}
export declare const assessRuntimeHealth: (input: {
    liveState?: RuntimeLiveStateArtifact;
    roundPhase?: RuntimeRoundPhaseArtifact;
    controllerLease?: ControllerLeaseArtifact;
    transportState?: TransportStateArtifact;
    now?: number;
    heartbeatStaleMs?: number;
    transportEventStaleMs?: number;
    stallThresholdMs?: number;
}) => RuntimeHealthAssessment;
//# sourceMappingURL=runtime-health.d.ts.map