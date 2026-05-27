import type {
  ContractReviewArtifact,
  EvalReport,
  PatchRequestArtifact,
  QualityCritiqueArtifact
} from "../types.js";

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

export const reviewFeedbackFromArtifacts = (input: {
  contractReviewArtifact?: ContractReviewArtifact;
  patchRequestArtifact?: PatchRequestArtifact;
  qualityCritiqueArtifact?: QualityCritiqueArtifact;
  evalReport?: EvalReport;
}): string[] =>
  unique([
    ...(input.contractReviewArtifact?.required_changes ?? []),
    ...(input.contractReviewArtifact?.concerns ?? []),
    ...(input.patchRequestArtifact?.must_fix.map((item) => item.expected_change) ??
      []),
    ...(input.patchRequestArtifact?.quality_findings?.map(
      (finding) => finding.expected_change
    ) ?? []),
    ...(input.evalReport?.blockers ?? []),
    ...(input.evalReport?.next_actions ?? []),
    ...(input.qualityCritiqueArtifact?.findings.map(
      (finding) => finding.expected_change
    ) ?? [])
  ]).slice(0, 12);

export const steeringNotesFromContractReview = (
  contractReviewArtifact: ContractReviewArtifact | undefined
): string[] =>
  contractReviewArtifact
    ? unique([
        ...contractReviewArtifact.concerns,
        ...contractReviewArtifact.required_changes
      ]).slice(0, 12)
    : [];

export const externalBlockersFromPatchRequest = (
  patchRequestArtifact: PatchRequestArtifact | undefined
): string[] =>
  unique(
    patchRequestArtifact?.environment_blockers?.map(
      (blocker) => `Resolve environment blocker: ${blocker}`
    ) ?? []
  ).slice(0, 12);

export const scopeGuardrailsFromPatchRequest = (
  patchRequestArtifact: PatchRequestArtifact | undefined
): string[] =>
  unique(patchRequestArtifact?.forbidden_scope_expansion ?? []).slice(0, 12);
