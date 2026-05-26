import type { LoopRubric, LoopRunSummary, ValidationLane } from "../types.js";
export declare const resolveEvaluatorBundleSelection: (input: {
    explicitEvaluatorProfilePath?: string;
    explicitTargetFamily?: string;
    rubric?: LoopRubric;
    rubricPath?: string;
    preparedEvaluatorProfilePath?: string;
    preparedTargetFamily?: LoopRunSummary["target_family"];
    preparedValidationLane?: LoopRunSummary["validation_lane"];
    summaryEvaluatorProfilePath?: string;
    summaryTargetFamily?: LoopRunSummary["target_family"];
    summaryValidationLane?: LoopRunSummary["validation_lane"];
    preferGenericCoreDefault?: boolean;
}) => {
    evaluatorProfilePath?: string;
    targetFamily?: LoopRunSummary["target_family"];
    validationLane?: ValidationLane;
    runtimeWarnings: string[];
};
//# sourceMappingURL=evaluator-bundle.d.ts.map