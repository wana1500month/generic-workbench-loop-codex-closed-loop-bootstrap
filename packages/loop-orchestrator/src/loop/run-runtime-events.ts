import type { RuntimeEvent, ValidationLane } from "../types.js";
import {
  buildRuntimeEvent,
  ephemeralRuntimeEventCodes,
  mergeRuntimeEvents
} from "./runtime-events.js";

type RestoredRunRuntimeEventSource = {
  summary: {
    runtime_events?: RuntimeEvent[];
    runtime_warnings?: string[];
    round_history?: readonly unknown[];
  };
  summaryWasRecovered?: boolean;
  interruptedRound?: {
    round: number;
    resumeFromPhase: string;
  };
  initializationIncomplete?: boolean;
  initializationMissingArtifacts?: string[];
};

export const persistentWarningsFromRestoredRun = (
  restoredRun: RestoredRunRuntimeEventSource | undefined
): string[] => {
  const previousEphemeralEventMessages = new Set(
    (restoredRun?.summary.runtime_events ?? [])
      .filter((event) => ephemeralRuntimeEventCodes.has(event.code))
      .map((event) => event.message)
  );
  return (restoredRun?.summary.runtime_warnings ?? []).filter(
    (warning) => !previousEphemeralEventMessages.has(warning)
  );
};

export const buildInitialRuntimeEventsForRun = (input: {
  restoredRun?: RestoredRunRuntimeEventSource;
  loadedAdapterAttached: boolean;
  resolvedValidationLane?: ValidationLane;
  resolvedTargetFamily?: string;
  resumeMigrationPath?: string;
  adapterMigrationAuthorized: boolean;
  runId: string;
  resumeIdentityMismatches: string[];
  resumeRunPath?: string;
  resumePhase?: string;
}): RuntimeEvent[] =>
  mergeRuntimeEvents([
    ...((input.restoredRun?.summary.runtime_events ?? []).filter(
      (event) => !ephemeralRuntimeEventCodes.has(event.code)
    ) ?? []),
    ...(input.loadedAdapterAttached &&
    input.resolvedValidationLane === "environment_integration"
      ? [
          buildRuntimeEvent(
            "validation.environment_lane_hint",
            `Validation lane '${input.resolvedValidationLane}' depends on the local environment. Browser or fullstack probe failures may reflect sandbox or administrator policy, not only product defects.`,
            {
              validation_lane: input.resolvedValidationLane,
              target_family: input.resolvedTargetFamily ?? null
            }
          )
        ]
      : []),
    ...(input.resumeMigrationPath
      ? [
          buildRuntimeEvent(
            "resume.migration_override",
            input.adapterMigrationAuthorized
              ? `Approved adapter migration was accepted automatically for run '${input.runId}'. This run now records the adapter identity migration without a manual override.`
              : `Resume identity migration override was accepted for run '${input.runId}'. This run now records a bundle migration.`,
            {
              mismatch_count: input.resumeIdentityMismatches.length,
              resumed_run_id: input.runId,
              authorized_adapter_migration: Boolean(
                input.adapterMigrationAuthorized
              )
            }
          )
        ]
      : []),
    ...(input.resumeRunPath
      ? [
          buildRuntimeEvent(
            "run.resumed_from_history",
            `Resumed run '${input.runId}' from persisted controller history.`,
            { resumed_run_id: input.runId }
          )
        ]
      : []),
    ...(input.restoredRun?.summaryWasRecovered
      ? [
          buildRuntimeEvent(
            "resume.recovered_round_checkpoint",
            `Recovered committed round checkpoint(s) for run '${input.runId}' from round directories before continuing.`,
            {
              resumed_run_id: input.runId,
              recovered_round_count:
                input.restoredRun.summary.round_history?.length ?? 0
            }
          )
        ]
      : []),
    ...(input.restoredRun?.interruptedRound
      ? [
          buildRuntimeEvent(
            "resume.repaired_interrupted_round",
            `Detected interrupted round ${input.restoredRun.interruptedRound.round} at phase '${input.resumePhase ?? input.restoredRun.interruptedRound.resumeFromPhase}'. Resume will continue from the persisted runtime journal.`,
            {
              resumed_run_id: input.runId,
              round: input.restoredRun.interruptedRound.round,
              phase:
                input.resumePhase ??
                input.restoredRun.interruptedRound.resumeFromPhase
            }
          )
        ]
      : []),
    ...(input.restoredRun?.initializationIncomplete
      ? [
          buildRuntimeEvent(
            "resume.partial_init_rebuild",
            `Resume detected incomplete planning initialization for run '${input.runId}'. Missing planner artifacts will be rebuilt from IDEA and rubric before continuing.`,
            {
              resumed_run_id: input.runId,
              missing_artifact_count:
                input.restoredRun.initializationMissingArtifacts?.length ?? 0,
              missing_artifacts: (
                input.restoredRun.initializationMissingArtifacts ?? []
              ).join(", ")
            }
          )
        ]
      : [])
  ]);

export const buildFinalRuntimeEventsForRun = (input: {
  currentRuntimeEvents: RuntimeEvent[];
  restored: boolean;
  forceReopenTerminal: boolean;
  resumeNoopTerminal: boolean;
  restoredStopReason?: string;
  runId: string;
}): RuntimeEvent[] =>
  mergeRuntimeEvents([
    ...input.currentRuntimeEvents,
    ...(input.restored
      ? [
          buildRuntimeEvent(
            input.forceReopenTerminal && input.resumeNoopTerminal
              ? "resume.reopened_terminal"
              : "resume.continued",
            input.forceReopenTerminal && input.resumeNoopTerminal
              ? `Run '${input.runId}' reopened a terminal stop reason '${input.restoredStopReason}' because --force-reopen-terminal was supplied explicitly.`
              : `Resume for run '${input.runId}' continued by opening a new round.`,
            {
              stop_reason: input.restoredStopReason ?? null,
              resumed_run_id: input.runId
            }
          )
        ]
      : [])
  ]);
