import type { EvalReport, FailureLineage, FailureLineagePolicySnapshot, LoadedAdapterContract, RoundSummary, TargetManifest } from "./types.js";
export declare const buildFailureLineageArtifact: (input: {
    evalReport: EvalReport;
    loadedAdapter?: LoadedAdapterContract;
    targetManifest?: TargetManifest;
    previousRoundSummary?: RoundSummary;
}) => FailureLineage;
export declare const buildFailureLineagePolicySnapshot: (input: {
    history: readonly RoundSummary[];
    failureLineage: FailureLineage;
    scoreDeltas: number[];
    scopeDriftDetected: boolean;
    patchEntropy: number;
    projectedPlateauCount: number;
    plateauLimit: number;
}) => FailureLineagePolicySnapshot;
export declare const applyFailureLineagePolicySnapshot: (input: {
    history: readonly RoundSummary[];
    failureLineage: FailureLineage;
    scoreDeltas: number[];
    scopeDriftDetected: boolean;
    patchEntropy: number;
    projectedPlateauCount: number;
    plateauLimit: number;
}) => FailureLineage;
export declare const isPureEnvironmentBlockedLineage: (failureLineage?: FailureLineage) => boolean;
export declare const failureLineageArtifactPath: (roundDirectory: string) => string;
export declare const loadFailureLineageArtifact: (path?: string) => Promise<FailureLineage | undefined>;
//# sourceMappingURL=failure-lineage.d.ts.map