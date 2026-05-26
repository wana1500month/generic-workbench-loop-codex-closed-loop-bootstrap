import type { ControllerRoundPhase } from "../types.js";
export declare const controllerPhaseOrder: readonly ControllerRoundPhase[];
export declare const parsePositiveTimeoutMs: (value: string | undefined) => number | undefined;
export declare const parsePhaseTimeoutOverrides: (value: string | undefined) => Partial<Record<ControllerRoundPhase, number>>;
export declare class PhaseBudgetExceededError extends Error {
    readonly phase: ControllerRoundPhase;
    readonly timeoutMs: number;
    constructor(phase: ControllerRoundPhase, timeoutMs: number);
}
//# sourceMappingURL=phase-timeouts.d.ts.map