import { dirname } from "node:path";
import { loadJson } from "../file-system.js";
import { normalizeVerificationProfile, resolvedPath } from "./shared.js";
export const loadAdapterContract = async (contractPath) => {
    if (!contractPath) {
        return undefined;
    }
    const absolutePath = resolvedPath(contractPath);
    const contract = await loadJson(absolutePath);
    const baseDirectory = dirname(absolutePath);
    const runtimeWarnings = contract.verification_profile_path
        ? [
            "Adapter field 'verification_profile_path' is deprecated and ignored at runtime. Remove it from adapter.json, then select the bundle through --target-family <family> for the standard path or --evaluator-profile <profile.json> for an explicit override."
        ]
        : [];
    return {
        base_directory: baseDirectory,
        contract_path: absolutePath,
        contract,
        ...(runtimeWarnings.length > 0 ? { runtime_warnings: runtimeWarnings } : {})
    };
};
export const loadVerificationProfile = async (profilePath) => {
    const absolutePath = resolvedPath(profilePath);
    return {
        profile_path: absolutePath,
        profile: normalizeVerificationProfile(await loadJson(absolutePath), absolutePath)
    };
};
export const attachVerificationProfile = async (input) => {
    if (!input.loadedAdapter || !input.profilePath) {
        return input.loadedAdapter;
    }
    return {
        ...input.loadedAdapter,
        verification_profile: await loadVerificationProfile(input.profilePath),
        verification_profile_source: input.source
    };
};
//# sourceMappingURL=contract-loader.js.map