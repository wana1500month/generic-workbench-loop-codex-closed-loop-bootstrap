import type { LoadedAdapterContract, LoadedVerificationProfile } from "../types.js";
export declare const loadAdapterContract: (contractPath?: string) => Promise<LoadedAdapterContract | undefined>;
export declare const loadVerificationProfile: (profilePath: string) => Promise<LoadedVerificationProfile>;
export declare const attachVerificationProfile: (input: {
    loadedAdapter: LoadedAdapterContract | undefined;
    profilePath?: string;
    source: "core" | "adapter";
}) => Promise<LoadedAdapterContract | undefined>;
//# sourceMappingURL=contract-loader.d.ts.map