import type {
  BuildBriefArtifact,
  SessionRunContractArtifact
} from "./types.js";

export const validatePreparedProductSessionIntegrity = (input: {
  buildBrief: BuildBriefArtifact;
  runContract: SessionRunContractArtifact;
}): string[] => {
  const errors: string[] = [];

  if (/Generic Codex Workbench/i.test(input.buildBrief.product.title)) {
    errors.push("buildBrief.product.title still points at the harness identity.");
  }

  if (/Generic Codex Workbench/i.test(input.runContract.objective)) {
    errors.push("runContract.objective still points at the harness identity.");
  }

  const targetRoot = input.runContract.execution_controls.target_root;
  if (/^(?:income\/expense|\/지출|수입\/지출)$/u.test(targetRoot)) {
    errors.push(
      `target_root looks like a workflow phrase, not a project path: ${targetRoot}`
    );
  }

  if (input.buildBrief.product.target_users.length === 0) {
    errors.push("target_users is empty.");
  }

  if (input.buildBrief.product.core_workflows.length === 0) {
    errors.push("core_workflows is empty.");
  }

  if (input.buildBrief.product.success_definition.length === 0) {
    errors.push("success_definition is empty.");
  }

  return errors;
};
