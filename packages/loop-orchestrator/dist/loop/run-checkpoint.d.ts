import type { LoopRunSummary } from "../types.js";
import type { RunCheckpointCurrentBest } from "./run-summary-finalization.js";
export declare const writeRunCheckpoint: (input: {
    runDirectory: string;
    summary: LoopRunSummary;
    currentBest: RunCheckpointCurrentBest;
}) => Promise<void>;
//# sourceMappingURL=run-checkpoint.d.ts.map