import { isPureEnvironmentBlockedLineage } from "../failure-lineage.js";
import type {
  FailureLineage,
  LoopRunSummary,
  PatchRequestArtifact,
  ReleaseThresholdResults
} from "../types.js";
import type { RoundSummary } from "../types.js";

export const stopReasonFromState = (input: {
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
}): LoopRunSummary["stop_reason"] | undefined => {
  const continuationRequested =
    input.latestPatchNextAction === "advance" ||
    input.latestPatchNextAction === "recontract_adapter" ||
    (input.latestPatchNextAction === "revise" && input.latestMustFixCount > 0);
  const continuationStillPlanned =
    input.completedRounds < input.maxRounds && continuationRequested;
  const terminalContractCompleted =
    input.latestVerdict === "advance" &&
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

  if (
    input.latestPatchNextAction === "hold" &&
    isPureEnvironmentBlockedLineage(input.latestFailureLineage)
  ) {
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

export const isResumeNoopTerminalStopReason = (
  stopReason: LoopRunSummary["stop_reason"] | undefined
): stopReason is Extract<
  LoopRunSummary["stop_reason"],
  | "target_reached"
  | "contract_completed"
  | "environment_blocked"
  | "adapter_contract_invalid"
  | "adapter_migration_rejected"
  | "new_run_required"
> =>
  stopReason === "target_reached" ||
  stopReason === "contract_completed" ||
  stopReason === "environment_blocked" ||
  stopReason === "adapter_contract_invalid" ||
  stopReason === "adapter_migration_rejected" ||
  stopReason === "new_run_required";

type RoundSummaryLike = Pick<RoundSummary, "overall_verdict">;
