import { copyFile, mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { loadJson, loadJsonIfExists, writeJson } from "./file-system.js";
import { resumeIdentityFingerprint } from "./resume-identity.js";
import type {
  AdapterDriftReport,
  AdapterMigrationApplied,
  AdapterMigrationDecision,
  AdapterMigrationClass,
  AdapterMigrationIdentityState,
  AdapterMigrationProposal,
  AdapterMigrationResponse,
  AdapterMigrationApplyMode,
  AdapterOrigin,
  LoadedAdapterContract,
  LoopRunSummary,
  TargetManifestKey
} from "./types.js";

type GeneratedRuntimeConfig = {
  ready_url?: string;
  app_url?: string;
  health_url?: string;
  api_base_url?: string;
  [key: string]: unknown;
};

const targetManifestKeys = new Set<TargetManifestKey>([
  "app_url",
  "health_url",
  "api_base_url"
]);
const fileSafeToken = (value: string): string =>
  value.replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-");

const normalizeString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const boundaryBreakBlockerPattern =
  /(verification provider|provider[_\s-]?id|required capability|missing capability|contract version|target root|adapter id)/i;

export const generatedAdapterRuntimeConfigPath = (adapterContractPath: string): string =>
  join(dirname(adapterContractPath), ".generated", "codex-adapter", "runtime-config.json");

export const detectAdapterOrigin = (
  loadedAdapter: LoadedAdapterContract | undefined
): AdapterOrigin =>
  loadedAdapter &&
  basename(loadedAdapter.contract_path) === "adapter.generated.json" &&
  loadedAdapter.contract.adapter_id.startsWith("generated-")
    ? "generated_local"
    : "external_contract";

const inferRuntimeSurfaceValue = (
  key: TargetManifestKey,
  runtimeConfig: GeneratedRuntimeConfig
): string | undefined => {
  switch (key) {
    case "app_url":
      return normalizeString(runtimeConfig.app_url) ?? normalizeString(runtimeConfig.ready_url);
    case "health_url":
      return (
        normalizeString(runtimeConfig.health_url) ?? normalizeString(runtimeConfig.ready_url)
      );
    case "api_base_url":
      return (
        normalizeString(runtimeConfig.api_base_url) ?? normalizeString(runtimeConfig.ready_url)
      );
    default:
      return undefined;
  }
};

const classifyAdapterMigration = (input: {
  adapterOrigin: AdapterOrigin;
  adapterDriftReport: AdapterDriftReport;
  inferableKeys: TargetManifestKey[];
}): {
  migrationClass: AdapterMigrationClass;
  applyMode: AdapterMigrationApplyMode;
  sameRunEligible: boolean;
  autoapplyEligible: boolean;
  requiresOperatorAcceptance: boolean;
  forceNewRun: boolean;
} => {
  if (
    input.adapterOrigin === "generated_local" &&
    input.adapterDriftReport.kind === "runtime" &&
    input.inferableKeys.length === input.adapterDriftReport.missing_target_manifest_keys.length &&
    input.inferableKeys.length > 0
  ) {
    return {
      migrationClass: "runtime_surface_patch",
      applyMode: "same_run_in_place",
      sameRunEligible: true,
      autoapplyEligible: true,
      requiresOperatorAcceptance: false,
      forceNewRun: false
    };
  }

  const boundaryBreakDetected =
    (input.adapterOrigin === "external_contract" &&
      input.adapterDriftReport.kind === "contract") ||
    input.adapterDriftReport.static_blockers.some((blocker) =>
      boundaryBreakBlockerPattern.test(blocker)
    );
  if (boundaryBreakDetected) {
    return {
      migrationClass: "boundary_break",
      applyMode: "new_run_required",
      sameRunEligible: false,
      autoapplyEligible: false,
      requiresOperatorAcceptance: true,
      forceNewRun: true
    };
  }

  return {
    migrationClass:
      input.adapterDriftReport.kind === "contract"
        ? "kernel_wiring_patch"
        : "runtime_surface_patch",
    applyMode: input.adapterOrigin === "generated_local" ? "proposal_only" : "proposal_only",
    sameRunEligible: false,
    autoapplyEligible: false,
    requiresOperatorAcceptance: true,
    forceNewRun: false
  };
};

export const decisionOptionsForAdapterMigrationProposal = (
  proposal: AdapterMigrationProposal
): AdapterMigrationDecision[] =>
  proposal.force_new_run
    ? ["open_new_run", "reject"]
    : ["accept", "reject", "open_new_run"];

export const buildAdapterMigrationProposal = async (input: {
  runId: string;
  round: number;
  sourceAdapterDriftReportPath: string;
  loadedAdapter: LoadedAdapterContract;
  adapterDriftReport: AdapterDriftReport;
}): Promise<AdapterMigrationProposal> => {
  const adapterOrigin = detectAdapterOrigin(input.loadedAdapter);
  const runtimeConfigPath =
    adapterOrigin === "generated_local"
      ? generatedAdapterRuntimeConfigPath(input.loadedAdapter.contract_path)
      : undefined;
  const runtimeConfig = runtimeConfigPath
    ? await loadJsonIfExists<GeneratedRuntimeConfig>(runtimeConfigPath)
    : undefined;
  const missingKeys = input.adapterDriftReport.missing_target_manifest_keys.filter(
    (key): key is TargetManifestKey => targetManifestKeys.has(key as TargetManifestKey)
  );
  const inferredPatchEntries = missingKeys
    .map((key) => [key, inferRuntimeSurfaceValue(key, runtimeConfig ?? {})] as const)
    .filter((entry): entry is readonly [TargetManifestKey, string] => Boolean(entry[1]));
  const inferableKeys = inferredPatchEntries.map(([key]) => key);
  const proposedRuntimeConfigPatch =
    inferredPatchEntries.length > 0
      ? Object.fromEntries(inferredPatchEntries)
      : undefined;
  const classification = classifyAdapterMigration({
    adapterOrigin,
    adapterDriftReport: input.adapterDriftReport,
    inferableKeys
  });
  const runtimeConfigRelativePath =
    runtimeConfigPath && runtimeConfigPath.startsWith(dirname(input.loadedAdapter.contract_path))
      ? resolve(runtimeConfigPath)
      : runtimeConfigPath;
  const proposalId = `${input.runId}:r${input.round}:adapter-migration`;
  const providerId = input.loadedAdapter.contract.verification_provider?.provider_id;

  return {
    proposal_id: proposalId,
    run_id: input.runId,
    round: input.round,
    source_adapter_drift_report_path: input.sourceAdapterDriftReportPath,
    adapter_origin: adapterOrigin,
    migration_class: classification.migrationClass,
    apply_mode: classification.applyMode,
    same_run_eligible: classification.sameRunEligible,
    autoapply_eligible: classification.autoapplyEligible,
    requires_operator_acceptance: classification.requiresOperatorAcceptance,
    force_new_run: classification.forceNewRun,
    current_identity: {
      adapter_contract_path: input.loadedAdapter.contract_path,
      target_root: input.loadedAdapter.contract.target_root,
      adapter_id: input.loadedAdapter.contract.adapter_id,
      provider_id: providerId
    },
    proposed_identity: {
      adapter_contract_path: input.loadedAdapter.contract_path,
      target_root: input.loadedAdapter.contract.target_root,
      adapter_id: input.loadedAdapter.contract.adapter_id,
      provider_id: providerId
    },
    affected_files: [
      input.loadedAdapter.contract_path,
      ...(runtimeConfigRelativePath ? [runtimeConfigRelativePath] : [])
    ],
    affected_capabilities: ["run_target", "capture_evidence", "run_checks"],
    reasons: input.adapterDriftReport.reasons,
    summary:
      classification.autoapplyEligible && proposedRuntimeConfigPatch
        ? `Generated adapter runtime surface drift can be repaired in-place by updating ${Object.keys(
            proposedRuntimeConfigPatch
          ).join(", ")} before the recontract round continues.`
        : input.adapterDriftReport.summary,
    suggested_updates: input.adapterDriftReport.suggested_updates,
    ...(proposedRuntimeConfigPatch
      ? { proposed_runtime_config_patch: proposedRuntimeConfigPatch }
      : {}),
    ...(classification.autoapplyEligible
      ? {
          proposed_contract_patch: {
            append_notes: [
              `Applied runtime-surface migration ${proposalId} after ${input.adapterDriftReport.recontract_reason}.`
            ]
          }
        }
      : {})
  };
};

export const applyGeneratedLocalAdapterMigration = async (input: {
  proposal: AdapterMigrationProposal;
  loadedAdapter: LoadedAdapterContract;
  runtimeDirectory: string;
}): Promise<{
  changedFiles: string[];
  backupDirectory: string;
}> => {
  if (
    input.proposal.adapter_origin !== "generated_local" ||
    input.proposal.apply_mode !== "same_run_in_place" ||
    !input.proposal.proposed_runtime_config_patch
  ) {
    throw new Error(
      `Adapter migration proposal '${input.proposal.proposal_id}' is not eligible for same-run generated-local apply.`
    );
  }

  const adapterContractPath = resolve(input.loadedAdapter.contract_path);
  const runtimeConfigPath = generatedAdapterRuntimeConfigPath(adapterContractPath);
  const backupDirectory = join(
    input.runtimeDirectory,
    "adapter-migrations",
    fileSafeToken(input.proposal.proposal_id),
    "before"
  );
  await mkdir(backupDirectory, { recursive: true });
  await Promise.all([
    copyFile(adapterContractPath, join(backupDirectory, "adapter.generated.json")),
    copyFile(runtimeConfigPath, join(backupDirectory, "runtime-config.json"))
  ]);

  const [adapterContract, runtimeConfig] = await Promise.all([
    loadJson<Record<string, unknown>>(adapterContractPath),
    loadJson<GeneratedRuntimeConfig>(runtimeConfigPath)
  ]);
  const nextRuntimeConfig = {
    ...runtimeConfig,
    ...input.proposal.proposed_runtime_config_patch
  };
  const currentNotes = Array.isArray(adapterContract.notes)
    ? adapterContract.notes.filter((note): note is string => typeof note === "string")
    : [];
  const migrationNote = `Applied runtime-surface migration ${input.proposal.proposal_id}.`;
  const nextAdapterContract = {
    ...adapterContract,
    notes: currentNotes.includes(migrationNote)
      ? currentNotes
      : [...currentNotes, migrationNote]
  };

  await Promise.all([
    writeJson(runtimeConfigPath, nextRuntimeConfig),
    writeJson(adapterContractPath, nextAdapterContract)
  ]);

  return {
    changedFiles: [adapterContractPath, runtimeConfigPath],
    backupDirectory
  };
};

const isAdapterMigrationDecision = (
  value: string | undefined
): value is AdapterMigrationDecision =>
  value === "accept" || value === "reject" || value === "open_new_run";

export const loadAdapterMigrationResponse = async (
  path: string
): Promise<AdapterMigrationResponse | undefined> => {
  const artifact = await loadJsonIfExists<Record<string, unknown>>(path);
  if (!artifact) {
    return undefined;
  }
  const proposalId = normalizeString(artifact.proposal_id);
  const decision = normalizeString(artifact.decision);
  if (!proposalId || !isAdapterMigrationDecision(decision)) {
    return undefined;
  }
  return {
    proposal_id: proposalId,
    decision,
    ...(normalizeString(artifact.note) ? { note: normalizeString(artifact.note)! } : {})
  };
};

export const loadAuthorizedAdapterMigration = async (
  summary?: LoopRunSummary
): Promise<AdapterMigrationApplied | undefined> => {
  const explicitPath = summary?.adapter_migration_applied_path;
  if (explicitPath) {
    return loadJsonIfExists<AdapterMigrationApplied>(explicitPath);
  }

  const latestRoundPath = [...(summary?.round_history ?? [])]
    .reverse()
    .find((round) => typeof round.adapter_migration_applied_path === "string")
    ?.adapter_migration_applied_path;
  return latestRoundPath
    ? loadJsonIfExists<AdapterMigrationApplied>(latestRoundPath)
    : undefined;
};

export const isAuthorizedAdapterMigration = (input: {
  applied?: AdapterMigrationApplied;
  previousIdentity: AdapterMigrationIdentityState;
  currentIdentity: AdapterMigrationIdentityState;
}): boolean => {
  if (!input.applied?.same_run_authorized) {
    return false;
  }

  return (
    resumeIdentityFingerprint(input.previousIdentity) ===
      resumeIdentityFingerprint(input.applied.old_identity) &&
    resumeIdentityFingerprint(input.currentIdentity) ===
      resumeIdentityFingerprint(input.applied.new_identity)
  );
};
