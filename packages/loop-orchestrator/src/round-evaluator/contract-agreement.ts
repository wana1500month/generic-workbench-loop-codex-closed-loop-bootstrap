import type {
  ContractAgreementArtifact,
  ContractReviewArtifact,
  RoundContractArtifact
} from "../types.js";

import { unique } from "./shared.js";

export const buildContractAgreementArtifact = (input: {
  contractArtifact: RoundContractArtifact;
  contractReviewArtifact: ContractReviewArtifact;
}): ContractAgreementArtifact => {
  const agreed = input.contractReviewArtifact.decision === "accept";

  return {
    contract_id: input.contractArtifact.contract_id,
    agreement_id: `${input.contractArtifact.contract_id}-agreement`,
    status: agreed ? "agreed" : "blocked",
    objective: input.contractArtifact.objective,
    acceptance_checks: agreed
      ? input.contractReviewArtifact.approved_checks
      : unique([
          ...input.contractReviewArtifact.approved_checks,
          ...input.contractArtifact.carry_over_check_ids
        ]),
    generator_must_deliver: agreed
      ? input.contractReviewArtifact.approved_checks
      : input.contractReviewArtifact.required_changes,
    evaluator_must_verify: agreed
      ? input.contractReviewArtifact.approved_checks
      : input.contractReviewArtifact.required_changes,
    carry_over_context: input.contractArtifact.carry_over_context
  };
};


