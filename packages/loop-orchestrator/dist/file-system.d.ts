export declare const repoRoot: string;
export declare const resolveRunsDirectory: () => string;
export declare const loadJson: <T>(path: string) => Promise<T>;
export declare const loadJsonIfExists: <T>(path: string) => Promise<T | undefined>;
export declare const loadJsonLinesIfExists: <T>(path: string) => Promise<T[]>;
export declare const writeJson: (path: string, value: unknown) => Promise<void>;
export declare const writeText: (path: string, value: string) => Promise<void>;
export declare const appendJsonLine: (path: string, value: unknown) => Promise<void>;
export declare const pathExists: (path: string) => Promise<boolean>;
export declare const sha256ForPath: (path?: string) => Promise<string | undefined>;
export declare const removeIfExists: (path: string) => Promise<void>;
export declare const nextRunId: (runsDirectory: string) => Promise<string>;
//# sourceMappingURL=file-system.d.ts.map