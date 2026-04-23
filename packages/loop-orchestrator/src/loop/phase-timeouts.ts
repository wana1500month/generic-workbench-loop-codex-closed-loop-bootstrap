import type { ControllerRoundPhase } from "../types.js";

export const controllerPhaseOrder: readonly ControllerRoundPhase[] = [
  "planning",
  "negotiation",
  "pre_verification",
  "core_probes",
  "post_verification",
  "evaluation",
  "round_commit",
  "run_finalize"
];

export const parsePositiveTimeoutMs = (value: string | undefined): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

export const parsePhaseTimeoutOverrides = (
  value: string | undefined
): Partial<Record<ControllerRoundPhase, number>> => {
  if (!value?.trim()) {
    return {};
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Partial<Record<ControllerRoundPhase, number>>>((acc, entry) => {
      const [phaseCandidate, timeoutCandidate] = entry.split("=", 2);
      if (!phaseCandidate || !timeoutCandidate) {
        return acc;
      }
      if (!controllerPhaseOrder.includes(phaseCandidate as ControllerRoundPhase)) {
        return acc;
      }
      const timeoutMs = parsePositiveTimeoutMs(timeoutCandidate.trim());
      if (!timeoutMs) {
        return acc;
      }
      acc[phaseCandidate as ControllerRoundPhase] = timeoutMs;
      return acc;
    }, {});
};

export class PhaseBudgetExceededError extends Error {
  public readonly phase: ControllerRoundPhase;
  public readonly timeoutMs: number;

  public constructor(phase: ControllerRoundPhase, timeoutMs: number) {
    super(`PHASE_TIMEOUT:${phase}:${timeoutMs}`);
    this.name = "PhaseBudgetExceededError";
    this.phase = phase;
    this.timeoutMs = timeoutMs;
  }
}
