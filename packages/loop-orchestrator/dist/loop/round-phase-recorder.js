import { writeRuntimeRoundPhaseArtifact } from "../runtime-state.js";
import { activeArtifactPathsFor } from "./active-checkpoint.js";
export const persistRoundPhase = async (input) => {
    await writeRuntimeRoundPhaseArtifact(input.roundPhasePath, {
        run_id: input.runId,
        round: input.round,
        controller_mode: input.controllerMode,
        transport_mode: input.transportMode,
        executor_mode: input.executorMode,
        phase: input.phase,
        status: input.status,
        updated_at: input.updatedAt,
        heartbeat_at: input.updatedAt,
        ...(input.lastProgressAt ? { last_progress_at: input.lastProgressAt } : {}),
        ...(input.lastProgressNote
            ? { last_progress_note: input.lastProgressNote }
            : {}),
        ...(input.activePhaseTimeoutMs !== undefined
            ? { phase_timeout_ms: input.activePhaseTimeoutMs }
            : {}),
        ...(input.activeStallThresholdMs !== undefined
            ? { stall_threshold_ms: input.activeStallThresholdMs }
            : {}),
        owner_pid: process.pid,
        ...(input.activeHeartbeatPhaseStartedAt
            ? { phase_started_at: input.activeHeartbeatPhaseStartedAt }
            : {}),
        ...(input.status === "completed" ? { phase_completed_at: input.updatedAt } : {}),
        ...(input.appServerThreadId
            ? { session: { thread_id: input.appServerThreadId } }
            : {}),
        ...(input.artifacts ? { artifacts: input.artifacts } : {}),
        ...(input.heartbeatNotes.length > 0 ? { notes: input.heartbeatNotes } : {})
    });
    await input.writeLiveTransportProtocol();
    const activeArtifacts = activeArtifactPathsFor(input.artifacts);
    await input.writeOperatorSurface({
        round: input.round,
        phase: input.phase,
        phaseStatus: input.status,
        activePromptPath: activeArtifacts.activePromptPath,
        activeResponsePath: activeArtifacts.activeResponsePath,
        notes: input.heartbeatNotes
    });
    await input.syncAppServerPhase?.({
        round: input.round,
        phase: input.phase,
        status: input.status,
        notes: input.heartbeatNotes
    });
    await input.tickHeartbeat();
    return activeArtifacts;
};
//# sourceMappingURL=round-phase-recorder.js.map