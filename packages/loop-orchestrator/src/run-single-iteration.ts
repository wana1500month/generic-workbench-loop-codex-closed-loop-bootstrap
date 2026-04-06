import { join } from "node:path";

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
