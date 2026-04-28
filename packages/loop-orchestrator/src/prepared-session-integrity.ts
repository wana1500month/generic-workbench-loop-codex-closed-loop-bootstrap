import type {
  BuildBriefArtifact,
  SessionRunContractArtifact,
  VerificationProfile
} from "./types.js";

export const validatePreparedProductSessionIntegrity = (input: {
  buildBrief: BuildBriefArtifact;
  runContract: SessionRunContractArtifact;
  evaluatorProfile?: VerificationProfile;
}): string[] => {
  const errors: string[] = [];
  const serializedRunContract = JSON.stringify(input.runContract);

  if (/Generic Codex Workbench/i.test(input.buildBrief.product.title)) {
    errors.push("buildBrief.product.title still points at the harness identity.");
  }

  if (/Generic Codex Workbench/i.test(input.runContract.objective)) {
    errors.push("runContract.objective still points at the harness identity.");
  }

  if (
    /workbench|controller|adapter/i.test(
      JSON.stringify(input.buildBrief.product.success_definition)
    )
  ) {
    errors.push(
      "Product success_definition appears contaminated by harness quality-bar language."
    );
  }

  if (/packages\/loop-orchestrator\/src|ADAPTER_CONTRACT\.md|AGENT_PROTOCOL\.md/i.test(serializedRunContract)) {
    errors.push("Product run contract appears to point at harness implementation files.");
  }

  const buildTargetRoot = input.buildBrief.execution_context.target_root;
  const contractTargetRoot = input.runContract.execution_controls.target_root;
  if (
    buildTargetRoot &&
    contractTargetRoot &&
    !contractTargetRoot.includes(buildTargetRoot) &&
    !buildTargetRoot.includes(contractTargetRoot)
  ) {
    errors.push(
      `buildBrief target_root and runContract target_root disagree: ${buildTargetRoot} vs ${contractTargetRoot}`
    );
  }

  const targetRoot = contractTargetRoot;
  if (/^(?:income\/expense|\/지출|수입\/지출|로그인\/회원가입|A\/B)$/u.test(targetRoot)) {
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

  if (input.evaluatorProfile) {
    const profileText = JSON.stringify(input.evaluatorProfile.quality_contract ?? {});
    if (/workbench|controller|adapter/i.test(profileText)) {
      errors.push(
        "Evaluator profile quality contract is contaminated by harness language."
      );
    }

    const workflowProbeLabels = (input.evaluatorProfile.core_probes ?? [])
      .filter((probe) =>
        /^(?:Core workflow remains|Workflow works:|Workflow API works:)/.test(
          probe.label
        )
      )
      .map((probe) => probe.label);
    for (const workflow of input.buildBrief.product.core_workflows) {
      if (!workflowProbeLabels.some((label) => label.includes(workflow))) {
        errors.push(`Missing workflow-specific probe for '${workflow}'.`);
      }
    }
  }

  return errors;
};
