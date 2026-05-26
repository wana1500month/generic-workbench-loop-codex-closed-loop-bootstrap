import type { AdapterCriterionResult, AdapterEvidenceItem, AdapterCapabilityName, AdapterCapabilityPacket, AdapterCapabilityResult, BrowserJourneyStepAction, CoreVerificationProbeMode, CoreVerificationProbeRole, CoreVerificationProbeScope, ExternalAdapterContract, LiveVerificationMode, ProbeSemanticLevel, ProofCapabilityName, RoundVerdict, SubjectiveMetricResult, TargetFamily, TargetSurface, TargetManifestKey, ValidationLane, VerificationAssertionTag, VerificationCriterion, VerificationProfile, VerificationProviderSpec, VerifiedAdapterCriterionResult, VerifiedAdapterEvidenceItem, VerificationWitness } from "../types.js";
export declare const defaultCapabilityResult: (capability: AdapterCapabilityName, summary: string) => AdapterCapabilityResult;
export declare const roundVerdicts: Set<RoundVerdict>;
export declare const criterionStatuses: Set<"pass" | "fail">;
export declare const verificationOperators: Set<string>;
export declare const adapterCapabilities: Set<AdapterCapabilityName>;
export declare const proofCapabilities: Set<ProofCapabilityName>;
export declare const capabilitiesRequiringEvidence: Set<AdapterCapabilityName>;
export declare const textEvidenceExtensions: Set<string>;
export declare const jsonEvidenceExtensions: Set<string>;
export declare const imageEvidenceExtensions: Set<string>;
export declare const liveVerificationModes: Set<LiveVerificationMode>;
export declare const targetSurfaces: Set<TargetSurface>;
export declare const targetFamilies: Set<TargetFamily>;
export declare const validationLanes: Set<ValidationLane>;
export declare const verificationAssertionTags: Set<VerificationAssertionTag>;
export declare const coreVerificationProbeModes: Set<CoreVerificationProbeMode>;
export declare const coreVerificationProbeRoles: Set<CoreVerificationProbeRole>;
export declare const coreVerificationProbeScopes: Set<"target_root">;
export declare const targetManifestKeys: Set<TargetManifestKey>;
export declare const probeSemanticLevels: Set<ProbeSemanticLevel>;
export declare const browserJourneyStepActions: Set<BrowserJourneyStepAction>;
export declare const unique: <T>(values: readonly T[]) => T[];
export declare const sha256ForBuffer: (value: Buffer | string) => string;
export declare const commandTokens: (command: string) => string[];
export declare const commandVectorFor: (input: {
    command: string;
    args?: readonly string[];
}) => string[];
export declare const commandDigestFor: (input: {
    command: string;
    args?: readonly string[];
}) => string;
export declare const commandTargetFingerprint: (input: {
    command: string;
    args?: readonly string[];
    baseDirectory: string;
    cwd?: string;
}) => string;
export declare const isPlainObject: (value: unknown) => value is Record<string, unknown>;
export declare const isPrimitiveMetadataValue: (value: unknown) => value is string | number | boolean | ReadonlyArray<string | number | boolean>;
export declare const hasPrimitiveMetadata: (value: unknown) => value is Record<string, string | number | boolean | ReadonlyArray<string | number | boolean>>;
export declare const normalizeScoreWeightBlock: (input: {
    rawValue: unknown;
    allowedKeys: readonly string[];
    profilePath: string;
    fieldName: string;
}) => Record<string, number> | undefined;
export declare const pathExists: (path: string) => Promise<boolean>;
export declare const evidenceMaxBytes: () => number;
export declare const commandOutputMaxBytes: () => number;
export declare const attemptPathForCapability: (roundDirectory: string, capability: AdapterCapabilityName) => string;
export declare const lateResultPathForCapability: (input: {
    roundDirectory: string;
    capability: AdapterCapabilityName;
    executionId: string;
    suffix: string;
}) => string;
export declare const resultExecutionIdFor: (input: {
    packet?: AdapterCapabilityPacket;
    rawResult: unknown;
}) => string | undefined;
export declare const withExecutionMetadata: (rawResult: unknown, executionId: string) => unknown;
export declare const quarantineResultFile: (input: {
    sourcePath: string;
    roundDirectory: string;
    capability: AdapterCapabilityName;
    executionId: string;
    suffix: string;
}) => Promise<string | undefined>;
export declare const resolvedPath: (path: string) => string;
export declare const isProofCapability: (capability: AdapterCapabilityName) => capability is ProofCapabilityName;
export declare const isVerificationCapability: (value: unknown) => value is VerificationCriterion["capability"];
export declare const isLiveVerificationMode: (value: unknown) => value is LiveVerificationMode;
export declare const isTargetSurface: (value: unknown) => value is TargetSurface;
export declare const isTargetFamily: (value: unknown) => value is TargetFamily;
export declare const isValidationLane: (value: unknown) => value is ValidationLane;
export declare const isVerificationAssertionTag: (value: unknown) => value is VerificationAssertionTag;
export declare const isCoreVerificationProbeMode: (value: unknown) => value is CoreVerificationProbeMode;
export declare const isCoreVerificationProbeScope: (value: unknown) => value is CoreVerificationProbeScope;
export declare const isCoreVerificationProbeRole: (value: unknown) => value is CoreVerificationProbeRole;
export declare const isTargetManifestKey: (value: unknown) => value is TargetManifestKey;
export declare const isProbeSemanticLevel: (value: unknown) => value is ProbeSemanticLevel;
export declare const isBrowserJourneyStepAction: (value: unknown) => value is BrowserJourneyStepAction;
export declare const defaultProbeRoleForMode: (mode: CoreVerificationProbeMode) => CoreVerificationProbeRole;
export declare const releaseGateCapableProbeModes: Set<CoreVerificationProbeMode>;
export declare const isHttpUrl: (value: string) => boolean;
export declare const normalizedEvidenceKind: (explicitKind: string | undefined, evidencePath: string) => string;
export declare const isJsonEvidence: (kind: string, evidencePath: string) => boolean;
export declare const isTextEvidence: (kind: string, evidencePath: string) => boolean;
export declare const isImageEvidence: (kind: string, evidencePath: string) => boolean;
export declare const hasExpectedImageSignature: (buffer: Buffer, evidencePath: string) => boolean;
export declare const inspectEvidenceContent: (input: {
    evidencePath: string;
    resolvedEvidencePath: string;
    kind?: string;
}) => Promise<{
    ok: boolean;
    summary: string;
}>;
export declare const resolveEvidencePath: (input: {
    evidencePath: string;
    baseDirectory: string;
    cwd: string;
    targetRoot: string;
    runDirectory: string;
    roundDirectory: string;
}) => Promise<string | undefined>;
export declare const parseStringList: (value: unknown, errorMessage: string, validationErrors: string[]) => string[];
export declare const optionalTrimmedString: (value: unknown) => string | undefined;
export declare const requiredProfileString: (value: unknown, profilePath: string, fieldName: string) => string;
export declare const parseOptionalProfileStringArray: (value: unknown, profilePath: string, fieldName: string) => string[] | undefined;
export declare const normalizeScoreOutOfTen: (input: {
    value: unknown;
    profilePath: string;
    fieldName: string;
}) => number;
export declare const normalizeEvidenceItems: (input: {
    capability: AdapterCapabilityName;
    rawResult?: Record<string, unknown>;
    evidencePaths: string[];
}, validationErrors: string[]) => AdapterEvidenceItem[];
export declare const normalizeCriteriaResults: (input: {
    capability: AdapterCapabilityName;
    rawResult?: Record<string, unknown>;
}, validationErrors: string[]) => AdapterCriterionResult[];
export declare const normalizeSubjectiveMetricResults: (input: {
    capability: AdapterCapabilityName;
    rawResult?: Record<string, unknown>;
}, validationErrors: string[]) => SubjectiveMetricResult[];
export declare const parseVerificationWitness: (input: {
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
}) => Promise<{
    witness?: VerificationWitness;
    errors: string[];
}>;
export declare const validateAdapterCapabilityResult: (input: {
    capability: AdapterCapabilityName;
    rawResult: unknown;
    providerId: string;
    providerRole: "executor" | "verifier";
    baseDirectory: string;
    cwd: string;
    targetRoot: string;
    runDirectory: string;
    roundDirectory: string;
}) => Promise<{
    result: AdapterCapabilityResult;
    verified_evidence: VerifiedAdapterEvidenceItem[];
    verified_criteria_results: VerifiedAdapterCriterionResult[];
    verified_evidence_paths: string[];
    validation_errors: string[];
}>;
export declare const shellExecutableFor: (shell: "powershell" | "sh" | "bash" | "cmd") => string;
export declare const execCommand: (input: {
    command: string;
    args?: string[];
    cwd: string;
    timeoutMs: number;
    env: NodeJS.ProcessEnv;
    shell?: "powershell" | "sh" | "bash" | "cmd";
}) => Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    timedOut: boolean;
    outputLimitExceeded: boolean;
    outputLimitBytes: number;
}>;
export declare const normalizeVerificationProfile: (rawProfile: unknown, profilePath: string) => VerificationProfile;
export declare const verificationProviderForCapability: (contract: ExternalAdapterContract, capability: AdapterCapabilityName) => {
    providerRole: "executor" | "verifier";
    providerId: string;
    capabilitySpec?: VerificationProviderSpec["capabilities"][ProofCapabilityName] | ExternalAdapterContract["capabilities"][AdapterCapabilityName];
};
//# sourceMappingURL=shared.d.ts.map