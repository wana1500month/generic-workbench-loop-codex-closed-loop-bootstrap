import type {
  ControllerPhaseStatus,
  ControllerRoundPhase,
  ExecutionState
} from "../types.js";
import { PhaseBudgetExceededError } from "./phase-timeouts.js";

export const assertActivePhaseBudget = (input: {
  activeHeartbeatPhase?: ControllerRoundPhase;
  activeHeartbeatPhaseStatus?: ControllerPhaseStatus;
  activePhaseTimeoutMs?: number;
  activeHeartbeatPhaseStartedAt?: string;
}): void => {
  if (
    !input.activeHeartbeatPhase ||
    input.activeHeartbeatPhaseStatus !== "in_progress" ||
    input.activePhaseTimeoutMs === undefined ||
    !input.activeHeartbeatPhaseStartedAt
  ) {
    return;
  }
  const phaseStartedAt = Date.parse(input.activeHeartbeatPhaseStartedAt);
  if (Number.isNaN(phaseStartedAt)) {
    return;
  }
  if (Date.now() - phaseStartedAt > input.activePhaseTimeoutMs) {
    throw new PhaseBudgetExceededError(
      input.activeHeartbeatPhase,
      input.activePhaseTimeoutMs
    );
  }
};

export const markLoopProgress = async (input: {
  note: string;
  assertPhaseBudget(): void;
  getActiveExecutionState(): ExecutionState;
  setExecutionState(state: ExecutionState): void;
  setLastProgress(at: string, note: string): void;
  heartbeatTick(): Promise<void>;
}): Promise<void> => {
  input.assertPhaseBudget();
  input.setLastProgress(new Date().toISOString(), input.note);
  if (
    !["paused", "stalled", "failed", "completed"].includes(
      input.getActiveExecutionState()
    )
  ) {
    input.setExecutionState("running");
  }
  await input.heartbeatTick();
};

export const withActivePhaseBudget = async <T>(input: {
  phase: ControllerRoundPhase;
  work(): Promise<T>;
  getActiveHeartbeatPhase(): ControllerRoundPhase | undefined;
  assertPhaseBudget(): void;
}): Promise<T> => {
  const result = await input.work();
  if (input.getActiveHeartbeatPhase() === input.phase) {
    input.assertPhaseBudget();
  }
  return result;
};
