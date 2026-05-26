import type { AdapterCapabilityExecution, CoreVerificationProbeExecution, LoadedAdapterContract, RoundCheckResult, RoundCheckStatus, TargetManifest, VerificationAssertionTag, VerificationCriterion, VerificationCoreProbe } from "../types.js";
export declare const adapterContractDocPath: string;
export declare const adapterExamplePath: string;
export declare const adapterRuntimePath: string;
export declare const placeholderSurfaceChecks: Set<string>;
export declare const artifactOnlyChecks: Set<string>;
export declare const knownCheckIds: Set<string>;
export declare const nonCarryForwardDerivedChecks: Set<string>;
export declare const proofEvaluatorChecks: Set<string>;
export declare const nonScoringDerivedChecks: Set<string>;
export declare const liveVerificationKinds: Set<string>;
export declare const proofCapabilityKinds: Set<string>;
export declare const releaseGateCoreProbeModes: Set<string>;
export declare const unique: <T>(values: readonly T[]) => T[];
export declare const isProofCapabilityName: (value: string) => boolean;
export declare const proofExecutionsFor: (adapterExecutions: readonly AdapterCapabilityExecution[]) => AdapterCapabilityExecution[];
export declare const buildProofEvidenceOriginIndex: (adapterExecutions: readonly AdapterCapabilityExecution[]) => Map<string, Set<string>>;
export declare const commandTokens: (command: string) => string[];
export declare const commandVectorFor: (input: {
    command: string;
    args?: readonly string[];
}) => string[];
export declare const commandTargetFingerprint: (input: {
    command: string;
    args?: readonly string[];
    baseDirectory: string;
    cwd?: string;
}) => string;
export declare const observedValueMatches: (operator: "equals" | "contains" | "regex" | "number_gte" | "number_lte", observedValue: string, expectedValue: string) => boolean;
export declare const checkResult: (check_id: string, status: RoundCheckStatus, detail: string) => RoundCheckResult;
export declare const isPassingCheck: (result: RoundCheckResult) => boolean;
export declare const isFailingCheck: (result: RoundCheckResult) => boolean;
export declare const isSatisfiedCheck: (result: RoundCheckResult) => boolean;
export declare const isApplicableCheck: (result: RoundCheckResult) => boolean;
export declare const ratioScore: (passedItems: number, totalItems: number) => number;
export declare const strictPartialCreditScore: (passedItems: number, totalItems: number) => number;
export declare const scoreFromResults: (results: readonly RoundCheckResult[], options?: {
    strictPartialCredit?: boolean;
}) => number;
export declare const isKnownCheck: (checkId: string) => boolean;
export declare const pathExists: (path?: string) => boolean;
export declare const requiredProofCapabilities: readonly ["capture_evidence", "run_checks", "grade_round"];
export declare const requiredCoreProbesFor: (loadedAdapter?: LoadedAdapterContract) => VerificationCoreProbe[];
export declare const coreProbeRole: (probe: VerificationCoreProbe) => import("../types.js").CoreVerificationProbeRole;
export declare const probeSemanticLevel: (probe: VerificationCoreProbe) => import("../types.js").ProbeSemanticLevel;
export declare const assertionIdForCriterion: (criterion: VerificationCriterion) => string;
export declare const releaseAssertionIdForProbe: (probe: VerificationCoreProbe) => string | undefined;
export declare const requiredReleaseGateCoreProbesFor: (loadedAdapter?: LoadedAdapterContract) => VerificationCoreProbe[];
export declare const requiredBrowserJourneyReleaseProbesFor: (loadedAdapter?: LoadedAdapterContract) => VerificationCoreProbe[];
export declare const requiredHttpJsonReleaseProbesFor: (loadedAdapter?: LoadedAdapterContract) => VerificationCoreProbe[];
export declare const minimumFeatureReleaseAssertionsFor: (loadedAdapter?: LoadedAdapterContract) => number;
export declare const minimumAssertionTagCountsFor: (loadedAdapter?: LoadedAdapterContract) => Partial<Record<VerificationAssertionTag, number>>;
export declare const expectedTargetSurfacesFor: (loadedAdapter?: LoadedAdapterContract) => Set<"browser" | "api">;
export declare const normalizedWeights: <T extends string>(weights: Partial<Record<T, number>>, fallback: Record<T, number>) => Record<T, number>;
export declare const proofScoreWeightsFor: (loadedAdapter?: LoadedAdapterContract) => Record<keyof import("../types.js").VerificationProofScoreWeights, number>;
export declare const releaseScoreWeightsFor: (loadedAdapter?: LoadedAdapterContract) => Record<keyof import("../types.js").VerificationReleaseScoreWeights, number>;
export declare const visualEvidenceExtensions: Set<string>;
export declare const isVisualEvidencePath: (path: string) => boolean;
export declare const successfulGradeRoundExecutionFor: (adapterExecutions: readonly AdapterCapabilityExecution[]) => AdapterCapabilityExecution | undefined;
export declare const assertionTagLabel: (tag: VerificationAssertionTag) => string;
export declare const configuredReleaseAssertionIdsForTag: (loadedAdapter: LoadedAdapterContract | undefined, tag: VerificationAssertionTag) => Set<string>;
export declare const releaseGateAssertionIdsFor: (loadedAdapter?: LoadedAdapterContract) => Set<string>;
export declare const hardReleaseAssertionIdsFor: (loadedAdapter?: LoadedAdapterContract) => Set<string>;
export declare const passedFeatureReleaseAssertionIds: (input: {
    loadedAdapter?: LoadedAdapterContract;
    coreProbeResults: CoreVerificationProbeExecution[];
}) => Set<string>;
export declare const passedBrowserJourneyAssertionIds: (input: {
    loadedAdapter?: LoadedAdapterContract;
    coreProbeResults: CoreVerificationProbeExecution[];
}) => Set<string>;
export declare const passedHttpJsonAssertionIds: (input: {
    loadedAdapter?: LoadedAdapterContract;
    coreProbeResults: CoreVerificationProbeExecution[];
}) => Set<string>;
export declare const passedReleaseAssertionIdsForTag: (input: {
    loadedAdapter?: LoadedAdapterContract;
    coreProbeResults: CoreVerificationProbeExecution[];
    tag: VerificationAssertionTag;
}) => Set<string>;
export declare const verificationBoundaryIssues: (loadedAdapter?: LoadedAdapterContract) => string[];
export declare const fileWrittenCheck: (check_id: string, path: string | undefined, label: string) => RoundCheckResult;
export declare const fileSurfaceReservedCheck: (check_id: string, path: string | undefined, label: string) => RoundCheckResult;
export declare const adapterHonestyCheck: (input: {
    loadedAdapter?: LoadedAdapterContract;
    adapterExecutions: AdapterCapabilityExecution[];
}) => RoundCheckResult;
export declare const proofBoundaryIndependenceCheck: (input: {
    loadedAdapter?: LoadedAdapterContract;
    adapterExecutions: AdapterCapabilityExecution[];
}) => RoundCheckResult;
export declare const proofProvenanceAttestationCheck: (input: {
    loadedAdapter?: LoadedAdapterContract;
    adapterExecutions: AdapterCapabilityExecution[];
}) => RoundCheckResult;
export declare const liveVerificationPresentCheck: (input: {
    loadedAdapter?: LoadedAdapterContract;
    adapterExecutions: AdapterCapabilityExecution[];
    coreProbeResults: CoreVerificationProbeExecution[];
    targetManifest?: TargetManifest;
}) => RoundCheckResult;
export declare const independentTargetProbeCheck: (input: {
    loadedAdapter?: LoadedAdapterContract;
    coreProbeResults: CoreVerificationProbeExecution[];
    targetManifest?: TargetManifest;
}) => RoundCheckResult;
export declare const adapterMeaningfulEvidenceCheck: (input: {
    loadedAdapter?: LoadedAdapterContract;
    adapterExecutions: AdapterCapabilityExecution[];
}) => RoundCheckResult;
export declare const adapterCriteriaGroundingCheck: (input: {
    loadedAdapter?: LoadedAdapterContract;
    adapterExecutions: AdapterCapabilityExecution[];
}) => RoundCheckResult;
export declare const evaluateVerificationProfile: (input: {
    loadedAdapter?: LoadedAdapterContract;
    adapterExecutions: AdapterCapabilityExecution[];
}) => {
    profileCheck: RoundCheckResult;
    criterionChecks: RoundCheckResult[];
    hardFailedCriterionIds: string[];
};
//# sourceMappingURL=shared.d.ts.map