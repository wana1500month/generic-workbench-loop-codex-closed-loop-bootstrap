import type { ContractReviewArtifact } from "./types.js";

export const contractReviewRequiresHumanDecision = (
  input: Pick<ContractReviewArtifact, "decision" | "required_changes" | "static_blockers">
): boolean =>
  input.decision === "revise" &&
  input.required_changes.length > 0 &&
  input.static_blockers.length === 0;
