import type { IdeaBrief, LoopImprovementContract, LoopPlan, LoopRoundDirective, LoopRubric, LoopScenario, PatchRequestArtifact } from "./types.js";
export declare const buildScenarioFromIdea: (idea: IdeaBrief) => LoopScenario;
export declare const buildAttemptDirective: (input: {
    scenario: LoopScenario;
    plan: LoopPlan;
    round: number;
    previousPatchRequest?: PatchRequestArtifact;
}) => LoopRoundDirective;
export declare const buildLoopPlan: (input: {
    scenario: LoopScenario;
    rubric: LoopRubric;
    maxRounds: number;
    idea: IdeaBrief;
    planKind?: "harness" | "product_build";
}) => LoopPlan;
export declare const buildRoundContract: (input: {
    scenario: LoopScenario;
    directive: LoopRoundDirective;
    round: number;
    previousPatchRequest?: PatchRequestArtifact;
}) => LoopImprovementContract;
//# sourceMappingURL=planner.d.ts.map