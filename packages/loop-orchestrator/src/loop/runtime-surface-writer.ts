import {
  buildOperatorSurfaceArtifact,
  writeOperatorSurfaceArtifacts
} from "../operator-surface.js";
import { buildOperatorSurfaceSessionProjection } from "../session-artifacts.js";
import { writeTransportStateArtifact } from "../runtime-state.js";
import {
  buildTransportStateArtifact,
  transportRuntimeWarningsForMode
} from "../transport-mode.js";
import type {
  AdapterMigrationDecision,
  ControllerMode,
  ControllerPhaseStatus,
  ControllerRoundPhase,
  CurrentThreadCheckpointKind,
  ExecutionState,
  ExecutorMode,
  OperatorAttentionRequired,
  OperatorRecommendedSkill,
  SessionStatusArtifact,
  TransportMode
} from "../types.js";

export type RuntimeSurfaceWriteInput = {
  round?: number;
  phase?: ControllerRoundPhase;
  phaseStatus?: ControllerPhaseStatus;
  executionState?: ExecutionState | "configured";
  attentionRequired?: OperatorAttentionRequired;
  checkpointKind?: CurrentThreadCheckpointKind;
  checkpointId?: string;
  checkpointSeq?: number;
  autoResumeEligible?: boolean;
  userVisiblePause?: boolean;
  decisionOptions?: AdapterMigrationDecision[];
  recommendedSkill?: OperatorRecommendedSkill;
  recommendedCommand?: string;
  nextAction?: string;
  activePromptPath?: string;
  activeResponsePath?: string;
  notes?: string[];
};

export type RuntimeSurfaceState = {
  activeExecutionState: ExecutionState;
  activeHeartbeatRound?: number;
  activeHeartbeatPhase?: ControllerRoundPhase;
  activeHeartbeatPhaseStatus?: ControllerPhaseStatus;
  activePromptPath?: string;
  activeResponsePath?: string;
  attentionRequired?: OperatorAttentionRequired;
  checkpointKind?: CurrentThreadCheckpointKind;
  checkpointId?: string;
  checkpointSeq?: number;
  autoResumeEligible?: boolean;
  userVisiblePause?: boolean;
  decisionOptions?: AdapterMigrationDecision[];
  recommendedSkill?: OperatorRecommendedSkill;
  recommendedCommand?: string;
};

export const resolveRuntimeSurfaceState = (
  state: RuntimeSurfaceState,
  input?: RuntimeSurfaceWriteInput
): RuntimeSurfaceState => ({
  ...state,
  activePromptPath: input?.activePromptPath ?? state.activePromptPath,
  activeResponsePath: input?.activeResponsePath ?? state.activeResponsePath,
  attentionRequired: input?.attentionRequired ?? state.attentionRequired,
  checkpointKind: input?.checkpointKind ?? state.checkpointKind,
  checkpointId: input?.checkpointId ?? state.checkpointId,
  checkpointSeq: input?.checkpointSeq ?? state.checkpointSeq,
  autoResumeEligible: input?.autoResumeEligible ?? state.autoResumeEligible,
  userVisiblePause: input?.userVisiblePause ?? state.userVisiblePause,
  decisionOptions:
    input?.decisionOptions !== undefined
      ? input.decisionOptions.length > 0
        ? input.decisionOptions
        : undefined
      : state.decisionOptions,
  recommendedSkill: input?.recommendedSkill ?? state.recommendedSkill,
  recommendedCommand: input?.recommendedCommand ?? state.recommendedCommand
});

export const writeLoopOperatorSurface = async (input: {
  state: RuntimeSurfaceState;
  writeInput?: RuntimeSurfaceWriteInput;
  runId: string;
  controllerMode: ControllerMode;
  transportMode: TransportMode;
  executorMode: ExecutorMode;
  summaryPath: string;
  transportStatePath: string;
  transportProtocolPath?: string;
  dashboardPath: string;
  sessionStatusPath: string;
  sessionStatusEventsPath: string;
  sessionStreamPath: string;
  operatorSurfacePath: string;
  operatorSurfaceMarkdownPath: string;
  latestSessionStatusArtifact?: SessionStatusArtifact;
  threadId?: string;
  threadName?: string;
  heartbeatNotes: string[];
}): Promise<void> => {
  const { state, writeInput } = input;
  const session = input.latestSessionStatusArtifact
    ? buildOperatorSurfaceSessionProjection(input.latestSessionStatusArtifact)
    : undefined;

  if (input.transportMode !== "app-server") {
    await writeTransportStateArtifact(
      input.transportStatePath,
      buildTransportStateArtifact({
        runId: input.runId,
        controllerMode: input.controllerMode,
        transportMode: input.transportMode,
        executorMode: input.executorMode,
        summaryPath: input.summaryPath,
        protocolPath: input.transportProtocolPath,
        dashboardPath: input.dashboardPath,
        sessionStatusPath: input.sessionStatusPath,
        sessionStatusEventsPath: input.sessionStatusEventsPath,
        sessionStreamPath: input.sessionStreamPath,
        ...(session ? { session } : {}),
        status: "configured",
        notes: transportRuntimeWarningsForMode({
          controllerMode: input.controllerMode,
          transportMode: input.transportMode
        })
      })
    );
  }

  await writeOperatorSurfaceArtifacts({
    jsonPath: input.operatorSurfacePath,
    markdownPath: input.operatorSurfaceMarkdownPath,
    artifact: buildOperatorSurfaceArtifact({
      runId: input.runId,
      controllerMode: input.controllerMode,
      transportMode: input.transportMode,
      executionState: writeInput?.executionState ?? state.activeExecutionState,
      round: writeInput?.round ?? state.activeHeartbeatRound,
      phase: writeInput?.phase ?? state.activeHeartbeatPhase,
      phaseStatus: writeInput?.phaseStatus ?? state.activeHeartbeatPhaseStatus,
      attentionRequired:
        writeInput?.attentionRequired ?? state.attentionRequired,
      checkpointKind: writeInput?.checkpointKind ?? state.checkpointKind,
      checkpointId: writeInput?.checkpointId ?? state.checkpointId,
      checkpointSeq: writeInput?.checkpointSeq ?? state.checkpointSeq,
      autoResumeEligible:
        writeInput?.autoResumeEligible ?? state.autoResumeEligible,
      userVisiblePause: writeInput?.userVisiblePause ?? state.userVisiblePause,
      decisionOptions: writeInput?.decisionOptions ?? state.decisionOptions,
      summaryPath: input.summaryPath,
      transportStatePath: input.transportStatePath,
      transportProtocolPath: input.transportProtocolPath,
      sessionStatusPath: input.sessionStatusPath,
      sessionStatusEventsPath: input.sessionStatusEventsPath,
      sessionStreamPath: input.sessionStreamPath,
      activePromptPath: writeInput?.activePromptPath ?? state.activePromptPath,
      activeResponsePath:
        writeInput?.activeResponsePath ?? state.activeResponsePath,
      dashboardPath: input.operatorSurfaceMarkdownPath,
      threadId: input.threadId,
      threadName: input.threadName,
      recommendedSkill: writeInput?.recommendedSkill ?? state.recommendedSkill,
      recommendedCommand:
        writeInput?.recommendedCommand ?? state.recommendedCommand,
      session,
      nextAction: writeInput?.nextAction,
      notes: writeInput?.notes ?? input.heartbeatNotes
    })
  });
};
