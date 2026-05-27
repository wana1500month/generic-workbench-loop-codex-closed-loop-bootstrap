import type { ClosedLoopResult, ControllerMode, ControllerRoundPhase, ExecutorMode, LoadedAdapterContract, LoopRunSummary, RuntimeEvent, TransportMode, ValidationLane } from "../types.js";
import type { RestoredRunState } from "../resume-state.js";
import type { ResumeIdentityState } from "../resume-identity.js";
export interface FinalizeNoopTerminalResumeInput {
    runId: string;
    runDirectory: string;
    restoredRun: RestoredRunState;
    restoredStopReason: LoopRunSummary["stop_reason"] | undefined;
    controllerMode: ControllerMode;
    transportMode: TransportMode;
    executorMode: ExecutorMode;
    runtimeStatePaths: {
        transportStatePath: string;
        roundPhasePath: string;
        liveStatePath: string;
        controllerLeasePath: string;
        sessionStatusPath: string;
        sessionStatusEventsPath: string;
        sessionStreamPath: string;
    };
    currentResumeIdentityPath: string;
    currentResumeIdentity: ResumeIdentityState;
    currentRuntimeEvents: RuntimeEvent[];
    previousPersistentWarnings: string[];
    bundleRuntimeWarnings?: string[];
    adapterRuntimeWarnings?: string[];
    resumeDecisionPath?: string;
    resumeIdentityMismatches: string[];
    forceReopenTerminal: boolean;
    allowResumeMigration: boolean;
    resumePhase?: ControllerRoundPhase;
    resolvedTargetFamily?: LoopRunSummary["target_family"];
    resolvedValidationLane?: ValidationLane;
    evaluatorProfilePath?: string;
    loadedAdapter?: LoadedAdapterContract;
}
export declare const finalizeNoopTerminalResume: (input: FinalizeNoopTerminalResumeInput) => Promise<ClosedLoopResult>;
//# sourceMappingURL=noop-terminal-resume.d.ts.map