import type { AttachedGeneratorResponseArtifact, AttachedGeneratorTaskArtifact, LoadedAdapterContract, TargetManifest } from "./types.js";
export type PrototypeBaselineState = {
    source_round?: number;
    source_phase?: string;
    source_semantics?: PrototypeBaselineSourceSemantics;
    source_path?: string;
    baseline_path?: string;
    source_target?: string;
    probe_id?: string | null;
    created_at?: string;
    evidence_paths?: string[];
};
export type PrototypeBaselineCaptureResult = {
    status: "captured" | "reused" | "skipped" | "blocked";
    baseline_path?: string;
    source_phase?: string | null;
    source_semantics?: PrototypeBaselineSourceSemantics;
    source_round?: number;
    source_target?: string;
    readiness_url?: string;
    reason?: string;
    evidence_paths?: string[];
    prototype_baseline_present: boolean;
    prototype_baseline_valid: boolean;
};
export type PrototypeBaselineSourceSemantics = "initial_pre_round_baseline" | "first_rendered_round_fallback" | "operator_provided_initial_baseline" | "post_mutation_or_late_round_baseline" | "unknown_baseline_origin";
export declare const validPrototypeBaselineSourcePhases: Set<string>;
export declare const prototypeBaselinePaths: (runtimeDirectory: string) => {
    manifestPath: string;
    screenshotPath: string;
    tracePath: string;
};
export declare const isValidPrototypeBaselineSourcePhase: (value: unknown) => value is string;
export declare const prototypeBaselineSourceSemanticsForPhase: (value: unknown) => PrototypeBaselineSourceSemantics | undefined;
export declare const isPrototypeBaselineSourceSemantics: (value: unknown) => value is PrototypeBaselineSourceSemantics;
export declare const describePrototypeBaselineSourceSemantics: (value: PrototypeBaselineSourceSemantics | undefined) => string | undefined;
export declare const hasPrototypeBaseline: (state: PrototypeBaselineState | undefined) => state is PrototypeBaselineState & {
    baseline_path: string;
};
export declare const hasValidPrototypeBaseline: (state: PrototypeBaselineState | undefined) => state is PrototypeBaselineState & {
    baseline_path: string;
    source_phase: string;
};
export declare const attachedPreGeneratorBaselineWindowOpen: (input: {
    round: number;
    attachedGeneratorEligible: boolean;
    existingTask?: AttachedGeneratorTaskArtifact;
    existingResponse?: AttachedGeneratorResponseArtifact;
}) => boolean;
export declare const loadPrototypeBaselineState: (runtimeDirectory: string) => Promise<PrototypeBaselineState | undefined>;
export declare const captureBootstrapGeneratedBaselineIfNeeded: (input: {
    loadedAdapter: LoadedAdapterContract;
    runtimeDirectory: string;
    targetManifest?: TargetManifest;
}) => Promise<PrototypeBaselineCaptureResult>;
//# sourceMappingURL=prototype-baseline.d.ts.map