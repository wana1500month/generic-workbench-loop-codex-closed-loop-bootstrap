export const markLoopProgress = async (input) => {
    input.assertPhaseBudget();
    input.setLastProgress(new Date().toISOString(), input.note);
    if (!["paused", "stalled", "failed", "completed"].includes(input.getActiveExecutionState())) {
        input.setExecutionState("running");
    }
    await input.heartbeatTick();
};
export const withActivePhaseBudget = async (input) => {
    const result = await input.work();
    if (input.getActiveHeartbeatPhase() === input.phase) {
        input.assertPhaseBudget();
    }
    return result;
};
//# sourceMappingURL=progress-budget.js.map