import type { ControllerMode, ControllerRoundPhase } from "./types.js";

export const defaultControllerMode: ControllerMode = "detached";

export const controllerModes = [
  "attached",
  "detached"
] as const satisfies readonly ControllerMode[];

export const isControllerMode = (
  value: string | undefined
): value is ControllerMode =>
  typeof value === "string" &&
  (controllerModes as readonly string[]).includes(value);

export const controllerRoundPhases = [
  "planning",
  "negotiation",
  "pre_verification",
  "core_probes",
  "post_verification",
  "evaluation",
  "round_commit",
  "run_finalize"
] as const satisfies readonly ControllerRoundPhase[];

export const isControllerRoundPhase = (
  value: string | undefined
): value is ControllerRoundPhase =>
  typeof value === "string" &&
  (controllerRoundPhases as readonly string[]).includes(value);
