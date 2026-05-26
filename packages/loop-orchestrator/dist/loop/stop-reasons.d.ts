import type { FailureLineage, LoopRunSummary, PatchRequestArtifact, ReleaseThresholdResults } from "../types.js";
import type { RoundSummary } from "../types.js";
export declare const stopReasonFromState: (input: {
    latestVerdict: RoundSummaryLike["overall_verdict"];
    latestUnresolvedCheckIds: string[];
    latestPatchNextAction?: PatchRequestArtifact["next_action"];
    latestMustFixCount: number;
    latestThresholdResults?: ReleaseThresholdResults;
    latestFailureLineage?: FailureLineage;
    latestStaticAdapterContractInvalid?: boolean;
    plateauCount: number;
    plateauLimit: number;
    completedRounds: number;
    maxRounds: number;
}) => LoopRunSummary["stop_reason"] | undefined;
export declare const isResumeNoopTerminalStopReason: (stopReason: LoopRunSummary["stop_reason"] | undefined) => stopReason is Extract<LoopRunSummary["stop_reason"], "target_reached" | "contract_completed" | "environment_blocked" | "adapter_contract_invalid" | "adapter_migration_rejected" | "new_run_required">;
type RoundSummaryLike = Pick<RoundSummary, "overall_verdict">;
export {};
//# sourceMappingURL=stop-reasons.d.ts.map