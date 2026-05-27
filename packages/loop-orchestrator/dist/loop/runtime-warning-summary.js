const unique = (values) => [...new Set(values)];
export const reviewFeedbackFromArtifacts = (input) => unique([
    ...(input.contractReviewArtifact?.required_changes ?? []),
    ...(input.contractReviewArtifact?.concerns ?? []),
    ...(input.patchRequestArtifact?.must_fix.map((item) => item.expected_change) ??
        []),
    ...(input.patchRequestArtifact?.quality_findings?.map((finding) => finding.expected_change) ?? []),
    ...(input.evalReport?.blockers ?? []),
    ...(input.evalReport?.next_actions ?? []),
    ...(input.qualityCritiqueArtifact?.findings.map((finding) => finding.expected_change) ?? [])
]).slice(0, 12);
export const steeringNotesFromContractReview = (contractReviewArtifact) => contractReviewArtifact
    ? unique([
        ...contractReviewArtifact.concerns,
        ...contractReviewArtifact.required_changes
    ]).slice(0, 12)
    : [];
export const externalBlockersFromPatchRequest = (patchRequestArtifact) => unique(patchRequestArtifact?.environment_blockers?.map((blocker) => `Resolve environment blocker: ${blocker}`) ?? []).slice(0, 12);
export const scopeGuardrailsFromPatchRequest = (patchRequestArtifact) => unique(patchRequestArtifact?.forbidden_scope_expansion ?? []).slice(0, 12);
//# sourceMappingURL=runtime-warning-summary.js.map