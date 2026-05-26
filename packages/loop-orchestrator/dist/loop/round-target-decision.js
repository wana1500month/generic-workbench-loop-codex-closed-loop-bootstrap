import { stopReasonFromState } from "./stop-reasons.js";
export const stopReasonForRoundTargetDecision = (input) => stopReasonFromState({
    latestVerdict: input.state.verdict,
    latestUnresolvedCheckIds: input.state.unresolvedCheckIds,
    latestPatchNextAction: input.state.patchNextAction,
    latestMustFixCount: input.state.patchMustFixCount,
    latestThresholdResults: input.state.thresholdResults,
    latestFailureLineage: input.state.failureLineage,
    latestStaticAdapterContractInvalid: input.state.staticAdapterContractInvalid,
    plateauCount: input.plateauCount,
    plateauLimit: input.plateauLimit,
    completedRounds: input.completedRounds,
    maxRounds: input.maxRounds
});
export const stopReasonForMissingRoundTargetDecision = (input) => input.state
    ? stopReasonForRoundTargetDecision({
        state: input.state,
        plateauCount: input.plateauCount,
        plateauLimit: input.plateauLimit,
        completedRounds: input.completedRounds,
        maxRounds: input.maxRounds
    })
    : stopReasonFromState({
        latestVerdict: "hold",
        latestUnresolvedCheckIds: [],
        latestMustFixCount: 0,
        plateauCount: input.plateauCount,
        plateauLimit: input.plateauLimit,
        completedRounds: input.completedRounds,
        maxRounds: input.maxRounds
    });
//# sourceMappingURL=round-target-decision.js.map