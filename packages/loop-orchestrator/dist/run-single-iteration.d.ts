import type { ControllerMode, ControllerRoundPhase, TransportMode } from "./types.js";
import type { SingleRoundResult } from "./types.js";
export declare const runSingleIteration: (input: {
    adapterPath?: string;
    rubricPath?: string;
    evaluatorProfilePath?: string;
    targetFamily?: string;
    preparedRunId?: string;
    resumeRunPath?: string;
    allowResumeMigration?: boolean;
    forceReopenTerminal?: boolean;
    controllerMode?: ControllerMode;
    transportMode?: TransportMode;
    phaseTimeouts?: Partial<Record<ControllerRoundPhase, number>>;
    appServerTaskTimeoutMs?: number;
    appServerRequestTimeoutMs?: number;
    repairOnly?: boolean;
    resumePhase?: ControllerRoundPhase;
    executorMode?: "harness" | "subagents-experimental";
    targetScore?: number;
}) => Promise<SingleRoundResult>;
//# sourceMappingURL=run-single-iteration.d.ts.map