import type {
  ControllerLeaseArtifact,
  ControllerPhaseStatus,
  ExecutionState,
  RunStopReason,
  RuntimeLiveStateArtifact,
  RuntimeRoundPhaseArtifact,
  TransportStateArtifact
} from "./types.js";

export const pausedStopReasons = new Set<RunStopReason>([
  "awaiting_current_thread_handoff",
  "awaiting_manual_generator"
]);

export const defaultStallThresholdMs = 60_000;
export const defaultHeartbeatStaleMs = 30_000;
export const defaultTransportEventStaleMs = 30_000;

const parseTimestamp = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const ageFor = (
  value: string | undefined,
  now: number
): number | undefined => {
  const parsed = parseTimestamp(value);
  return parsed === undefined ? undefined : Math.max(now - parsed, 0);
};

const firstDefined = <T>(...values: Array<T | undefined>): T | undefined =>
  values.find((value): value is T => value !== undefined);

export const phaseBudgetToStallThresholdMs = (
  phaseTimeoutMs: number | undefined
): number => {
  if (
    phaseTimeoutMs === undefined ||
    !Number.isFinite(phaseTimeoutMs) ||
    phaseTimeoutMs <= 0
  ) {
    return defaultStallThresholdMs;
  }

  return Math.min(Math.max(Math.round(phaseTimeoutMs / 4), 30_000), 120_000);
};

export const heartbeatTimestampForRuntime = (input: {
  liveState?: RuntimeLiveStateArtifact;
  roundPhase?: RuntimeRoundPhaseArtifact;
  controllerLease?: ControllerLeaseArtifact;
}): string | undefined =>
  firstDefined(
    input.liveState?.heartbeat_at,
    input.controllerLease?.heartbeat_at,
    input.roundPhase?.heartbeat_at
  );

export const progressTimestampForRuntime = (input: {
  liveState?: RuntimeLiveStateArtifact;
  roundPhase?: RuntimeRoundPhaseArtifact;
  controllerLease?: ControllerLeaseArtifact;
}): string | undefined =>
  firstDefined(
    input.liveState?.last_progress_at,
    input.roundPhase?.last_progress_at,
    input.controllerLease?.last_progress_at,
    input.roundPhase?.phase_started_at,
    input.liveState?.updated_at,
    input.roundPhase?.updated_at,
    input.controllerLease?.updated_at
  );

export interface RuntimeHealthAssessment {
  execution_state: ExecutionState;
  controller_status: ControllerLeaseArtifact["status"];
  phase_status?: ControllerPhaseStatus;
  heartbeat_at?: string;
  heartbeat_age_ms?: number;
  progress_at?: string;
  progress_age_ms?: number;
  transport_event_at?: string;
  transport_event_age_ms?: number;
  phase_timeout_ms?: number;
  stall_threshold_ms: number;
  heartbeat_stale: boolean;
  progress_stale: boolean;
  transport_stale: boolean;
  terminal: boolean;
  should_restart: boolean;
  summary: string;
}

export const assessRuntimeHealth = (input: {
  liveState?: RuntimeLiveStateArtifact;
  roundPhase?: RuntimeRoundPhaseArtifact;
  controllerLease?: ControllerLeaseArtifact;
  transportState?: TransportStateArtifact;
  now?: number;
  heartbeatStaleMs?: number;
  transportEventStaleMs?: number;
  stallThresholdMs?: number;
}): RuntimeHealthAssessment => {
  const now = input.now ?? Date.now();
  const phaseTimeoutMs = firstDefined(
    input.liveState?.phase_timeout_ms,
    input.roundPhase?.phase_timeout_ms
  );
  const stallThresholdMs =
    input.stallThresholdMs ??
    firstDefined(
      input.liveState?.stall_threshold_ms,
      input.roundPhase?.stall_threshold_ms
    ) ??
    phaseBudgetToStallThresholdMs(phaseTimeoutMs);
  const heartbeatAt = heartbeatTimestampForRuntime(input);
  const progressAt = progressTimestampForRuntime(input);
  const transportEventAt = input.transportState?.app_server?.last_event_at;
  const heartbeatAgeMs = ageFor(heartbeatAt, now);
  const progressAgeMs = ageFor(progressAt, now);
  const transportEventAgeMs = ageFor(transportEventAt, now);
  const heartbeatStale =
    heartbeatAgeMs !== undefined &&
    heartbeatAgeMs >
      (input.heartbeatStaleMs ?? defaultHeartbeatStaleMs);
  const progressStale =
    progressAgeMs !== undefined && progressAgeMs > stallThresholdMs;
  const transportStale =
    transportEventAgeMs !== undefined &&
    transportEventAgeMs >
      (input.transportEventStaleMs ?? defaultTransportEventStaleMs);
  const liveExecutionState = input.liveState?.execution_state;
  const stopReason = input.liveState?.stop_reason;
  const phaseStatus = input.roundPhase?.status ?? input.liveState?.active_phase_status;
  const paused =
    liveExecutionState === "paused" ||
    input.controllerLease?.status === "paused" ||
    phaseStatus === "awaiting_input" ||
    (stopReason !== undefined && pausedStopReasons.has(stopReason));
  const terminal =
    stopReason !== undefined &&
    !pausedStopReasons.has(stopReason);

  let executionState: ExecutionState;
  if (terminal || liveExecutionState === "completed") {
    executionState = "completed";
  } else if (
    liveExecutionState === "failed" ||
    input.controllerLease?.status === "failed"
  ) {
    executionState = "failed";
  } else if (
    liveExecutionState === "stalled" ||
    input.controllerLease?.status === "stalled" ||
    phaseStatus === "stalled" ||
    (!paused && (progressStale || heartbeatStale))
  ) {
    executionState = "stalled";
  } else if (paused) {
    executionState = "paused";
  } else {
    executionState = "running";
  }

  const controllerStatus: ControllerLeaseArtifact["status"] =
    executionState === "completed"
      ? input.controllerLease?.status === "stopped"
        ? "stopped"
        : "stopped"
      : executionState === "paused"
        ? "paused"
        : executionState === "stalled"
          ? "stalled"
          : executionState === "failed"
            ? "failed"
            : "running";

  const summary =
    executionState === "stalled"
      ? `No recorded progress for ${Math.round(
          (progressAgeMs ?? 0) / 1000
        )}s while the controller heartbeat stayed ${
          heartbeatStale ? "stale" : "fresh"
        }.`
      : executionState === "paused"
        ? `Run is paused${
            stopReason ? ` (${stopReason}).` : "."
          }`
        : executionState === "completed"
          ? `Run finished${stopReason ? ` with ${stopReason}.` : "."}`
          : executionState === "failed"
            ? "Controller reported a failed runtime state."
            : "Runtime is progressing.";

  return {
    execution_state: executionState,
    controller_status: controllerStatus,
    ...(phaseStatus ? { phase_status: phaseStatus } : {}),
    ...(heartbeatAt ? { heartbeat_at: heartbeatAt } : {}),
    ...(heartbeatAgeMs !== undefined ? { heartbeat_age_ms: heartbeatAgeMs } : {}),
    ...(progressAt ? { progress_at: progressAt } : {}),
    ...(progressAgeMs !== undefined ? { progress_age_ms: progressAgeMs } : {}),
    ...(transportEventAt ? { transport_event_at: transportEventAt } : {}),
    ...(transportEventAgeMs !== undefined
      ? { transport_event_age_ms: transportEventAgeMs }
      : {}),
    ...(phaseTimeoutMs !== undefined ? { phase_timeout_ms: phaseTimeoutMs } : {}),
    stall_threshold_ms: stallThresholdMs,
    heartbeat_stale: heartbeatStale,
    progress_stale: progressStale,
    transport_stale: transportStale,
    terminal,
    should_restart:
      !terminal &&
      !paused &&
      (executionState === "stalled" || executionState === "failed"),
    summary
  };
};
