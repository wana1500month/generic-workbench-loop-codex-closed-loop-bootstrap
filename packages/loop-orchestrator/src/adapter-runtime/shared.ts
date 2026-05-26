import { access, mkdir, readFile, realpath, rename, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

import { resolvedAdapterTargetRoot } from "../adapter-paths.js";
import { loadJson, repoRoot, writeJson, writeText } from "../file-system.js";
import { stopProcessTree } from "../process-runtime.js";
import { validateTargetUrlPolicy } from "../target-url-policy.js";
import type {
  AdapterCapabilityExecution,
  AdapterCriterionResult,
  AdapterEvidenceItem,
  AdapterCapabilityAttemptArtifact,
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
  QualityContract,
  RoundVerdict,
  SubjectiveMetricResult,
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
  VerificationSubjectiveMetric,
  VerifiedAdapterCriterionResult,
  VerifiedAdapterEvidenceItem,
  VerificationWitness,
  VerificationWitnessStep
} from "../types.js";

export const defaultCapabilityResult = (
  capability: AdapterCapabilityName,
  summary: string
): AdapterCapabilityResult => ({
  capability,
  ok: false,
  summary,
  findings: [summary],
  evidence_paths: []
});

export const roundVerdicts = new Set<RoundVerdict>(["advance", "revise", "hold"]);
export const criterionStatuses = new Set<"pass" | "fail">(["pass", "fail"]);
export const verificationOperators = new Set([
  "equals",
  "contains",
  "regex",
  "number_gte",
  "number_lte"
]);
export const adapterCapabilities = new Set<AdapterCapabilityName>([
  "prepare_target",
  "apply_change",
  "run_target",
  "capture_evidence",
  "run_checks",
  "grade_round"
]);
export const proofCapabilities = new Set<ProofCapabilityName>([
  "capture_evidence",
  "run_checks",
  "grade_round"
]);
export const capabilitiesRequiringEvidence = new Set<AdapterCapabilityName>([
  "capture_evidence",
  "run_checks",
  "grade_round"
]);
export const textEvidenceExtensions = new Set([
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
export const jsonEvidenceExtensions = new Set([".json"]);
export const imageEvidenceExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp"
]);
export const liveVerificationModes = new Set<LiveVerificationMode>([
  "browser",
  "api",
  "db",
  "shell"
]);
export const targetSurfaces = new Set<TargetSurface>(["browser", "api"]);
export const targetFamilies = new Set<TargetFamily>([
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
export const validationLanes = new Set<ValidationLane>([
  "deterministic_semantic",
  "environment_integration"
]);
export const verificationAssertionTags = new Set<VerificationAssertionTag>([
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
export const coreVerificationProbeModes = new Set<CoreVerificationProbeMode>([
  "browser_journey",
  "browser",
  "http_json",
  "http",
  "file_contains",
  "json_value",
  "shell_command"
]);
export const coreVerificationProbeRoles = new Set<CoreVerificationProbeRole>([
  "supporting",
  "release_gate"
]);
export const coreVerificationProbeScopes = new Set<CoreVerificationProbeScope>([
  "target_root"
]);
export const targetManifestKeys = new Set<TargetManifestKey>([
  "health_url",
  "app_url",
  "api_base_url"
]);
export const probeSemanticLevels = new Set<ProbeSemanticLevel>([
  "liveness",
  "feature",
  "workflow"
]);
export const browserJourneyStepActions = new Set<BrowserJourneyStepAction>([
  "goto",
  "click",
  "fill",
  "press",
  "reload",
  "wait_for",
  "assert_visible",
  "assert_not_visible",
  "assert_text",
  "assert_value",
  "assert_url"
]);

export const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

export const sha256ForBuffer = (value: Buffer | string): string =>
  createHash("sha256").update(value).digest("hex");

export const commandTokens = (command: string): string[] =>
  command.match(/"[^"]+"|'[^']+'|\S+/g)?.map((token) => token.replace(/^['"]|['"]$/g, "")) ?? [];

export const commandVectorFor = (input: {
  command: string;
  args?: readonly string[];
}): string[] =>
  input.args && input.args.length > 0 ? [input.command, ...input.args] : commandTokens(input.command);

export const commandDigestFor = (input: {
  command: string;
  args?: readonly string[];
}): string => sha256ForBuffer(JSON.stringify(commandVectorFor(input)));

export const commandTargetFingerprint = (input: {
  command: string;
  args?: readonly string[];
  baseDirectory: string;
  cwd?: string;
}): string => {
  const tokens = commandVectorFor(input);
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

  return `raw:${commandVectorFor(input).join("\u0000").trim().toLowerCase()}`;
};

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isPrimitiveMetadataValue = (
  value: unknown
): value is string | number | boolean | ReadonlyArray<string | number | boolean> =>
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean" ||
  (Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === "string" ||
        typeof entry === "number" ||
        typeof entry === "boolean"
    ));

export const hasPrimitiveMetadata = (
  value: unknown
): value is Record<
  string,
  string | number | boolean | ReadonlyArray<string | number | boolean>
> =>
  isPlainObject(value) &&
  Object.values(value).every((entry) => isPrimitiveMetadataValue(entry));

export const normalizeScoreWeightBlock = (
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

export const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const positiveIntegerEnv = (name: string, fallback: number): number => {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const evidenceMaxBytes = (): number =>
  positiveIntegerEnv("HARNESS_EVIDENCE_MAX_BYTES", 10 * 1024 * 1024);

export const commandOutputMaxBytes = (): number =>
  positiveIntegerEnv("HARNESS_COMMAND_OUTPUT_MAX_BYTES", 1024 * 1024);

const credentialBasenames = new Set([
  ".env",
  "auth.json",
  "credentials",
  "credentials.json",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  "secret",
  "secrets",
  "token",
  "tokens"
]);

const pathLooksCredentialLike = (path: string): boolean => {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (parts.some((part) => part.toLowerCase() === ".codex")) {
    return true;
  }
  const basename = parts[parts.length - 1]?.toLowerCase();
  return Boolean(
    basename &&
      (credentialBasenames.has(basename) ||
        basename.startsWith(".env.") ||
        basename.endsWith(".pem") ||
        basename.endsWith(".key"))
  );
};

const isPathInside = (root: string, candidate: string): boolean => {
  const rootPath = process.platform === "win32" ? root.toLowerCase() : root;
  const candidatePath = process.platform === "win32" ? candidate.toLowerCase() : candidate;
  const relationship = relative(rootPath, candidatePath);
  return relationship === "" || (!relationship.startsWith("..") && !isAbsolute(relationship));
};

const safeRealpath = async (path: string): Promise<string> => {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
};

const allowedEvidenceRoots = async (input: {
  baseDirectory: string;
  cwd: string;
  targetRoot: string;
  runDirectory: string;
  roundDirectory: string;
}): Promise<string[]> =>
  unique(
    await Promise.all(
      [
        input.roundDirectory,
        input.runDirectory,
        input.targetRoot,
        input.baseDirectory
      ].map((candidate) => safeRealpath(resolve(candidate)))
    )
  );

export const attemptPathForCapability = (
  roundDirectory: string,
  capability: AdapterCapabilityName
): string => join(roundDirectory, "adapter", `${capability}-attempt.json`);

export const lateResultPathForCapability = (input: {
  roundDirectory: string;
  capability: AdapterCapabilityName;
  executionId: string;
  suffix: string;
}): string =>
  join(
    input.roundDirectory,
    "adapter",
    "late-results",
    `${input.capability}-${input.executionId}-${input.suffix}`
  );

export const resultExecutionIdFor = (input: {
  packet?: AdapterCapabilityPacket;
  rawResult: unknown;
}): string | undefined => {
  if (
    isPlainObject(input.rawResult) &&
    hasPrimitiveMetadata(input.rawResult.metadata) &&
    typeof input.rawResult.metadata.execution_id === "string" &&
    input.rawResult.metadata.execution_id.trim().length > 0
  ) {
    return input.rawResult.metadata.execution_id.trim();
  }
  if (
    input.packet &&
    typeof input.packet.execution_id === "string" &&
    input.packet.execution_id.trim().length > 0
  ) {
    return input.packet.execution_id.trim();
  }
  return undefined;
};

export const withExecutionMetadata = (
  rawResult: unknown,
  executionId: string
): unknown => {
  if (!isPlainObject(rawResult)) {
    return rawResult;
  }

  const metadata = hasPrimitiveMetadata(rawResult.metadata) ? rawResult.metadata : {};
  return {
    ...rawResult,
    metadata: {
      ...metadata,
      execution_id: executionId
    }
  };
};

export const quarantineResultFile = async (input: {
  sourcePath: string;
  roundDirectory: string;
  capability: AdapterCapabilityName;
  executionId: string;
  suffix: string;
}): Promise<string | undefined> => {
  if (!(await pathExists(input.sourcePath))) {
    return undefined;
  }

  const destinationPath = lateResultPathForCapability({
    roundDirectory: input.roundDirectory,
    capability: input.capability,
    executionId: input.executionId,
    suffix: input.suffix
  });
  await mkdir(dirname(destinationPath), { recursive: true });
  await rename(input.sourcePath, destinationPath);
  return destinationPath;
};

export const resolvedPath = (path: string): string =>
  resolve(repoRoot, path);

export const isProofCapability = (capability: AdapterCapabilityName): capability is ProofCapabilityName =>
  proofCapabilities.has(capability as ProofCapabilityName);

export const isVerificationCapability = (
  value: unknown
): value is VerificationCriterion["capability"] => value === "run_checks" || value === "grade_round";

export const isLiveVerificationMode = (value: unknown): value is LiveVerificationMode =>
  typeof value === "string" && liveVerificationModes.has(value as LiveVerificationMode);

export const isTargetSurface = (value: unknown): value is TargetSurface =>
  typeof value === "string" && targetSurfaces.has(value as TargetSurface);

export const isTargetFamily = (value: unknown): value is TargetFamily =>
  typeof value === "string" && targetFamilies.has(value as TargetFamily);

export const isValidationLane = (value: unknown): value is ValidationLane =>
  typeof value === "string" && validationLanes.has(value as ValidationLane);

export const isVerificationAssertionTag = (value: unknown): value is VerificationAssertionTag =>
  typeof value === "string" &&
  verificationAssertionTags.has(value as VerificationAssertionTag);

export const isCoreVerificationProbeMode = (
  value: unknown
): value is CoreVerificationProbeMode =>
  typeof value === "string" &&
  coreVerificationProbeModes.has(value as CoreVerificationProbeMode);

export const isCoreVerificationProbeScope = (
  value: unknown
): value is CoreVerificationProbeScope =>
  typeof value === "string" &&
  coreVerificationProbeScopes.has(value as CoreVerificationProbeScope);

export const isCoreVerificationProbeRole = (
  value: unknown
): value is CoreVerificationProbeRole =>
  typeof value === "string" &&
  coreVerificationProbeRoles.has(value as CoreVerificationProbeRole);

export const isTargetManifestKey = (value: unknown): value is TargetManifestKey =>
  typeof value === "string" && targetManifestKeys.has(value as TargetManifestKey);

export const isProbeSemanticLevel = (value: unknown): value is ProbeSemanticLevel =>
  typeof value === "string" && probeSemanticLevels.has(value as ProbeSemanticLevel);

export const isBrowserJourneyStepAction = (
  value: unknown
): value is BrowserJourneyStepAction =>
  typeof value === "string" && browserJourneyStepActions.has(value as BrowserJourneyStepAction);

export const defaultProbeRoleForMode = (
  mode: CoreVerificationProbeMode
): CoreVerificationProbeRole =>
  mode === "http_json" || mode === "browser_journey" ? "release_gate" : "supporting";

export const releaseGateCapableProbeModes = new Set<CoreVerificationProbeMode>([
  "http_json",
  "browser_journey",
  "shell_command",
  "file_contains",
  "json_value"
]);

export const isHttpUrl = (value: string): boolean => {
  const policy = validateTargetUrlPolicy(value);
  return policy.ok;
};

export const normalizedEvidenceKind = (
  explicitKind: string | undefined,
  evidencePath: string
): string => explicitKind?.trim().toLowerCase() ?? extname(evidencePath).toLowerCase();

export const isJsonEvidence = (kind: string, evidencePath: string): boolean =>
  kind.includes("json") || jsonEvidenceExtensions.has(extname(evidencePath).toLowerCase());

export const isTextEvidence = (kind: string, evidencePath: string): boolean =>
  kind.includes("text") ||
  kind.includes("log") ||
  kind.includes("report") ||
  kind.includes("markdown") ||
  kind.includes("html") ||
  kind.includes("xml") ||
  kind.includes("yaml") ||
  textEvidenceExtensions.has(extname(evidencePath).toLowerCase());

export const isImageEvidence = (kind: string, evidencePath: string): boolean =>
  kind.includes("image") ||
  kind.includes("screenshot") ||
  imageEvidenceExtensions.has(extname(evidencePath).toLowerCase());

export const hasExpectedImageSignature = (buffer: Buffer, evidencePath: string): boolean => {
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

export const inspectEvidenceContent = async (input: {
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

export const resolveEvidencePath = async (input: {
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
  if (pathLooksCredentialLike(trimmedPath)) {
    return undefined;
  }

  const allowedRoots = await allowedEvidenceRoots(input);

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
    if (pathLooksCredentialLike(candidate) || !(await pathExists(candidate))) {
      continue;
    }
    const realCandidate = await safeRealpath(candidate);
    if (!allowedRoots.some((root) => isPathInside(root, realCandidate))) {
      continue;
    }
    const stats = await stat(realCandidate);
    if (!stats.isFile() || stats.size > evidenceMaxBytes()) {
      continue;
    }
    return realCandidate;
  }

  return undefined;
};

export const parseStringList = (
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

export const optionalTrimmedString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

export const requiredProfileString = (
  value: unknown,
  profilePath: string,
  fieldName: string
): string => {
  const normalized = optionalTrimmedString(value);
  if (!normalized) {
    throw new Error(
      `Verification profile '${profilePath}' must provide a non-empty '${fieldName}'.`
    );
  }
  return normalized;
};

export const parseOptionalProfileStringArray = (
  value: unknown,
  profilePath: string,
  fieldName: string
): string[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(
      `Verification profile '${profilePath}' must use a string array for '${fieldName}'.`
    );
  }
  return unique(value.map((entry) => entry.trim()).filter(Boolean));
};

export const normalizeScoreOutOfTen = (input: {
  value: unknown;
  profilePath: string;
  fieldName: string;
}): number => {
  if (typeof input.value !== "number" || !Number.isFinite(input.value)) {
    throw new Error(
      `Verification profile '${input.profilePath}' must use a finite number for '${input.fieldName}'.`
    );
  }
  if (input.value < 0 || input.value > 10) {
    throw new Error(
      `Verification profile '${input.profilePath}' must keep '${input.fieldName}' between 0 and 10.`
    );
  }
  return Number(input.value.toFixed(1));
};

export const normalizeEvidenceItems = (
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

export const normalizeCriteriaResults = (
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

export const normalizeSubjectiveMetricResults = (
  input: {
    capability: AdapterCapabilityName;
    rawResult?: Record<string, unknown>;
  },
  validationErrors: string[]
): SubjectiveMetricResult[] => {
  if (input.rawResult?.subjective_metric_results === undefined) {
    return [];
  }

  if (input.capability !== "grade_round") {
    validationErrors.push(
      `Capability '${input.capability}' cannot return 'subjective_metric_results'; only 'grade_round' may report subjective grading.`
    );
    return [];
  }

  if (!Array.isArray(input.rawResult.subjective_metric_results)) {
    validationErrors.push(
      "Capability 'grade_round' returned a non-array 'subjective_metric_results' field."
    );
    return [];
  }

  const normalizedResults: SubjectiveMetricResult[] = [];
  for (const rawMetric of input.rawResult.subjective_metric_results) {
    if (!isPlainObject(rawMetric)) {
      validationErrors.push(
        "Capability 'grade_round' returned a non-object subjective metric result."
      );
      continue;
    }

    const metricId = optionalTrimmedString(rawMetric.metric_id);
    if (!metricId) {
      validationErrors.push(
        "Capability 'grade_round' returned a subjective metric result without a metric_id."
      );
      continue;
    }

    const label = optionalTrimmedString(rawMetric.label);
    if (!label) {
      validationErrors.push(
        `Capability 'grade_round' returned subjective metric '${metricId}' with an empty label.`
      );
      continue;
    }

    const score =
      typeof rawMetric.score_out_of_ten === "number" &&
      Number.isFinite(rawMetric.score_out_of_ten) &&
      rawMetric.score_out_of_ten >= 0 &&
      rawMetric.score_out_of_ten <= 10
        ? Number(rawMetric.score_out_of_ten.toFixed(1))
        : undefined;
    if (score === undefined) {
      validationErrors.push(
        `Capability 'grade_round' returned subjective metric '${metricId}' with an invalid score_out_of_ten.`
      );
      continue;
    }

    const minimumScore =
      typeof rawMetric.minimum_score_out_of_ten === "number" &&
      Number.isFinite(rawMetric.minimum_score_out_of_ten) &&
      rawMetric.minimum_score_out_of_ten >= 0 &&
      rawMetric.minimum_score_out_of_ten <= 10
        ? Number(rawMetric.minimum_score_out_of_ten.toFixed(1))
        : undefined;
    if (minimumScore === undefined) {
      validationErrors.push(
        `Capability 'grade_round' returned subjective metric '${metricId}' with an invalid minimum_score_out_of_ten.`
      );
      continue;
    }

    const status =
      rawMetric.status === "pass" || rawMetric.status === "fail"
        ? rawMetric.status
        : undefined;
    if (!status) {
      validationErrors.push(
        `Capability 'grade_round' returned subjective metric '${metricId}' with an invalid status.`
      );
      continue;
    }

    const rationale = optionalTrimmedString(rawMetric.rationale);
    if (!rationale) {
      validationErrors.push(
        `Capability 'grade_round' returned subjective metric '${metricId}' without rationale.`
      );
      continue;
    }

    const recommendedChanges = parseStringList(
      rawMetric.recommended_changes,
      `Capability 'grade_round' returned subjective metric '${metricId}' with a non-string 'recommended_changes' collection.`,
      validationErrors
    );
    const evidencePaths = parseStringList(
      rawMetric.evidence_paths,
      `Capability 'grade_round' returned subjective metric '${metricId}' with a non-string 'evidence_paths' collection.`,
      validationErrors
    );
    if (evidencePaths.length === 0) {
      validationErrors.push(
        `Capability 'grade_round' returned subjective metric '${metricId}' without evidence paths.`
      );
      continue;
    }

    const violations =
      rawMetric.violations === undefined
        ? undefined
        : parseStringList(
            rawMetric.violations,
            `Capability 'grade_round' returned subjective metric '${metricId}' with a non-string 'violations' collection.`,
            validationErrors
          );

    const evidenceQuality =
      rawMetric.evidence_quality === undefined
        ? undefined
        : isPlainObject(rawMetric.evidence_quality)
          ? {
              ...(typeof rawMetric.evidence_quality.has_required_evidence === "boolean"
                ? {
                    has_required_evidence:
                      rawMetric.evidence_quality.has_required_evidence
                  }
                : {}),
              ...(optionalTrimmedString(rawMetric.evidence_quality.evidence_type)
                ? {
                    evidence_type: optionalTrimmedString(
                      rawMetric.evidence_quality.evidence_type
                    )
                  }
                : {})
            }
          : (() => {
              validationErrors.push(
                `Capability 'grade_round' returned subjective metric '${metricId}' with a non-object 'evidence_quality' field.`
              );
              return undefined;
            })();

    const qualityAxisId =
      rawMetric.quality_axis_id === undefined
        ? undefined
        : optionalTrimmedString(rawMetric.quality_axis_id);
    if (rawMetric.quality_axis_id !== undefined && !qualityAxisId) {
      validationErrors.push(
        `Capability 'grade_round' returned subjective metric '${metricId}' with an empty quality_axis_id.`
      );
      continue;
    }

    const required =
      rawMetric.required === undefined
        ? undefined
        : typeof rawMetric.required === "boolean"
          ? rawMetric.required
          : (() => {
              validationErrors.push(
                `Capability 'grade_round' returned subjective metric '${metricId}' with a non-boolean required flag.`
              );
              return undefined;
            })();

    normalizedResults.push({
      metric_id: metricId,
      label,
      score_out_of_ten: score,
      minimum_score_out_of_ten: minimumScore,
      status,
      rationale,
      recommended_changes: recommendedChanges,
      evidence_paths: evidencePaths,
      ...(violations?.length ? { violations } : {}),
      ...(evidenceQuality && Object.keys(evidenceQuality).length > 0
        ? { evidence_quality: evidenceQuality }
        : {}),
      ...(qualityAxisId ? { quality_axis_id: qualityAxisId } : {}),
      ...(required !== undefined ? { required } : {})
    });
  }

  const duplicateMetricIds = normalizedResults.filter(
    (metric, index, allMetrics) =>
      allMetrics.findIndex((candidate) => candidate.metric_id === metric.metric_id) !== index
  );
  if (duplicateMetricIds.length > 0) {
    validationErrors.push(
      `Capability 'grade_round' returned duplicate subjective metric ids: ${unique(duplicateMetricIds.map((metric) => metric.metric_id)).join(", ")}.`
    );
  }

  return normalizedResults;
};

export const parseVerificationWitness = async (input: {
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

export const validateAdapterCapabilityResult = async (input: {
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
  const subjectiveMetricResults = normalizeSubjectiveMetricResults(
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
        const targetUrlPolicy = validateTargetUrlPolicy(value);
        if (!targetUrlPolicy.ok || !targetUrlPolicy.url) {
          validationErrors.push(
            `Capability 'run_target' returned disallowed target_manifest.${key} '${value}': ${targetUrlPolicy.reason ?? "URL is not allowed."}`
          );
          continue;
        }
        targetManifest[key] = targetUrlPolicy.url;
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
      ...(validatedVerdict !== undefined ? { overall_verdict: validatedVerdict } : {}),
      ...(subjectiveMetricResults.length > 0
        ? { subjective_metric_results: subjectiveMetricResults }
        : {})
    },
    verified_evidence: verifiedEvidence,
    verified_criteria_results: verifiedCriteriaResults,
    verified_evidence_paths: unique(verifiedEvidence.map((item) => item.path)),
    validation_errors: validationErrors
  };
};

export const shellExecutableFor = (
  shell: "powershell" | "sh" | "bash" | "cmd"
): string => {
  switch (shell) {
    case "powershell":
      return "powershell.exe";
    case "sh":
      return "sh";
    case "bash":
      return "bash";
    case "cmd":
      return "cmd.exe";
  }
  throw new Error(`Unsupported shell: ${shell}`);
};

interface BufferedOutput {
  text: string;
  bytes: number;
  truncated: boolean;
}

const appendBoundedOutput = (
  output: BufferedOutput,
  chunk: Buffer | string,
  maxBytes: number
): boolean => {
  if (output.truncated) {
    return true;
  }

  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const remaining = maxBytes - output.bytes;
  if (remaining <= 0) {
    output.truncated = true;
    output.text += `\n[output truncated after ${maxBytes} bytes]\n`;
    return true;
  }

  if (buffer.length > remaining) {
    output.text += buffer.subarray(0, remaining).toString();
    output.text += `\n[output truncated after ${maxBytes} bytes]\n`;
    output.bytes = maxBytes;
    output.truncated = true;
    return true;
  }

  output.text += buffer.toString();
  output.bytes += buffer.length;
  return false;
};

export const execCommand = async (input: {
  command: string;
  args?: string[];
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
  timedOut: boolean;
  outputLimitExceeded: boolean;
  outputLimitBytes: number;
}> =>
  new Promise((resolvePromise, rejectPromise) => {
    const startedAtDate = new Date();
    const child = (() => {
      if (input.shell) {
        return spawn(input.command, {
          cwd: input.cwd,
          env: input.env,
          shell: shellExecutableFor(input.shell),
          detached: process.platform !== "win32",
          windowsHide: true
        });
      }

      const [command, ...args] = Array.isArray(input.args)
        ? [input.command, ...input.args]
        : commandTokens(input.command);
      if (!command) {
        rejectPromise(new Error("Adapter command cannot be empty."));
        return undefined;
      }
      return spawn(command, args, {
        cwd: input.cwd,
        env: input.env,
        shell: false,
        detached: process.platform !== "win32",
        windowsHide: true
      });
    })();
    if (!child) {
      return;
    }

    const stdout: BufferedOutput = { text: "", bytes: 0, truncated: false };
    const stderr: BufferedOutput = { text: "", bytes: 0, truncated: false };
    let timedOut = false;
    let outputLimitExceeded = false;
    const outputLimitBytes = commandOutputMaxBytes();
    const timer = setTimeout(() => {
      timedOut = true;
      void stopProcessTree(child.pid ?? -1);
    }, input.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      if (appendBoundedOutput(stdout, chunk, outputLimitBytes) && !outputLimitExceeded) {
        outputLimitExceeded = true;
        void stopProcessTree(child.pid ?? -1);
      }
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      if (appendBoundedOutput(stderr, chunk, outputLimitBytes) && !outputLimitExceeded) {
        outputLimitExceeded = true;
        void stopProcessTree(child.pid ?? -1);
      }
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      clearTimeout(timer);
      const finishedAtDate = new Date();
      resolvePromise({
        code,
        stdout: stdout.text,
        stderr: stderr.text,
        startedAt: startedAtDate.toISOString(),
        finishedAt: finishedAtDate.toISOString(),
        durationMs: finishedAtDate.getTime() - startedAtDate.getTime(),
        timedOut,
        outputLimitExceeded,
        outputLimitBytes
      });
    });
  });

export const normalizeVerificationProfile = (
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
    const qualityAxisId =
      rawCriterion.quality_axis_id === undefined
        ? undefined
        : typeof rawCriterion.quality_axis_id === "string" &&
            rawCriterion.quality_axis_id.trim().length > 0
          ? rawCriterion.quality_axis_id.trim()
          : (() => {
              throw new Error(
                `Verification profile '${profilePath}' criterion '${criterionId}' has an empty 'quality_axis_id'.`
              );
            })();

    return {
      criterion_id: criterionId,
      capability,
      summary,
      operator,
      expected_value: expectedValue,
      ...(assertionId ? { assertion_id: assertionId } : {}),
      ...(qualityAxisId ? { quality_axis_id: qualityAxisId } : {}),
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
            const qualityAxisId =
              rawProbe.quality_axis_id === undefined
                ? undefined
                : typeof rawProbe.quality_axis_id === "string" &&
                    rawProbe.quality_axis_id.trim().length > 0
                  ? rawProbe.quality_axis_id.trim()
                  : (() => {
                      throw new Error(
                        `Verification profile '${profilePath}' core probe '${probeId}' has an empty 'quality_axis_id'.`
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
                        "assert_visible",
                        "assert_not_visible",
                        "assert_value"
                      ]);
                      const valueRequiredActions = new Set([
                        "fill",
                        "press",
                        "assert_text",
                        "assert_value",
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

            const args =
              rawProbe.args === undefined
                ? undefined
                : Array.isArray(rawProbe.args) &&
                    rawProbe.args.every((entry) => typeof entry === "string")
                  ? rawProbe.args
                  : (() => {
                      throw new Error(
                        `Verification profile '${profilePath}' core probe '${probeId}' must use a string array for 'args'.`
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
            if (role === "release_gate" && !releaseGateCapableProbeModes.has(mode)) {
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
              ...(qualityAxisId ? { quality_axis_id: qualityAxisId } : {}),
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
              ...(args ? { args } : {}),
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
  const qualityContract =
    rawProfile.quality_contract === undefined
      ? undefined
      : isPlainObject(rawProfile.quality_contract)
        ? ({
            primary_goal: requiredProfileString(
              rawProfile.quality_contract.primary_goal,
              profilePath,
              "quality_contract.primary_goal"
            ),
            quality_axes: Array.isArray(rawProfile.quality_contract.quality_axes)
              ? rawProfile.quality_contract.quality_axes.map((rawAxis, index) => {
                  if (!isPlainObject(rawAxis)) {
                    throw new Error(
                      `Verification profile '${profilePath}' has a non-object quality axis at index ${index}.`
                    );
                  }

                  const scoringMode =
                    rawAxis.scoring_mode === undefined
                      ? undefined
                      : rawAxis.scoring_mode === "binary_release_gate" ||
                          rawAxis.scoring_mode === "subjective_out_of_ten"
                        ? rawAxis.scoring_mode
                        : (() => {
                            throw new Error(
                              `Verification profile '${profilePath}' quality axis '${requiredProfileString(rawAxis.axis_id, profilePath, `quality_contract.quality_axes[${index}].axis_id`)}' has an invalid scoring_mode '${String(rawAxis.scoring_mode)}'.`
                            );
                          })();

                  return {
                    axis_id: requiredProfileString(
                      rawAxis.axis_id,
                      profilePath,
                      `quality_contract.quality_axes[${index}].axis_id`
                    ),
                    label: requiredProfileString(
                      rawAxis.label,
                      profilePath,
                      `quality_contract.quality_axes[${index}].label`
                    ),
                    description: requiredProfileString(
                      rawAxis.description,
                      profilePath,
                      `quality_contract.quality_axes[${index}].description`
                    ),
                    ...(optionalTrimmedString(rawAxis.desired_outcome)
                      ? { desired_outcome: optionalTrimmedString(rawAxis.desired_outcome) }
                      : {}),
                    ...(parseOptionalProfileStringArray(
                      rawAxis.preserve_signals,
                      profilePath,
                      `quality_contract.quality_axes[${index}].preserve_signals`
                    )
                      ? {
                          preserve_signals: parseOptionalProfileStringArray(
                            rawAxis.preserve_signals,
                            profilePath,
                            `quality_contract.quality_axes[${index}].preserve_signals`
                          )
                        }
                      : {}),
                    ...(parseOptionalProfileStringArray(
                      rawAxis.reference_signals,
                      profilePath,
                      `quality_contract.quality_axes[${index}].reference_signals`
                    )
                      ? {
                          reference_signals: parseOptionalProfileStringArray(
                            rawAxis.reference_signals,
                            profilePath,
                            `quality_contract.quality_axes[${index}].reference_signals`
                          )
                        }
                      : {}),
                    ...(scoringMode ? { scoring_mode: scoringMode } : {}),
                    ...(rawAxis.minimum_score_out_of_ten !== undefined
                      ? {
                          minimum_score_out_of_ten: normalizeScoreOutOfTen({
                            value: rawAxis.minimum_score_out_of_ten,
                            profilePath,
                            fieldName: `quality_contract.quality_axes[${index}].minimum_score_out_of_ten`
                          })
                        }
                      : {})
                  };
                })
              : (() => {
                  throw new Error(
                    `Verification profile '${profilePath}' must use an array for 'quality_contract.quality_axes'.`
                  );
                })(),
            ...(parseOptionalProfileStringArray(
              rawProfile.quality_contract.preserve_signals,
              profilePath,
              "quality_contract.preserve_signals"
            )
              ? {
                  preserve_signals: parseOptionalProfileStringArray(
                    rawProfile.quality_contract.preserve_signals,
                    profilePath,
                    "quality_contract.preserve_signals"
                  )
                }
              : {}),
            ...(parseOptionalProfileStringArray(
              rawProfile.quality_contract.reference_signals,
              profilePath,
              "quality_contract.reference_signals"
            )
              ? {
                  reference_signals: parseOptionalProfileStringArray(
                    rawProfile.quality_contract.reference_signals,
                    profilePath,
                    "quality_contract.reference_signals"
                  )
                }
              : {}),
            ...(rawProfile.quality_contract.critique_style !== undefined
              ? rawProfile.quality_contract.critique_style === "deterministic_release_gate"
                ? { critique_style: "deterministic_release_gate" as const }
                : (() => {
                    throw new Error(
                      `Verification profile '${profilePath}' has an invalid quality_contract.critique_style '${String(rawProfile.quality_contract.critique_style)}'.`
                    );
                  })()
              : {})
          } satisfies QualityContract)
        : (() => {
            throw new Error(
              `Verification profile '${profilePath}' must use an object for 'quality_contract'.`
            );
          })();
  const subjectiveMetrics =
    rawProfile.subjective_metrics === undefined
      ? undefined
      : Array.isArray(rawProfile.subjective_metrics)
        ? rawProfile.subjective_metrics.map((rawMetric, index) => {
            if (!isPlainObject(rawMetric)) {
              throw new Error(
                `Verification profile '${profilePath}' has a non-object subjective metric at index ${index}.`
              );
            }

            const required =
              rawMetric.required === undefined
                ? undefined
                : typeof rawMetric.required === "boolean"
                  ? rawMetric.required
                  : (() => {
                      throw new Error(
                        `Verification profile '${profilePath}' subjective metric '${requiredProfileString(rawMetric.metric_id, profilePath, `subjective_metrics[${index}].metric_id`)}' has a non-boolean required flag.`
                      );
                    })();
            const weight =
              rawMetric.weight === undefined
                ? undefined
                : typeof rawMetric.weight === "number" &&
                    Number.isFinite(rawMetric.weight) &&
                    rawMetric.weight >= 0
                  ? Number(rawMetric.weight.toFixed(3))
                  : (() => {
                      throw new Error(
                        `Verification profile '${profilePath}' subjective metric '${requiredProfileString(rawMetric.metric_id, profilePath, `subjective_metrics[${index}].metric_id`)}' has an invalid weight.`
                      );
                    })();
            const qualityAxisId =
              rawMetric.quality_axis_id === undefined
                ? undefined
                : requiredProfileString(
                    rawMetric.quality_axis_id,
                    profilePath,
                    `subjective_metrics[${index}].quality_axis_id`
                  );

            return {
              metric_id: requiredProfileString(
                rawMetric.metric_id,
                profilePath,
                `subjective_metrics[${index}].metric_id`
              ),
              label: requiredProfileString(
                rawMetric.label,
                profilePath,
                `subjective_metrics[${index}].label`
              ),
              description: requiredProfileString(
                rawMetric.description,
                profilePath,
                `subjective_metrics[${index}].description`
              ),
              minimum_score_out_of_ten: normalizeScoreOutOfTen({
                value: rawMetric.minimum_score_out_of_ten,
                profilePath,
                fieldName: `subjective_metrics[${index}].minimum_score_out_of_ten`
              }),
              ...(qualityAxisId ? { quality_axis_id: qualityAxisId } : {}),
              ...(required !== undefined ? { required } : {}),
              ...(weight !== undefined ? { weight } : {})
            } satisfies VerificationSubjectiveMetric;
          })
        : (() => {
            throw new Error(
              `Verification profile '${profilePath}' must use an array for 'subjective_metrics'.`
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
    ...(qualityContract ? { quality_contract: qualityContract } : {}),
    ...(subjectiveMetrics && subjectiveMetrics.length > 0
      ? { subjective_metrics: subjectiveMetrics }
      : {}),
    ...(notes && notes.length > 0 ? { notes } : {})
  };
};

export const verificationProviderForCapability = (
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
