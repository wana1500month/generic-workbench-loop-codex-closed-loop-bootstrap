export const contractReviewRequiresHumanDecision = (input) => input.decision === "revise" &&
    input.required_changes.length > 0 &&
    input.static_blockers.length === 0;
//# sourceMappingURL=current-thread-boundaries.js.map