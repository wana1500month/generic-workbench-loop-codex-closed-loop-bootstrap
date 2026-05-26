import { join } from "node:path";
import { loadJsonIfExists, writeJson } from "./file-system.js";
export const runtimeStatePathsForRun = (runDirectory) => {
    const runtimeDirectory = join(runDirectory, "runtime");
    return {
        runtimeDirectory,
        controllerLeasePath: join(runtimeDirectory, "controller-lease.json"),
        liveStatePath: join(runtimeDirectory, "live-state.json"),
        roundPhasePath: join(runtimeDirectory, "round-phase.json"),
        transportStatePath: join(runtimeDirectory, "transport-state.json"),
        supervisorStatePath: join(runtimeDirectory, "supervisor-state.json"),
        buildBriefPath: join(runtimeDirectory, "build-brief.json"),
        runContractPath: join(runtimeDirectory, "run-contract.json"),
        openQuestionsPath: join(runtimeDirectory, "open-questions.json"),
        sessionStatusPath: join(runtimeDirectory, "session-status.json"),
        sessionStatusEventsPath: join(runtimeDirectory, "session-status-events.jsonl"),
        sessionStreamPath: join(runtimeDirectory, "session-stream.json"),
        appServerSessionEventsPath: join(runtimeDirectory, "app-server-session-events.jsonl"),
        operatorSurfacePath: join(runtimeDirectory, "operator-surface.json"),
        operatorSurfaceMarkdownPath: join(runtimeDirectory, "operator-surface.md"),
        plannerEnhancementTaskPath: join(runtimeDirectory, "planner-enhancement-task.json"),
        plannerEnhancementPromptPath: join(runtimeDirectory, "planner-enhancement-prompt.md"),
        plannerEnhancementResponsePath: join(runtimeDirectory, "planner-enhancement-response.json")
    };
};
export const readRuntimeRoundPhaseArtifact = async (path) => loadJsonIfExists(path);
export const readRuntimeLiveStateArtifact = async (path) => loadJsonIfExists(path);
export const readControllerLeaseArtifact = async (path) => loadJsonIfExists(path);
export const readTransportStateArtifact = async (path) => loadJsonIfExists(path);
export const readSupervisorStateArtifact = async (path) => loadJsonIfExists(path);
export const readOperatorSurfaceArtifact = async (path) => loadJsonIfExists(path);
export const writeRuntimeRoundPhaseArtifact = async (path, artifact) => {
    await writeJson(path, artifact);
};
export const writeRuntimeLiveStateArtifact = async (path, artifact) => {
    await writeJson(path, artifact);
};
export const writeControllerLeaseArtifact = async (path, artifact) => {
    await writeJson(path, artifact);
};
export const writeTransportStateArtifact = async (path, artifact) => {
    await writeJson(path, artifact);
};
export const writeSupervisorStateArtifact = async (path, artifact) => {
    await writeJson(path, artifact);
};
export const writeOperatorSurfaceArtifact = async (path, artifact) => {
    await writeJson(path, artifact);
};
export const startRuntimeHeartbeat = (input) => {
    let finalStatusOverride;
    let writeInFlight = false;
    const intervalMs = input.intervalMs ?? 5000;
    const writeSnapshot = async () => {
        if (writeInFlight) {
            return;
        }
        writeInFlight = true;
        const now = new Date().toISOString();
        const snapshot = input.getSnapshot();
        const leaseStatus = finalStatusOverride ?? snapshot.leaseStatus;
        try {
            const liveStateArtifact = {
                run_id: input.runId,
                controller_mode: input.controllerMode,
                transport_mode: input.transportMode,
                ...(input.executorMode ? { executor_mode: input.executorMode } : {}),
                updated_at: now,
                heartbeat_at: now,
                execution_state: snapshot.executionState,
                ...(snapshot.lastProgressAt
                    ? { last_progress_at: snapshot.lastProgressAt }
                    : {}),
                ...(snapshot.lastProgressNote
                    ? { last_progress_note: snapshot.lastProgressNote }
                    : {}),
                ...(snapshot.phaseTimeoutMs !== undefined
                    ? { phase_timeout_ms: snapshot.phaseTimeoutMs }
                    : {}),
                ...(snapshot.stallThresholdMs !== undefined
                    ? { stall_threshold_ms: snapshot.stallThresholdMs }
                    : {}),
                round_count: snapshot.roundCount,
                ...(snapshot.round !== undefined ? { active_round: snapshot.round } : {}),
                ...(snapshot.phase ? { active_phase: snapshot.phase } : {}),
                ...(snapshot.phaseStatus ? { active_phase_status: snapshot.phaseStatus } : {}),
                ...(snapshot.latestRoundSummaryPath
                    ? { latest_round_summary_path: snapshot.latestRoundSummaryPath }
                    : {}),
                ...(snapshot.latestEvalReportPath
                    ? { latest_eval_report_path: snapshot.latestEvalReportPath }
                    : {}),
                ...(snapshot.bestRound !== undefined ? { best_round: snapshot.bestRound } : {}),
                ...(snapshot.bestTotalScore !== undefined
                    ? { best_total_score: snapshot.bestTotalScore }
                    : {}),
                ...(snapshot.stopReason ? { stop_reason: snapshot.stopReason } : {}),
                ...(snapshot.summaryPath ? { summary_path: snapshot.summaryPath } : {}),
                round_phase_path: input.paths.roundPhasePath,
                controller_lease_path: input.paths.controllerLeasePath,
                ...(snapshot.notes?.length ? { notes: snapshot.notes } : {})
            };
            const leaseArtifact = {
                run_id: input.runId,
                controller_mode: input.controllerMode,
                transport_mode: input.transportMode,
                ...(input.executorMode ? { executor_mode: input.executorMode } : {}),
                status: leaseStatus,
                updated_at: now,
                heartbeat_at: now,
                ...(snapshot.lastProgressAt
                    ? { last_progress_at: snapshot.lastProgressAt }
                    : {}),
                owner_pid: process.pid,
                ...(snapshot.round !== undefined ? { round: snapshot.round } : {}),
                ...(snapshot.phase ? { phase: snapshot.phase } : {}),
                ...(snapshot.phaseStatus ? { phase_status: snapshot.phaseStatus } : {}),
                ...(snapshot.summaryPath ? { summary_path: snapshot.summaryPath } : {}),
                live_state_path: input.paths.liveStatePath
            };
            const writes = [
                writeRuntimeLiveStateArtifact(input.paths.liveStatePath, liveStateArtifact),
                writeControllerLeaseArtifact(input.paths.controllerLeasePath, leaseArtifact)
            ];
            if (snapshot.round !== undefined && snapshot.phase && snapshot.phaseStatus) {
                writes.push(writeRuntimeRoundPhaseArtifact(input.paths.roundPhasePath, {
                    run_id: input.runId,
                    round: snapshot.round,
                    controller_mode: input.controllerMode,
                    transport_mode: input.transportMode,
                    ...(input.executorMode ? { executor_mode: input.executorMode } : {}),
                    phase: snapshot.phase,
                    status: snapshot.phaseStatus,
                    updated_at: now,
                    heartbeat_at: now,
                    ...(snapshot.lastProgressAt
                        ? { last_progress_at: snapshot.lastProgressAt }
                        : {}),
                    ...(snapshot.lastProgressNote
                        ? { last_progress_note: snapshot.lastProgressNote }
                        : {}),
                    ...(snapshot.phaseTimeoutMs !== undefined
                        ? { phase_timeout_ms: snapshot.phaseTimeoutMs }
                        : {}),
                    ...(snapshot.stallThresholdMs !== undefined
                        ? { stall_threshold_ms: snapshot.stallThresholdMs }
                        : {}),
                    owner_pid: process.pid,
                    ...(snapshot.phaseStartedAt
                        ? { phase_started_at: snapshot.phaseStartedAt }
                        : {}),
                    ...(snapshot.notes?.length ? { notes: snapshot.notes } : {})
                }));
            }
            await Promise.all(writes);
        }
        finally {
            writeInFlight = false;
        }
    };
    const interval = setInterval(() => {
        void writeSnapshot();
    }, intervalMs);
    interval.unref();
    return {
        tick: writeSnapshot,
        stop: async (status) => {
            finalStatusOverride = status;
            clearInterval(interval);
            await writeSnapshot();
        }
    };
};
//# sourceMappingURL=runtime-state.js.map