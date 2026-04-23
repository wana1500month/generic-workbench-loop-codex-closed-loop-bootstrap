import { dirname } from "node:path";

import { loadJson } from "../file-system.js";
import type {
  ExternalAdapterContract,
  LoadedAdapterContract,
  LoadedVerificationProfile
} from "../types.js";

import { normalizeVerificationProfile, resolvedPath } from "./shared.js";

export const loadAdapterContract = async (
  contractPath?: string
): Promise<LoadedAdapterContract | undefined> => {
  if (!contractPath) {
    return undefined;
  }

  const absolutePath = resolvedPath(contractPath);
  const contract = await loadJson<ExternalAdapterContract>(absolutePath);
  const baseDirectory = dirname(absolutePath);
  const runtimeWarnings =
    contract.verification_profile_path
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

export const loadVerificationProfile = async (
  profilePath: string
): Promise<LoadedVerificationProfile> => {
  const absolutePath = resolvedPath(profilePath);
  return {
    profile_path: absolutePath,
    profile: normalizeVerificationProfile(
      await loadJson<unknown>(absolutePath),
      absolutePath
    )
  };
};

export const attachVerificationProfile = async (input: {
  loadedAdapter: LoadedAdapterContract | undefined;
  profilePath?: string;
  source: "core" | "adapter";
}): Promise<LoadedAdapterContract | undefined> => {
  if (!input.loadedAdapter || !input.profilePath) {
    return input.loadedAdapter;
  }

  return {
    ...input.loadedAdapter,
    verification_profile: await loadVerificationProfile(input.profilePath),
    verification_profile_source: input.source
  };
};


