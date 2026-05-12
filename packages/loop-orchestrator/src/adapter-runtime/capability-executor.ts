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

const defaultInheritedAdapterEnvNames = new Set([
  "CI",
  "COMSPEC",
  "HOME",
  "PATH",
  "PATHEXT",
  "SHELL",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR"
]);

const adapterEnvSecretNamePattern =
  /(^OPENAI_API_KEY$|^CODEX_|^AWS_|^GCP_|^AZURE_|^GITHUB_TOKEN$|^NPM_TOKEN$|(^|_)(AUTH|CREDENTIAL|KEY|PASSWORD|PRIVATE|SECRET|TOKEN)($|_))/i;

const extraInheritedAdapterEnvNames = (): Set<string> =>
  new Set(
    (process.env.HARNESS_ADAPTER_ENV_ALLOWLIST ?? "")
      .split(",")
      .map((name) => name.trim().toUpperCase())
      .filter(Boolean)
  );

const isSensitiveEnvName = (name: string): boolean =>
  adapterEnvSecretNamePattern.test(name.toUpperCase());

const buildAdapterProcessEnv = (input: {
  harnessEnv: Record<string, string>;
  extraEnv?: Record<string, string>;
}): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  const allowlist = new Set([
    ...defaultInheritedAdapterEnvNames,
    ...extraInheritedAdapterEnvNames()
  ]);

  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) {
      continue;
    }
    const normalizedName = name.toUpperCase();
    if (!allowlist.has(normalizedName) || isSensitiveEnvName(normalizedName)) {
      continue;
    }
    env[name] = value;
  }

  for (const [name, value] of Object.entries({
    ...input.harnessEnv,
    ...(input.extraEnv ?? {})
  })) {
    if (isSensitiveEnvName(name)) {
      continue;
    }
    env[name] = value;
  }

  return env;
};

const sensitiveEnvValuesForRedaction = (
  extraEnv?: Record<string, string>
): string[] =>
  [
    ...Object.entries(process.env),
    ...Object.entries(extraEnv ?? {})
  ]
    .filter(([name, value]) => isSensitiveEnvName(name) && typeof value === "string")
    .map(([, value]) => value)
    .filter(
      (value): value is string => typeof value === "string" && value.length >= 8
    );

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const redactAdapterOutput = (
  output: string,
  sensitiveValues: readonly string[]
): string => {
  let redacted = output;
  for (const value of sensitiveValues) {
    redacted = redacted.replace(new RegExp(escapeRegExp(value), "g"), "[REDACTED]");
  }
  return redacted
    .replace(
      /\b(?:(?:sk|sess)[-_][A-Za-z0-9_-]{12,}|(?:ghp|github_pat)_[A-Za-z0-9_]{12,})\b/g,
      "[REDACTED]"
    )
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]")
    .replace(
      /\b(Bearer\s+)[A-Za-z0-9._~+/-]{12,}={0,2}\b/g,
      "$1[REDACTED]"
    );
};

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
  const harnessEnv = {
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
    HARNESS_EXECUTION_ID: executionId
  };
  const env = buildAdapterProcessEnv({
    harnessEnv,
    extraEnv: input.extraEnv
  });
  const sensitiveValues = sensitiveEnvValuesForRedaction(input.extraEnv);

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
  const stdout = redactAdapterOutput(execution.stdout, sensitiveValues);
  const stderr = redactAdapterOutput(execution.stderr, sensitiveValues);
  await Promise.all([
    writeText(stdoutPath, stdout),
    writeText(stderrPath, stderr)
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
      findings: stderr.trim() ? [stderr.trim()] : [],
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
    stdout_sha256: sha256ForBuffer(stdout),
    stderr_path: stderrPath,
    stderr_sha256: sha256ForBuffer(stderr),
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

