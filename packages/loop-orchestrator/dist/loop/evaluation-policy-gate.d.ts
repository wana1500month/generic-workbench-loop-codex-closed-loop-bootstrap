import { type EvaluationPolicy, type RoundScorecard } from "../evaluation-policy.js";
import type { EvalReport } from "../types.js";
export interface EvaluationPolicyGateResult {
    evalReport: EvalReport;
    scorecard: RoundScorecard;
}
export declare const applyEvaluationPolicyGate: (input: {
    policy: EvaluationPolicy;
    evalReport: EvalReport;
}) => EvaluationPolicyGateResult;
//# sourceMappingURL=evaluation-policy-gate.d.ts.map