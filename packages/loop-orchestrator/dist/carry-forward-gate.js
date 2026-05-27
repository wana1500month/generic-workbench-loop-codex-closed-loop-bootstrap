const unique = (values) => [...new Set(values)];
const nonCarryForwardDerivedChecks = new Set([
    "previous_patch_request_addressed",
    "previous_patch_request_resolved"
]);
const isPassingCheck = (result) => result.status === "pass";
export const buildCarryForwardGateArtifact = (input) => {
    const previousPatchTargetCheckIds = unique(input.previousPatchTargetCheckIds);
    const actionableTargetCheckIds = previousPatchTargetCheckIds.filter((checkId) => !nonCarryForwardDerivedChecks.has(checkId));
    const checkLookup = new Map(input.evalReport.check_results.map((result) => [result.check_id, result]));
    const targetResults = actionableTargetCheckIds
        .map((checkId) => checkLookup.get(checkId))
        .filter((result) => Boolean(result));
    const missingTargetCheckIds = actionableTargetCheckIds.filter((checkId) => !checkLookup.has(checkId));
    const addressed = previousPatchTargetCheckIds.length === 0 ||
        input.previousPatchRequestAddressed;
    const resolved = actionableTargetCheckIds.length === 0
        ? addressed
        : addressed &&
            missingTargetCheckIds.length === 0 &&
            targetResults.every(isPassingCheck);
    return {
        schema_version: "2026-05-27",
        artifact_type: "carry_forward_gate",
        generated_at: new Date().toISOString(),
        round: input.round,
        previous_patch_target_check_ids: previousPatchTargetCheckIds,
        actionable_target_check_ids: actionableTargetCheckIds,
        addressed,
        resolved,
        resolution_source: "carry_forward_gate",
        target_results: targetResults,
        missing_target_check_ids: missingTargetCheckIds,
        notes: previousPatchTargetCheckIds.length === 0
            ? ["No previous patch request required carry-forward."]
            : [
                addressed
                    ? "The current round contract carried the previous patch target ids forward."
                    : "The current round contract did not carry every previous patch target id forward.",
                resolved
                    ? "Every actionable carried target check passed in the current blind eval report."
                    : "At least one actionable carried target check is missing or unresolved in the current blind eval report."
            ]
    };
};
//# sourceMappingURL=carry-forward-gate.js.map