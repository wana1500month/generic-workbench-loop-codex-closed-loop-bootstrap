import { dirname, join } from "node:path";

import { writeRunControllerSummary } from "../agent-handoff.js";
import { writeRunCodexHandoff } from "../codex-handoff.js";
import { detectDurableMemoryPaths } from "../durable-memory.js";
import { writeJson } from "../file-system.js";
import { defaultIdeaPath } from "../idea-intake.js";
import { writeTransportProtocol } from "../transport-protocol.js";
import type {
  ClosedLoopResult,
  ControllerMode,
  ControllerRoundPhase,
  ExecutorMode,
  LoadedAdapterContract,
  LoopRunSummary,
  ResumeDecisionArtifact,
  RuntimeEvent,
  TransportMode,
  ValidationLane
} from "../types.js";
import type { RestoredRunState } from "../resume-state.js";
import type { ResumeIdentityState } from "../resume-identity.js";
import { buildRuntimeEvent, mergeRuntimeEvents } from "./runtime-events.js";

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

export interface FinalizeNoopTerminalResumeInput {
  runId: string;
  runDirectory: string;
  restoredRun: RestoredRunState;
  restoredStopReason: LoopRunSummary["stop_reason"] | undefined;
  controllerMode: ControllerMode;
  transportMode: TransportMode;
  executorMode: ExecutorMode;
  runtimeStatePaths: {
    transportStatePath: string;
    roundPhasePath: string;
    liveStatePath: string;
    controllerLeasePath: string;
    sessionStatusPath: string;
    sessionStatusEventsPath: string;
    sessionStreamPath: string;
  };
  currentResumeIdentityPath: string;
  currentResumeIdentity: ResumeIdentityState;
  currentRuntimeEvents: RuntimeEvent[];
  previousPersistentWarnings: string[];
  bundleRuntimeWarnings?: string[];
  adapterRuntimeWarnings?: string[];
  resumeDecisionPath?: string;
  resumeIdentityMismatches: string[];
  forceReopenTerminal: boolean;
  allowResumeMigration: boolean;
  resumePhase?: ControllerRoundPhase;
  resolvedTargetFamily?: LoopRunSummary["target_family"];
  resolvedValidationLane?: ValidationLane;
  evaluatorProfilePath?: string;
  loadedAdapter?: LoadedAdapterContract;
}

export const finalizeNoopTerminalResume = async (
  input: FinalizeNoopTerminalResumeInput
): Promise<ClosedLoopResult> => {
  if (!input.restoredRun.plan || !input.restoredRun.scenario) {
    throw new Error("Cannot finalize noop terminal resume without restored plan and scenario.");
  }
  const plan = input.restoredRun.plan;
  const scenario = input.restoredRun.scenario;
  const transportProtocolPath = await writeTransportProtocol({
    runDirectory: input.runDirectory,
    transportMode: input.transportMode,
    summary: {
      run_id: input.runId,
      controller_mode: input.controllerMode,
      transport_mode: input.transportMode,
      transport_state_path: input.runtimeStatePaths.transportStatePath,
      resume_identity_path: input.currentResumeIdentityPath,
      runtime_round_phase_path: input.runtimeStatePaths.roundPhasePath
    },
    activeRound: input.restoredRun.interruptedRound?.round,
    activePhase:
      input.resumePhase ?? input.restoredRun.interruptedRound?.resumeFromPhase,
    activeStatus: input.restoredRun.interruptedRound?.phaseStatus,
    latestPatchRequestPath: input.restoredRun.previousPatchRequestPath,
    latestRoundContractPath: input.restoredRun.latestRoundSummary?.contract_path,
    notes: [
      ...input.restoredRun.repairNotes,
      ...(input.transportMode === "current-thread"
        ? [
            "Keep the current thread as the generator/controller surface. $loop-control owns the same-thread autocontinue chain; use $attached-loop only if this foreground thread needs recovery after interruption."
          ]
        : [])
    ]
  });
  const noopRuntimeEvents = mergeRuntimeEvents([
    ...input.currentRuntimeEvents,
    buildRuntimeEvent(
      "resume.noop_terminal",
      `Run '${input.runId}' already ended with terminal stop reason '${input.restoredStopReason}'. Resume returned without opening a new round. Re-run with --force-reopen-terminal to override this default.`,
      {
        stop_reason: input.restoredStopReason ?? null,
        resumed_run_id: input.runId
      }
    )
  ]);
  const runtimeWarnings = unique([
    ...input.previousPersistentWarnings,
    ...(input.bundleRuntimeWarnings ?? []),
    ...(input.adapterRuntimeWarnings ?? []),
    ...noopRuntimeEvents.map((event) => event.message)
  ]);
  const resumeDecisionArtifact: ResumeDecisionArtifact | undefined =
    input.resumeDecisionPath
      ? {
          run_id: input.runId,
          decided_at: new Date().toISOString(),
          decision: "noop_terminal",
          previous_stop_reason: input.restoredStopReason,
          force_reopen_terminal: input.forceReopenTerminal,
          allow_resume_migration: input.allowResumeMigration,
          mismatches: input.resumeIdentityMismatches,
          runtime_event_codes: noopRuntimeEvents.map((event) => event.code)
        }
      : undefined;
  const summary: LoopRunSummary = {
    ...input.restoredRun.summary,
    controller_mode: input.controllerMode,
    transport_mode: input.transportMode,
    executor_mode: input.executorMode,
    ...(input.resolvedTargetFamily
      ? { target_family: input.resolvedTargetFamily }
      : {}),
    ...(input.resolvedValidationLane
      ? { validation_lane: input.resolvedValidationLane }
      : {}),
    ...(input.evaluatorProfilePath
      ? { evaluator_profile_path: input.evaluatorProfilePath }
      : {}),
    ...(input.currentResumeIdentity.adapter_contract_sha256
      ? {
          adapter_contract_sha256:
            input.currentResumeIdentity.adapter_contract_sha256
        }
      : {}),
    ...(input.currentResumeIdentity.evaluator_bundle_sha256
      ? {
          evaluator_bundle_sha256:
            input.currentResumeIdentity.evaluator_bundle_sha256
        }
      : {}),
    ...(input.currentResumeIdentity.rubric_sha256
      ? { rubric_sha256: input.currentResumeIdentity.rubric_sha256 }
      : {}),
    planner_brief_path: input.restoredRun.plannerBriefPath,
    planned_scenario_path: input.restoredRun.plannedScenarioPath,
    plan_path: input.restoredRun.planPath,
    ...(await detectDurableMemoryPaths(
      dirname(input.restoredRun.summary.idea_path ?? defaultIdeaPath)
    )),
    codex_handoff_path: undefined,
    adapter_contract_path:
      input.loadedAdapter?.contract_path ??
      input.restoredRun.summary.adapter_contract_path,
    adapter_id:
      input.loadedAdapter?.contract.adapter_id ??
      input.restoredRun.summary.adapter_id,
    verification_provider_id:
      input.loadedAdapter?.contract.verification_provider?.provider_id ??
      input.restoredRun.summary.verification_provider_id,
    adapter_attached: Boolean(input.loadedAdapter),
    resume_identity_path: input.currentResumeIdentityPath,
    runtime_live_state_path: input.runtimeStatePaths.liveStatePath,
    runtime_round_phase_path: input.runtimeStatePaths.roundPhasePath,
    controller_lease_path: input.runtimeStatePaths.controllerLeasePath,
    transport_state_path: input.runtimeStatePaths.transportStatePath,
    transport_protocol_path: transportProtocolPath,
    session_status_path: input.runtimeStatePaths.sessionStatusPath,
    session_status_events_path: input.runtimeStatePaths.sessionStatusEventsPath,
    session_stream_path: input.runtimeStatePaths.sessionStreamPath,
    runtime_events: noopRuntimeEvents,
    ...(input.resumeDecisionPath
      ? { resume_decision_path: input.resumeDecisionPath }
      : {}),
    ...(runtimeWarnings.length > 0 ? { runtime_warnings: runtimeWarnings } : {}),
    resumed_from_run_id: input.runId
  };
  const codexHandoffPath = await writeRunCodexHandoff({
    runDirectory: input.runDirectory,
    summary,
    plan,
    scenario
  });
  summary.codex_handoff_path = codexHandoffPath;
  await Promise.all([
    writeJson(input.currentResumeIdentityPath, input.currentResumeIdentity),
    ...(resumeDecisionArtifact && input.resumeDecisionPath
      ? [writeJson(input.resumeDecisionPath, resumeDecisionArtifact)]
      : []),
    writeJson(join(input.runDirectory, "summary.json"), summary),
    writeRunControllerSummary({
      runDirectory: input.runDirectory,
      summary
    })
  ]);
  return {
    plan,
    summary,
    runDirectory: input.runDirectory,
    plannedScenarioPath: input.restoredRun.plannedScenarioPath
  };
};
