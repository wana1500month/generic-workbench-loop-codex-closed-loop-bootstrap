import type { AdapterCapabilityExecution, AdapterCapabilityPacket, AdapterCapabilityName, LoadedAdapterContract } from "../types.js";
export declare const executeAdapterCapability: (input: {
    loadedAdapter: LoadedAdapterContract;
    capability: AdapterCapabilityName;
    packet: AdapterCapabilityPacket;
    roundDirectory: string;
    extraEnv?: Record<string, string>;
}) => Promise<AdapterCapabilityExecution>;
//# sourceMappingURL=capability-executor.d.ts.map