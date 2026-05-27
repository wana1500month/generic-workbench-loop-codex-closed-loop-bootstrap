import { buildRuntimeEvent, mergeRuntimeEvents, normalizeRuntimeWarnings } from "./runtime-events.js";
const unique = (values) => [...new Set(values)];
export const finalizeRunAsPausedStopWithArtifacts = async (deps, input) => {
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
export const finalizeRunAsTerminalDecisionStopWithArtifacts = async (deps, input) => {
    deps.setCurrentRuntimeEvents(mergeRuntimeEvents([
        ...deps.getCurrentRuntimeEvents(),
        buildRuntimeEvent(input.runtimeEventCode, input.runtimeEventMessage, input.runtimeEventMetadata)
    ]));
    deps.setRuntimeWarnings(normalizeRuntimeWarnings([
        ...deps.getRuntimeWarnings(),
        ...input.notes,
        input.runtimeEventMessage
    ]));
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
//# sourceMappingURL=attempt-finalization.js.map