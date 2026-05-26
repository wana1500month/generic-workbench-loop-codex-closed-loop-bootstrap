import {
  buildEvaluationPolicy,
  loadEvaluationPolicyForRun,
  writeEvaluationPolicyArtifacts,
  type EvaluationPolicy
} from "../evaluation-policy.js";

export const ensureEvaluationPolicyForRun = async (input: {
  runDirectory: string;
  explicitTargetScore?: number;
}): Promise<EvaluationPolicy> => {
  const policy =
    (await loadEvaluationPolicyForRun(input.runDirectory)) ??
    buildEvaluationPolicy({
      explicitTargetScore: input.explicitTargetScore
    });
  await writeEvaluationPolicyArtifacts({
    runDirectory: input.runDirectory,
    policy
  });
  return policy;
};
