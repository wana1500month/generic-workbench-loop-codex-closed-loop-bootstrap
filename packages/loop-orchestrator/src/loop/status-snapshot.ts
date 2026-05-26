import type {
  ExecutionState,
  LoopRunSummary,
  OperatorAttentionRequired,
  SessionLoopStatus
} from "../types.js";

export const sessionStatusForStopReason = (
  stopReason: LoopRunSummary["stop_reason"] | undefined
): SessionLoopStatus | undefined => {
  switch (stopReason) {
    case "awaiting_codex_checkpoint":
    case "awaiting_current_thread_handoff":
    case "awaiting_manual_generator":
      return "running";
    case "awaiting_human_input":
    case "new_run_required":
      return "needs_steering";
    case "awaiting_external_condition":
    case "environment_blocked":
      return "blocked_externally";
    case "target_reached":
    case "contract_completed":
    case "max_rounds_reached":
      return "ready_for_review";
    case "adapter_migration_rejected":
      return "done";
    default:
      return undefined;
  }
};

export const deriveSessionLoopStatus = (input: {
  override?: SessionLoopStatus;
  stopReason?: LoopRunSummary["stop_reason"];
  attentionRequired?: OperatorAttentionRequired;
  executionState: ExecutionState;
  hasHistory: boolean;
}): SessionLoopStatus => {
  if (input.override) {
    return input.override;
  }
  const stopReasonStatus = sessionStatusForStopReason(input.stopReason);
  if (stopReasonStatus) {
    return stopReasonStatus;
  }
  if (input.executionState === "completed") {
    return "done";
  }
  if (input.executionState === "paused") {
    if (input.attentionRequired === "human") {
      return "needs_steering";
    }
    if (input.attentionRequired === "external") {
      return "blocked_externally";
    }
  }
  return input.hasHistory ? "running" : "ready_to_start";
};
