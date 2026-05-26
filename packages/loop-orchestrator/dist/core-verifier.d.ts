import type { CoreVerificationProbeExecution, LoadedAdapterContract, TargetManifest } from "./types.js";
export declare const executeCoreVerificationProbes: (input: {
    loadedAdapter?: LoadedAdapterContract;
    runDirectory: string;
    roundDirectory: string;
    targetManifest?: TargetManifest;
    probeIds?: string[];
    onProbeComplete?: (execution: CoreVerificationProbeExecution) => Promise<void> | void;
}) => Promise<CoreVerificationProbeExecution[]>;
export declare const restoreCoreVerificationProbeExecutions: (input: {
    loadedAdapter?: LoadedAdapterContract;
    roundDirectory: string;
}) => Promise<CoreVerificationProbeExecution[]>;
//# sourceMappingURL=core-verifier.d.ts.map