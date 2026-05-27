import type {
  ControllerMode,
  ControllerRoundPhase,
  TransportMode
} from "../types.js";

export interface RunClosedLoopInput {
  adapterPath?: string;
  rubricPath?: string;
  evaluatorProfilePath?: string;
  targetFamily?: string;
  preparedRunId?: string;
  resumeRunPath?: string;
  allowResumeMigration?: boolean;
  forceReopenTerminal?: boolean;
  maxRounds?: number;
  targetScore?: number;
  includeRemediationBudget?: boolean;
  controllerMode?: ControllerMode;
  transportMode?: TransportMode;
  repairOnly?: boolean;
  resumePhase?: ControllerRoundPhase;
  executorMode?: "harness" | "subagents-experimental";
  phaseTimeouts?: Partial<Record<ControllerRoundPhase, number>>;
  appServerTaskTimeoutMs?: number;
  appServerRequestTimeoutMs?: number;
}
