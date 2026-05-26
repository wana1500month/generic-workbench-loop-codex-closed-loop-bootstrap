import { type AppServerTransportSnapshot } from "./transport-mode.js";
import type { ControllerMode, ControllerPhaseStatus, ControllerRoundPhase, ExecutorMode } from "./types.js";
type AppServerTurnResult = {
    turnId: string;
    status: "completed" | "interrupted" | "failed";
    eventCursor?: number;
    responseText?: string;
    reviewText?: string;
};
export interface AppServerTransportController {
    syncPhase: (input: {
        round: number;
        phase: ControllerRoundPhase;
        status: ControllerPhaseStatus;
        notes?: string[];
    }) => Promise<void>;
    runTask: (input: {
        round: number;
        phase: ControllerRoundPhase;
        prompt: string;
        taskLabel: string;
        completionTimeoutMs?: number;
        taskCwd?: string;
        writableRoots?: string[];
        networkAccess?: boolean;
        inputItems?: Array<Record<string, unknown>>;
        outputSchema?: Record<string, unknown>;
        approvalPolicy?: string;
        sandboxMode?: "workspaceWrite" | "readOnly";
        summary?: "none" | "auto" | "concise" | "detailed";
        effort?: "low" | "medium" | "high";
    }) => Promise<AppServerTurnResult>;
    runReview: (input: {
        round: number;
        phase: ControllerRoundPhase;
        reviewLabel: string;
        instructions: string;
        completionTimeoutMs?: number;
    }) => Promise<AppServerTurnResult>;
    stop: (input?: {
        stopReason?: string;
        notes?: string[];
    }) => Promise<void>;
    snapshot: () => AppServerTransportSnapshot;
}
export declare const startAppServerTransport: (input: {
    runId: string;
    controllerMode: ControllerMode;
    executorMode?: ExecutorMode;
    transportStatePath: string;
    summaryPath: string;
    protocolPath: string;
    dashboardPath: string;
    sessionStatusPath: string;
    sessionStatusEventsPath: string;
    sessionStreamPath: string;
    mirroredSessionEventsPath: string;
    restoredThreadId?: string;
    initialRound: number;
    initialPhase: ControllerRoundPhase;
    initialStatus: ControllerPhaseStatus;
    initialNotes?: string[];
    startInitialTurn?: boolean;
    threadName: string;
    defaultTaskTimeoutMs: number;
    requestTimeoutMs: number;
}) => Promise<AppServerTransportController>;
export {};
//# sourceMappingURL=app-server-runtime.d.ts.map