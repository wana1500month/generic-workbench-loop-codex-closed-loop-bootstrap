import type {
  AdapterCommandSpec,
  AdapterExecutionPolicy,
  ExternalAdapterContract,
  ResolvedAdapterExecutionPolicy
} from "../types.js";

export const resolveAdapterExecutionPolicy = (input: {
  contract: ExternalAdapterContract;
  capabilitySpec: AdapterCommandSpec;
  targetRoot: string;
}): ResolvedAdapterExecutionPolicy => {
  const merged: AdapterExecutionPolicy = {
    ...(input.contract.execution_policy ?? {}),
    ...(input.capabilitySpec.execution_policy ?? {})
  };

  const trustMode = merged.trust_mode ?? "trusted";
  const sandboxProvider =
    merged.sandbox_provider ?? (trustMode === "sandboxed" ? "custom-wrapper" : "none");

  return {
    trust_mode: trustMode,
    sandbox_provider: sandboxProvider,
    network_access: merged.network_access ?? false,
    isolated_home: merged.isolated_home ?? true,
    writable_roots: merged.writable_roots ?? [input.targetRoot],
    fail_closed: trustMode === "sandboxed"
  };
};
