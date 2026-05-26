import type { ContractAgreementArtifact, ContractReviewArtifact, EvalReport, FailureLineage, IdeaBrief, LoopPlan, LoopRunSummary, LoopScenario, PatchRequestArtifact, QualityCritiqueArtifact, TrajectoryDecisionArtifact, RoundArtifacts } from "./types.js";
export declare const plannerBriefPathForRun: (runDirectory: string) => string;
export declare const writeRunPlannerBrief: (input: {
    runDirectory: string;
    idea: IdeaBrief;
    scenario: LoopScenario;
    plan: LoopPlan;
}) => Promise<string>;
export declare const writeRoundHandoff: (input: {
    roundDirectory: string;
    scenario: LoopScenario;
    round: number;
    contractReview: ContractReviewArtifact;
    contractAgreement: ContractAgreementArtifact;
    evalReport: EvalReport;
    patchRequest: PatchRequestArtifact;
    qualityCritique: QualityCritiqueArtifact;
    trajectoryDecision: TrajectoryDecisionArtifact;
    failureLineage?: FailureLineage;
    executorMode?: LoopRunSummary["executor_mode"];
    targetFamily?: LoopRunSummary["target_family"];
    validationLane?: LoopRunSummary["validation_lane"];
    decisionSource?: NonNullable<LoopRunSummary["round_history"]>[number]["decision_source"];
    previousPatchRequestAddressed: boolean;
    previousPatchRequestResolved: boolean;
    stopReason?: string;
}) => Promise<RoundArtifacts>;
export declare const writeRoundHandoffPlaceholders: (input: {
    roundDirectory: string;
}) => Promise<RoundArtifacts>;
export declare const writeRunControllerSummary: (input: {
    runDirectory: string;
    summary: LoopRunSummary;
}) => Promise<string>;
//# sourceMappingURL=agent-handoff.d.ts.map