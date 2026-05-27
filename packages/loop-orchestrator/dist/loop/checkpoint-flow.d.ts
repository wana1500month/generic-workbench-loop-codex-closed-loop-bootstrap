import type { AdapterMigrationDecision, ClosedLoopResult, ControllerPhaseStatus, ControllerRoundPhase, CurrentThreadCheckpointKind, LoopRunSummary, OperatorAttentionRequired, OperatorRecommendedSkill } from "../types.js";
type RecordRoundPhase = (input: {
    round: number;
    phase: ControllerRoundPhase;
    status: ControllerPhaseStatus;
    artifacts?: Record<string, string>;
    notes?: string[];
}) => Promise<void>;
type FinalizeRunAsPausedStop = (input: {
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
export declare const pauseForHumanInputCheckpoint: (deps: CheckpointFlowDeps, input: PauseForHumanInputInput) => Promise<ClosedLoopResult>;
export declare const pauseForExternalConditionCheckpoint: (deps: CheckpointFlowDeps, input: PauseForExternalConditionInput) => Promise<ClosedLoopResult>;
export declare const checkpointForCurrentThreadWorkCheckpoint: (deps: CheckpointFlowDeps & {
    manualCurrentThreadProtocol: boolean;
}, input: CheckpointForCurrentThreadWorkInput) => Promise<ClosedLoopResult>;
export {};
//# sourceMappingURL=checkpoint-flow.d.ts.map