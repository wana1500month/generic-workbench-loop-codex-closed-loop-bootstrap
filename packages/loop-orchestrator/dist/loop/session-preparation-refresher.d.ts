import { type SessionPreparationArtifactsInput } from "../session-artifacts.js";
import type { AdapterMigrationDecision, ControllerMode, CurrentThreadCheckpointKind, ExecutionState, LoopRunSummary, OperatorAttentionRequired, OperatorRecommendedSkill, SessionLoopStatus, SessionStatusArtifact, TransportMode } from "../types.js";
type SessionRefreshUpdate = {
    currentObjective?: string;
    steeringNotes?: string[];
    reviewFeedback?: string[];
    externalBlockers?: string[];
    scopeGuardrails?: string[];
    latestRound?: number;
    latestStopReason?: LoopRunSummary["stop_reason"];
};
export type SessionPreparationRefreshInput = {
    status?: SessionLoopStatus;
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
type RuntimeStateSnapshot = {
    executionState: ExecutionState;
    attentionRequired?: OperatorAttentionRequired;
    checkpointKind?: CurrentThreadCheckpointKind;
    checkpointId?: string;
    activePromptPath?: string;
    activeResponsePath?: string;
    recommendedSkill?: OperatorRecommendedSkill;
    decisionOptions?: AdapterMigrationDecision[];
    historyLength: number;
};
type TransportSnapshot = {
    thread_id?: string;
    thread_name?: string;
    turn_id?: string;
};
type SessionPreparationRefresherState = {
    currentObjective: string;
    steeringNotes: string[];
    reviewFeedback: string[];
    externalBlockers: string[];
    scopeGuardrails: string[];
    latestStopReason?: LoopRunSummary["stop_reason"];
    latestRound?: number;
};
export declare const createSessionPreparationRefresher: (config: {
    controllerMode: ControllerMode;
    transportMode: TransportMode;
    artifactInput: Omit<SessionPreparationArtifactsInput, "threadBindingState" | "threadId" | "turnId" | "sessionStatus" | "currentObjective" | "steeringNotes" | "reviewFeedback" | "externalBlockers" | "scopeGuardrails" | "latestRound" | "latestStopReason" | "checkpointKind" | "checkpointId" | "checkpointPromptPath" | "checkpointResponsePath" | "checkpointSkill" | "decisionOptions">;
    getTransportSnapshot: () => TransportSnapshot | undefined;
    getRuntimeState: () => RuntimeStateSnapshot;
    initialState: {
        currentObjective: string;
        steeringNotes: string[];
        reviewFeedback: string[];
        externalBlockers: string[];
        scopeGuardrails: string[];
        latestStopReason?: LoopRunSummary["stop_reason"];
    };
}) => {
    updateState(input?: SessionRefreshUpdate): void;
    getState(): SessionPreparationRefresherState;
    refresh(input?: SessionPreparationRefreshInput): Promise<SessionStatusArtifact>;
};
export {};
//# sourceMappingURL=session-preparation-refresher.d.ts.map