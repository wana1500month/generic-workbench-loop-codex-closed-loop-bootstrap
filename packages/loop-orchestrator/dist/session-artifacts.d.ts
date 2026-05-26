import type { DurableMemoryContext } from "./durable-memory.js";
import type { AdapterMigrationDecision, BuildBriefArtifact, CurrentThreadCheckpointKind, IdeaBrief, LoopPlan, OperatorRecommendedSkill, OperatorSurfaceSessionProjection, LoopScenario, OperatorWorkspaceSurface, SessionLoopStatus, SessionStreamContractArtifact, SessionStatusArtifact, SessionRunContractArtifact, TargetFamily, ThreadBindingState, TransportMode } from "./types.js";
type OpenQuestionArtifact = {
    id: string;
    prompt: string;
    status: "deferred";
    impact: "medium" | "high";
    source: "discovery" | "steering" | "review" | "external";
    related_round?: number;
};
export interface SessionOpenQuestionsArtifact {
    updated_at: string;
    session_status: SessionLoopStatus;
    objective: string;
    latest_round?: number;
    latest_stop_reason?: string;
    steering_notes: string[];
    review_feedback: string[];
    external_blockers: string[];
    questions: OpenQuestionArtifact[];
}
export interface SessionPreparationArtifactsResult {
    buildBrief: BuildBriefArtifact;
    runContract: SessionRunContractArtifact;
    openQuestions: SessionOpenQuestionsArtifact;
    sessionStatus: SessionStatusArtifact;
    sessionStream: SessionStreamContractArtifact;
    executionPlanPath: string;
}
export interface PreparedSessionSeed {
    buildBrief: BuildBriefArtifact;
    runContract: SessionRunContractArtifact;
    idea: IdeaBrief;
    durableMemory: DurableMemoryContext;
}
export interface SessionPreparationArtifactsInput {
    runId: string;
    runDirectory: string;
    rootDirectory: string;
    buildBriefPath: string;
    runContractPath: string;
    openQuestionsPath: string;
    sessionStatusPath: string;
    sessionStatusEventsPath: string;
    sessionStreamPath: string;
    operatorSurfacePath: string;
    executionPlanPath: string;
    transportMode: TransportMode;
    appServerSessionEventsPath?: string;
    threadBindingState?: ThreadBindingState;
    threadId?: string;
    turnId?: string;
    idea: IdeaBrief;
    durableMemory: DurableMemoryContext;
    scenario: LoopScenario;
    plan: LoopPlan;
    workspaceMode: OperatorWorkspaceSurface;
    targetFamily?: TargetFamily;
    validationBundle?: SessionRunContractArtifact["validation_strategy"]["validation_bundle"];
    discoverySource?: SessionRunContractArtifact["discovery_source"];
    sessionStatus?: SessionLoopStatus;
    currentObjective?: string;
    steeringNotes?: string[];
    reviewFeedback?: string[];
    externalBlockers?: string[];
    scopeGuardrails?: string[];
    latestRound?: number;
    latestStopReason?: string;
    checkpointKind?: CurrentThreadCheckpointKind;
    checkpointId?: string;
    checkpointPromptPath?: string;
    checkpointResponsePath?: string;
    checkpointSkill?: OperatorRecommendedSkill;
    decisionOptions?: AdapterMigrationDecision[];
}
export declare const buildSessionStatusArtifact: (input: {
    updatedAt: string;
    runId: string;
    runDirectory: string;
    objective: string;
    sessionStatus: SessionLoopStatus;
    workspaceMode: OperatorWorkspaceSurface;
    currentThreadRequired?: boolean;
    openQuestions: SessionOpenQuestionsArtifact;
    buildBriefPath: string;
    runContractPath: string;
    openQuestionsPath: string;
    sessionStatusEventsPath: string;
    sessionStreamPath: string;
    operatorSurfacePath: string;
    executionPlanPath: string;
    transportMode: TransportMode;
    threadBindingState?: ThreadBindingState;
    threadId?: string;
    turnId?: string;
    checkpointKind?: CurrentThreadCheckpointKind;
    checkpointId?: string;
    checkpointPromptPath?: string;
    checkpointResponsePath?: string;
    checkpointSkill?: OperatorRecommendedSkill;
    decisionOptions?: AdapterMigrationDecision[];
}) => SessionStatusArtifact;
export declare const buildOperatorSurfaceSessionProjection: (artifact: SessionStatusArtifact) => OperatorSurfaceSessionProjection;
export declare const buildSessionStreamContractArtifact: (input: {
    updatedAt: string;
    runId: string;
    runDirectory: string;
    transportMode: TransportMode;
    sessionStatusPath: string;
    sessionStatusEventsPath: string;
    sessionStatus: SessionStatusArtifact;
    latestSourceSequence?: number;
    appServerSessionEventsPath?: string;
}) => SessionStreamContractArtifact;
export declare const loadPreparedSessionSeed: (input: {
    buildBriefPath: string;
    runContractPath: string;
}) => Promise<PreparedSessionSeed | undefined>;
export declare const writeSessionPreparationArtifacts: (input: SessionPreparationArtifactsInput) => Promise<SessionPreparationArtifactsResult>;
export {};
//# sourceMappingURL=session-artifacts.d.ts.map