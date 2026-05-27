import { canonicalCodexCheckpointStopReason } from "../stop-reason.js";
import type {
  AdapterMigrationDecision,
  ClosedLoopResult,
  ControllerPhaseStatus,
  ControllerRoundPhase,
  CurrentThreadCheckpointKind,
  LoopRunSummary,
  OperatorAttentionRequired,
  OperatorRecommendedSkill
} from "../types.js";
import {
  activeArtifactPathsFor,
  activeCheckpointMetadataFor
} from "./active-checkpoint.js";

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

type RecordRoundPhase = (input: {
  round: number;
  phase: ControllerRoundPhase;
  status: ControllerPhaseStatus;
  artifacts?: Record<string, string>;
  notes?: string[];
}) => Promise<void>;

type FinalizeRunAsPausedStop = (input: {
  stopReason: Extract<
    LoopRunSummary["stop_reason"],
    | "awaiting_codex_checkpoint"
    | "awaiting_manual_generator"
    | "awaiting_human_input"
    | "awaiting_external_condition"
  >;
  notes: string[];
  attentionRequired?: OperatorAttentionRequired;
  checkpointKind?: CurrentThreadCheckpointKind;
  checkpointId?: string;
  checkpointSeq?: number;
  autoResumeEligible?: boolean;
  userVisiblePause?: boolean;
  decisionOptions?: AdapterMigrationDecision[];
  recommendedSkill?: OperatorRecommendedSkill;
  recommendedCommand?: string;
  activePromptPath?: string;
  activeResponsePath?: string;
}) => Promise<ClosedLoopResult>;

export type PauseForHumanInputInput = {
  round: number;
  phase: ControllerRoundPhase;
  notes: string[];
  artifacts?: Record<string, string>;
  checkpointKind?: CurrentThreadCheckpointKind;
  decisionOptions?: AdapterMigrationDecision[];
  recommendedCommand?: string;
};

export type PauseForExternalConditionInput = {
  round: number;
  phase: ControllerRoundPhase;
  notes: string[];
  artifacts?: Record<string, string>;
  checkpointKind?: CurrentThreadCheckpointKind;
  recommendedCommand?: string;
};

export type CheckpointForCurrentThreadWorkInput = {
  round: number;
  phase: ControllerRoundPhase;
  checkpointKind: CurrentThreadCheckpointKind;
  artifacts: Record<string, string>;
  notes: string[];
};

type CheckpointFlowDeps = {
  runId: string;
  recordRoundPhase: RecordRoundPhase;
  finalizeRunAsPausedStop: FinalizeRunAsPausedStop;
};

export const pauseForHumanInputCheckpoint = async (
  deps: CheckpointFlowDeps,
  input: PauseForHumanInputInput
): Promise<ClosedLoopResult> => {
  const { activePromptPath, activeResponsePath } = activeArtifactPathsFor(
    input.artifacts
  );
  const checkpointMetadata = await activeCheckpointMetadataFor({
    artifacts: input.artifacts,
    runId: deps.runId,
    fallback: {
      round: input.round,
      phase: input.phase,
      checkpointKind: input.checkpointKind ?? "planner"
    }
  });
  await deps.recordRoundPhase({
    round: input.round,
    phase: input.phase,
    status: "awaiting_human_input",
    artifacts: input.artifacts ?? {},
    notes: input.notes
  });
  return deps.finalizeRunAsPausedStop({
    stopReason: "awaiting_human_input",
    notes: input.notes,
    attentionRequired: "human",
    checkpointKind: input.checkpointKind,
    checkpointId: checkpointMetadata.checkpointId,
    checkpointSeq: checkpointMetadata.checkpointSeq,
    autoResumeEligible: false,
    userVisiblePause: true,
    decisionOptions: input.decisionOptions,
    recommendedSkill: "loop-control",
    recommendedCommand: input.recommendedCommand,
    activePromptPath,
    activeResponsePath
  });
};

export const pauseForExternalConditionCheckpoint = async (
  deps: CheckpointFlowDeps,
  input: PauseForExternalConditionInput
): Promise<ClosedLoopResult> => {
  const { activePromptPath, activeResponsePath } = activeArtifactPathsFor(
    input.artifacts
  );
  const checkpointMetadata = await activeCheckpointMetadataFor({
    artifacts: input.artifacts,
    runId: deps.runId,
    fallback: {
      round: input.round,
      phase: input.phase,
      checkpointKind: input.checkpointKind ?? "evaluator"
    }
  });
  await deps.recordRoundPhase({
    round: input.round,
    phase: input.phase,
    status: "awaiting_external_condition",
    artifacts: input.artifacts ?? {},
    notes: input.notes
  });
  return deps.finalizeRunAsPausedStop({
    stopReason: "awaiting_external_condition",
    notes: input.notes,
    attentionRequired: "external",
    checkpointKind: input.checkpointKind,
    checkpointId: checkpointMetadata.checkpointId,
    checkpointSeq: checkpointMetadata.checkpointSeq,
    autoResumeEligible: false,
    userVisiblePause: true,
    recommendedSkill: "loop-control",
    recommendedCommand: input.recommendedCommand,
    activePromptPath,
    activeResponsePath
  });
};

export const checkpointForCurrentThreadWorkCheckpoint = async (
  deps: CheckpointFlowDeps & { manualCurrentThreadProtocol: boolean },
  input: CheckpointForCurrentThreadWorkInput
): Promise<ClosedLoopResult> => {
  if (deps.manualCurrentThreadProtocol) {
    const manualProtocolNotes = input.notes.filter(
      (note) => !/not a human decision stop/i.test(note)
    );
    return pauseForHumanInputCheckpoint(deps, {
      round: input.round,
      phase: input.phase,
      checkpointKind: input.checkpointKind,
      artifacts: input.artifacts,
      notes: unique([
        ...manualProtocolNotes,
        "This current-thread run is using the manual protocol, so a human operator must complete the active checkpoint before resuming."
      ])
    });
  }

  const { activePromptPath, activeResponsePath } = activeArtifactPathsFor(
    input.artifacts
  );
  const checkpointMetadata = await activeCheckpointMetadataFor({
    artifacts: input.artifacts,
    runId: deps.runId,
    fallback: {
      round: input.round,
      phase: input.phase,
      checkpointKind: input.checkpointKind
    }
  });
  await deps.recordRoundPhase({
    round: input.round,
    phase: input.phase,
    status: "awaiting_codex_work",
    artifacts: input.artifacts,
    notes: input.notes
  });
  return deps.finalizeRunAsPausedStop({
    stopReason: canonicalCodexCheckpointStopReason,
    notes: input.notes,
    attentionRequired: "codex",
    checkpointKind: input.checkpointKind,
    checkpointId: checkpointMetadata.checkpointId,
    checkpointSeq: checkpointMetadata.checkpointSeq,
    autoResumeEligible: true,
    userVisiblePause: false,
    recommendedSkill: "loop-control",
    activePromptPath,
    activeResponsePath
  });
};
