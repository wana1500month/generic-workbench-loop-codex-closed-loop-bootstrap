import type {
  AdapterDriftReport,
  ContractReviewArtifact,
  FailureLineage,
  RecontractReason
} from "./types.js";

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const recontractReasonForReport = (
  hasStaticContractBlockers: boolean
): RecontractReason =>
  hasStaticContractBlockers ? "adapter_contract_drift" : "adapter_runtime_drift";

export const buildAdapterDriftReport = (input: {
  contractId: string;
  round: number;
  contractReviewArtifact: ContractReviewArtifact;
  failureLineage?: FailureLineage;
}): AdapterDriftReport | undefined => {
  const staticBlockers = input.contractReviewArtifact.static_blockers ?? [];
  const missingTargetManifestKeys =
    input.failureLineage?.missing_target_manifest_keys ?? [];
  const signals = unique([
    ...(staticBlockers.length > 0 ? (["static_contract_blockers"] as const) : []),
    ...(missingTargetManifestKeys.length > 0
      ? (["missing_target_manifest_keys"] as const)
      : [])
  ]);

  if (signals.length === 0) {
    return undefined;
  }

  const kind = staticBlockers.length > 0 ? "contract" : "runtime";
  const recontractReason = recontractReasonForReport(staticBlockers.length > 0);
  const reasons = [
    ...(staticBlockers.length > 0
      ? [
          `Static adapter contract blockers remain unresolved: ${staticBlockers.join(" ")}`
        ]
      : []),
    ...(missingTargetManifestKeys.length > 0
      ? [
          `Required target manifest keys are missing from the adapter runtime surface: ${missingTargetManifestKeys.join(", ")}.`
        ]
      : [])
  ];
  const summary =
    kind === "contract"
      ? "The adapter contract no longer exposes a stable execution or verification boundary for the next remediation attempt."
      : "The adapter runtime no longer publishes the manifest surface that release-gate verification expects.";
  const suggestedUpdates = unique([
    ...(staticBlockers.length > 0
      ? [
          "Update the adapter contract or verification provider wiring so proof runs outside the executor trust domain.",
          "Repair static verification-boundary issues before opening another remediation round."
        ]
      : []),
    ...(missingTargetManifestKeys.length > 0
      ? [
          `Publish the required target_manifest keys before the next round: ${missingTargetManifestKeys.join(", ")}.`,
          "Re-contract the adapter runtime surface instead of widening product remediation."
        ]
      : [])
  ]);

  return {
    report_id: `${input.contractId}-adapter-drift-round-${String(input.round).padStart(2, "0")}`,
    contract_id: input.contractId,
    round: input.round,
    kind,
    signals,
    recommended_action: "recontract_adapter",
    recontract_reason: recontractReason,
    summary,
    reasons,
    static_blockers: staticBlockers,
    missing_target_manifest_keys: missingTargetManifestKeys,
    suggested_updates: suggestedUpdates
  };
};
