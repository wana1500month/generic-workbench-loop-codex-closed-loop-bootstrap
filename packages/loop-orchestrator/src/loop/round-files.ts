import { join } from "node:path";

import { loadJson, writeJson } from "../file-system.js";
import type { RoundSummary } from "../types.js";

export const roundDirectoryFor = (runDirectory: string, round: number): string =>
  join(runDirectory, `round-${String(round).padStart(3, "0")}`);

export const crashAfterCheckpointEnabled = (): boolean =>
  process.env.HARNESS_TEST_CRASH_AFTER_CHECKPOINT_ONCE === "1";

export const ensureJsonFile = async (
  path: string,
  fallbackValue: unknown
): Promise<void> => {
  try {
    await loadJson<unknown>(path);
  } catch {
    await writeJson(path, fallbackValue);
  }
};

export const writeRoundSummary = async (
  roundDirectory: string,
  summary: RoundSummary
): Promise<void> => {
  await writeJson(join(roundDirectory, "round_summary.json"), summary);
};

export const isImproved = (nextScore: number, currentBest: number | undefined): boolean =>
  currentBest === undefined || nextScore > currentBest + 0.001;
