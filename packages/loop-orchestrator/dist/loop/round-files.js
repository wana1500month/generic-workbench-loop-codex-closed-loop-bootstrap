import { join } from "node:path";
import { loadJson, writeJson } from "../file-system.js";
export const roundDirectoryFor = (runDirectory, round) => join(runDirectory, `round-${String(round).padStart(3, "0")}`);
export const crashAfterCheckpointEnabled = () => process.env.HARNESS_TEST_CRASH_AFTER_CHECKPOINT_ONCE === "1";
export const ensureJsonFile = async (path, fallbackValue) => {
    try {
        await loadJson(path);
    }
    catch {
        await writeJson(path, fallbackValue);
    }
};
export const writeRoundSummary = async (roundDirectory, summary) => {
    await writeJson(join(roundDirectory, "round_summary.json"), summary);
};
export const isImproved = (nextScore, currentBest) => currentBest === undefined || nextScore > currentBest + 0.001;
//# sourceMappingURL=round-files.js.map