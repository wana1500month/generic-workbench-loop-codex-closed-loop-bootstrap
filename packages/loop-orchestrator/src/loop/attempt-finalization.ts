import type {
  AdapterMigrationDecision,
  ClosedLoopResult,
  ControllerRoundPhase,
  CurrentThreadCheckpointKind,
  ExecutionState,
  LoopRunSummary,
  OperatorAttentionRequired,
  OperatorRecommendedSkill,
  RuntimeEvent
} from "../types.js";
import {
  buildRuntimeEvent,
  mergeRuntimeEvents,
  normalizeRuntimeWarnings
} from "./runtime-events.js";

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

export type FinalizeRunAsPausedStopInput = {
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
};

export type FinalizeRunAsTerminalDecisionStopInput = {
  round: number;
  phase: ControllerRoundPhase;
  stopReason: Extract<
    LoopRunSummary["stop_reason"],
    "adapter_migration_rejected" | "new_run_required"
  >;
  notes: string[];
  artifacts?: Record<string, string>;
  runtimeEventCode:
    | "adapter.migration_rejected"
    | "adapter.migration_new_run_requested";
  runtimeEventMessage: string;
  runtimeEventMetadata?: Record<string, string | number | boolean | null>;
};

type SessionRefreshUpdate = {
  currentObjective?: string;
  steeringNotes?: string[];
  reviewFeedback?: string[];
  externalBlockers?: string[];
  scopeGuardrails?: string[];
  latestRound?: number;
  latestStopReason?: LoopRunSummary["stop_reason"];
};

type SessionPreparationRefresh = {
  stopReason?: LoopRunSummary["stop_reason"];
  attentionRequired?: OperatorAttentionRequired;
  executionState?: ExecutionState;
  checkpointKind?: CurrentThreadCheckpointKind;
  checkpointId?: string;
  activePromptPath?: string;
  activeResponsePath?: string;
  recommendedSkill?: OperatorRecommendedSkill;
  decisionOptions?: AdapterMigrationDecision[];
};

type OperatorSurfaceWrite = SessionPreparationRefresh & {
  checkpointSeq?: number;
  autoResumeEligible?: boolean;
  userVisiblePause?: boolean;
  recommendedCommand?: string;
  notes?: string[];
};

type RoundPhaseRecord = {
  round: number;
  phase: ControllerRoundPhase;
  status: "completed";
  artifacts?: Record<string, string>;
  notes?: string[];
};

export type AttemptFinalizationDeps = {
  plan: ClosedLoopResult["plan"];
  runDirectory: string;
  plannedScenarioPath?: string;
  getRuntimeWarnings(): string[];
  setRuntimeWarnings(warnings: string[]): void;
  getHeartbeatNotes(): string[];
  replaceHeartbeatNotes(notes: string[]): void;
  updateSessionRefreshState(input?: SessionRefreshUpdate): void;
  refreshSessionPreparationArtifacts(
    input: SessionPreparationRefresh
  ): Promise<void>;
  writeLiveTransportProtocol(): Promise<void>;
  writeOperatorSurface(input: OperatorSurfaceWrite): Promise<void>;
  writeCheckpoint(
    stopReason: LoopRunSummary["stop_reason"] | undefined
  ): Promise<LoopRunSummary>;
  getCurrentRuntimeEvents(): RuntimeEvent[];
  setCurrentRuntimeEvents(events: RuntimeEvent[]): void;
  recordRoundPhase(input: RoundPhaseRecord): Promise<void>;
  clearActiveCheckpointSurface(): void;
  setExecutionState(state: ExecutionState): void;
};

export const finalizeRunAsPausedStopWithArtifacts = async (
  deps: AttemptFinalizationDeps,
  input: FinalizeRunAsPausedStopInput
): Promise<ClosedLoopResult> => {
  deps.setRuntimeWarnings(unique([...deps.getRuntimeWarnings(), ...input.notes]));
  deps.replaceHeartbeatNotes(unique([...deps.getHeartbeatNotes(), ...input.notes]));
  deps.updateSessionRefreshState({
    ...(input.attentionRequired === "human"
      ? { steeringNotes: input.notes }
      : {}),
    ...(input.attentionRequired === "external"
      ? { externalBlockers: input.notes }
      : {}),
    latestStopReason: input.stopReason
  });
  await deps.refreshSessionPreparationArtifacts({
    stopReason: input.stopReason,
    attentionRequired: input.attentionRequired,
    executionState: "paused",
    checkpointKind: input.checkpointKind,
    checkpointId: input.checkpointId,
    activePromptPath: input.activePromptPath,
    activeResponsePath: input.activeResponsePath,
    recommendedSkill: input.recommendedSkill,
    decisionOptions: input.decisionOptions
  });
  await deps.writeLiveTransportProtocol();
  await deps.writeOperatorSurface({
    executionState: "paused",
    attentionRequired: input.attentionRequired,
    checkpointKind: input.checkpointKind,
    checkpointId: input.checkpointId,
    checkpointSeq: input.checkpointSeq,
    autoResumeEligible: input.autoResumeEligible,
    userVisiblePause: input.userVisiblePause,
    decisionOptions: input.decisionOptions ?? [],
    recommendedSkill: input.recommendedSkill,
    recommendedCommand: input.recommendedCommand,
    activePromptPath: input.activePromptPath,
    activeResponsePath: input.activeResponsePath,
    notes: deps.getHeartbeatNotes()
  });
  const summary = await deps.writeCheckpoint(input.stopReason);
  return {
    plan: deps.plan,
    summary,
    runDirectory: deps.runDirectory,
    plannedScenarioPath: deps.plannedScenarioPath
  };
};

export const finalizeRunAsTerminalDecisionStopWithArtifacts = async (
  deps: AttemptFinalizationDeps,
  input: FinalizeRunAsTerminalDecisionStopInput
): Promise<ClosedLoopResult> => {
  deps.setCurrentRuntimeEvents(
    mergeRuntimeEvents([
      ...deps.getCurrentRuntimeEvents(),
      buildRuntimeEvent(
        input.runtimeEventCode,
        input.runtimeEventMessage,
        input.runtimeEventMetadata
      )
    ])
  );
  deps.setRuntimeWarnings(
    normalizeRuntimeWarnings([
      ...deps.getRuntimeWarnings(),
      ...input.notes,
      input.runtimeEventMessage
    ])
  );
  deps.replaceHeartbeatNotes(unique([...deps.getHeartbeatNotes(), ...input.notes]));
  deps.updateSessionRefreshState({
    steeringNotes: input.notes,
    latestStopReason: input.stopReason
  });
  await deps.refreshSessionPreparationArtifacts({
    stopReason: input.stopReason,
    attentionRequired: "human",
    executionState: "completed"
  });
  await deps.recordRoundPhase({
    round: input.round,
    phase: input.phase,
    status: "completed",
    artifacts: input.artifacts ?? {},
    notes: input.notes
  });
  deps.clearActiveCheckpointSurface();
  deps.setExecutionState("completed");
  await deps.writeLiveTransportProtocol();
  await deps.writeOperatorSurface({
    executionState: "completed",
    attentionRequired: "none",
    decisionOptions: [],
    notes: deps.getHeartbeatNotes()
  });
  const summary = await deps.writeCheckpoint(input.stopReason);
  return {
    plan: deps.plan,
    summary,
    runDirectory: deps.runDirectory,
    plannedScenarioPath: deps.plannedScenarioPath
  };
};
