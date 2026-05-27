import { resolveOperatorSurfaceContext } from "../operator-surface.js";
import { writeSessionPreparationArtifacts } from "../session-artifacts.js";
import { deriveSessionLoopStatus } from "./status-snapshot.js";
const unique = (values) => [...new Set(values)];
export const createSessionPreparationRefresher = (config) => {
    const state = {
        ...config.initialState,
        latestRound: undefined
    };
    const updateState = (input) => {
        if (!input)
            return;
        if (input.currentObjective !== undefined)
            state.currentObjective = input.currentObjective;
        if (input.steeringNotes !== undefined)
            state.steeringNotes = unique(input.steeringNotes);
        if (input.reviewFeedback !== undefined)
            state.reviewFeedback = unique(input.reviewFeedback);
        if (input.externalBlockers !== undefined)
            state.externalBlockers = unique(input.externalBlockers);
        if (input.scopeGuardrails !== undefined)
            state.scopeGuardrails = unique(input.scopeGuardrails);
        if (input.latestRound !== undefined)
            state.latestRound = input.latestRound;
        if (input.latestStopReason !== undefined)
            state.latestStopReason = input.latestStopReason;
    };
    const refresh = async (input) => {
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
                attentionRequired: input?.attentionRequired ?? runtimeState.attentionRequired,
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
            checkpointResponsePath: input?.activeResponsePath ?? runtimeState.activeResponsePath,
            checkpointSkill: input?.recommendedSkill ?? runtimeState.recommendedSkill,
            decisionOptions: input?.decisionOptions ?? runtimeState.decisionOptions
        });
        return result.sessionStatus;
    };
    return { updateState, getState: () => state, refresh };
};
//# sourceMappingURL=session-preparation-refresher.js.map