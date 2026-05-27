import type { RuntimeEvent, ValidationLane } from "../types.js";
type RestoredRunRuntimeEventSource = {
    summary: {
        runtime_events?: RuntimeEvent[];
        runtime_warnings?: string[];
        round_history?: readonly unknown[];
    };
    summaryWasRecovered?: boolean;
    interruptedRound?: {
        round: number;
        resumeFromPhase: string;
    };
    initializationIncomplete?: boolean;
    initializationMissingArtifacts?: string[];
};
export declare const persistentWarningsFromRestoredRun: (restoredRun: RestoredRunRuntimeEventSource | undefined) => string[];
export declare const buildInitialRuntimeEventsForRun: (input: {
    restoredRun?: RestoredRunRuntimeEventSource;
    loadedAdapterAttached: boolean;
    resolvedValidationLane?: ValidationLane;
    resolvedTargetFamily?: string;
    resumeMigrationPath?: string;
    adapterMigrationAuthorized: boolean;
    runId: string;
    resumeIdentityMismatches: string[];
    resumeRunPath?: string;
    resumePhase?: string;
}) => RuntimeEvent[];
export declare const buildFinalRuntimeEventsForRun: (input: {
    currentRuntimeEvents: RuntimeEvent[];
    restored: boolean;
    forceReopenTerminal: boolean;
    resumeNoopTerminal: boolean;
    restoredStopReason?: string;
    runId: string;
}) => RuntimeEvent[];
export {};
//# sourceMappingURL=run-runtime-events.d.ts.map