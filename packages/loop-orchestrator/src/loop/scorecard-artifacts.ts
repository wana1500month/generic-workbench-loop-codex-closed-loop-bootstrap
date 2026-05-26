import {
  writeRoundScorecardArtifacts,
  type EvaluationPolicy,
  type RoundScorecard
} from "../evaluation-policy.js";
import type { EvalReport } from "../types.js";
import {
  applyEvaluationPolicyGate,
  type EvaluationPolicyGateResult
} from "./evaluation-policy-gate.js";

export const applyRoundScorecardGate = (input: {
  policy: EvaluationPolicy;
  evalReport: EvalReport;
}): EvaluationPolicyGateResult => applyEvaluationPolicyGate(input);

export const writeOptionalRoundScorecardArtifacts = async (input: {
  roundDirectory: string;
  scorecard?: RoundScorecard;
}): Promise<void> => {
  if (!input.scorecard) {
    return;
  }
  await writeRoundScorecardArtifacts({
    roundDirectory: input.roundDirectory,
    scorecard: input.scorecard
  });
};
