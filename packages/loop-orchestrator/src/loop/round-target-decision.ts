import type {
  FailureLineage,
  LoopRunSummary,
  PatchRequestArtifact,
  ReleaseThresholdResults,
  RoundSummary
} from "../types.js";
import { stopReasonFromState } from "./stop-reasons.js";

export interface RoundTargetDecisionState {
  score: number;
  controlPlaneScore: number;
  proofScore: number;
  verdict: RoundSummary["overall_verdict"];
  unresolvedCheckIds: string[];
  patchNextAction?: PatchRequestArtifact["next_action"];
  patchMustFixCount: number;
  thresholdResults?: ReleaseThresholdResults;
  failureLineage?: FailureLineage;
  staticAdapterContractInvalid?: boolean;
}

export const stopReasonForRoundTargetDecision = (input: {
  state: RoundTargetDecisionState;
  plateauCount: number;
  plateauLimit: number;
  completedRounds: number;
  maxRounds: number;
}): LoopRunSummary["stop_reason"] | undefined =>
  stopReasonFromState({
    latestVerdict: input.state.verdict,
    latestUnresolvedCheckIds: input.state.unresolvedCheckIds,
    latestPatchNextAction: input.state.patchNextAction,
    latestMustFixCount: input.state.patchMustFixCount,
    latestThresholdResults: input.state.thresholdResults,
    latestFailureLineage: input.state.failureLineage,
    latestStaticAdapterContractInvalid:
      input.state.staticAdapterContractInvalid,
    plateauCount: input.plateauCount,
    plateauLimit: input.plateauLimit,
    completedRounds: input.completedRounds,
    maxRounds: input.maxRounds
  });

export const stopReasonForMissingRoundTargetDecision = (input: {
  state?: RoundTargetDecisionState;
  plateauCount: number;
  plateauLimit: number;
  completedRounds: number;
  maxRounds: number;
}): LoopRunSummary["stop_reason"] | undefined =>
  input.state
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
