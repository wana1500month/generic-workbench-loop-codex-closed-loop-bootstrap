import { type EvidenceSurface, type ProjectKind } from "./evaluation-policy.js";
export type AdaptiveQuestionField = "verification_surface" | "workflow_checks" | "quality_metrics" | "failure_expectations";
export interface AdaptiveQuestionCandidate {
    id: AdaptiveQuestionField;
    question: string;
    why_it_matters: string;
    value_score: number;
    project_kind: ProjectKind;
    evidence_surfaces: EvidenceSurface[];
}
export interface AdaptiveQuestionSet {
    project_kind: ProjectKind;
    evidence_surfaces: EvidenceSurface[];
    selected_questions: AdaptiveQuestionCandidate[];
    by_field: Partial<Record<AdaptiveQuestionField, AdaptiveQuestionCandidate>>;
}
export declare const buildAdaptiveQuestionSet: (input: {
    request: string;
    projectKind?: ProjectKind;
    explicitEvidenceSurfaces?: readonly EvidenceSurface[];
    hasVerificationSurface: boolean;
    hasWorkflowChecks: boolean;
    hasCustomQualityMetrics?: boolean;
    hasFailureExpectations?: boolean;
    maxQuestions?: number;
}) => AdaptiveQuestionSet;
//# sourceMappingURL=adaptive-interviewer.d.ts.map