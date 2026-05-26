import { join } from "node:path";
import { runClosedLoop } from "./loop.js";
export const runSingleIteration = async (input) => {
    const result = await runClosedLoop({
        adapterPath: input.adapterPath,
        rubricPath: input.rubricPath,
        evaluatorProfilePath: input.evaluatorProfilePath,
        targetFamily: input.targetFamily,
        preparedRunId: input.preparedRunId,
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
//# sourceMappingURL=run-single-iteration.js.map