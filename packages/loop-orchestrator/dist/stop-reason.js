export const canonicalCodexCheckpointStopReason = "awaiting_codex_checkpoint";
export const legacyCurrentThreadHandoffStopReason = "awaiting_current_thread_handoff";
export const isCurrentThreadCheckpointStopReason = (stopReason) => stopReason === canonicalCodexCheckpointStopReason ||
    stopReason === legacyCurrentThreadHandoffStopReason;
export const normalizeRunStopReason = (stopReason) => stopReason === legacyCurrentThreadHandoffStopReason
    ? canonicalCodexCheckpointStopReason
    : stopReason;
//# sourceMappingURL=stop-reason.js.map