import type { SessionAdapterPlan, SessionIntakeSnapshot, SessionWorkflowCheck, VerificationSurface } from "./intake-schema.js";
import type { TargetFamily } from "./types.js";
export declare const generatedAdapterFiles: readonly ["generated-adapter/adapter.generated.json", "generated-adapter/adapter-plan.generated.json", "generated-adapter/adapter-plan.generated.md", "generated-adapter/rubric.generated.json", "generated-adapter/verification-profile.generated.json", "generated-adapter/codex-adapter/runtime-config.json", "generated-adapter/codex-adapter/scripts/prepare-target.mjs", "generated-adapter/codex-adapter/scripts/apply-change.mjs", "generated-adapter/codex-adapter/scripts/run-target.mjs", "generated-adapter/codex-adapter/scripts/capture-evidence.mjs", "generated-adapter/codex-adapter/scripts/run-checks.mjs", "generated-adapter/codex-adapter/scripts/grade-round.mjs"];
export declare const defaultVerificationSurfacesForFamily: (targetFamily: TargetFamily) => VerificationSurface[];
export declare const normalizeVerificationSurfacesForFamily: (targetFamily: TargetFamily, surfaces: readonly VerificationSurface[] | undefined) => VerificationSurface[];
export declare const selectorHintsForWorkflow: (index: number) => NonNullable<SessionWorkflowCheck["selector_hints"]>;
export declare const normalizeWorkflowName: (value: string) => string;
export declare const workflowNameMatches: (left: string, right: string) => boolean;
export declare const defaultWorkflowChecksFromCoreFeatures: (coreFeatures: readonly string[], surfaces: readonly VerificationSurface[]) => SessionWorkflowCheck[];
export declare const alignWorkflowChecksToCoreFeatures: (coreFeatures: readonly string[], checks: readonly SessionWorkflowCheck[], surfaces: readonly VerificationSurface[]) => SessionWorkflowCheck[];
export declare const hasExplicitApiNegation: (value: string) => boolean;
export declare const parseVerificationSurfacesAnswer: (value: string) => VerificationSurface[];
export declare const parseWorkflowChecksAnswer: (value: string, defaultSurface?: VerificationSurface) => SessionWorkflowCheck[];
export declare const buildAdapterPlanFromIntake: (input: {
    intake: SessionIntakeSnapshot;
    targetFamily: TargetFamily;
}) => SessionAdapterPlan;
export declare const adapterPlanPreviewLines: (plan: SessionAdapterPlan, locale?: "en" | "ko") => string[];
export declare const adapterPlanMarkdown: (plan: SessionAdapterPlan) => string;
//# sourceMappingURL=adapter-plan.d.ts.map