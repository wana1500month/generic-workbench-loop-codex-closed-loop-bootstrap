import { join } from "node:path";

import { loadJsonIfExists, writeJson } from "./file-system.js";
import type {
  ControllerLeaseArtifact,
  ControllerMode,
  ControllerPhaseStatus,
  ControllerRoundPhase,
  ExecutorMode,
  RunStopReason,
  TransportMode,
  TransportStateArtifact,
  RuntimeLiveStateArtifact,
  RuntimeRoundPhaseArtifact
} from "./types.js";

export interface RuntimeStatePaths {
  runtimeDirectory: string;
  controllerLeasePath: string;
  liveStatePath: string;
  roundPhasePath: string;
  transportStatePath: string;
}

export interface RuntimeHeartbeatSnapshot {
  roundCount: number;
  round?: number;
  phase?: ControllerRoundPhase;
  phaseStatus?: ControllerPhaseStatus;
  phaseStartedAt?: string;
  latestRoundSummaryPath?: string;
  latestEvalReportPath?: string;
  bestRound?: number;
  bestTotalScore?: number;
  stopReason?: RunStopReason;
  summaryPath?: string;
  notes?: string[];
}

export interface RuntimeHeartbeatController {
  tick: () => Promise<void>;
  stop: (status?: ControllerLeaseArtifact["status"]) => Promise<void>;
}

export const runtimeStatePathsForRun = (
  runDirectory: string
): RuntimeStatePaths => {
  const runtimeDirectory = join(runDirectory, "runtime");
  return {
    runtimeDirectory,
    controllerLeasePath: join(runtimeDirectory, "controller-lease.json"),
    liveStatePath: join(runtimeDirectory, "live-state.json"),
    roundPhasePath: join(runtimeDirectory, "round-phase.json"),
    transportStatePath: join(runtimeDirectory, "transport-state.json")
  };
};

export const readRuntimeRoundPhaseArtifact = async (
  path: string
): Promise<RuntimeRoundPhaseArtifact | undefined> =>
  loadJsonIfExists<RuntimeRoundPhaseArtifact>(path);

export const readRuntimeLiveStateArtifact = async (
  path: string
): Promise<RuntimeLiveStateArtifact | undefined> =>
  loadJsonIfExists<RuntimeLiveStateArtifact>(path);

export const readControllerLeaseArtifact = async (
  path: string
): Promise<ControllerLeaseArtifact | undefined> =>
  loadJsonIfExists<ControllerLeaseArtifact>(path);

export const readTransportStateArtifact = async (
  path: string
): Promise<TransportStateArtifact | undefined> =>
  loadJsonIfExists<TransportStateArtifact>(path);

export const writeRuntimeRoundPhaseArtifact = async (
  path: string,
  artifact: RuntimeRoundPhaseArtifact
): Promise<void> => {
  await writeJson(path, artifact);
};

export const writeRuntimeLiveStateArtifact = async (
  path: string,
  artifact: RuntimeLiveStateArtifact
): Promise<void> => {
  await writeJson(path, artifact);
};

export const writeControllerLeaseArtifact = async (
  path: string,
  artifact: ControllerLeaseArtifact
): Promise<void> => {
  await writeJson(path, artifact);
};

export const writeTransportStateArtifact = async (
  path: string,
  artifact: TransportStateArtifact
): Promise<void> => {
  await writeJson(path, artifact);
};

export const startRuntimeHeartbeat = (input: {
  runId: string;
  controllerMode: ControllerMode;
  transportMode: TransportMode;
  executorMode?: ExecutorMode;
  paths: RuntimeStatePaths;
  getSnapshot: () => RuntimeHeartbeatSnapshot;
  intervalMs?: number;
}): RuntimeHeartbeatController => {
  let currentStatus: ControllerLeaseArtifact["status"] = "running";
  let writeInFlight = false;
  const intervalMs = input.intervalMs ?? 5000;

  const writeSnapshot = async (): Promise<void> => {
    if (writeInFlight) {
      return;
    }
    writeInFlight = true;
    const now = new Date().toISOString();
    const snapshot = input.getSnapshot();

    try {
      const liveStateArtifact: RuntimeLiveStateArtifact = {
        run_id: input.runId,
        controller_mode: input.controllerMode,
        transport_mode: input.transportMode,
        ...(input.executorMode ? { executor_mode: input.executorMode } : {}),
        updated_at: now,
        heartbeat_at: now,
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
      const leaseArtifact: ControllerLeaseArtifact = {
        run_id: input.runId,
        controller_mode: input.controllerMode,
        transport_mode: input.transportMode,
        ...(input.executorMode ? { executor_mode: input.executorMode } : {}),
        status: currentStatus,
        updated_at: now,
        heartbeat_at: now,
        owner_pid: process.pid,
        ...(snapshot.round !== undefined ? { round: snapshot.round } : {}),
        ...(snapshot.phase ? { phase: snapshot.phase } : {}),
        ...(snapshot.phaseStatus ? { phase_status: snapshot.phaseStatus } : {}),
        ...(snapshot.summaryPath ? { summary_path: snapshot.summaryPath } : {}),
        live_state_path: input.paths.liveStatePath
      };

      const writes: Promise<void>[] = [
        writeRuntimeLiveStateArtifact(input.paths.liveStatePath, liveStateArtifact),
        writeControllerLeaseArtifact(input.paths.controllerLeasePath, leaseArtifact)
      ];

      if (snapshot.round !== undefined && snapshot.phase && snapshot.phaseStatus) {
        writes.push(
          writeRuntimeRoundPhaseArtifact(input.paths.roundPhasePath, {
            run_id: input.runId,
            round: snapshot.round,
            controller_mode: input.controllerMode,
            transport_mode: input.transportMode,
            ...(input.executorMode ? { executor_mode: input.executorMode } : {}),
            phase: snapshot.phase,
            status: snapshot.phaseStatus,
            updated_at: now,
            heartbeat_at: now,
            owner_pid: process.pid,
            ...(snapshot.phaseStartedAt
              ? { phase_started_at: snapshot.phaseStartedAt }
              : {}),
            ...(snapshot.notes?.length ? { notes: snapshot.notes } : {})
          })
        );
      }

      await Promise.all(writes);
    } finally {
      writeInFlight = false;
    }
  };

  const interval = setInterval(() => {
    void writeSnapshot();
  }, intervalMs);
  interval.unref();

  return {
    tick: writeSnapshot,
    stop: async (status = "stopped") => {
      currentStatus = status;
      clearInterval(interval);
      await writeSnapshot();
    }
  };
};
