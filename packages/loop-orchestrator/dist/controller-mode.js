export const defaultControllerMode = "detached";
export const controllerModes = [
    "attached",
    "detached"
];
export const isControllerMode = (value) => typeof value === "string" &&
    controllerModes.includes(value);
export const controllerRoundPhases = [
    "planning",
    "negotiation",
    "pre_verification",
    "core_probes",
    "post_verification",
    "evaluation",
    "round_commit",
    "run_finalize"
];
export const isControllerRoundPhase = (value) => typeof value === "string" &&
    controllerRoundPhases.includes(value);
//# sourceMappingURL=controller-mode.js.map