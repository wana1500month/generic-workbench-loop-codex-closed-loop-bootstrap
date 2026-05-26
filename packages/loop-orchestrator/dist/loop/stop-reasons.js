import { isPureEnvironmentBlockedLineage } from "../failure-lineage.js";
export const stopReasonFromState = (input) => {
    const continuationRequested = input.latestPatchNextAction === "advance" ||
        input.latestPatchNextAction === "recontract_adapter" ||
        (input.latestPatchNextAction === "revise" && input.latestMustFixCount > 0);
    const continuationStillPlanned = input.completedRounds < input.maxRounds && continuationRequested;
    const terminalContractCompleted = input.latestVerdict === "advance" &&
        input.latestUnresolvedCheckIds.length === 0 &&
        input.latestPatchNextAction === "complete";
    if (terminalContractCompleted && input.latestThresholdResults?.target_reached_eligible) {
        return "target_reached";
    }
    if (terminalContractCompleted) {
        return "contract_completed";
    }
    if (input.latestStaticAdapterContractInvalid) {
        return "adapter_contract_invalid";
    }
    if (input.latestPatchNextAction === "hold" &&
        isPureEnvironmentBlockedLineage(input.latestFailureLineage)) {
        return "environment_blocked";
    }
    if (input.completedRounds >= input.maxRounds) {
        return "max_rounds_reached";
    }
    if (input.plateauCount >= input.plateauLimit && !continuationStillPlanned) {
        return "plateau_limit_reached";
    }
    return undefined;
};
export const isResumeNoopTerminalStopReason = (stopReason) => stopReason === "target_reached" ||
    stopReason === "contract_completed" ||
    stopReason === "environment_blocked" ||
    stopReason === "adapter_contract_invalid" ||
    stopReason === "adapter_migration_rejected" ||
    stopReason === "new_run_required";
//# sourceMappingURL=stop-reasons.js.map