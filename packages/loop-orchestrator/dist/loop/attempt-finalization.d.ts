import type { AdapterMigrationDecision, ClosedLoopResult, ControllerRoundPhase, CurrentThreadCheckpointKind, ExecutionState, LoopRunSummary, OperatorAttentionRequired, OperatorRecommendedSkill, RuntimeEvent } from "../types.js";
export type FinalizeRunAsPausedStopInput = {
    stopReason: Extract<LoopRunSummary["stop_reason"], "awaiting_codex_checkpoint" | "awaiting_manual_generator" | "awaiting_human_input" | "awaiting_external_condition">;
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
    stopReason: Extract<LoopRunSummary["stop_reason"], "adapter_migration_rejected" | "new_run_required">;
    notes: string[];
    artifacts?: Record<string, string>;
    runtimeEventCode: "adapter.migration_rejected" | "adapter.migration_new_run_requested";
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
    refreshSessionPreparationArtifacts(input: SessionPreparationRefresh): Promise<void>;
    writeLiveTransportProtocol(): Promise<void>;
    writeOperatorSurface(input: OperatorSurfaceWrite): Promise<void>;
    writeCheckpoint(stopReason: LoopRunSummary["stop_reason"] | undefined): Promise<LoopRunSummary>;
    getCurrentRuntimeEvents(): RuntimeEvent[];
    setCurrentRuntimeEvents(events: RuntimeEvent[]): void;
    recordRoundPhase(input: RoundPhaseRecord): Promise<void>;
    clearActiveCheckpointSurface(): void;
    setExecutionState(state: ExecutionState): void;
};
export declare const finalizeRunAsPausedStopWithArtifacts: (deps: AttemptFinalizationDeps, input: FinalizeRunAsPausedStopInput) => Promise<ClosedLoopResult>;
export declare const finalizeRunAsTerminalDecisionStopWithArtifacts: (deps: AttemptFinalizationDeps, input: FinalizeRunAsTerminalDecisionStopInput) => Promise<ClosedLoopResult>;
export {};
//# sourceMappingURL=attempt-finalization.d.ts.map