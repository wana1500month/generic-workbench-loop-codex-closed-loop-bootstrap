import { join } from "node:path";

import type {
  ControllerMode,
  ControllerRoundPhase,
  TransportMode
} from "./types.js";
import type { SingleRoundResult } from "./types.js";
import { runClosedLoop } from "./loop.js";

export const runSingleIteration = async (input: {
  adapterPath?: string;
  rubricPath?: string;
  evaluatorProfilePath?: string;
  targetFamily?: string;
  resumeRunPath?: string;
  allowResumeMigration?: boolean;
  forceReopenTerminal?: boolean;
  controllerMode?: ControllerMode;
  transportMode?: TransportMode;
  phaseTimeouts?: Partial<Record<ControllerRoundPhase, number>>;
  appServerTaskTimeoutMs?: number;
  appServerRequestTimeoutMs?: number;
  repairOnly?: boolean;
  resumePhase?: ControllerRoundPhase;
  executorMode?: "harness" | "subagents-experimental";
  targetScore?: number;
}): Promise<SingleRoundResult> => {
  const result = await runClosedLoop({
    adapterPath: input.adapterPath,
    rubricPath: input.rubricPath,
    evaluatorProfilePath: input.evaluatorProfilePath,
    targetFamily: input.targetFamily,
    resumeRunPath: input.resumeRunPath,
    allowResumeMigration: input.allowResumeMigration,
    forceReopenTerminal: input.forceReopenTerminal,
    controllerMode: input.controllerMode,
    transportMode: input.transportMode,
    phaseTimeouts: input.phaseTimeouts,
    appServerTaskTimeoutMs: input.appServerTaskTimeoutMs,
    appServerRequestTimeoutMs: input.appServerRequestTimeoutMs,
    repairOnly: input.repairOnly,
    resumePhase: input.resumePhase,
    executorMode: input.executorMode,
    maxRounds: 1,
    targetScore: input.targetScore,
    includeRemediationBudget: false
  });

  return {
    summary: result.summary,
    runDirectory: result.runDirectory,
    roundDirectory: join(result.runDirectory, "round-001")
  };
};
