import type {
  ActiveContractFrame,
  AttemptLifecycleDecision,
  RemediationHistory,
  PatchRequestArtifact,
  RoundContractArtifact,
  ContractAgreementArtifact,
  FailureLineageTriggerCode,
  RecontractReason,
  TrajectoryDecisionArtifact
} from "./types.js";
import { fallbackTrajectoryDirective } from "./trajectory-controller.js";

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const recontractReasonForTrigger = (
  triggerCode: FailureLineageTriggerCode | undefined,
  remediationHistory?: RemediationHistory
): RecontractReason => {
  switch (triggerCode) {
    case "manifest_contract_broken":
      return "manifest_contract_broken";
    case "release_gate_regression":
      return "release_gate_regression";
    case "scope_drift":
      return "scope_drift";
    case "contradiction_detected":
      return "contradictory_evidence";
    case "patch_entropy_spike":
      return "patch_entropy_spike";
    case "repeated_same_failure_signature":
      return "repeated_same_failure_signature";
    case "plateau_without_progress":
      return "plateau_without_progress";
    default:
      if ((remediationHistory?.repeated_unresolved_signature_count ?? 0) >= 2) {
        return "repeated_same_failure_signature";
      }
      if (remediationHistory?.contradiction_count) {
        return "contradictory_evidence";
      }
      if (remediationHistory?.scope_drift_detected) {
        return "scope_drift";
      }
      return "plateau_without_progress";
  }
};

export const targetCheckIdsFromPatchRequest = (
  patchRequest?: PatchRequestArtifact
): string[] =>
  unique(
    patchRequest?.must_fix.flatMap((item) => item.target_check_ids).filter(Boolean) ?? []
  );

export const unresolvedSignatureFor = (
  unresolvedCheckIds: readonly string[]
): string | undefined => {
  const normalized = unique(unresolvedCheckIds).sort();
  return normalized.length > 0 ? normalized.join("|") : undefined;
};

export const decideAttemptLifecycle = (input: {
  round: number;
  previousPatchRequest?: PatchRequestArtifact;
  previousTrajectoryDecision?: TrajectoryDecisionArtifact;
  hasActiveContractFrame: boolean;
  remediationHistory?: RemediationHistory;
}): AttemptLifecycleDecision => {
  const trajectory =
    input.previousTrajectoryDecision ??
    fallbackTrajectoryDirective({
      previousPatchRequest: input.previousPatchRequest,
      remediationHistory: input.remediationHistory
    });

  if (input.round === 1) {
    return {
      negotiation_mode: "full_negotiation",
      continuation_authority: "planner_contract",
      persist_contract_review: true,
      persist_contract_agreement: true,
      reopen_contract: true,
      decision_source: "initial_round",
      reason: "Round 1 establishes the active contract frame through full negotiation.",
      trajectory
    };
  }

  if (!input.hasActiveContractFrame) {
    return {
      negotiation_mode: "recontract",
      continuation_authority: "planner_contract",
      persist_contract_review: true,
      persist_contract_agreement: true,
      reopen_contract: true,
      decision_source: "missing_active_contract_frame",
      reason: "No active contract frame is locked, so remediation cannot stay patch-only yet.",
      recontract_reason: "missing_active_contract_frame",
      trajectory
    };
  }

  const targetCheckIds = targetCheckIdsFromPatchRequest(input.previousPatchRequest);
  if (targetCheckIds.length === 0) {
    return {
      negotiation_mode: "recontract",
      continuation_authority: "planner_contract",
      persist_contract_review: true,
      persist_contract_agreement: true,
      reopen_contract: true,
      decision_source: "no_actionable_patch_ids",
      reason: "The previous patch request has no actionable target_check_ids to drive patch-only repair.",
      recontract_reason: "no_actionable_patch_ids",
      trajectory
    };
  }

  if (trajectory.mode === "pivot" || trajectory.mode === "parallel_pivot") {
    return {
      negotiation_mode: "recontract",
      continuation_authority: "planner_contract",
      persist_contract_review: true,
      persist_contract_agreement: true,
      reopen_contract: true,
      decision_source: "trajectory_policy",
      reason: `Trajectory controller selected ${trajectory.mode} from ${trajectory.restart_from}. ${trajectory.reason}`,
      recontract_reason: recontractReasonForTrigger(
        input.remediationHistory?.policy_snapshot?.dominant_trigger_code,
        input.remediationHistory
      ),
      trajectory
    };
  }

  if ((input.remediationHistory?.target_manifest_keys_missing.length ?? 0) > 0) {
    return {
      negotiation_mode: "recontract",
      continuation_authority: "planner_contract",
      persist_contract_review: true,
      persist_contract_agreement: true,
      reopen_contract: true,
      decision_source: "hard_rule",
      reason:
        `Release-gate target manifest keys are still missing: ${input.remediationHistory?.target_manifest_keys_missing.join(", ")}.`,
      recontract_reason: "manifest_contract_broken",
      trajectory
    };
  }

  if ((input.remediationHistory?.regression_check_ids.length ?? 0) > 0) {
    return {
      negotiation_mode: "recontract",
      continuation_authority: "planner_contract",
      persist_contract_review: true,
      persist_contract_agreement: true,
      reopen_contract: true,
      decision_source: "hard_rule",
      reason: `Release-gate regression reopened the contract boundary: ${input.remediationHistory?.regression_check_ids.join(", ")}.`,
      recontract_reason: "release_gate_regression",
      trajectory
    };
  }

  if (input.remediationHistory?.scope_drift_detected) {
    return {
      negotiation_mode: "recontract",
      continuation_authority: "planner_contract",
      persist_contract_review: true,
      persist_contract_agreement: true,
      reopen_contract: true,
      decision_source: "hard_rule",
      reason:
        "The latest patch request widened scope beyond the active contract frame, so remediation should re-contract before continuing.",
      recontract_reason: "scope_drift",
      trajectory
    };
  }

  if (
    input.remediationHistory?.policy_snapshot?.recommended_action === "recontract"
  ) {
    const policySnapshot = input.remediationHistory.policy_snapshot;
    const dominantTrigger = policySnapshot.dominant_trigger_code;
    const reasons = policySnapshot.reasons.join(" ");
    return {
      negotiation_mode: "recontract",
      continuation_authority: "planner_contract",
      persist_contract_review: true,
      persist_contract_agreement: true,
      reopen_contract: true,
      decision_source: "policy_snapshot",
      reason: reasons
        ? `${reasons} Policy source: ${policySnapshot.recommendation_source}. Dominant trigger: ${dominantTrigger}. Confidence: ${policySnapshot.escalation_confidence}.`
        : `Persisted failure-lineage policy recommended reopening the contract boundary. Dominant trigger: ${dominantTrigger}. Confidence: ${policySnapshot.escalation_confidence}.`,
      recontract_reason: recontractReasonForTrigger(
        dominantTrigger,
        input.remediationHistory
      ),
      trajectory
    };
  }

  return {
    negotiation_mode: "patch_only",
    continuation_authority: "patch_request",
    persist_contract_review: false,
    persist_contract_agreement: false,
    reopen_contract: false,
    decision_source: input.remediationHistory?.policy_snapshot
      ? "policy_snapshot"
      : "default_patch_authority",
    reason:
      "An active contract frame exists and the latest patch request has actionable check ids, so remediation stays patch-only.",
    trajectory
  };
};

export const buildActiveContractFrame = (input: {
  round: number;
  contractArtifact: RoundContractArtifact;
  contractAgreementArtifact: ContractAgreementArtifact;
}): ActiveContractFrame => ({
  source_round: input.round,
  contract_id: input.contractArtifact.contract_id,
  objective: input.contractArtifact.objective,
  focus_areas: input.contractArtifact.focus_areas,
  rewrite_scope: input.contractArtifact.rewrite_scope,
  acceptance_checks: input.contractAgreementArtifact.acceptance_checks,
  agreement: input.contractAgreementArtifact
});
