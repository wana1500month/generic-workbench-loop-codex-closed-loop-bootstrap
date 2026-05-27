import type {
  ControllerRoundPhase,
  ExecutionState
} from "../types.js";

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
