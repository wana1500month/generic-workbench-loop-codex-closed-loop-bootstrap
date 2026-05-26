import type { RunStopReason } from "./types.js";
export declare const canonicalCodexCheckpointStopReason: "awaiting_codex_checkpoint";
export declare const legacyCurrentThreadHandoffStopReason: "awaiting_current_thread_handoff";
export declare const isCurrentThreadCheckpointStopReason: (stopReason: string | undefined) => stopReason is typeof canonicalCodexCheckpointStopReason | typeof legacyCurrentThreadHandoffStopReason;
export declare const normalizeRunStopReason: (stopReason: RunStopReason | undefined) => RunStopReason | undefined;
//# sourceMappingURL=stop-reason.d.ts.map