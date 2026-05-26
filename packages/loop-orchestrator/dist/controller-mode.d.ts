import type { ControllerMode, ControllerRoundPhase } from "./types.js";
export declare const defaultControllerMode: ControllerMode;
export declare const controllerModes: readonly ["attached", "detached"];
export declare const isControllerMode: (value: string | undefined) => value is ControllerMode;
export declare const controllerRoundPhases: readonly ["planning", "negotiation", "pre_verification", "core_probes", "post_verification", "evaluation", "round_commit", "run_finalize"];
export declare const isControllerRoundPhase: (value: string | undefined) => value is ControllerRoundPhase;
//# sourceMappingURL=controller-mode.d.ts.map