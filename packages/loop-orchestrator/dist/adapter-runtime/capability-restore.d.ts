import type { AdapterCapabilityExecution, AdapterCapabilityName, LoadedAdapterContract } from "../types.js";
export declare const restoreAdapterCapabilityExecution: (input: {
    loadedAdapter: LoadedAdapterContract;
    capability: AdapterCapabilityName;
    roundDirectory: string;
}) => Promise<AdapterCapabilityExecution | undefined>;
export declare const restoreAdapterCapabilityExecutions: (input: {
    loadedAdapter?: LoadedAdapterContract;
    capabilities: AdapterCapabilityName[];
    roundDirectory: string;
}) => Promise<AdapterCapabilityExecution[]>;
//# sourceMappingURL=capability-restore.d.ts.map