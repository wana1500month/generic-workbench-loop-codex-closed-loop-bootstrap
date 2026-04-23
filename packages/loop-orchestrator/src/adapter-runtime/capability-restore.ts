import { join, resolve } from "node:path";

import { resolvedAdapterTargetRoot } from "../adapter-paths.js";
import { loadJson } from "../file-system.js";
import type {
  AdapterCapabilityExecution,
  AdapterCapabilityPacket,
  AdapterCapabilityName,
  AdapterCapabilityAttemptArtifact,
  LoadedAdapterContract
} from "../types.js";

import {
  pathExists,
  attemptPathForCapability,
  resultExecutionIdFor,
  quarantineResultFile,
  validateAdapterCapabilityResult,
  verificationProviderForCapability,
  withExecutionMetadata
} from "./shared.js";

export const restoreAdapterCapabilityExecution = async (input: {
  loadedAdapter: LoadedAdapterContract;
  capability: AdapterCapabilityName;
  roundDirectory: string;
}): Promise<AdapterCapabilityExecution | undefined> => {
  const adapterDirectory = join(input.roundDirectory, "adapter");
  const attemptPath = attemptPathForCapability(input.roundDirectory, input.capability);
  const packetPath = join(adapterDirectory, `${input.capability}-input.json`);
  const resultPath = join(adapterDirectory, `${input.capability}-result.json`);
  if (!(await pathExists(packetPath)) || !(await pathExists(resultPath))) {
    return undefined;
  }

  const packet = await loadJson<AdapterCapabilityPacket>(packetPath);
  const attempt = await loadJson<AdapterCapabilityAttemptArtifact | undefined>(attemptPath).catch(
    () => undefined
  );
  const rawResult = await loadJson<unknown>(resultPath);
  const resultExecutionId = resultExecutionIdFor({
    packet,
    rawResult
  });
  if (attempt) {
    if (attempt.status === "timed_out") {
      await quarantineResultFile({
        sourcePath: resultPath,
        roundDirectory: input.roundDirectory,
        capability: input.capability,
        executionId: attempt.execution_id,
        suffix: "late-result.json"
      });
      return undefined;
    }
    if (attempt.status !== "completed") {
      return undefined;
    }
    if (resultExecutionId && resultExecutionId !== attempt.execution_id) {
      await quarantineResultFile({
        sourcePath: resultPath,
        roundDirectory: input.roundDirectory,
        capability: input.capability,
        executionId: resultExecutionId,
        suffix: "mismatched-result.json"
      });
      return undefined;
    }
    if (!resultExecutionId && packet.execution_id && packet.execution_id !== attempt.execution_id) {
      return undefined;
    }
  }
  const provider = verificationProviderForCapability(
    input.loadedAdapter.contract,
    input.capability
  );
  const capabilitySpec = provider.capabilitySpec;
  const targetRoot = resolvedAdapterTargetRoot(input.loadedAdapter);
  const cwd = capabilitySpec?.cwd
    ? resolve(input.loadedAdapter.base_directory, capabilitySpec.cwd)
    : targetRoot;
  const validated = await validateAdapterCapabilityResult({
    capability: input.capability,
    rawResult: resultExecutionId ? withExecutionMetadata(rawResult, resultExecutionId) : rawResult,
    providerId: provider.providerId,
    providerRole: provider.providerRole,
    baseDirectory: input.loadedAdapter.base_directory,
    cwd,
    targetRoot,
    runDirectory: packet.run_directory,
    roundDirectory: packet.round_directory
  });

  return {
    capability: input.capability,
    provider_id: provider.providerId,
    provider_role: provider.providerRole,
    packet_path: packetPath,
    result_path: resultPath,
    result: validated.result,
    verified_evidence: validated.verified_evidence,
    verified_criteria_results: validated.verified_criteria_results,
    verified_evidence_paths: validated.verified_evidence_paths,
    validation_errors: validated.validation_errors
  };
};

export const restoreAdapterCapabilityExecutions = async (input: {
  loadedAdapter?: LoadedAdapterContract;
  capabilities: AdapterCapabilityName[];
  roundDirectory: string;
}): Promise<AdapterCapabilityExecution[]> => {
  if (!input.loadedAdapter) {
    return [];
  }

  const restored = await Promise.all(
    input.capabilities.map((capability) =>
      restoreAdapterCapabilityExecution({
        loadedAdapter: input.loadedAdapter!,
        capability,
        roundDirectory: input.roundDirectory
      })
    )
  );

  return restored.filter(
    (execution): execution is AdapterCapabilityExecution => Boolean(execution)
  );
};

