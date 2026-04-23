import type {
  ContractReviewArtifact,
  LoadedAdapterContract,
  RoundContractArtifact
} from "../types.js";

import {
  artifactOnlyChecks,
  isKnownCheck,
  unique,
  verificationBoundaryIssues
} from "./shared.js";

export const buildContractReviewArtifact = (input: {
  contractArtifact: RoundContractArtifact;
  loadedAdapter?: LoadedAdapterContract;
}): ContractReviewArtifact => {
  const unknownChecks = input.contractArtifact.acceptance_checks.filter((checkId) => !isKnownCheck(checkId));
  const duplicateChecks = input.contractArtifact.acceptance_checks.filter(
    (checkId, index, allChecks) => allChecks.indexOf(checkId) !== index
  );
  const carryOverChecksNotAccepted = input.contractArtifact.carry_over_check_ids.filter(
    (checkId) => !input.contractArtifact.acceptance_checks.includes(checkId)
  );
  const hasMeaningfulCheck = input.contractArtifact.acceptance_checks.some(
    (checkId) => !artifactOnlyChecks.has(checkId)
  );

  const concerns: string[] = [];
  const requiredChanges: string[] = [];
  const staticBlockers: string[] = [];

  if (input.contractArtifact.acceptance_checks.length === 0) {
    concerns.push("The contract has no acceptance checks.");
    requiredChanges.push("Add at least one acceptance check before the round can proceed.");
  }

  if (unknownChecks.length > 0) {
    concerns.push(`Unknown acceptance checks: ${unknownChecks.join(", ")}.`);
    requiredChanges.push("Replace unknown checks with evaluator-known check ids.");
  }

  if (duplicateChecks.length > 0) {
    concerns.push(`Duplicate acceptance checks: ${unique(duplicateChecks).join(", ")}.`);
    requiredChanges.push("Remove duplicate acceptance checks so the contract is testable.");
  }

  if (!hasMeaningfulCheck) {
    concerns.push("All acceptance checks are artifact-write checks, so the contract cannot fail usefully.");
    requiredChanges.push("Include at least one behavioral or resolution check beyond file existence.");
  }

  if (
    input.contractArtifact.carry_over_patch_ids.length > 0 &&
    input.contractArtifact.carry_over_check_ids.length === 0
  ) {
    concerns.push("A previous patch request exists, but no carried check ids were attached.");
    requiredChanges.push("Carry unresolved check ids forward from the previous patch request.");
  }

  if (carryOverChecksNotAccepted.length > 0) {
    concerns.push(
      `The draft contract does not promise to close carried checks: ${carryOverChecksNotAccepted.join(", ")}.`
    );
    requiredChanges.push("Add every carried check id to the current acceptance checks.");
  }

  if (input.loadedAdapter) {
    concerns.push(`Adapter '${input.loadedAdapter.contract.adapter_id}' is attached for this round.`);
    const boundaryIssues = verificationBoundaryIssues(input.loadedAdapter);
    if (boundaryIssues.length > 0) {
      staticBlockers.push(...boundaryIssues);
      concerns.push(
        `Independent proof boundary is incomplete: ${boundaryIssues.join(" ")}`
      );
      requiredChanges.push(
        "Fix the adapter contract before retrying: attach a distinct verification_provider, a core-owned evaluator profile, and required browser_journey/http_json release-gate probes for independent target verification."
      );
    }
    if (!input.loadedAdapter.verification_profile) {
      staticBlockers.push(
        "No core-owned evaluator profile is attached, so target-specific criteria would stay adapter-authored."
      );
      concerns.push(
        "No core-owned evaluator profile is attached, so target-specific criteria would stay adapter-authored."
      );
      requiredChanges.push(
      "Attach a core-owned evaluator bundle via --target-family or rubric.evaluator_profile_path, or use --evaluator-profile for an explicit override."
      );
    } else if (input.loadedAdapter.verification_profile_source !== "core") {
      requiredChanges.push(
      "Move verification profile ownership into the harness: select it through --target-family or rubric.evaluator_profile_path, and reserve --evaluator-profile for explicit overrides instead of adapter.json."
      );
    }
  } else {
    concerns.push("No external adapter is attached; this round can only claim harness-side proof.");
  }

  return {
    contract_id: input.contractArtifact.contract_id,
    review_id: `${input.contractArtifact.contract_id}-review`,
    decision: requiredChanges.length > 0 ? "revise" : "accept",
    concerns,
    required_changes: requiredChanges,
    approved_checks:
      requiredChanges.length > 0
        ? input.contractArtifact.acceptance_checks.filter((checkId) => isKnownCheck(checkId))
        : input.contractArtifact.acceptance_checks,
    adapter_ready: Boolean(input.loadedAdapter),
    static_blockers: unique(staticBlockers)
  };
};


