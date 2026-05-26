const unique = (values) => [...new Set(values)];
const targetCheckIdsFromPatch = (patchRequest) => unique(patchRequest.must_fix.flatMap((item) => item.target_check_ids).filter(Boolean));
const patchObjective = (targetCheckIds) => {
    if (targetCheckIds.length === 1 &&
        targetCheckIds[0] === "target_signal_thresholds_met") {
        return "Raise target signal thresholds using the latest QA evidence without widening scope.";
    }
    return "Resolve the latest patch request without widening scope.";
};
export const buildPatchCarryForwardContract = (input) => {
    const carryOverPatchIds = input.previousPatchRequest.must_fix.map((item) => item.id);
    const carryOverCheckIds = targetCheckIdsFromPatch(input.previousPatchRequest);
    return {
        contract_id: `${input.scenarioId}-contract-round-${String(input.round).padStart(2, "0")}`,
        attempt_kind: "remediation",
        objective: patchObjective(carryOverCheckIds),
        rewrite_scope: "incremental",
        focus_areas: unique([
            ...input.activeContractFrame.focus_areas,
            "patch_authority",
            "qa_rigor"
        ]),
        acceptance_checks: carryOverCheckIds,
        notes: [
            `Patch-only remediation under active contract frame '${input.activeContractFrame.contract_id}'.`,
            `Patch authority stays with '${input.previousPatchRequest.request_id}' derived from '${input.previousPatchRequest.derived_from_verdict_id}'.`,
            "Do not widen scope or reopen planner negotiation unless the controller escalates to recontract."
        ],
        carry_over_patch_ids: carryOverPatchIds,
        carry_over_check_ids: carryOverCheckIds
    };
};
export const buildSyntheticPatchCarryForwardReview = (input) => ({
    contract_id: input.contractArtifact.contract_id,
    review_id: `${input.contractArtifact.contract_id}-review`,
    decision: "accept",
    concerns: [
        `Patch-only remediation stays under '${input.previousPatchRequest.request_id}'.`,
        input.reason
    ],
    required_changes: [],
    approved_checks: input.contractArtifact.acceptance_checks,
    adapter_ready: true,
    static_blockers: []
});
export const buildSyntheticPatchCarryForwardAgreement = (input) => ({
    contract_id: input.contractArtifact.contract_id,
    agreement_id: `${input.contractArtifact.contract_id}-agreement`,
    status: "agreed",
    objective: input.contractArtifact.objective,
    acceptance_checks: input.contractArtifact.acceptance_checks,
    generator_must_deliver: input.previousPatchRequest.must_fix.length > 0
        ? input.previousPatchRequest.must_fix.map((item) => item.expected_change)
        : ["Resolve the carried patch authority without widening scope."],
    evaluator_must_verify: input.contractArtifact.acceptance_checks.length > 0
        ? input.contractArtifact.acceptance_checks.map((checkId) => `Verify carried patch target '${checkId}'.`)
        : ["Verify the latest patch request was resolved."],
    carry_over_context: input.contractArtifact.carry_over_context
});
//# sourceMappingURL=patch-carry-forward.js.map