import { PhaseBudgetExceededError } from "./phase-timeouts.js";
export const assertActivePhaseBudget = (input) => {
    if (!input.activeHeartbeatPhase ||
        input.activeHeartbeatPhaseStatus !== "in_progress" ||
        input.activePhaseTimeoutMs === undefined ||
        !input.activeHeartbeatPhaseStartedAt) {
        return;
    }
    const phaseStartedAt = Date.parse(input.activeHeartbeatPhaseStartedAt);
    if (Number.isNaN(phaseStartedAt)) {
        return;
    }
    if (Date.now() - phaseStartedAt > input.activePhaseTimeoutMs) {
        throw new PhaseBudgetExceededError(input.activeHeartbeatPhase, input.activePhaseTimeoutMs);
    }
};
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