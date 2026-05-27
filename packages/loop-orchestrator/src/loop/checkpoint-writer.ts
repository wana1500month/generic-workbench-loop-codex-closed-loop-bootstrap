import { join } from "node:path";

import { writeJson, pathExists, writeText } from "../file-system.js";
import type {
  ControllerMode,
  ExecutorMode,
  LoadedAdapterContract,
  LoopRubric,
  LoopRunSummary,
  ReleaseThresholdResults,
  RoundSummary,
  TargetFamily,
  TransportMode,
  RuntimeEvent,
  ValidationLane
} from "../types.js";
import { buildCheckpointSummary } from "./checkpoints.js";
import { crashAfterCheckpointEnabled } from "./round-files.js";
import { writeRunCheckpoint } from "./run-checkpoint.js";
import {
  currentBestForRunCheckpoint,
  type RunCheckpointCurrentBest
} from "./run-summary-finalization.js";

export const writeLoopCheckpointSnapshot = async (input: {
  runId: string;
  runDirectory: string;
  scenarioId: string;
  rubric: LoopRubric;
  controllerMode: ControllerMode;
  transportMode: TransportMode;
  executorMode: ExecutorMode;
  targetFamily?: TargetFamily;
  validationLane?: ValidationLane;
  evaluatorProfilePath?: string;
  adapterContractSha256?: string;
  evaluatorBundleSha256?: string;
  rubricSha256?: string;
  plannerBriefPath: string;
  plannedScenarioPath: string;
  planPath: string;
  ideaPath: string;
  featureListPath: string;
  progressPath: string;
  progressLogPath: string;
  doneWhenPath: string;
  initScriptPath: string;
  loadedAdapter?: LoadedAdapterContract;
  codexSessionRegistryPath: string;
  currentResumeIdentityPath: string;
  runtimeDirectory: string;
  runtimeLiveStatePath: string;
  runtimeRoundPhasePath: string;
  controllerLeasePath: string;
  transportStatePath: string;
  transportProtocolPath?: string;
  operatorSurfacePath: string;
  sessionStatusPath: string;
  sessionStatusEventsPath: string;
  sessionStreamPath: string;
  stopReason?: LoopRunSummary["stop_reason"];
  bestRound?: number;
  bestScore?: number;
  bestControlPlaneScore: number;
  bestProofScore: number;
  bestReleaseScore: number;
  bestThresholdResults?: ReleaseThresholdResults;
  bestDimensionScores: LoopRunSummary["dimension_scores"];
  history: RoundSummary[];
  runtimeEvents: RuntimeEvent[];
  runtimeWarnings: string[];
  resumeMigrationPath?: string;
  previousBundleFingerprint?: string;
  newBundleFingerprint?: string;
  adapterMigrationAppliedPath?: string;
  resumedFromRunId?: string;
  currentResumeIdentity: unknown;
  currentBest?: RunCheckpointCurrentBest;
  bestPatchRequestPath?: string;
  bestEvalReportPath?: string;
}): Promise<LoopRunSummary> => {
  const summary = buildCheckpointSummary({
    runId: input.runId,
    scenarioId: input.scenarioId,
    rubricId: input.rubric.rubric_id,
    controllerMode: input.controllerMode,
    transportMode: input.transportMode,
    executorMode: input.executorMode,
    targetFamily: input.targetFamily,
    validationLane: input.validationLane,
    evaluatorProfilePath: input.evaluatorProfilePath,
    adapterContractSha256: input.adapterContractSha256,
    evaluatorBundleSha256: input.evaluatorBundleSha256,
    rubricSha256: input.rubricSha256,
    plannerBriefPath: input.plannerBriefPath,
    plannedScenarioPath: input.plannedScenarioPath,
    planPath: input.planPath,
    ideaPath: input.ideaPath,
    featureListPath: input.featureListPath,
    progressPath: input.progressPath,
    progressLogPath: input.progressLogPath,
    doneWhenPath: input.doneWhenPath,
    initScriptPath: input.initScriptPath,
    adapterContractPath: input.loadedAdapter?.contract_path,
    adapterId: input.loadedAdapter?.contract.adapter_id,
    verificationProviderId:
      input.loadedAdapter?.contract.verification_provider?.provider_id,
    adapterAttached: Boolean(input.loadedAdapter),
    codexSessionRegistryPath: input.codexSessionRegistryPath,
    resumeIdentityPath: input.currentResumeIdentityPath,
    runtimeLiveStatePath: input.runtimeLiveStatePath,
    runtimeRoundPhasePath: input.runtimeRoundPhasePath,
    controllerLeasePath: input.controllerLeasePath,
    transportStatePath: input.transportStatePath,
    transportProtocolPath: input.transportProtocolPath,
    operatorSurfacePath: input.operatorSurfacePath,
    sessionStatusPath: input.sessionStatusPath,
    sessionStatusEventsPath: input.sessionStatusEventsPath,
    sessionStreamPath: input.sessionStreamPath,
    stopReason: input.stopReason,
    bestRound: input.bestRound,
    bestScore: input.bestScore,
    bestControlPlaneScore: input.bestControlPlaneScore,
    bestProofScore: input.bestProofScore,
    bestReleaseScore: input.bestReleaseScore,
    bestThresholdResults: input.bestThresholdResults,
    bestDimensionScores: input.bestDimensionScores,
    history: input.history,
    runtimeEvents: input.runtimeEvents,
    runtimeWarnings: input.runtimeWarnings,
    resumeMigrationPath: input.resumeMigrationPath,
    previousBundleFingerprint: input.previousBundleFingerprint,
    newBundleFingerprint: input.newBundleFingerprint,
    adapterMigrationAppliedPath: input.adapterMigrationAppliedPath,
    resumeDecisionPath: undefined,
    resumedFromRunId: input.resumedFromRunId
  });

  await Promise.all([
    writeJson(input.currentResumeIdentityPath, input.currentResumeIdentity),
    writeRunCheckpoint({
      runDirectory: input.runDirectory,
      summary,
      currentBest:
        input.currentBest ??
        currentBestForRunCheckpoint({
          history: input.history,
          bestRound: input.bestRound,
          bestScore: input.bestScore,
          bestControlPlaneScore: input.bestControlPlaneScore,
          bestProofScore: input.bestProofScore,
          bestReleaseScore: input.bestReleaseScore,
          bestThresholdResults: input.bestThresholdResults,
          bestDimensionScores: input.bestDimensionScores,
          bestPatchRequestPath: input.bestPatchRequestPath,
          bestEvalReportPath: input.bestEvalReportPath
        })
    })
  ]);

  if (crashAfterCheckpointEnabled() && input.history.length > 0) {
    const latestRound = input.history[input.history.length - 1]?.round ?? 0;
    const crashMarkerPath = join(
      input.runtimeDirectory,
      "test-crash-after-checkpoint.marker"
    );
    if (!(await pathExists(crashMarkerPath))) {
      await writeText(
        crashMarkerPath,
        `Triggered after round ${latestRound}.\n`
      );
      throw new Error(
        `HARNESS_TEST_CRASH_AFTER_CHECKPOINT_ONCE triggered after round ${latestRound}.`
      );
    }
  }
  return summary;
};
