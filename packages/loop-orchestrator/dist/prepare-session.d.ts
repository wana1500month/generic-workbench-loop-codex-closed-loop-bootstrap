import { type PreparedSessionSeed } from "./session-artifacts.js";
import type { ControllerMode, OperatorWorkspaceSurface, TargetFamily, ThreadBindingState, TransportMode } from "./types.js";
export interface PrepareSessionResult {
    runId: string;
    runDirectory: string;
    buildBriefPath: string;
    runContractPath: string;
    openQuestionsPath: string;
    sessionStatusPath: string;
    sessionStatusEventsPath: string;
    sessionStreamPath: string;
    operatorSurfacePath: string;
    executionPlanPath: string;
    adapterPath?: string;
    adapterPlanPath?: string;
    adapterReviewTaskPath?: string;
    rubricPath?: string;
    evaluatorProfilePath?: string;
}
export interface ReadyToStartSessionMarker {
    run_id: string;
    run_directory: string;
    updated_at: string;
    thread_id?: string;
    binding_state?: ThreadBindingState;
    front_door_session_id?: string;
    front_door_session_path?: string;
}
export interface PrepareSessionRunInput {
    runDirectory?: string;
    ideaPath?: string;
    rubricPath?: string;
    targetFamily?: TargetFamily;
    targetScore?: number;
    maxRounds?: number;
    workspaceMode?: OperatorWorkspaceSurface;
    transportMode?: TransportMode;
    controllerMode?: ControllerMode;
    frontDoorSessionPath?: string;
}
export declare const legacyReadyToStartMarkerPathForRuns: (runsDirectory: string) => string;
export declare const readyToStartIndexDirectoryForRuns: (runsDirectory: string) => string;
export declare const readyToStartMarkerPathForRuns: (runsDirectory: string) => string;
export declare const readyToStartMarkerPathForRun: (runsDirectory: string, runId: string) => string;
export declare const readyToStartMarkerPathForThread: (runsDirectory: string, threadId: string) => string;
export declare const loadReadyToStartSessionMarker: (runsDirectory: string) => Promise<ReadyToStartSessionMarker | undefined>;
export declare const writeReadyToStartSessionMarker: (runsDirectory: string, marker: ReadyToStartSessionMarker) => Promise<void>;
export declare const clearReadyToStartSessionMarker: (runsDirectory: string, marker: ReadyToStartSessionMarker) => Promise<void>;
export declare const loadPreparedSessionSeedForRun: (runDirectory: string) => Promise<PreparedSessionSeed | undefined>;
export declare const findLatestPreparedRunAwaitingStart: (runsDirectory: string, currentThreadId?: string, options?: {
    runId?: string;
    allowAssumedForeground?: boolean;
}) => Promise<{
    runId: string;
    runDirectory: string;
    marker?: ReadyToStartSessionMarker;
} | undefined>;
export declare const prepareSessionRun: (input: PrepareSessionRunInput) => Promise<PrepareSessionResult>;
//# sourceMappingURL=prepare-session.d.ts.map