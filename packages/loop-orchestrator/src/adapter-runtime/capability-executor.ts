import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

import { resolvedAdapterTargetRoot } from "../adapter-paths.js";
import { loadJson, writeJson, writeText } from "../file-system.js";
import type {
  AdapterCapabilityExecution,
  AdapterCapabilityPacket,
  AdapterCapabilityName,
  AdapterCapabilityAttemptArtifact,
  AdapterExecutionAttestation,
  LoadedAdapterContract
} from "../types.js";

import {
  attemptPathForCapability,
  commandDigestFor,
  defaultCapabilityResult,
  execCommand,
  pathExists,
  quarantineResultFile,
  sha256ForBuffer,
  validateAdapterCapabilityResult,
  verificationProviderForCapability,
  withExecutionMetadata
} from "./shared.js";

export const executeAdapterCapability = async (input: {
  loadedAdapter: LoadedAdapterContract;
  capability: AdapterCapabilityName;
  packet: AdapterCapabilityPacket;
  roundDirectory: string;
  extraEnv?: Record<string, string>;
}): Promise<AdapterCapabilityExecution> => {
  const adapterDirectory = join(input.roundDirectory, "adapter");
  const attemptPath = attemptPathForCapability(input.roundDirectory, input.capability);
  const packetPath = join(adapterDirectory, `${input.capability}-input.json`);
  const resultPath = join(adapterDirectory, `${input.capability}-result.json`);
  const stdoutPath = join(adapterDirectory, `${input.capability}-stdout.log`);
  const stderrPath = join(adapterDirectory, `${input.capability}-stderr.log`);

  const provider = verificationProviderForCapability(
    input.loadedAdapter.contract,
    input.capability
  );
  const capabilitySpec = provider.capabilitySpec;
  const executionId = randomUUID();
  const packet: AdapterCapabilityPacket = {
    ...input.packet,
    execution_id: executionId
  };
  await writeJson(packetPath, packet);
  if (!capabilitySpec) {
    const result = defaultCapabilityResult(
      input.capability,
      `${
        provider.providerRole === "verifier" ? "Verification provider" : "Adapter"
      } capability '${input.capability}' is not configured.`
    );
    await writeJson(resultPath, result);
    return {
      capability: input.capability,
      provider_id: provider.providerId,
      provider_role: provider.providerRole,
      packet_path: packetPath,
      result_path: resultPath,
      result,
      verified_evidence: [],
      verified_criteria_results: [],
      verified_evidence_paths: [],
      validation_errors: []
    };
  }

  const targetRoot = resolvedAdapterTargetRoot(input.loadedAdapter);
  const cwd = capabilitySpec.cwd
    ? resolve(input.loadedAdapter.base_directory, capabilitySpec.cwd)
    : targetRoot;
  const timeoutMs = capabilitySpec.timeout_ms ?? 120000;
  const startedAt = new Date().toISOString();
  const runningAttempt: AdapterCapabilityAttemptArtifact = {
    capability: input.capability,
    execution_id: executionId,
    status: "running",
    started_at: startedAt,
    updated_at: startedAt,
    timeout_ms: timeoutMs,
    packet_path: packetPath,
    result_path: resultPath,
    stdout_path: stdoutPath,
    stderr_path: stderrPath,
    command: capabilitySpec.command,
    ...(capabilitySpec.args?.length ? { args: capabilitySpec.args } : {}),
    ...(capabilitySpec.shell ? { shell: capabilitySpec.shell } : {})
  };
  await writeJson(attemptPath, runningAttempt);
  const env = {
    ...process.env,
    HARNESS_INPUT_PATH: packetPath,
    HARNESS_OUTPUT_PATH: resultPath,
    HARNESS_TARGET_ROOT: targetRoot,
    HARNESS_RUN_DIRECTORY: packet.run_directory,
    HARNESS_ROUND_DIRECTORY: packet.round_directory,
    HARNESS_RUNTIME_DIRECTORY:
      packet.runtime_directory ?? join(packet.run_directory, "runtime"),
    HARNESS_CODEX_SESSION_REGISTRY_PATH:
      packet.codex_session_registry_path ??
      join(packet.run_directory, "runtime", "codex-sessions.json"),
    HARNESS_CAPABILITY: input.capability,
    HARNESS_PROVIDER_ID: provider.providerId,
    HARNESS_PROVIDER_ROLE: provider.providerRole,
    HARNESS_EXECUTION_ID: executionId,
    ...(input.extraEnv ?? {})
  };

  let execution: Awaited<ReturnType<typeof execCommand>>;
  try {
    execution = await execCommand({
      command: capabilitySpec.command,
      ...(capabilitySpec.args ? { args: capabilitySpec.args } : {}),
      cwd,
      timeoutMs,
      env,
      shell: capabilitySpec.shell
    });
  } catch (error) {
    const failedAt = new Date().toISOString();
    await writeJson(attemptPath, {
      ...runningAttempt,
      status: "failed",
      updated_at: failedAt,
      finished_at: failedAt,
      exit_code: null
    } satisfies AdapterCapabilityAttemptArtifact);
    throw error;
  }
  await Promise.all([
    writeText(stdoutPath, execution.stdout),
    writeText(stderrPath, execution.stderr)
  ]);

  if (execution.timedOut) {
    await quarantineResultFile({
      sourcePath: resultPath,
      roundDirectory: input.roundDirectory,
      capability: input.capability,
      executionId,
      suffix: "result.json"
    });
    const timedOutAt = execution.finishedAt;
    await writeJson(attemptPath, {
      ...runningAttempt,
      status: "timed_out",
      updated_at: timedOutAt,
      timed_out_at: timedOutAt,
      finished_at: timedOutAt,
      exit_code: execution.code
    } satisfies AdapterCapabilityAttemptArtifact);
    throw new Error(
      `Adapter command timed out after ${timeoutMs} ms: ${capabilitySpec.command}`
    );
  }

  if (execution.outputLimitExceeded) {
    const failedAt = execution.finishedAt;
    await writeJson(attemptPath, {
      ...runningAttempt,
      status: "failed",
      updated_at: failedAt,
      finished_at: failedAt,
      exit_code: execution.code
    } satisfies AdapterCapabilityAttemptArtifact);
    throw new Error(
      `Adapter command exceeded output cap (${execution.outputLimitBytes} bytes per stream): ${capabilitySpec.command}`
    );
  }

  let rawResult: unknown;
  if (await pathExists(resultPath)) {
    rawResult = withExecutionMetadata(await loadJson<unknown>(resultPath), executionId);
  } else {
    rawResult = withExecutionMetadata(
      {
      capability: input.capability,
      ok: execution.code === 0,
      summary:
        execution.code === 0
          ? `Capability '${input.capability}' completed without an explicit result file.`
          : `Capability '${input.capability}' failed with exit code ${execution.code ?? -1}.`,
      findings: execution.stderr.trim() ? [execution.stderr.trim()] : [],
      evidence_paths: []
      },
      executionId
    );
  }

  const validated = await validateAdapterCapabilityResult({
    capability: input.capability,
    rawResult,
    providerId: provider.providerId,
    providerRole: provider.providerRole,
    baseDirectory: input.loadedAdapter.base_directory,
    cwd,
    targetRoot,
    runDirectory: packet.run_directory,
    roundDirectory: packet.round_directory
  });
  await writeJson(resultPath, validated.result);
  await writeJson(attemptPath, {
    ...runningAttempt,
    status: "completed",
    updated_at: execution.finishedAt,
    finished_at: execution.finishedAt,
    exit_code: execution.code
  } satisfies AdapterCapabilityAttemptArtifact);
  const resultRaw = await readFile(resultPath);
  const attestation: AdapterExecutionAttestation = {
    command: capabilitySpec.command,
    ...(capabilitySpec.args?.length ? { args: capabilitySpec.args } : {}),
    command_sha256: commandDigestFor({
      command: capabilitySpec.command,
      args: capabilitySpec.args
    }),
    cwd,
    shell: capabilitySpec.shell ?? "system",
    timeout_ms: timeoutMs,
    started_at: execution.startedAt,
    finished_at: execution.finishedAt,
    duration_ms: execution.durationMs,
    stdout_path: stdoutPath,
    stdout_sha256: sha256ForBuffer(execution.stdout),
    stderr_path: stderrPath,
    stderr_sha256: sha256ForBuffer(execution.stderr),
    result_sha256: sha256ForBuffer(resultRaw)
  };

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
    validation_errors: validated.validation_errors,
    attestation
  };
};

