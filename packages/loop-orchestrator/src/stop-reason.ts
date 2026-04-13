import type { RunStopReason } from "./types.js";

export const canonicalCodexCheckpointStopReason = "awaiting_codex_checkpoint" as const;
export const legacyCurrentThreadHandoffStopReason =
  "awaiting_current_thread_handoff" as const;

export const isCurrentThreadCheckpointStopReason = (
  stopReason: string | undefined
): stopReason is
  | typeof canonicalCodexCheckpointStopReason
  | typeof legacyCurrentThreadHandoffStopReason =>
  stopReason === canonicalCodexCheckpointStopReason ||
  stopReason === legacyCurrentThreadHandoffStopReason;

export const normalizeRunStopReason = (
  stopReason: RunStopReason | undefined
): RunStopReason | undefined =>
  stopReason === legacyCurrentThreadHandoffStopReason
    ? canonicalCodexCheckpointStopReason
    : stopReason;
