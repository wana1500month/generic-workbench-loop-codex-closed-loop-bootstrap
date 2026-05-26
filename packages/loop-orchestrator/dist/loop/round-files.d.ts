import type { RoundSummary } from "../types.js";
export declare const roundDirectoryFor: (runDirectory: string, round: number) => string;
export declare const crashAfterCheckpointEnabled: () => boolean;
export declare const ensureJsonFile: (path: string, fallbackValue: unknown) => Promise<void>;
export declare const writeRoundSummary: (roundDirectory: string, summary: RoundSummary) => Promise<void>;
export declare const isImproved: (nextScore: number, currentBest: number | undefined) => boolean;
//# sourceMappingURL=round-files.d.ts.map