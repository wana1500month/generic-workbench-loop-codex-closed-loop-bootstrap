export const controllerPhaseOrder = [
    "planning",
    "negotiation",
    "pre_verification",
    "core_probes",
    "post_verification",
    "evaluation",
    "round_commit",
    "run_finalize"
];
export const parsePositiveTimeoutMs = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};
export const parsePhaseTimeoutOverrides = (value) => {
    if (!value?.trim()) {
        return {};
    }
    return value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .reduce((acc, entry) => {
        const [phaseCandidate, timeoutCandidate] = entry.split("=", 2);
        if (!phaseCandidate || !timeoutCandidate) {
            return acc;
        }
        if (!controllerPhaseOrder.includes(phaseCandidate)) {
            return acc;
        }
        const timeoutMs = parsePositiveTimeoutMs(timeoutCandidate.trim());
        if (!timeoutMs) {
            return acc;
        }
        acc[phaseCandidate] = timeoutMs;
        return acc;
    }, {});
};
export class PhaseBudgetExceededError extends Error {
    phase;
    timeoutMs;
    constructor(phase, timeoutMs) {
        super(`PHASE_TIMEOUT:${phase}:${timeoutMs}`);
        this.name = "PhaseBudgetExceededError";
        this.phase = phase;
        this.timeoutMs = timeoutMs;
    }
}
//# sourceMappingURL=phase-timeouts.js.map