import { spawn } from "node:child_process";
import { copyFile, cp, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

import {
  loadJson,
  loadJsonIfExists,
  pathExists,
  repoRoot,
  writeJson
} from "./file-system.js";
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

const normalizePatchPath = (value: string): string => value.replaceAll("\\", "/");

const isGeneratedLocalAdapterSurfacePath = (relativePath: string): boolean => {
  const normalized = normalizePatchPath(relativePath)
    .replace(/^(\.\/)+/, "")
    .replace(/^\/+/, "");
  if (!normalized || normalized.split("/").includes("..")) {
    return false;
  }

  return (
    normalized === "adapter.generated.json" ||
    normalized === ".generated/codex-adapter/runtime-config.json" ||
    normalized === "codex-adapter/runtime-config.json" ||
    normalized.startsWith(".generated/codex-adapter/scripts/") ||
    normalized.startsWith("codex-adapter/scripts/")
  );
};

const parsePatchChangedFiles = (patchText: string): string[] => {
  const changedFiles = new Set<string>();
  const diffMatches = patchText.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm);
  for (const match of diffMatches) {
    const nextPath = normalizePatchPath(match[2] ?? "")
      .replace(/^(\.\/)+/, "")
      .replace(/^\/+/, "");
    if (nextPath) {
      changedFiles.add(nextPath);
    }
  }
  if (changedFiles.size > 0) {
    return [...changedFiles];
  }

  const plusMatches = patchText.matchAll(/^\+\+\+ b\/(.+)$/gm);
  for (const match of plusMatches) {
    const nextPath = normalizePatchPath(match[1] ?? "")
      .replace(/^(\.\/)+/, "")
      .replace(/^\/+/, "");
    if (nextPath && nextPath !== "/dev/null") {
      changedFiles.add(nextPath);
    }
  }

  return [...changedFiles];
};

const isPathInside = (rootPath: string, candidatePath: string): boolean => {
  const resolvedRoot = resolve(rootPath);
  const resolvedCandidate = resolve(candidatePath);
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}\\`) ||
    resolvedCandidate.startsWith(`${resolvedRoot}/`)
  );
};

const runGitApply = async (input: {
  cwd: string;
  patchPath: string;
  directory?: string;
}): Promise<void> =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      "git",
      [
        "apply",
        "--whitespace=nowarn",
        "--unsafe-paths",
        ...(input.directory ? [`--directory=${input.directory}`] : []),
        input.patchPath
      ],
      {
        cwd: input.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      }
    );
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      rejectPromise(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(
          `git apply failed for '${input.patchPath}' in '${input.cwd}'.${stdout.trim() ? `\n${stdout.trim()}` : ""}${stderr.trim() ? `\n${stderr.trim()}` : ""}`
        )
      );
    });
  });

export const generatedAdapterRuntimeConfigPath = (adapterContractPath: string): string =>
  basename(dirname(adapterContractPath)) === "generated-adapter"
    ? join(dirname(adapterContractPath), "codex-adapter", "runtime-config.json")
    : join(dirname(adapterContractPath), ".generated", "codex-adapter", "runtime-config.json");

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
    applyMode:
      input.adapterOrigin === "generated_local" &&
      input.adapterDriftReport.kind === "contract"
        ? "same_run_in_place"
        : "proposal_only",
    sameRunEligible:
      input.adapterOrigin === "generated_local" &&
      input.adapterDriftReport.kind === "contract",
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

export const approvalSemanticsForAdapterMigrationProposal = (
  proposal: AdapterMigrationProposal
): Record<AdapterMigrationDecision, string> => ({
  accept:
    proposal.same_run_eligible && proposal.patch_bundle_path
      ? "Apply the authored migration bundle on this run, record the migrated adapter identity, and continue the same run."
      : proposal.apply_mode === "proposal_only"
        ? "Approve the proposal bundle and pause on external/manual apply before this run can continue."
        : "Approve the migration plan and continue with the migration workflow.",
  reject:
    "Reject the migration proposal and close the current run with adapter_migration_rejected.",
  open_new_run:
    proposal.force_new_run
      ? "Open a fresh run around the new adapter boundary instead of continuing in place."
      : "Close the current run with new_run_required so the migration can reopen on a fresh run."
});

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
    expected_post_apply_identity: {
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
        : classification.sameRunEligible &&
            classification.migrationClass === "kernel_wiring_patch"
          ? "Generated adapter kernel wiring drift can be repaired on this run after Codex authors a migration bundle and an operator accepts it."
        : input.adapterDriftReport.summary,
    suggested_updates: input.adapterDriftReport.suggested_updates,
    ...(proposedRuntimeConfigPatch
      ? { proposed_runtime_config_patch: proposedRuntimeConfigPatch }
      : {}),
    ...((classification.autoapplyEligible || classification.sameRunEligible)
      ? {
          proposed_contract_patch: {
            append_notes: [
              `${
                classification.migrationClass === "kernel_wiring_patch"
                  ? "Applied kernel-wiring migration"
                  : "Applied runtime-surface migration"
              } ${proposalId} after ${input.adapterDriftReport.recontract_reason}.`
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
    input.proposal.apply_mode !== "same_run_in_place"
  ) {
    throw new Error(
      `Adapter migration proposal '${input.proposal.proposal_id}' is not eligible for same-run generated-local apply.`
    );
  }

  const adapterContractPath = resolve(input.loadedAdapter.contract_path);
  const adapterRoot = dirname(adapterContractPath);
  const runtimeConfigPath = generatedAdapterRuntimeConfigPath(adapterContractPath);
  const generatedAdapterRoot =
    basename(adapterRoot) === "generated-adapter"
      ? resolve(adapterRoot, "codex-adapter")
      : resolve(adapterRoot, ".generated", "codex-adapter");
  const backupDirectory = join(
    input.runtimeDirectory,
    "adapter-migrations",
    fileSafeToken(input.proposal.proposal_id),
    "before"
  );
  await mkdir(backupDirectory, { recursive: true });
  await copyFile(adapterContractPath, join(backupDirectory, "adapter.generated.json"));
  if (await pathExists(generatedAdapterRoot)) {
    await cp(generatedAdapterRoot, join(backupDirectory, ".generated", "codex-adapter"), {
      recursive: true
    });
  }

  const changedFiles = new Set<string>();
  if (input.proposal.patch_bundle_path) {
    const patchPath = resolve(input.proposal.patch_bundle_path);
    const patchText = await readFile(patchPath, "utf8");
    const patchChangedFiles = parsePatchChangedFiles(patchText);
    if (patchChangedFiles.length === 0) {
      throw new Error(
        `Adapter migration patch bundle '${patchPath}' did not declare any changed files.`
      );
    }
    const invalidPath = patchChangedFiles.find(
      (relativePath) => !isGeneratedLocalAdapterSurfacePath(relativePath)
    );
    if (invalidPath) {
      throw new Error(
        `Adapter migration patch bundle '${patchPath}' touched '${invalidPath}', which is outside the generated adapter write surface.`
      );
    }
    await runGitApply({
      cwd: isPathInside(repoRoot, adapterRoot) ? repoRoot : adapterRoot,
      patchPath,
      ...(isPathInside(repoRoot, adapterRoot)
        ? {
            directory:
              normalizePatchPath(relative(repoRoot, adapterRoot)).replace(
                /^$/,
                "."
              )
          }
        : {})
    });
    for (const relativePath of patchChangedFiles) {
      changedFiles.add(resolve(adapterRoot, relativePath));
    }
  }

  if (input.proposal.proposed_runtime_config_patch) {
    const runtimeConfig = await loadJson<GeneratedRuntimeConfig>(runtimeConfigPath);
    const nextRuntimeConfig = {
      ...runtimeConfig,
      ...input.proposal.proposed_runtime_config_patch
    };
    await writeJson(runtimeConfigPath, nextRuntimeConfig);
    changedFiles.add(resolve(runtimeConfigPath));
  }

  const adapterContract = await loadJson<Record<string, unknown>>(adapterContractPath);
  const currentNotes = Array.isArray(adapterContract.notes)
    ? adapterContract.notes.filter((note): note is string => typeof note === "string")
    : [];
  const migrationNote =
    input.proposal.proposed_contract_patch &&
    typeof input.proposal.proposed_contract_patch === "object" &&
    Array.isArray(input.proposal.proposed_contract_patch.append_notes) &&
    input.proposal.proposed_contract_patch.append_notes.length > 0
      ? String(input.proposal.proposed_contract_patch.append_notes[0])
      : `Applied adapter migration ${input.proposal.proposal_id}.`;
  const nextAdapterContract = {
    ...adapterContract,
    notes: currentNotes.includes(migrationNote)
      ? currentNotes
      : [...currentNotes, migrationNote]
  };
  await writeJson(adapterContractPath, nextAdapterContract);
  changedFiles.add(resolve(adapterContractPath));

  return {
    changedFiles: [...changedFiles],
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
