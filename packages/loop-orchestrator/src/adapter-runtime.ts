import { access, readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";

import { loadJson, repoRoot, writeJson, writeText } from "./file-system.js";
import type {
  AdapterCapabilityExecution,
  AdapterCriterionResult,
  AdapterEvidenceItem,
  AdapterExecutionAttestation,
  AdapterCapabilityName,
  AdapterCapabilityPacket,
  AdapterCapabilityResult,
  BrowserJourneyStep,
  BrowserJourneyStepAction,
  CoreVerificationProbeMode,
  CoreVerificationProbeRole,
  CoreVerificationProbeScope,
  ExternalAdapterContract,
  LiveVerificationMode,
  LoadedAdapterContract,
  LoadedVerificationProfile,
  ProbeSemanticLevel,
  ProofCapabilityName,
  RoundVerdict,
  TargetFamily,
  TargetSurface,
  TargetManifest,
  TargetManifestKey,
  ValidationLane,
  VerificationAssertionTag,
  VerificationCriterion,
  VerificationProfile,
  VerificationCoreProbe,
  VerificationProviderSpec,
  VerifiedAdapterCriterionResult,
  VerifiedAdapterEvidenceItem,
  VerificationWitness,
  VerificationWitnessStep
} from "./types.js";

const defaultCapabilityResult = (
  capability: AdapterCapabilityName,
  summary: string
): AdapterCapabilityResult => ({
  capability,
  ok: false,
  summary,
  findings: [summary],
  evidence_paths: []
});

const roundVerdicts = new Set<RoundVerdict>(["advance", "revise", "hold"]);
const criterionStatuses = new Set<"pass" | "fail">(["pass", "fail"]);
const verificationOperators = new Set([
  "equals",
  "contains",
  "regex",
  "number_gte",
  "number_lte"
]);
const adapterCapabilities = new Set<AdapterCapabilityName>([
  "prepare_target",
  "apply_change",
  "run_target",
  "capture_evidence",
  "run_checks",
  "grade_round"
]);
const proofCapabilities = new Set<ProofCapabilityName>([
  "capture_evidence",
  "run_checks",
  "grade_round"
]);
const capabilitiesRequiringEvidence = new Set<AdapterCapabilityName>([
  "capture_evidence",
  "run_checks",
  "grade_round"
]);
const textEvidenceExtensions = new Set([
  ".txt",
  ".log",
  ".md",
  ".markdown",
  ".csv",
  ".html",
  ".htm",
  ".xml",
  ".yml",
  ".yaml"
]);
const jsonEvidenceExtensions = new Set([".json"]);
const imageEvidenceExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp"
]);
const liveVerificationModes = new Set<LiveVerificationMode>([
  "browser",
  "api",
  "db",
  "shell"
]);
const targetSurfaces = new Set<TargetSurface>(["browser", "api"]);
const targetFamilies = new Set<TargetFamily>([
  "generic-core",
  "api-service",
  "crud-api",
  "chat-agent",
  "browser-app",
  "browser-editor",
  "editor-app",
  "fullstack-app",
  "dashboard"
]);
const validationLanes = new Set<ValidationLane>([
  "deterministic_semantic",
  "environment_integration"
]);
const verificationAssertionTags = new Set<VerificationAssertionTag>([
  "browser",
  "api",
  "persistence",
  "error_path",
  "auth",
  "consistency",
  "workflow_multi_step",
  "latency_budget",
  "undo_redo",
  "grounded_tool_use"
]);
const coreVerificationProbeModes = new Set<CoreVerificationProbeMode>([
  "browser_journey",
  "browser",
  "http_json",
  "http",
  "file_contains",
  "json_value",
  "shell_command"
]);
const coreVerificationProbeRoles = new Set<CoreVerificationProbeRole>([
  "supporting",
  "release_gate"
]);
const coreVerificationProbeScopes = new Set<CoreVerificationProbeScope>([
  "target_root"
]);
const targetManifestKeys = new Set<TargetManifestKey>([
  "health_url",
  "app_url",
  "api_base_url"
]);
const probeSemanticLevels = new Set<ProbeSemanticLevel>([
  "liveness",
  "feature",
  "workflow"
]);
const browserJourneyStepActions = new Set<BrowserJourneyStepAction>([
  "goto",
  "click",
  "fill",
  "press",
  "wait_for",
  "assert_visible",
  "assert_text",
  "assert_url"
]);

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const sha256ForBuffer = (value: Buffer | string): string =>
  createHash("sha256").update(value).digest("hex");

const commandTokens = (command: string): string[] =>
  command.match(/"[^"]+"|'[^']+'|\S+/g)?.map((token) => token.replace(/^['"]|['"]$/g, "")) ?? [];

const commandTargetFingerprint = (input: {
  command: string;
  baseDirectory: string;
  cwd?: string;
}): string => {
  const tokens = commandTokens(input.command);
  if (tokens.length === 0) {
    return "raw:";
  }

  const commandName = tokens[0].toLowerCase();
  const candidateScript = tokens[1];
  const scriptLike =
    candidateScript &&
    [".js", ".cjs", ".mjs", ".ts", ".ps1", ".sh", ".cmd", ".bat", ".py"].includes(
      extname(candidateScript).toLowerCase()
    );
  if (
    scriptLike &&
    [
      "node",
      "node.exe",
      "bun",
      "bun.exe",
      "python",
      "python3",
      "python.exe",
      "bash",
      "sh",
      "powershell",
      "powershell.exe",
      "cmd",
      "cmd.exe"
    ].includes(commandName)
  ) {
    const scriptPath = isAbsolute(candidateScript)
      ? resolve(candidateScript)
      : resolve(input.cwd ?? input.baseDirectory, candidateScript);
    return `${commandName}:${scriptPath}`;
  }

  return `raw:${input.command.trim().toLowerCase()}`;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasPrimitiveMetadata = (
  value: unknown
): value is Record<string, string | number | boolean> =>
  isPlainObject(value) &&
  Object.values(value).every(
    (entry) =>
      typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean"
  );

const normalizeScoreWeightBlock = (
  input: {
    rawValue: unknown;
    allowedKeys: readonly string[];
    profilePath: string;
    fieldName: string;
  }
): Record<string, number> | undefined => {
  if (input.rawValue === undefined) {
    return undefined;
  }

  if (!isPlainObject(input.rawValue)) {
    throw new Error(
      `Verification profile '${input.profilePath}' must use an object for '${input.fieldName}'.`
    );
  }

  const weights = Object.fromEntries(
    Object.entries(input.rawValue).map(([rawKey, rawValue]) => {
      if (!input.allowedKeys.includes(rawKey)) {
        throw new Error(
          `Verification profile '${input.profilePath}' contains unsupported weight '${input.fieldName}.${rawKey}'.`
        );
      }
      if (typeof rawValue !== "number" || !Number.isFinite(rawValue) || rawValue < 0) {
        throw new Error(
          `Verification profile '${input.profilePath}' must use finite numbers >= 0 for '${input.fieldName}.${rawKey}'.`
        );
      }
      return [rawKey, rawValue];
    })
  );

  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    throw new Error(
      `Verification profile '${input.profilePath}' must assign a positive total weight for '${input.fieldName}'.`
    );
  }

  return weights;
};

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const resolvedPath = (path: string): string =>
  resolve(repoRoot, path);

const isProofCapability = (capability: AdapterCapabilityName): capability is ProofCapabilityName =>
  proofCapabilities.has(capability as ProofCapabilityName);

const isVerificationCapability = (
  value: unknown
): value is VerificationCriterion["capability"] => value === "run_checks" || value === "grade_round";

const isLiveVerificationMode = (value: unknown): value is LiveVerificationMode =>
  typeof value === "string" && liveVerificationModes.has(value as LiveVerificationMode);

const isTargetSurface = (value: unknown): value is TargetSurface =>
  typeof value === "string" && targetSurfaces.has(value as TargetSurface);

const isTargetFamily = (value: unknown): value is TargetFamily =>
  typeof value === "string" && targetFamilies.has(value as TargetFamily);

const isValidationLane = (value: unknown): value is ValidationLane =>
  typeof value === "string" && validationLanes.has(value as ValidationLane);

const isVerificationAssertionTag = (value: unknown): value is VerificationAssertionTag =>
  typeof value === "string" &&
  verificationAssertionTags.has(value as VerificationAssertionTag);

const isCoreVerificationProbeMode = (
  value: unknown
): value is CoreVerificationProbeMode =>
  typeof value === "string" &&
  coreVerificationProbeModes.has(value as CoreVerificationProbeMode);

const isCoreVerificationProbeScope = (
  value: unknown
): value is CoreVerificationProbeScope =>
  typeof value === "string" &&
  coreVerificationProbeScopes.has(value as CoreVerificationProbeScope);

const isCoreVerificationProbeRole = (
  value: unknown
): value is CoreVerificationProbeRole =>
  typeof value === "string" &&
  coreVerificationProbeRoles.has(value as CoreVerificationProbeRole);

const isTargetManifestKey = (value: unknown): value is TargetManifestKey =>
  typeof value === "string" && targetManifestKeys.has(value as TargetManifestKey);

const isProbeSemanticLevel = (value: unknown): value is ProbeSemanticLevel =>
  typeof value === "string" && probeSemanticLevels.has(value as ProbeSemanticLevel);

const isBrowserJourneyStepAction = (
  value: unknown
): value is BrowserJourneyStepAction =>
  typeof value === "string" && browserJourneyStepActions.has(value as BrowserJourneyStepAction);

const defaultProbeRoleForMode = (
  mode: CoreVerificationProbeMode
): CoreVerificationProbeRole =>
  mode === "http_json" || mode === "browser_journey" ? "release_gate" : "supporting";

const isHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const normalizedEvidenceKind = (
  explicitKind: string | undefined,
  evidencePath: string
): string => explicitKind?.trim().toLowerCase() ?? extname(evidencePath).toLowerCase();

const isJsonEvidence = (kind: string, evidencePath: string): boolean =>
  kind.includes("json") || jsonEvidenceExtensions.has(extname(evidencePath).toLowerCase());

const isTextEvidence = (kind: string, evidencePath: string): boolean =>
  kind.includes("text") ||
  kind.includes("log") ||
  kind.includes("report") ||
  kind.includes("markdown") ||
  kind.includes("html") ||
  kind.includes("xml") ||
  kind.includes("yaml") ||
  textEvidenceExtensions.has(extname(evidencePath).toLowerCase());

const isImageEvidence = (kind: string, evidencePath: string): boolean =>
  kind.includes("image") ||
  kind.includes("screenshot") ||
  imageEvidenceExtensions.has(extname(evidencePath).toLowerCase());

const hasExpectedImageSignature = (buffer: Buffer, evidencePath: string): boolean => {
  const extension = extname(evidencePath).toLowerCase();
  if (extension === ".png") {
    return buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    );
  }
  if (extension === ".gif") {
    return buffer.subarray(0, 4).toString("ascii") === "GIF8";
  }
  if (extension === ".webp") {
    return (
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }

  return true;
};

const inspectEvidenceContent = async (input: {
  evidencePath: string;
  resolvedEvidencePath: string;
  kind?: string;
}): Promise<{ ok: boolean; summary: string }> => {
  const inferredKind = normalizedEvidenceKind(input.kind, input.evidencePath);

  if (isJsonEvidence(inferredKind, input.evidencePath)) {
    const raw = await readFile(input.resolvedEvidencePath, "utf8");
    const trimmed = raw.trim();
    if (!trimmed) {
      return {
        ok: false,
        summary: `Evidence '${input.evidencePath}' is empty after trimming and cannot count as structured proof.`
      };
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed === null) {
        return {
          ok: false,
          summary: `Evidence '${input.evidencePath}' parsed as null and does not describe a meaningful result.`
        };
      }
      if (Array.isArray(parsed) && parsed.length === 0) {
        return {
          ok: false,
          summary: `Evidence '${input.evidencePath}' parsed as an empty array and does not describe a meaningful result.`
        };
      }
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed) &&
        Object.keys(parsed).length === 0
      ) {
        return {
          ok: false,
          summary: `Evidence '${input.evidencePath}' parsed as an empty object and does not describe a meaningful result.`
        };
      }

      return {
        ok: true,
        summary:
          typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
            ? `Structured evidence parsed as JSON with ${Object.keys(parsed).length} top-level keys.`
            : `Structured evidence parsed as JSON ${Array.isArray(parsed) ? `with ${parsed.length} items` : `value '${typeof parsed}'`}.`
      };
    } catch {
      return {
        ok: false,
        summary: `Evidence '${input.evidencePath}' is labeled as structured proof but is not valid JSON.`
      };
    }
  }

  if (isTextEvidence(inferredKind, input.evidencePath)) {
    const raw = await readFile(input.resolvedEvidencePath, "utf8");
    const trimmed = raw.trim();
    if (trimmed.length < 16) {
      return {
        ok: false,
        summary: `Evidence '${input.evidencePath}' is too short (${trimmed.length} trimmed characters) to count as meaningful text proof.`
      };
    }

    return {
      ok: true,
      summary: `Text evidence contains ${trimmed.length} trimmed characters of readable content.`
    };
  }

  const raw = await readFile(input.resolvedEvidencePath);
  if (isImageEvidence(inferredKind, input.evidencePath)) {
    if (raw.length < 1024) {
      return {
        ok: false,
        summary: `Evidence '${input.evidencePath}' is too small (${raw.length} bytes) to count as a meaningful image artifact.`
      };
    }
    if (!hasExpectedImageSignature(raw, input.evidencePath)) {
      return {
        ok: false,
        summary: `Evidence '${input.evidencePath}' does not match the expected image signature for its file type.`
      };
    }

    return {
      ok: true,
      summary: `Image evidence is ${raw.length} bytes and matches its declared file signature.`
    };
  }

  if (raw.length < 64) {
    return {
      ok: false,
      summary: `Evidence '${input.evidencePath}' is too small (${raw.length} bytes) to count as a meaningful binary artifact.`
    };
  }

  return {
    ok: true,
    summary: `Binary evidence is ${raw.length} bytes.`
  };
};

const resolveEvidencePath = async (input: {
  evidencePath: string;
  baseDirectory: string;
  cwd: string;
  targetRoot: string;
  runDirectory: string;
  roundDirectory: string;
}): Promise<string | undefined> => {
  const trimmedPath = input.evidencePath.trim();
  if (!trimmedPath) {
    return undefined;
  }

  const candidates = isAbsolute(trimmedPath)
    ? [trimmedPath]
    : unique([
        resolve(input.cwd, trimmedPath),
        resolve(input.targetRoot, trimmedPath),
        resolve(input.roundDirectory, trimmedPath),
        resolve(input.runDirectory, trimmedPath),
        resolve(input.baseDirectory, trimmedPath)
      ]);

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return undefined;
};

const parseStringList = (
  value: unknown,
  errorMessage: string,
  validationErrors: string[]
): string[] => {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    validationErrors.push(errorMessage);
    return [];
  }

  return unique(value.map((entry) => entry.trim()).filter(Boolean));
};

const normalizeEvidenceItems = (
  input: {
    capability: AdapterCapabilityName;
    rawResult?: Record<string, unknown>;
    evidencePaths: string[];
  },
  validationErrors: string[]
): AdapterEvidenceItem[] => {
  if (input.rawResult?.evidence_items === undefined) {
    return input.evidencePaths.map((path) => ({ path }));
  }

  if (!Array.isArray(input.rawResult.evidence_items)) {
    validationErrors.push(
      `Capability '${input.capability}' returned a non-array 'evidence_items' field.`
    );
    return [];
  }

  const normalizedItems: AdapterEvidenceItem[] = [];
  for (const rawItem of input.rawResult.evidence_items) {
    if (!isPlainObject(rawItem)) {
      validationErrors.push(
        `Capability '${input.capability}' returned a non-object evidence item.`
      );
      continue;
    }

    const pathValue = typeof rawItem.path === "string" ? rawItem.path.trim() : "";
    if (!pathValue) {
      validationErrors.push(
        `Capability '${input.capability}' returned an evidence item without a path.`
      );
      continue;
    }

    const kindValue =
      typeof rawItem.kind === "string" && rawItem.kind.trim().length > 0
        ? rawItem.kind.trim()
        : undefined;
    if (rawItem.kind !== undefined && kindValue === undefined) {
      validationErrors.push(
        `Capability '${input.capability}' returned an evidence item with an empty 'kind'.`
      );
    }

    const descriptionValue =
      typeof rawItem.description === "string" && rawItem.description.trim().length > 0
        ? rawItem.description.trim()
        : undefined;
    if (rawItem.description !== undefined && descriptionValue === undefined) {
      validationErrors.push(
        `Capability '${input.capability}' returned an evidence item with an empty 'description'.`
      );
    }

    const supportsCheckIds = parseStringList(
      rawItem.supports_check_ids,
      `Capability '${input.capability}' returned a non-string 'supports_check_ids' collection.`,
      validationErrors
    );
    const supportsCriterionIds = parseStringList(
      rawItem.supports_criterion_ids,
      `Capability '${input.capability}' returned a non-string 'supports_criterion_ids' collection.`,
      validationErrors
    );
    const derivedFromCapabilities = parseStringList(
      rawItem.derived_from_capabilities,
      `Capability '${input.capability}' returned a non-string 'derived_from_capabilities' collection.`,
      validationErrors
    ).filter((capability) => {
      if (adapterCapabilities.has(capability as AdapterCapabilityName)) {
        return true;
      }

      validationErrors.push(
        `Capability '${input.capability}' referenced unknown derived capability '${capability}'.`
      );
      return false;
    }) as AdapterCapabilityName[];
    const derivedFromEvidencePaths = parseStringList(
      rawItem.derived_from_evidence_paths,
      `Capability '${input.capability}' returned a non-string 'derived_from_evidence_paths' collection.`,
      validationErrors
    );

    normalizedItems.push({
      path: pathValue,
      ...(kindValue ? { kind: kindValue } : {}),
      ...(descriptionValue ? { description: descriptionValue } : {}),
      ...(supportsCheckIds.length > 0 ? { supports_check_ids: supportsCheckIds } : {}),
      ...(supportsCriterionIds.length > 0
        ? { supports_criterion_ids: supportsCriterionIds }
        : {}),
      ...(derivedFromCapabilities.length > 0
        ? { derived_from_capabilities: derivedFromCapabilities }
        : {}),
      ...(derivedFromEvidencePaths.length > 0
        ? { derived_from_evidence_paths: derivedFromEvidencePaths }
        : {})
    });
  }

  const itemPaths = normalizedItems.map((item) => item.path);
  const missingFromItems = input.evidencePaths.filter((path) => !itemPaths.includes(path));
  const missingFromPaths = itemPaths.filter((path) => !input.evidencePaths.includes(path));

  if (missingFromItems.length > 0 || missingFromPaths.length > 0) {
    validationErrors.push(
      `Capability '${input.capability}' reported inconsistent 'evidence_paths' and 'evidence_items' entries.`
    );
  }

  return normalizedItems;
};

const normalizeCriteriaResults = (
  input: {
    capability: AdapterCapabilityName;
    rawResult?: Record<string, unknown>;
  },
  validationErrors: string[]
): AdapterCriterionResult[] => {
  if (input.rawResult?.criteria_results === undefined) {
    return [];
  }

  if (!Array.isArray(input.rawResult.criteria_results)) {
    validationErrors.push(
      `Capability '${input.capability}' returned a non-array 'criteria_results' field.`
    );
    return [];
  }

  const normalizedCriteria: AdapterCriterionResult[] = [];
  for (const rawCriterion of input.rawResult.criteria_results) {
    if (!isPlainObject(rawCriterion)) {
      validationErrors.push(
        `Capability '${input.capability}' returned a non-object criterion result.`
      );
      continue;
    }

    const criterionId =
      typeof rawCriterion.criterion_id === "string" ? rawCriterion.criterion_id.trim() : "";
    if (!criterionId) {
      validationErrors.push(
        `Capability '${input.capability}' returned a criterion result without a criterion_id.`
      );
      continue;
    }

    const status =
      typeof rawCriterion.status === "string" &&
      criterionStatuses.has(rawCriterion.status as "pass" | "fail")
        ? (rawCriterion.status as "pass" | "fail")
        : undefined;
    if (!status) {
      validationErrors.push(
        `Capability '${input.capability}' returned criterion '${criterionId}' with an invalid status.`
      );
      continue;
    }

    const summary =
      typeof rawCriterion.summary === "string" ? rawCriterion.summary.trim() : "";
    if (!summary) {
      validationErrors.push(
        `Capability '${input.capability}' returned criterion '${criterionId}' with an empty summary.`
      );
      continue;
    }

    const evidencePaths = parseStringList(
      rawCriterion.evidence_paths,
      `Capability '${input.capability}' returned criterion '${criterionId}' with a non-string 'evidence_paths' collection.`,
      validationErrors
    );
    if (evidencePaths.length === 0) {
      validationErrors.push(
        `Capability '${input.capability}' returned criterion '${criterionId}' without evidence paths.`
      );
      continue;
    }

    const hard =
      rawCriterion.hard === undefined
        ? undefined
        : typeof rawCriterion.hard === "boolean"
          ? rawCriterion.hard
          : (() => {
              validationErrors.push(
                `Capability '${input.capability}' returned criterion '${criterionId}' with a non-boolean 'hard' field.`
              );
              return undefined;
            })();
    const threshold =
      rawCriterion.threshold === undefined
        ? undefined
        : typeof rawCriterion.threshold === "string" && rawCriterion.threshold.trim().length > 0
          ? rawCriterion.threshold.trim()
          : (() => {
              validationErrors.push(
                `Capability '${input.capability}' returned criterion '${criterionId}' with an empty 'threshold'.`
              );
              return undefined;
            })();
    const observedValue =
      rawCriterion.observed_value === undefined
        ? undefined
        : typeof rawCriterion.observed_value === "string" &&
            rawCriterion.observed_value.trim().length > 0
          ? rawCriterion.observed_value.trim()
          : (() => {
              validationErrors.push(
                `Capability '${input.capability}' returned criterion '${criterionId}' with an empty 'observed_value'.`
              );
              return undefined;
            })();

    normalizedCriteria.push({
      criterion_id: criterionId,
      status,
      summary,
      evidence_paths: evidencePaths,
      ...(hard !== undefined ? { hard } : {}),
      ...(threshold ? { threshold } : {}),
      ...(observedValue ? { observed_value: observedValue } : {})
    });
  }

  const duplicateCriterionIds = normalizedCriteria.filter(
    (criterion, index, allCriteria) =>
      allCriteria.findIndex((candidate) => candidate.criterion_id === criterion.criterion_id) !==
      index
  );
  if (duplicateCriterionIds.length > 0) {
    validationErrors.push(
      `Capability '${input.capability}' returned duplicate criterion ids: ${unique(duplicateCriterionIds.map((criterion) => criterion.criterion_id)).join(", ")}.`
    );
  }

  return normalizedCriteria;
};

const parseVerificationWitness = async (input: {
  capability: AdapterCapabilityName;
  evidencePath: string;
  resolvedEvidencePath: string;
  providerId: string;
  providerRole: "executor" | "verifier";
  targetRoot: string;
  baseDirectory: string;
  cwd: string;
  runDirectory: string;
  roundDirectory: string;
}): Promise<{ witness?: VerificationWitness; errors: string[] }> => {
  const errors: string[] = [];
  if (!isProofCapability(input.capability)) {
    errors.push(
      `Capability '${input.capability}' cannot publish a verification-witness artifact because it is not a proof capability.`
    );
    return { errors };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(input.resolvedEvidencePath, "utf8"));
  } catch {
    errors.push(`Evidence '${input.evidencePath}' is labeled as verification-witness but is not valid JSON.`);
    return { errors };
  }

  if (!isPlainObject(parsed)) {
    errors.push(`Evidence '${input.evidencePath}' must be a JSON object when kind is verification-witness.`);
    return { errors };
  }

  const witnessId = typeof parsed.witness_id === "string" ? parsed.witness_id.trim() : "";
  if (!witnessId) {
    errors.push(`Evidence '${input.evidencePath}' is missing a non-empty witness_id.`);
  }
  const providerId =
    typeof parsed.provider_id === "string" ? parsed.provider_id.trim() : "";
  if (!providerId) {
    errors.push(`Evidence '${input.evidencePath}' is missing a non-empty provider_id.`);
  } else if (providerId !== input.providerId) {
    errors.push(
      `Evidence '${input.evidencePath}' reported provider_id '${providerId}', expected '${input.providerId}'.`
    );
  }
  const providerRole = parsed.provider_role;
  if (providerRole !== "verifier") {
    errors.push(`Evidence '${input.evidencePath}' must declare provider_role 'verifier'.`);
  }
  if (input.providerRole !== "verifier") {
    errors.push(
      `Capability '${input.capability}' executed as '${input.providerRole}' but attempted to publish a verification witness.`
    );
  }
  const capability =
    typeof parsed.capability === "string" && proofCapabilities.has(parsed.capability as ProofCapabilityName)
      ? (parsed.capability as ProofCapabilityName)
      : undefined;
  if (!capability) {
    errors.push(
      `Evidence '${input.evidencePath}' must report a proof capability when kind is verification-witness.`
    );
  }
  const mode = isLiveVerificationMode(parsed.mode) ? parsed.mode : undefined;
  if (!mode) {
    errors.push(`Evidence '${input.evidencePath}' is missing a supported live verification mode.`);
  }
  const targetRoot =
    typeof parsed.target_root === "string" ? parsed.target_root.trim() : "";
  if (!targetRoot) {
    errors.push(`Evidence '${input.evidencePath}' is missing a non-empty target_root.`);
  } else if (resolve(targetRoot) !== resolve(input.targetRoot)) {
    errors.push(
      `Evidence '${input.evidencePath}' reported target_root '${targetRoot}', expected '${input.targetRoot}'.`
    );
  }
  const targetReference =
    typeof parsed.target_reference === "string" ? parsed.target_reference.trim() : "";
  if (!targetReference) {
    errors.push(`Evidence '${input.evidencePath}' is missing a non-empty target_reference.`);
  }
  const interactionLogPath =
    typeof parsed.interaction_log_path === "string"
      ? parsed.interaction_log_path.trim()
      : "";
  let resolvedInteractionLogPath: string | undefined;
  if (!interactionLogPath) {
    errors.push(`Evidence '${input.evidencePath}' is missing an interaction_log_path.`);
  } else {
    resolvedInteractionLogPath = await resolveEvidencePath({
      evidencePath: interactionLogPath,
      baseDirectory: input.baseDirectory,
      cwd: input.cwd,
      targetRoot: input.targetRoot,
      runDirectory: input.runDirectory,
      roundDirectory: input.roundDirectory
    });
    if (!resolvedInteractionLogPath) {
      errors.push(
        `Evidence '${input.evidencePath}' referenced missing interaction_log_path '${interactionLogPath}'.`
      );
    }
  }
  const assertionIds = parseStringList(
    parsed.assertion_ids,
    `Evidence '${input.evidencePath}' must contain a string assertion_ids array.`,
    errors
  );
  if (assertionIds.length === 0) {
    errors.push(`Evidence '${input.evidencePath}' must cite at least one assertion_id.`);
  }

  const rawSteps = parsed.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    errors.push(`Evidence '${input.evidencePath}' must contain a non-empty steps array.`);
  }
  const steps: VerificationWitnessStep[] = [];
  if (Array.isArray(rawSteps)) {
    for (const [index, rawStep] of rawSteps.entries()) {
      if (!isPlainObject(rawStep)) {
        errors.push(`Evidence '${input.evidencePath}' contains a non-object witness step at index ${index}.`);
        continue;
      }
      const action = typeof rawStep.action === "string" ? rawStep.action.trim() : "";
      const outcome =
        rawStep.outcome === "pass" || rawStep.outcome === "fail" || rawStep.outcome === "info"
          ? rawStep.outcome
          : undefined;
      const artifactPaths = parseStringList(
        rawStep.artifact_paths,
        `Evidence '${input.evidencePath}' contains a non-string artifact_paths collection in step ${index}.`,
        errors
      );
      if (!action) {
        errors.push(`Evidence '${input.evidencePath}' witness step ${index} is missing an action.`);
      }
      if (!outcome) {
        errors.push(`Evidence '${input.evidencePath}' witness step ${index} has an invalid outcome.`);
      }
      if (artifactPaths.length === 0) {
        errors.push(`Evidence '${input.evidencePath}' witness step ${index} must cite at least one artifact path.`);
      }
      for (const artifactPath of artifactPaths) {
        const resolvedArtifactPath = await resolveEvidencePath({
          evidencePath: artifactPath,
          baseDirectory: input.baseDirectory,
          cwd: input.cwd,
          targetRoot: input.targetRoot,
          runDirectory: input.runDirectory,
          roundDirectory: input.roundDirectory
        });
        if (!resolvedArtifactPath) {
          errors.push(
            `Evidence '${input.evidencePath}' witness step ${index} referenced missing artifact '${artifactPath}'.`
          );
        }
      }
      if (action && outcome && artifactPaths.length > 0) {
        steps.push({
          action,
          outcome,
          artifact_paths: artifactPaths
        });
      }
    }
  }

  if (steps.length > 0 && !steps.some((step) => step.outcome === "pass")) {
    errors.push(`Evidence '${input.evidencePath}' witness steps never record a passing verification action.`);
  }
  if (steps.length < 2) {
    errors.push(`Evidence '${input.evidencePath}' must describe at least two verification steps.`);
  }

  if (
    errors.length > 0 ||
    !witnessId ||
    !providerId ||
    !capability ||
    !mode ||
    !targetReference ||
    !resolvedInteractionLogPath
  ) {
    return { errors };
  }

  return {
    witness: {
      witness_id: witnessId,
      provider_id: providerId,
      provider_role: "verifier",
      capability,
      mode,
      target_root: resolve(input.targetRoot),
      target_reference: targetReference,
      interaction_log_path: resolvedInteractionLogPath,
      assertion_ids: assertionIds,
      steps
    },
    errors
  };
};

const validateAdapterCapabilityResult = async (input: {
  capability: AdapterCapabilityName;
  rawResult: unknown;
  providerId: string;
  providerRole: "executor" | "verifier";
  baseDirectory: string;
  cwd: string;
  targetRoot: string;
  runDirectory: string;
  roundDirectory: string;
}): Promise<{
  result: AdapterCapabilityResult;
  verified_evidence: VerifiedAdapterEvidenceItem[];
  verified_criteria_results: VerifiedAdapterCriterionResult[];
  verified_evidence_paths: string[];
  validation_errors: string[];
}> => {
  const validationErrors: string[] = [];
  const rawResult = isPlainObject(input.rawResult) ? input.rawResult : undefined;

  if (!rawResult) {
    validationErrors.push(`Capability '${input.capability}' wrote a non-object result payload.`);
  }

  const returnedCapability = rawResult?.capability;
  if (returnedCapability !== input.capability) {
    validationErrors.push(
      `Capability '${input.capability}' reported capability '${typeof returnedCapability === "string" ? returnedCapability : "unknown"}'.`
    );
  }

  const returnedOk = typeof rawResult?.ok === "boolean" ? rawResult.ok : undefined;
  if (returnedOk === undefined) {
    validationErrors.push(`Capability '${input.capability}' did not provide a boolean 'ok' field.`);
  }

  const summary = typeof rawResult?.summary === "string" ? rawResult.summary.trim() : "";
  if (!summary) {
    validationErrors.push(`Capability '${input.capability}' returned an empty summary.`);
  }

  const findings =
    Array.isArray(rawResult?.findings) && rawResult.findings.every((entry) => typeof entry === "string")
      ? unique(rawResult.findings.map((entry) => entry.trim()).filter(Boolean))
      : (() => {
          validationErrors.push(
            `Capability '${input.capability}' returned a non-string 'findings' collection.`
          );
          return [];
        })();

  const evidencePaths =
    Array.isArray(rawResult?.evidence_paths) &&
    rawResult.evidence_paths.every((entry) => typeof entry === "string")
      ? unique(rawResult.evidence_paths.map((entry) => entry.trim()).filter(Boolean))
      : (() => {
          validationErrors.push(
            `Capability '${input.capability}' returned a non-string 'evidence_paths' collection.`
          );
          return [];
        })();
  const evidenceItems = normalizeEvidenceItems(
    {
      capability: input.capability,
      rawResult,
      evidencePaths
    },
    validationErrors
  );
  const criteriaResults = normalizeCriteriaResults(
    {
      capability: input.capability,
      rawResult
    },
    validationErrors
  );

  const verifiedEvidence: VerifiedAdapterEvidenceItem[] = [];
  const verifiedCriteriaResults: VerifiedAdapterCriterionResult[] = [];
  const missingEvidencePaths: string[] = [];
  const emptyEvidencePaths: string[] = [];

  if (
    returnedOk === true &&
    capabilitiesRequiringEvidence.has(input.capability) &&
    evidenceItems.some((item) => !item.kind)
  ) {
    validationErrors.push(
      `Capability '${input.capability}' cannot claim success without evidence item kinds.`
    );
  }

  if (
    returnedOk === true &&
    capabilitiesRequiringEvidence.has(input.capability) &&
    evidenceItems.some((item) => !item.description)
  ) {
    validationErrors.push(
      `Capability '${input.capability}' cannot claim success without evidence item descriptions.`
    );
  }

  // Adapter evidence must resolve to real files before the core can trust it.
  for (const evidenceItem of evidenceItems) {
    const resolvedEvidencePath = await resolveEvidencePath({
      evidencePath: evidenceItem.path,
      baseDirectory: input.baseDirectory,
      cwd: input.cwd,
      targetRoot: input.targetRoot,
      runDirectory: input.runDirectory,
      roundDirectory: input.roundDirectory
    });

    if (resolvedEvidencePath) {
      const stats = await stat(resolvedEvidencePath);
      if (stats.size <= 0) {
        emptyEvidencePaths.push(evidenceItem.path);
        continue;
      }

      const resolvedDerivedFromEvidencePaths = unique(
        (
          await Promise.all(
            (evidenceItem.derived_from_evidence_paths ?? []).map(async (derivedPath) =>
              resolveEvidencePath({
                evidencePath: derivedPath,
                baseDirectory: input.baseDirectory,
                cwd: input.cwd,
                targetRoot: input.targetRoot,
                runDirectory: input.runDirectory,
                roundDirectory: input.roundDirectory
              })
            )
          )
        ).filter((path): path is string => Boolean(path))
      );
      if (
        resolvedDerivedFromEvidencePaths.length !==
        (evidenceItem.derived_from_evidence_paths ?? []).length
      ) {
        validationErrors.push(
          `Capability '${input.capability}' referenced missing upstream evidence paths from '${evidenceItem.path}'.`
        );
      }

      const contentInspection = await inspectEvidenceContent({
        evidencePath: evidenceItem.path,
        resolvedEvidencePath,
        kind: evidenceItem.kind
      });
      if (!contentInspection.ok) {
        validationErrors.push(
          `Capability '${input.capability}' submitted weak evidence: ${contentInspection.summary}`
        );
        continue;
      }

      const witness =
        evidenceItem.kind?.trim().toLowerCase() === "verification-witness"
          ? await parseVerificationWitness({
              capability: input.capability,
              evidencePath: evidenceItem.path,
              resolvedEvidencePath,
              providerId: input.providerId,
              providerRole: input.providerRole,
              targetRoot: input.targetRoot,
              baseDirectory: input.baseDirectory,
              cwd: input.cwd,
              runDirectory: input.runDirectory,
              roundDirectory: input.roundDirectory
            })
          : undefined;
      if (witness?.errors.length) {
        validationErrors.push(...witness.errors);
        continue;
      }

      verifiedEvidence.push({
        path: resolvedEvidencePath,
        size_bytes: stats.size,
        sha256: sha256ForBuffer(await readFile(resolvedEvidencePath)),
        produced_by_capability: witness?.witness?.capability ?? input.capability,
        ...(evidenceItem.kind ? { kind: evidenceItem.kind } : {}),
        ...(evidenceItem.description ? { description: evidenceItem.description } : {}),
        supports_check_ids: evidenceItem.supports_check_ids ?? [],
        supports_criterion_ids: evidenceItem.supports_criterion_ids ?? [],
        derived_from_capabilities: evidenceItem.derived_from_capabilities ?? [],
        derived_from_evidence_paths: resolvedDerivedFromEvidencePaths,
        content_summary: contentInspection.summary,
        ...(witness?.witness ? { witness: witness.witness } : {})
      });
    } else {
      missingEvidencePaths.push(evidenceItem.path);
    }
  }

  if (missingEvidencePaths.length > 0) {
    validationErrors.push(
      `Capability '${input.capability}' referenced missing evidence paths: ${missingEvidencePaths.join(", ")}.`
    );
  }
  if (emptyEvidencePaths.length > 0) {
    validationErrors.push(
      `Capability '${input.capability}' referenced empty evidence files: ${emptyEvidencePaths.join(", ")}.`
    );
  }

  if (
    returnedOk === true &&
    capabilitiesRequiringEvidence.has(input.capability) &&
    verifiedEvidence.length === 0
  ) {
    validationErrors.push(
      `Capability '${input.capability}' cannot claim success without at least one non-empty verifiable evidence file.`
    );
  }

  if (
    returnedOk === true &&
    (input.capability === "run_checks" || input.capability === "grade_round") &&
    criteriaResults.length === 0
  ) {
    validationErrors.push(
      `Capability '${input.capability}' cannot claim success without at least one criterion result.`
    );
  }

  const verifiedEvidencePathSet = new Set(verifiedEvidence.map((item) => item.path));
  for (const criterion of criteriaResults) {
    const resolvedCriterionEvidencePaths = unique(
      (
        await Promise.all(
          criterion.evidence_paths.map(async (criterionPath) =>
            resolveEvidencePath({
              evidencePath: criterionPath,
              baseDirectory: input.baseDirectory,
              cwd: input.cwd,
              targetRoot: input.targetRoot,
              runDirectory: input.runDirectory,
              roundDirectory: input.roundDirectory
            })
          )
        )
      ).filter((path): path is string => Boolean(path))
    );
    if (resolvedCriterionEvidencePaths.length !== criterion.evidence_paths.length) {
      validationErrors.push(
        `Capability '${input.capability}' criterion '${criterion.criterion_id}' referenced missing evidence paths.`
      );
      continue;
    }

    if (
      input.capability === "run_checks" &&
      resolvedCriterionEvidencePaths.some((path) => !verifiedEvidencePathSet.has(path))
    ) {
      validationErrors.push(
        `Capability 'run_checks' criterion '${criterion.criterion_id}' must reference evidence owned by the same capability result.`
      );
      continue;
    }

    verifiedCriteriaResults.push({
      criterion_id: criterion.criterion_id,
      status: criterion.status,
      summary: criterion.summary,
      evidence_paths: resolvedCriterionEvidencePaths,
      hard: criterion.hard ?? false,
      ...(criterion.threshold ? { threshold: criterion.threshold } : {}),
      ...(criterion.observed_value ? { observed_value: criterion.observed_value } : {})
    });
  }

  const metadata = rawResult?.metadata;
  if (metadata !== undefined && !hasPrimitiveMetadata(metadata)) {
    validationErrors.push(
      `Capability '${input.capability}' returned non-primitive metadata values.`
    );
  }

  let validatedTargetManifest: TargetManifest | undefined;
  const rawTargetManifest = rawResult?.target_manifest;
  if (rawTargetManifest !== undefined) {
    if (input.capability !== "run_target") {
      validationErrors.push(
        `Capability '${input.capability}' cannot return 'target_manifest'; only 'run_target' may publish target surfaces.`
      );
    } else if (!isPlainObject(rawTargetManifest)) {
      validationErrors.push(
        "Capability 'run_target' returned a non-object 'target_manifest' field."
      );
    } else {
      const targetManifest: TargetManifest = {};
      for (const key of ["health_url", "app_url", "api_base_url"] as const) {
        const rawValue = rawTargetManifest[key];
        if (rawValue === undefined) {
          continue;
        }
        if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
          validationErrors.push(
            `Capability 'run_target' returned an empty '${key}' in target_manifest.`
          );
          continue;
        }
        const value = rawValue.trim();
        if (!isHttpUrl(value)) {
          validationErrors.push(
            `Capability 'run_target' returned non-http target_manifest.${key} '${value}'.`
          );
          continue;
        }
        targetManifest[key] = value;
      }
      if (Object.keys(targetManifest).length === 0) {
        validationErrors.push(
          "Capability 'run_target' returned target_manifest without any usable target URLs."
        );
      } else {
        validatedTargetManifest = targetManifest;
      }
    }
  }

  let validatedScore: number | undefined;
  const rawScore = rawResult?.score;
  if (rawScore !== undefined) {
    if (input.capability !== "grade_round") {
      validationErrors.push(
        `Capability '${input.capability}' cannot return 'score'; only 'grade_round' may grade a round.`
      );
    } else if (typeof rawScore !== "number" || !Number.isFinite(rawScore) || rawScore < 0 || rawScore > 1) {
      validationErrors.push(`Capability 'grade_round' returned an out-of-range score '${String(rawScore)}'.`);
    } else {
      validatedScore = Number(rawScore.toFixed(3));
    }
  }

  let validatedVerdict: RoundVerdict | undefined;
  const rawVerdict = rawResult?.overall_verdict;
  if (rawVerdict !== undefined) {
    if (input.capability !== "grade_round") {
      validationErrors.push(
        `Capability '${input.capability}' cannot return 'overall_verdict'; only 'grade_round' may grade a round.`
      );
    } else if (typeof rawVerdict !== "string" || !roundVerdicts.has(rawVerdict as RoundVerdict)) {
      validationErrors.push(
        `Capability 'grade_round' returned an invalid overall verdict '${String(rawVerdict)}'.`
      );
    } else {
      validatedVerdict = rawVerdict as RoundVerdict;
    }
  }

  if (
    input.capability === "grade_round" &&
    returnedOk === true &&
    validatedScore === undefined &&
    validatedVerdict === undefined
  ) {
    validationErrors.push(
      "Capability 'grade_round' must provide at least a score or overall_verdict when it claims success."
    );
  }

  let validatedThresholdVerdict: "pass" | "fail" | undefined;
  const rawThresholdVerdict = rawResult?.threshold_verdict;
  if (rawThresholdVerdict !== undefined) {
    if (input.capability !== "grade_round") {
      validationErrors.push(
        `Capability '${input.capability}' cannot return 'threshold_verdict'; only 'grade_round' may report threshold state.`
      );
    } else if (rawThresholdVerdict !== "pass" && rawThresholdVerdict !== "fail") {
      validationErrors.push(
        `Capability 'grade_round' returned an invalid threshold_verdict '${String(rawThresholdVerdict)}'.`
      );
    } else {
      validatedThresholdVerdict = rawThresholdVerdict;
    }
  }

  const blockingCriterionIds = parseStringList(
    rawResult?.blocking_criterion_ids,
    `Capability '${input.capability}' returned a non-string 'blocking_criterion_ids' collection.`,
    validationErrors
  );
  if (blockingCriterionIds.length > 0 && input.capability !== "grade_round") {
    validationErrors.push(
      `Capability '${input.capability}' cannot return 'blocking_criterion_ids'; only 'grade_round' may mark blocking criteria.`
    );
  }
  const criterionIdSet = new Set(verifiedCriteriaResults.map((criterion) => criterion.criterion_id));
  const unknownBlockingCriterionIds = blockingCriterionIds.filter(
    (criterionId) => !criterionIdSet.has(criterionId)
  );
  if (unknownBlockingCriterionIds.length > 0) {
    validationErrors.push(
      `Capability '${input.capability}' referenced unknown blocking criteria: ${unknownBlockingCriterionIds.join(", ")}.`
    );
  }
  if (
    input.capability === "grade_round" &&
    returnedOk === true &&
    validatedThresholdVerdict === undefined
  ) {
    validationErrors.push(
      "Capability 'grade_round' must provide a threshold_verdict when it claims success."
    );
  }
  const hardFailedCriterionIds = verifiedCriteriaResults
    .filter((criterion) => criterion.hard && criterion.status === "fail")
    .map((criterion) => criterion.criterion_id);
  if (
    input.capability === "grade_round" &&
    validatedVerdict === "advance" &&
    validatedThresholdVerdict === "fail"
  ) {
    validationErrors.push(
      "Capability 'grade_round' cannot return overall_verdict 'advance' when threshold_verdict is 'fail'."
    );
  }
  if (
    input.capability === "grade_round" &&
    validatedVerdict === "advance" &&
    blockingCriterionIds.length > 0
  ) {
    validationErrors.push(
      "Capability 'grade_round' cannot return overall_verdict 'advance' while blocking_criterion_ids remain."
    );
  }
  if (
    input.capability === "grade_round" &&
    validatedVerdict === "advance" &&
    hardFailedCriterionIds.length > 0
  ) {
    validationErrors.push(
      `Capability 'grade_round' cannot return overall_verdict 'advance' while hard criteria fail: ${hardFailedCriterionIds.join(", ")}.`
    );
  }
  if (
    input.capability === "grade_round" &&
    validatedThresholdVerdict === "pass" &&
    blockingCriterionIds.length > 0
  ) {
    validationErrors.push(
      "Capability 'grade_round' cannot report threshold_verdict 'pass' while blocking_criterion_ids remain."
    );
  }

  const normalizedOk = returnedOk === true && validationErrors.length === 0;
  const fallbackSummary =
    summary || `Capability '${input.capability}' result failed schema or evidence validation.`;

  return {
    result: {
      capability: input.capability,
      ok: normalizedOk,
      summary:
        validationErrors.length === 0
          ? fallbackSummary
          : `${fallbackSummary} Validation errors: ${validationErrors.join(" ")}`,
      findings: unique([...findings, ...validationErrors]),
      evidence_paths: evidencePaths,
      ...(evidenceItems.length > 0 ? { evidence_items: evidenceItems } : {}),
      ...(validatedTargetManifest ? { target_manifest: validatedTargetManifest } : {}),
      ...(criteriaResults.length > 0 ? { criteria_results: criteriaResults } : {}),
      ...(validatedThresholdVerdict ? { threshold_verdict: validatedThresholdVerdict } : {}),
      ...(blockingCriterionIds.length > 0
        ? { blocking_criterion_ids: blockingCriterionIds }
        : {}),
      ...(metadata !== undefined && hasPrimitiveMetadata(metadata) ? { metadata } : {}),
      ...(validatedScore !== undefined ? { score: validatedScore } : {}),
      ...(validatedVerdict !== undefined ? { overall_verdict: validatedVerdict } : {})
    },
    verified_evidence: verifiedEvidence,
    verified_criteria_results: verifiedCriteriaResults,
    verified_evidence_paths: unique(verifiedEvidence.map((item) => item.path)),
    validation_errors: validationErrors
  };
};

const shellExecutableFor = (
  shell: "powershell" | "sh" | "bash" | "cmd" | undefined
): string | true => {
  switch (shell) {
    case "powershell":
      return "powershell.exe";
    case "sh":
      return "sh";
    case "bash":
      return "bash";
    case "cmd":
      return "cmd.exe";
    default:
      return true;
  }
};

const execCommand = async (input: {
  command: string;
  cwd: string;
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
  shell?: "powershell" | "sh" | "bash" | "cmd";
}): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}> =>
  new Promise((resolvePromise, rejectPromise) => {
    const startedAtDate = new Date();
    const child = spawn(input.command, {
      cwd: input.cwd,
      env: input.env,
      shell: shellExecutableFor(input.shell)
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, input.timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        rejectPromise(new Error(`Adapter command timed out: ${input.command}`));
        return;
      }
      const finishedAtDate = new Date();
      resolvePromise({
        code,
        stdout,
        stderr,
        startedAt: startedAtDate.toISOString(),
        finishedAt: finishedAtDate.toISOString(),
        durationMs: finishedAtDate.getTime() - startedAtDate.getTime()
      });
    });
  });

const normalizeVerificationProfile = (
  rawProfile: unknown,
  profilePath: string
): VerificationProfile => {
  if (!isPlainObject(rawProfile)) {
    throw new Error(`Verification profile '${profilePath}' must be a JSON object.`);
  }

  const profileId =
    typeof rawProfile.profile_id === "string" ? rawProfile.profile_id.trim() : "";
  if (!profileId) {
    throw new Error(`Verification profile '${profilePath}' is missing a non-empty 'profile_id'.`);
  }

  const label = typeof rawProfile.label === "string" ? rawProfile.label.trim() : "";
  if (!label) {
    throw new Error(`Verification profile '${profilePath}' is missing a non-empty 'label'.`);
  }
  const bundleLabel =
    rawProfile.bundle_label === undefined
      ? undefined
      : typeof rawProfile.bundle_label === "string" &&
          rawProfile.bundle_label.trim().length > 0
        ? rawProfile.bundle_label.trim()
        : (() => {
            throw new Error(
              `Verification profile '${profilePath}' has an empty 'bundle_label'.`
            );
          })();
  const targetFamily =
    rawProfile.target_family === undefined
      ? undefined
      : isTargetFamily(rawProfile.target_family)
        ? rawProfile.target_family
        : (() => {
            throw new Error(
              `Verification profile '${profilePath}' contains unsupported target family '${String(rawProfile.target_family)}'.`
            );
          })();
  const validationLane =
    rawProfile.validation_lane === undefined
      ? undefined
      : isValidationLane(rawProfile.validation_lane)
        ? rawProfile.validation_lane
        : (() => {
            throw new Error(
              `Verification profile '${profilePath}' contains unsupported validation lane '${String(rawProfile.validation_lane)}'.`
            );
          })();

  if (!Array.isArray(rawProfile.criteria)) {
    throw new Error(`Verification profile '${profilePath}' must contain a 'criteria' array.`);
  }

  const criteria: VerificationCriterion[] = rawProfile.criteria.map((rawCriterion, index) => {
    if (!isPlainObject(rawCriterion)) {
      throw new Error(
        `Verification profile '${profilePath}' contains a non-object criterion at index ${index}.`
      );
    }

    const criterionId =
      typeof rawCriterion.criterion_id === "string" ? rawCriterion.criterion_id.trim() : "";
    if (!criterionId) {
      throw new Error(
        `Verification profile '${profilePath}' contains a criterion without a non-empty 'criterion_id'.`
      );
    }

    const capability = rawCriterion.capability;
    if (!isVerificationCapability(capability)) {
      throw new Error(
        `Verification profile '${profilePath}' criterion '${criterionId}' has an invalid capability '${String(capability)}'.`
      );
    }

    const summary =
      typeof rawCriterion.summary === "string" ? rawCriterion.summary.trim() : "";
    if (!summary) {
      throw new Error(
        `Verification profile '${profilePath}' criterion '${criterionId}' is missing a non-empty 'summary'.`
      );
    }

    const operator =
      typeof rawCriterion.operator === "string" &&
      verificationOperators.has(rawCriterion.operator)
        ? (rawCriterion.operator as VerificationCriterion["operator"])
        : undefined;
    if (!operator) {
      throw new Error(
        `Verification profile '${profilePath}' criterion '${criterionId}' has an invalid operator '${String(rawCriterion.operator)}'.`
      );
    }

    const expectedValue =
      typeof rawCriterion.expected_value === "string"
        ? rawCriterion.expected_value.trim()
        : "";
    if (!expectedValue) {
      throw new Error(
        `Verification profile '${profilePath}' criterion '${criterionId}' is missing a non-empty 'expected_value'.`
      );
    }

    const hard =
      rawCriterion.hard === undefined
        ? undefined
        : typeof rawCriterion.hard === "boolean"
          ? rawCriterion.hard
          : (() => {
              throw new Error(
                `Verification profile '${profilePath}' criterion '${criterionId}' has a non-boolean 'hard' field.`
              );
            })();
    const assertionId =
      rawCriterion.assertion_id === undefined
        ? undefined
        : typeof rawCriterion.assertion_id === "string" &&
            rawCriterion.assertion_id.trim().length > 0
          ? rawCriterion.assertion_id.trim()
          : (() => {
              throw new Error(
                `Verification profile '${profilePath}' criterion '${criterionId}' has an empty 'assertion_id'.`
              );
            })();

    return {
      criterion_id: criterionId,
      capability,
      summary,
      operator,
      expected_value: expectedValue,
      ...(assertionId ? { assertion_id: assertionId } : {}),
      ...(hard !== undefined ? { hard } : {})
    };
  });

  const duplicateCriterionIds = criteria.filter(
    (criterion, index, allCriteria) =>
      allCriteria.findIndex(
        (candidate) =>
          candidate.criterion_id === criterion.criterion_id &&
          candidate.capability === criterion.capability
      ) !== index
  );
  if (duplicateCriterionIds.length > 0) {
    throw new Error(
      `Verification profile '${profilePath}' contains duplicate criterion/capability pairs: ${unique(
        duplicateCriterionIds.map(
          (criterion) => `${criterion.capability}:${criterion.criterion_id}`
        )
      ).join(", ")}.`
    );
  }

  const notes =
    rawProfile.notes === undefined
      ? undefined
      : Array.isArray(rawProfile.notes) &&
          rawProfile.notes.every((entry) => typeof entry === "string")
        ? unique(rawProfile.notes.map((entry) => entry.trim()).filter(Boolean))
        : (() => {
            throw new Error(
              `Verification profile '${profilePath}' returned a non-string 'notes' collection.`
            );
          })();
  const requiredLiveVerificationModes =
    rawProfile.required_live_verification_modes === undefined
      ? undefined
      : Array.isArray(rawProfile.required_live_verification_modes)
        ? unique(
            rawProfile.required_live_verification_modes.map((entry) => {
              if (!isLiveVerificationMode(entry)) {
                throw new Error(
                  `Verification profile '${profilePath}' contains unsupported live verification mode '${String(entry)}'.`
                );
              }
              return entry;
            })
          )
        : (() => {
            throw new Error(
              `Verification profile '${profilePath}' must use an array for 'required_live_verification_modes'.`
            );
          })();
  const expectedTargetSurfaces =
    rawProfile.expected_target_surfaces === undefined
      ? undefined
      : Array.isArray(rawProfile.expected_target_surfaces)
        ? unique(
            rawProfile.expected_target_surfaces.map((entry) => {
              if (!isTargetSurface(entry)) {
                throw new Error(
                  `Verification profile '${profilePath}' contains unsupported target surface '${String(entry)}'.`
                );
              }
              return entry;
            })
          )
        : (() => {
            throw new Error(
              `Verification profile '${profilePath}' must use an array for 'expected_target_surfaces'.`
            );
          })();
  const coreProbes =
    rawProfile.core_probes === undefined
      ? undefined
      : Array.isArray(rawProfile.core_probes)
        ? rawProfile.core_probes.map((rawProbe, index) => {
            if (!isPlainObject(rawProbe)) {
              throw new Error(
                `Verification profile '${profilePath}' contains a non-object core probe at index ${index}.`
              );
            }

            const probeId =
              typeof rawProbe.probe_id === "string" ? rawProbe.probe_id.trim() : "";
            if (!probeId) {
              throw new Error(
                `Verification profile '${profilePath}' contains a core probe without a non-empty 'probe_id'.`
              );
            }

            const label =
              typeof rawProbe.label === "string" ? rawProbe.label.trim() : "";
            if (!label) {
              throw new Error(
                `Verification profile '${profilePath}' core probe '${probeId}' is missing a non-empty 'label'.`
              );
            }

            const mode = isCoreVerificationProbeMode(rawProbe.mode)
              ? rawProbe.mode
              : undefined;
            if (!mode) {
              throw new Error(
                `Verification profile '${profilePath}' core probe '${probeId}' has an invalid mode '${String(rawProbe.mode)}'.`
              );
            }

            const role =
              rawProbe.role === undefined
                ? defaultProbeRoleForMode(mode)
                : isCoreVerificationProbeRole(rawProbe.role)
                  ? rawProbe.role
                  : (() => {
                      throw new Error(
                        `Verification profile '${profilePath}' core probe '${probeId}' has an invalid role '${String(rawProbe.role)}'.`
                      );
                    })();

            const target =
              rawProbe.target === undefined
                ? undefined
                : typeof rawProbe.target === "string" && rawProbe.target.trim().length > 0
                  ? rawProbe.target.trim()
                  : (() => {
                      throw new Error(
                        `Verification profile '${profilePath}' core probe '${probeId}' has an empty 'target'.`
                      );
                    })();

            const targetManifestKey =
              rawProbe.target_manifest_key === undefined
                ? undefined
                : isTargetManifestKey(rawProbe.target_manifest_key)
                  ? rawProbe.target_manifest_key
                  : (() => {
                      throw new Error(
                        `Verification profile '${profilePath}' core probe '${probeId}' has an invalid target_manifest_key '${String(rawProbe.target_manifest_key)}'.`
                      );
                    })();
            const targetPath =
              rawProbe.target_path === undefined
                ? undefined
                : typeof rawProbe.target_path === "string" &&
                    rawProbe.target_path.trim().length > 0
                  ? rawProbe.target_path.trim()
                  : (() => {
                      throw new Error(
                        `Verification profile '${profilePath}' core probe '${probeId}' has an empty 'target_path'.`
                      );
                    })();
            const assertionId =
              rawProbe.assertion_id === undefined
                ? undefined
                : typeof rawProbe.assertion_id === "string" &&
                    rawProbe.assertion_id.trim().length > 0
                  ? rawProbe.assertion_id.trim()
                  : (() => {
                      throw new Error(
                        `Verification profile '${profilePath}' core probe '${probeId}' has an empty 'assertion_id'.`
                      );
                    })();
            const assertionTags =
              rawProbe.assertion_tags === undefined
                ? undefined
                : Array.isArray(rawProbe.assertion_tags)
                  ? unique(
                      rawProbe.assertion_tags.map((entry) => {
                        if (!isVerificationAssertionTag(entry)) {
                          throw new Error(
                            `Verification profile '${profilePath}' core probe '${probeId}' contains unsupported assertion tag '${String(entry)}'.`
                          );
                        }
                        return entry;
                      })
                    )
                  : (() => {
                      throw new Error(
                        `Verification profile '${profilePath}' core probe '${probeId}' must use an array for 'assertion_tags'.`
                      );
                    })();
            const semanticLevel =
              rawProbe.semantic_level === undefined
                ? "liveness"
                : isProbeSemanticLevel(rawProbe.semantic_level)
                  ? rawProbe.semantic_level
                  : (() => {
                      throw new Error(
                        `Verification profile '${profilePath}' core probe '${probeId}' has an invalid semantic_level '${String(rawProbe.semantic_level)}'.`
                      );
                    })();

            if (!target && !targetManifestKey) {
              throw new Error(
                `Verification profile '${profilePath}' core probe '${probeId}' must declare either 'target' or 'target_manifest_key'.`
              );
            }
            if (target && targetManifestKey) {
              throw new Error(
                `Verification profile '${profilePath}' core probe '${probeId}' must not declare both 'target' and 'target_manifest_key'.`
              );
            }

            const scope =
              rawProbe.scope === undefined
                ? undefined
                : isCoreVerificationProbeScope(rawProbe.scope)
                  ? rawProbe.scope
                  : (() => {
                      throw new Error(
                        `Verification profile '${profilePath}' core probe '${probeId}' has an invalid scope '${String(rawProbe.scope)}'.`
                      );
                    })();

            const expectedValue =
              rawProbe.expected_value === undefined
                ? undefined
                : typeof rawProbe.expected_value === "string" &&
                    rawProbe.expected_value.trim().length > 0
                  ? rawProbe.expected_value.trim()
                  : (() => {
                      throw new Error(
                        `Verification profile '${profilePath}' core probe '${probeId}' has an empty 'expected_value'.`
                      );
                    })();

            const jsonPath =
              rawProbe.json_path === undefined
                ? undefined
                : typeof rawProbe.json_path === "string" &&
                    rawProbe.json_path.trim().length > 0
                  ? rawProbe.json_path.trim()
                  : (() => {
                      throw new Error(
                        `Verification profile '${profilePath}' core probe '${probeId}' has an empty 'json_path'.`
                      );
                    })();

            const timeoutMs =
              rawProbe.timeout_ms === undefined
                ? undefined
                : typeof rawProbe.timeout_ms === "number" &&
                    Number.isFinite(rawProbe.timeout_ms) &&
                    rawProbe.timeout_ms > 0
                  ? Math.round(rawProbe.timeout_ms)
                  : (() => {
                      throw new Error(
                        `Verification profile '${profilePath}' core probe '${probeId}' has an invalid 'timeout_ms'.`
                      );
                    })();
            const expectedStatus =
              rawProbe.expected_status === undefined
                ? undefined
                : typeof rawProbe.expected_status === "number" &&
                    Number.isInteger(rawProbe.expected_status) &&
                    rawProbe.expected_status >= 100 &&
                    rawProbe.expected_status <= 599
                  ? rawProbe.expected_status
                  : (() => {
                      throw new Error(
                        `Verification profile '${profilePath}' core probe '${probeId}' has an invalid 'expected_status'.`
                      );
                    })();
            const steps =
              rawProbe.steps === undefined
                ? undefined
                : Array.isArray(rawProbe.steps)
                  ? rawProbe.steps.map((rawStep, stepIndex) => {
                      if (!isPlainObject(rawStep)) {
                        throw new Error(
                          `Verification profile '${profilePath}' core probe '${probeId}' contains a non-object step at index ${stepIndex}.`
                        );
                      }
                      const action = isBrowserJourneyStepAction(rawStep.action)
                        ? rawStep.action
                        : (() => {
                            throw new Error(
                              `Verification profile '${profilePath}' core probe '${probeId}' step ${stepIndex} has an invalid action '${String(rawStep.action)}'.`
                            );
                          })();
                      const selector =
                        rawStep.selector === undefined
                          ? undefined
                          : typeof rawStep.selector === "string" &&
                              rawStep.selector.trim().length > 0
                            ? rawStep.selector.trim()
                            : (() => {
                                throw new Error(
                                  `Verification profile '${profilePath}' core probe '${probeId}' step ${stepIndex} has an empty 'selector'.`
                                );
                              })();
                      const value =
                        rawStep.value === undefined
                          ? undefined
                          : typeof rawStep.value === "string" &&
                              rawStep.value.trim().length > 0
                            ? rawStep.value.trim()
                            : (() => {
                                throw new Error(
                                  `Verification profile '${profilePath}' core probe '${probeId}' step ${stepIndex} has an empty 'value'.`
                                );
                              })();
                      const stepTimeoutMs =
                        rawStep.timeout_ms === undefined
                          ? undefined
                          : typeof rawStep.timeout_ms === "number" &&
                              Number.isFinite(rawStep.timeout_ms) &&
                              rawStep.timeout_ms > 0
                            ? Math.round(rawStep.timeout_ms)
                            : (() => {
                                throw new Error(
                                  `Verification profile '${profilePath}' core probe '${probeId}' step ${stepIndex} has an invalid 'timeout_ms'.`
                                );
                              })();

                      const selectorRequiredActions = new Set([
                        "click",
                        "fill",
                        "press",
                        "assert_visible"
                      ]);
                      const valueRequiredActions = new Set([
                        "fill",
                        "press",
                        "assert_text",
                        "assert_url"
                      ]);
                      if (selectorRequiredActions.has(action) && !selector) {
                        throw new Error(
                          `Verification profile '${profilePath}' core probe '${probeId}' step ${stepIndex} requires 'selector' for action '${action}'.`
                        );
                      }
                      if (valueRequiredActions.has(action) && !value) {
                        throw new Error(
                          `Verification profile '${profilePath}' core probe '${probeId}' step ${stepIndex} requires 'value' for action '${action}'.`
                        );
                      }

                      const step: BrowserJourneyStep = {
                        action,
                        ...(selector ? { selector } : {}),
                        ...(value ? { value } : {}),
                        ...(stepTimeoutMs !== undefined ? { timeout_ms: stepTimeoutMs } : {})
                      };
                      return step;
                    })
                  : (() => {
                      throw new Error(
                        `Verification profile '${profilePath}' core probe '${probeId}' must use an array for 'steps'.`
                      );
                    })();

            const cwd =
              rawProbe.cwd === undefined
                ? undefined
                : typeof rawProbe.cwd === "string" && rawProbe.cwd.trim().length > 0
                  ? rawProbe.cwd.trim()
                  : (() => {
                      throw new Error(
                        `Verification profile '${profilePath}' core probe '${probeId}' has an empty 'cwd'.`
                      );
                    })();

            const shell =
              rawProbe.shell === undefined
                ? undefined
                : rawProbe.shell === "powershell" ||
                    rawProbe.shell === "sh" ||
                    rawProbe.shell === "bash" ||
                    rawProbe.shell === "cmd"
                  ? rawProbe.shell
                  : (() => {
                      throw new Error(
                        `Verification profile '${profilePath}' core probe '${probeId}' has an invalid shell '${String(rawProbe.shell)}'.`
                      );
                    })();

            const browserExecutable =
              rawProbe.browser_executable === undefined
                ? undefined
                : typeof rawProbe.browser_executable === "string" &&
                    rawProbe.browser_executable.trim().length > 0
                  ? rawProbe.browser_executable.trim()
                  : (() => {
                      throw new Error(
                        `Verification profile '${profilePath}' core probe '${probeId}' has an empty 'browser_executable'.`
                      );
                    })();

            const expectedExitCode =
              rawProbe.expected_exit_code === undefined
                ? undefined
                : typeof rawProbe.expected_exit_code === "number" &&
                    Number.isInteger(rawProbe.expected_exit_code) &&
                    rawProbe.expected_exit_code >= 0
                  ? rawProbe.expected_exit_code
                  : (() => {
                      throw new Error(
                        `Verification profile '${profilePath}' core probe '${probeId}' has an invalid 'expected_exit_code'.`
                      );
                    })();

            const required =
              rawProbe.required === undefined
                ? undefined
                : typeof rawProbe.required === "boolean"
                  ? rawProbe.required
                  : (() => {
                      throw new Error(
                        `Verification profile '${profilePath}' core probe '${probeId}' has a non-boolean 'required' field.`
                      );
                    })();

            if ((mode === "file_contains" || mode === "json_value") && !scope) {
              throw new Error(
                `Verification profile '${profilePath}' core probe '${probeId}' must declare scope 'target_root'.`
              );
            }
            if (
              (mode === "http" ||
                mode === "http_json" ||
                mode === "browser" ||
                mode === "browser_journey" ||
                mode === "shell_command") &&
              scope !== undefined
            ) {
              throw new Error(
                `Verification profile '${profilePath}' core probe '${probeId}' must not declare scope for mode '${mode}'.`
              );
            }
            if ((mode === "file_contains" || mode === "http" || mode === "browser") && !expectedValue) {
              throw new Error(
                `Verification profile '${profilePath}' core probe '${probeId}' must declare 'expected_value' for mode '${mode}'.`
              );
            }
            if (mode === "json_value" && (!jsonPath || expectedValue === undefined)) {
              throw new Error(
                `Verification profile '${profilePath}' core probe '${probeId}' must declare both 'json_path' and 'expected_value' for mode 'json_value'.`
              );
            }
            if (
              mode === "shell_command" &&
              jsonPath !== undefined
            ) {
              throw new Error(
                `Verification profile '${profilePath}' core probe '${probeId}' must not declare 'json_path' for mode 'shell_command'.`
              );
            }
            if (
              (mode === "browser" || mode === "browser_journey") &&
              expectedStatus !== undefined
            ) {
              throw new Error(
                `Verification profile '${profilePath}' core probe '${probeId}' cannot declare 'expected_status' for mode '${mode}'.`
              );
            }
            if (
              (mode === "file_contains" ||
                mode === "json_value" ||
                mode === "shell_command" ||
                mode === "http" ||
                mode === "browser") &&
              targetPath !== undefined
            ) {
              throw new Error(
                `Verification profile '${profilePath}' core probe '${probeId}' cannot declare 'target_path' with mode '${mode}'.`
              );
            }
            if (
              (mode === "file_contains" || mode === "json_value" || mode === "shell_command") &&
              targetManifestKey !== undefined
            ) {
              throw new Error(
                `Verification profile '${profilePath}' core probe '${probeId}' cannot use 'target_manifest_key' with mode '${mode}'.`
              );
            }
            if (
              mode !== "browser" &&
              mode !== "browser_journey" &&
              browserExecutable !== undefined
            ) {
              throw new Error(
                `Verification profile '${profilePath}' core probe '${probeId}' cannot declare 'browser_executable' unless mode is 'browser' or 'browser_journey'.`
              );
            }
            if (
              (mode === "http_json" || mode === "browser_journey") &&
              role !== "release_gate"
            ) {
              throw new Error(
                `Verification profile '${profilePath}' core probe '${probeId}' must use role 'release_gate' with mode '${mode}'.`
              );
            }
            if (
              mode === "http_json" &&
              expectedExitCode !== undefined
            ) {
              throw new Error(
                `Verification profile '${profilePath}' core probe '${probeId}' cannot declare 'expected_exit_code' for mode 'http_json'.`
              );
            }
            if (
              mode === "browser_journey" &&
              expectedValue !== undefined
            ) {
              throw new Error(
                `Verification profile '${profilePath}' core probe '${probeId}' cannot declare 'expected_value' for mode 'browser_journey'.`
              );
            }
            if (
              mode === "browser_journey" &&
              jsonPath !== undefined
            ) {
              throw new Error(
                `Verification profile '${profilePath}' core probe '${probeId}' cannot declare 'json_path' for mode 'browser_journey'.`
              );
            }
            if (role === "release_gate" && mode !== "http_json" && mode !== "browser_journey") {
              throw new Error(
                `Verification profile '${profilePath}' core probe '${probeId}' cannot use role 'release_gate' with mode '${mode}'.`
              );
            }

            const probe: VerificationCoreProbe = {
              probe_id: probeId,
              label,
              mode,
              role,
              ...(assertionId ? { assertion_id: assertionId } : {}),
              ...(assertionTags && assertionTags.length > 0
                ? { assertion_tags: assertionTags }
                : {}),
              ...(semanticLevel ? { semantic_level: semanticLevel } : {}),
              ...(target ? { target } : {}),
              ...(targetManifestKey ? { target_manifest_key: targetManifestKey } : {}),
              ...(targetPath ? { target_path: targetPath } : {}),
              ...(scope ? { scope } : {}),
              ...(expectedValue !== undefined ? { expected_value: expectedValue } : {}),
              ...(expectedStatus !== undefined ? { expected_status: expectedStatus } : {}),
              ...(jsonPath ? { json_path: jsonPath } : {}),
              ...(steps && steps.length > 0 ? { steps } : {}),
              ...(cwd ? { cwd } : {}),
              ...(shell ? { shell } : {}),
              ...(browserExecutable ? { browser_executable: browserExecutable } : {}),
              ...(expectedExitCode !== undefined
                ? { expected_exit_code: expectedExitCode }
                : {}),
              ...(timeoutMs !== undefined ? { timeout_ms: timeoutMs } : {}),
              ...(required !== undefined ? { required } : {})
            };

            return probe;
          })
        : (() => {
            throw new Error(
              `Verification profile '${profilePath}' must use an array for 'core_probes'.`
            );
          })();
  const targetReachedRequiresCoreProbes =
    rawProfile.target_reached_requires_core_probes === undefined
      ? undefined
      : typeof rawProfile.target_reached_requires_core_probes === "boolean"
        ? rawProfile.target_reached_requires_core_probes
        : (() => {
            throw new Error(
              `Verification profile '${profilePath}' must use a boolean for 'target_reached_requires_core_probes'.`
            );
          })();
  const minimumFeatureReleaseAssertions =
    rawProfile.minimum_feature_release_assertions === undefined
      ? 2
      : typeof rawProfile.minimum_feature_release_assertions === "number" &&
          Number.isInteger(rawProfile.minimum_feature_release_assertions) &&
          rawProfile.minimum_feature_release_assertions >= 1
        ? rawProfile.minimum_feature_release_assertions
        : (() => {
            throw new Error(
              `Verification profile '${profilePath}' must use an integer >= 1 for 'minimum_feature_release_assertions'.`
            );
          })();
  const minimumAssertionTagCounts =
    rawProfile.minimum_assertion_tag_counts === undefined
      ? undefined
      : isPlainObject(rawProfile.minimum_assertion_tag_counts)
        ? (Object.fromEntries(
            Object.entries(rawProfile.minimum_assertion_tag_counts).map(
              ([rawTag, rawCount]) => {
                if (!isVerificationAssertionTag(rawTag)) {
                  throw new Error(
                    `Verification profile '${profilePath}' contains unsupported minimum assertion tag '${rawTag}'.`
                  );
                }
                if (
                  typeof rawCount !== "number" ||
                  !Number.isInteger(rawCount) ||
                  rawCount < 1
                ) {
                  throw new Error(
                    `Verification profile '${profilePath}' must use integer counts >= 1 for 'minimum_assertion_tag_counts.${rawTag}'.`
                  );
                }
                return [rawTag, rawCount];
              }
            )
          ) as Partial<Record<VerificationAssertionTag, number>>)
        : (() => {
            throw new Error(
              `Verification profile '${profilePath}' must use an object for 'minimum_assertion_tag_counts'.`
            );
          })();
  const scorePolicy =
    rawProfile.score_policy === undefined
      ? undefined
      : isPlainObject(rawProfile.score_policy)
        ? {
            ...(normalizeScoreWeightBlock({
              rawValue: rawProfile.score_policy.proof_weights,
              allowedKeys: [
                "proof_pass_rate",
                "criterion_pass_rate",
                "threshold_verdict",
                "external_grade"
              ],
              profilePath,
              fieldName: "score_policy.proof_weights"
            })
              ? {
                  proof_weights: normalizeScoreWeightBlock({
                    rawValue: rawProfile.score_policy.proof_weights,
                    allowedKeys: [
                      "proof_pass_rate",
                      "criterion_pass_rate",
                      "threshold_verdict",
                      "external_grade"
                    ],
                    profilePath,
                    fieldName: "score_policy.proof_weights"
                  })
                }
              : {}),
            ...(normalizeScoreWeightBlock({
              rawValue: rawProfile.score_policy.release_weights,
              allowedKeys: ["control_plane_score", "proof_score"],
              profilePath,
              fieldName: "score_policy.release_weights"
            })
              ? {
                  release_weights: normalizeScoreWeightBlock({
                    rawValue: rawProfile.score_policy.release_weights,
                    allowedKeys: ["control_plane_score", "proof_score"],
                    profilePath,
                    fieldName: "score_policy.release_weights"
                  })
                }
              : {})
          }
        : (() => {
            throw new Error(
              `Verification profile '${profilePath}' must use an object for 'score_policy'.`
            );
          })();
  const expectedSurfaceSet = new Set(expectedTargetSurfaces ?? []);
  if (minimumAssertionTagCounts?.browser && !expectedSurfaceSet.has("browser")) {
    throw new Error(
      `Verification profile '${profilePath}' cannot require browser assertion tags without declaring browser in 'expected_target_surfaces'.`
    );
  }
  if (minimumAssertionTagCounts?.api && !expectedSurfaceSet.has("api")) {
    throw new Error(
      `Verification profile '${profilePath}' cannot require api assertion tags without declaring api in 'expected_target_surfaces'.`
    );
  }
  if (minimumAssertionTagCounts?.persistence && !expectedSurfaceSet.has("api")) {
    throw new Error(
      `Verification profile '${profilePath}' cannot require persistence assertion tags without declaring api in 'expected_target_surfaces'.`
    );
  }
  const configuredTaggedAssertionIds = new Map<VerificationAssertionTag, Set<string>>();
  for (const probe of coreProbes ?? []) {
    if ((probe.role ?? defaultProbeRoleForMode(probe.mode)) !== "release_gate") {
      continue;
    }
    if (probe.required === false || !probe.assertion_id || !probe.assertion_tags?.length) {
      continue;
    }
    for (const tag of probe.assertion_tags) {
      const assertionIds = configuredTaggedAssertionIds.get(tag) ?? new Set<string>();
      assertionIds.add(probe.assertion_id);
      configuredTaggedAssertionIds.set(tag, assertionIds);
    }
  }
  for (const [tag, minimumCount] of Object.entries(
    minimumAssertionTagCounts ?? {}
  ) as Array<[VerificationAssertionTag, number]>) {
    const configuredCount = configuredTaggedAssertionIds.get(tag)?.size ?? 0;
    if (configuredCount < minimumCount) {
      throw new Error(
        `Verification profile '${profilePath}' requires at least ${minimumCount} distinct '${tag}' release assertions, but only ${configuredCount} were configured.`
      );
    }
  }

  return {
    profile_id: profileId,
    label,
    ...(bundleLabel ? { bundle_label: bundleLabel } : {}),
    ...(targetFamily ? { target_family: targetFamily } : {}),
    ...(validationLane ? { validation_lane: validationLane } : {}),
    criteria,
    ...(expectedTargetSurfaces && expectedTargetSurfaces.length > 0
      ? { expected_target_surfaces: expectedTargetSurfaces }
      : {}),
    ...(requiredLiveVerificationModes && requiredLiveVerificationModes.length > 0
      ? { required_live_verification_modes: requiredLiveVerificationModes }
      : {}),
    ...(coreProbes && coreProbes.length > 0 ? { core_probes: coreProbes } : {}),
    ...(targetReachedRequiresCoreProbes !== undefined
      ? { target_reached_requires_core_probes: targetReachedRequiresCoreProbes }
      : {}),
    minimum_feature_release_assertions: minimumFeatureReleaseAssertions,
    ...(minimumAssertionTagCounts
      ? { minimum_assertion_tag_counts: minimumAssertionTagCounts }
      : {}),
    ...(scorePolicy &&
    (scorePolicy.proof_weights || scorePolicy.release_weights)
      ? { score_policy: scorePolicy }
      : {}),
    ...(notes && notes.length > 0 ? { notes } : {})
  };
};

const verificationProviderForCapability = (
  contract: ExternalAdapterContract,
  capability: AdapterCapabilityName
): {
  providerRole: "executor" | "verifier";
  providerId: string;
  capabilitySpec?: VerificationProviderSpec["capabilities"][ProofCapabilityName] | ExternalAdapterContract["capabilities"][AdapterCapabilityName];
} => {
  if (isProofCapability(capability) && contract.verification_provider) {
    return {
      providerRole: "verifier",
      providerId: contract.verification_provider.provider_id,
      capabilitySpec: contract.verification_provider.capabilities[capability]
    };
  }

  return {
    providerRole: "executor",
    providerId: contract.adapter_id,
    capabilitySpec: contract.capabilities[capability]
  };
};

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

export const executeAdapterCapability = async (input: {
  loadedAdapter: LoadedAdapterContract;
  capability: AdapterCapabilityName;
  packet: AdapterCapabilityPacket;
  roundDirectory: string;
  extraEnv?: Record<string, string>;
}): Promise<AdapterCapabilityExecution> => {
  const adapterDirectory = join(input.roundDirectory, "adapter");
  const packetPath = join(adapterDirectory, `${input.capability}-input.json`);
  const resultPath = join(adapterDirectory, `${input.capability}-result.json`);
  const stdoutPath = join(adapterDirectory, `${input.capability}-stdout.log`);
  const stderrPath = join(adapterDirectory, `${input.capability}-stderr.log`);
  await writeJson(packetPath, input.packet);

  const provider = verificationProviderForCapability(
    input.loadedAdapter.contract,
    input.capability
  );
  const capabilitySpec = provider.capabilitySpec;
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

  const targetRoot = resolve(
    input.loadedAdapter.base_directory,
    input.loadedAdapter.contract.target_root
  );
  const cwd = capabilitySpec.cwd
    ? resolve(input.loadedAdapter.base_directory, capabilitySpec.cwd)
    : targetRoot;
  const timeoutMs = capabilitySpec.timeout_ms ?? 120000;
  const env = {
    ...process.env,
    HARNESS_INPUT_PATH: packetPath,
    HARNESS_OUTPUT_PATH: resultPath,
    HARNESS_TARGET_ROOT: targetRoot,
    HARNESS_RUN_DIRECTORY: input.packet.run_directory,
    HARNESS_ROUND_DIRECTORY: input.packet.round_directory,
    HARNESS_RUNTIME_DIRECTORY:
      input.packet.runtime_directory ?? join(input.packet.run_directory, "runtime"),
    HARNESS_CODEX_SESSION_REGISTRY_PATH:
      input.packet.codex_session_registry_path ??
      join(input.packet.run_directory, "runtime", "codex-sessions.json"),
    HARNESS_CAPABILITY: input.capability,
    HARNESS_PROVIDER_ID: provider.providerId,
    HARNESS_PROVIDER_ROLE: provider.providerRole,
    ...(input.extraEnv ?? {})
  };

  const execution = await execCommand({
    command: capabilitySpec.command,
    cwd,
    timeoutMs,
    env,
    shell: capabilitySpec.shell
  });
  await Promise.all([
    writeText(stdoutPath, execution.stdout),
    writeText(stderrPath, execution.stderr)
  ]);

  let rawResult: unknown;
  if (await pathExists(resultPath)) {
    rawResult = await loadJson<unknown>(resultPath);
  } else {
    rawResult = {
      capability: input.capability,
      ok: execution.code === 0,
      summary:
        execution.code === 0
          ? `Capability '${input.capability}' completed without an explicit result file.`
          : `Capability '${input.capability}' failed with exit code ${execution.code ?? -1}.`,
      findings: execution.stderr.trim() ? [execution.stderr.trim()] : [],
      evidence_paths: []
    };
  }

  const validated = await validateAdapterCapabilityResult({
    capability: input.capability,
    rawResult,
    providerId: provider.providerId,
    providerRole: provider.providerRole,
    baseDirectory: input.loadedAdapter.base_directory,
    cwd,
    targetRoot,
    runDirectory: input.packet.run_directory,
    roundDirectory: input.packet.round_directory
  });
  await writeJson(resultPath, validated.result);
  const resultRaw = await readFile(resultPath);
  const attestation: AdapterExecutionAttestation = {
    command: capabilitySpec.command,
    command_sha256: sha256ForBuffer(capabilitySpec.command),
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
