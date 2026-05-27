import { resolveOperatorSurfaceContext } from "../operator-surface.js";
import {
  writeSessionPreparationArtifacts,
  type SessionPreparationArtifactsInput
} from "../session-artifacts.js";
import type {
  AdapterMigrationDecision,
  ControllerMode,
  CurrentThreadCheckpointKind,
  ExecutionState,
  LoopRunSummary,
  OperatorAttentionRequired,
  OperatorRecommendedSkill,
  SessionLoopStatus,
  SessionStatusArtifact,
  TransportMode
} from "../types.js";
import { deriveSessionLoopStatus } from "./status-snapshot.js";

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

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

export const createSessionPreparationRefresher = (config: {
  controllerMode: ControllerMode;
  transportMode: TransportMode;
  artifactInput: Omit<
    SessionPreparationArtifactsInput,
    | "threadBindingState"
    | "threadId"
    | "turnId"
    | "sessionStatus"
    | "currentObjective"
    | "steeringNotes"
    | "reviewFeedback"
    | "externalBlockers"
    | "scopeGuardrails"
    | "latestRound"
    | "latestStopReason"
    | "checkpointKind"
    | "checkpointId"
    | "checkpointPromptPath"
    | "checkpointResponsePath"
    | "checkpointSkill"
    | "decisionOptions"
  >;
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
}): {
  updateState(input?: SessionRefreshUpdate): void;
  getState(): SessionPreparationRefresherState;
  refresh(input?: SessionPreparationRefreshInput): Promise<SessionStatusArtifact>;
} => {
  const state: SessionPreparationRefresherState = {
    ...config.initialState,
    latestRound: undefined
  };
  const updateState = (input?: SessionRefreshUpdate): void => {
    if (!input) return;
    if (input.currentObjective !== undefined) state.currentObjective = input.currentObjective;
    if (input.steeringNotes !== undefined) state.steeringNotes = unique(input.steeringNotes);
    if (input.reviewFeedback !== undefined) state.reviewFeedback = unique(input.reviewFeedback);
    if (input.externalBlockers !== undefined) state.externalBlockers = unique(input.externalBlockers);
    if (input.scopeGuardrails !== undefined) state.scopeGuardrails = unique(input.scopeGuardrails);
    if (input.latestRound !== undefined) state.latestRound = input.latestRound;
    if (input.latestStopReason !== undefined) state.latestStopReason = input.latestStopReason;
  };

  const refresh = async (
    input?: SessionPreparationRefreshInput
  ): Promise<SessionStatusArtifact> => {
    const snapshot = config.getTransportSnapshot();
    const runtimeState = config.getRuntimeState();
    const sessionContext = resolveOperatorSurfaceContext({
      controllerMode: config.controllerMode,
      transportMode: config.transportMode,
      threadId: snapshot?.thread_id,
      threadName: snapshot?.thread_name
    });
    const result = await writeSessionPreparationArtifacts({
      ...config.artifactInput,
      threadBindingState: sessionContext.threadBindingState,
      threadId: sessionContext.threadId,
      turnId: snapshot?.turn_id,
      sessionStatus: deriveSessionLoopStatus({
        override: input?.status,
        stopReason: input?.stopReason ?? state.latestStopReason,
        executionState: input?.executionState ?? runtimeState.executionState,
        attentionRequired:
          input?.attentionRequired ?? runtimeState.attentionRequired,
        hasHistory: runtimeState.historyLength > 0
      }),
      currentObjective: state.currentObjective,
      steeringNotes: state.steeringNotes,
      reviewFeedback: state.reviewFeedback,
      externalBlockers: state.externalBlockers,
      scopeGuardrails: state.scopeGuardrails,
      latestRound: state.latestRound,
      latestStopReason: input?.stopReason ?? state.latestStopReason,
      checkpointKind: input?.checkpointKind ?? runtimeState.checkpointKind,
      checkpointId: input?.checkpointId ?? runtimeState.checkpointId,
      checkpointPromptPath: input?.activePromptPath ?? runtimeState.activePromptPath,
      checkpointResponsePath:
        input?.activeResponsePath ?? runtimeState.activeResponsePath,
      checkpointSkill: input?.recommendedSkill ?? runtimeState.recommendedSkill,
      decisionOptions: input?.decisionOptions ?? runtimeState.decisionOptions
    });
    return result.sessionStatus;
  };

  return { updateState, getState: () => state, refresh };
};
