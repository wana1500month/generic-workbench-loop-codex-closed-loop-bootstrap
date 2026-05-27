import type { ControllerPhaseStatus, ControllerRoundPhase, ExecutionState } from "../types.js";
export declare const assertActivePhaseBudget: (input: {
    activeHeartbeatPhase?: ControllerRoundPhase;
    activeHeartbeatPhaseStatus?: ControllerPhaseStatus;
    activePhaseTimeoutMs?: number;
    activeHeartbeatPhaseStartedAt?: string;
}) => void;
export declare const markLoopProgress: (input: {
    note: string;
    assertPhaseBudget(): void;
    getActiveExecutionState(): ExecutionState;
    setExecutionState(state: ExecutionState): void;
    setLastProgress(at: string, note: string): void;
    heartbeatTick(): Promise<void>;
}) => Promise<void>;
export declare const withActivePhaseBudget: <T>(input: {
    phase: ControllerRoundPhase;
    work(): Promise<T>;
    getActiveHeartbeatPhase(): ControllerRoundPhase | undefined;
    assertPhaseBudget(): void;
}) => Promise<T>;
//# sourceMappingURL=progress-budget.d.ts.map