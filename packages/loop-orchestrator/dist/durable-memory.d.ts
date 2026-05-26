import type { IdeaBrief } from "./types.js";
export interface DurableMemoryPaths {
    feature_list_path: string;
    progress_path: string;
    progress_log_path: string;
    done_when_path: string;
    init_script_path: string;
}
export interface DurableMemoryContext {
    title: string;
    summary: string;
    finishLine?: string;
    targetUsers: string[];
    coreFeatures: string[];
    qualityBar: string[];
    constraints: string[];
    mustNotBreak: string[];
    targetScore?: number;
    maxRounds?: number;
}
export declare const createDurableMemoryPaths: (rootDirectory: string) => DurableMemoryPaths;
export declare const buildFeatureLedger: (input: DurableMemoryContext) => Record<string, unknown>;
export declare const buildProgressMarkdown: (input: DurableMemoryContext) => string;
export declare const buildProgressJsonl: (input: DurableMemoryContext) => string;
export declare const buildDoneWhenMarkdown: (input: DurableMemoryContext) => string;
export declare const buildInitScript: () => string;
export declare const loadDurableMemoryContext: (idea: IdeaBrief) => Promise<{
    rootDirectory: string;
    context: DurableMemoryContext;
}>;
export declare const scaffoldDurableMemoryArtifacts: (rootDirectory: string, context: DurableMemoryContext) => Promise<DurableMemoryPaths>;
export declare const ensureDurableMemoryArtifacts: (rootDirectory: string, context: DurableMemoryContext) => Promise<DurableMemoryPaths>;
export declare const detectDurableMemoryPaths: (rootDirectory: string) => Promise<Partial<DurableMemoryPaths>>;
//# sourceMappingURL=durable-memory.d.ts.map