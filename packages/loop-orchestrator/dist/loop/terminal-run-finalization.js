import { writeRunCodexHandoff } from "../codex-handoff.js";
import { writeJson } from "../file-system.js";
import { defaultIdeaPath } from "../idea-intake.js";
import { buildCheckpointSummary } from "./checkpoints.js";
import { writeRunCheckpoint } from "./run-checkpoint.js";
import { currentBestForRunCheckpoint } from "./run-summary-finalization.js";
import { buildFinalRuntimeEventsForRun } from "./run-runtime-events.js";
import { normalizeRuntimeWarnings } from "./runtime-events.js";
import { isResumeNoopTerminalStopReason } from "./stop-reasons.js";
export const finalizeTerminalRun = async (input) => {
    const terminalRoundSummary = input.history[input.history.length - 1];
    const terminalRound = terminalRoundSummary?.round ?? input.bestRound;
    const terminalTotalScore = terminalRoundSummary?.total_score ?? input.bestScore ?? 0;
    const terminalThresholdResults = terminalRoundSummary?.threshold_results ?? input.bestThresholdResults;
    const finalRuntimeEvents = buildFinalRuntimeEventsForRun({
        currentRuntimeEvents: input.currentRuntimeEvents,
        restored: input.restored,
        forceReopenTerminal: input.forceReopenTerminal,
        resumeNoopTerminal: isResumeNoopTerminalStopReason(input.restoredStopReason),
        restoredStopReason: input.restoredStopReason,
        runId: input.runId
    });
    const runtimeWarnings = normalizeRuntimeWarnings([
        ...input.runtimeWarnings,
        ...finalRuntimeEvents.map((event) => event.message)
    ]);
    const resumeDecisionArtifact = input.resumeDecisionPath
        ? {
            run_id: input.runId,
            decided_at: new Date().toISOString(),
            decision: input.forceReopenTerminal &&
                isResumeNoopTerminalStopReason(input.restoredStopReason)
                ? "reopened_terminal"
                : "continue",
            previous_stop_reason: input.restoredStopReason,
            force_reopen_terminal: input.forceReopenTerminal,
            allow_resume_migration: input.allowResumeMigration,
            mismatches: input.resumeIdentityMismatches,
            runtime_event_codes: finalRuntimeEvents.map((event) => event.code)
        }
        : undefined;
    const summary = buildCheckpointSummary({
        runId: input.runId,
        scenarioId: input.scenario.scenario_id,
        rubricId: input.hydratedRubric.rubric_id,
        controllerMode: input.controllerMode,
        transportMode: input.transportMode,
        executorMode: input.executorMode,
        targetFamily: input.targetFamily,
        validationLane: input.validationLane,
        evaluatorProfilePath: input.evaluatorProfilePath,
        adapterContractSha256: input.currentResumeIdentity.adapter_contract_sha256,
        evaluatorBundleSha256: input.currentResumeIdentity.evaluator_bundle_sha256,
        rubricSha256: input.currentResumeIdentity.rubric_sha256,
        plannerBriefPath: input.plannerBriefPath,
        plannedScenarioPath: input.plannedScenarioPath,
        planPath: input.planPath,
        ideaPath: defaultIdeaPath,
        featureListPath: input.durableMemoryPaths.feature_list_path,
        progressPath: input.durableMemoryPaths.progress_path,
        progressLogPath: input.durableMemoryPaths.progress_log_path,
        doneWhenPath: input.durableMemoryPaths.done_when_path,
        initScriptPath: input.durableMemoryPaths.init_script_path,
        adapterContractPath: input.loadedAdapter?.contract_path,
        adapterId: input.loadedAdapter?.contract.adapter_id,
        verificationProviderId: input.loadedAdapter?.contract.verification_provider?.provider_id,
        adapterAttached: Boolean(input.loadedAdapter),
        codexSessionRegistryPath: input.codexSessionRegistryPath,
        resumeIdentityPath: input.currentResumeIdentityPath,
        runtimeLiveStatePath: input.runtimeStatePaths.liveStatePath,
        runtimeRoundPhasePath: input.runtimeStatePaths.roundPhasePath,
        controllerLeasePath: input.runtimeStatePaths.controllerLeasePath,
        transportStatePath: input.runtimeStatePaths.transportStatePath,
        transportProtocolPath: input.transportProtocolCurrentPath,
        operatorSurfacePath: input.runtimeStatePaths.operatorSurfacePath,
        sessionStatusPath: input.runtimeStatePaths.sessionStatusPath,
        sessionStatusEventsPath: input.runtimeStatePaths.sessionStatusEventsPath,
        sessionStreamPath: input.runtimeStatePaths.sessionStreamPath,
        stopReason: input.finalStopReason ?? input.resolvedStopReason,
        bestRound: input.bestRound,
        bestScore: input.bestScore ?? terminalTotalScore,
        bestControlPlaneScore: input.bestControlPlaneScore,
        bestProofScore: input.bestProofScore,
        bestReleaseScore: input.bestReleaseScore,
        bestThresholdResults: input.bestThresholdResults ?? terminalThresholdResults,
        bestDimensionScores: input.bestDimensionScores,
        history: input.history,
        runtimeEvents: finalRuntimeEvents,
        runtimeWarnings,
        resumeMigrationPath: input.resumeMigrationPath,
        previousBundleFingerprint: input.previousBundleFingerprint,
        newBundleFingerprint: input.newBundleFingerprint,
        adapterMigrationAppliedPath: input.latestAdapterMigrationAppliedPath,
        resumeDecisionPath: input.resumeDecisionPath,
        resumedFromRunId: input.restored ? input.runId : undefined
    });
    if (input.evaluationPolicyPath) {
        summary.evaluation_policy_path = input.evaluationPolicyPath;
    }
    await input.withPhaseBudget("run_finalize", async () => {
        await input.recordRoundPhase({
            round: terminalRound ?? 0,
            phase: "run_finalize",
            status: "in_progress",
            artifacts: { summary_path: input.summaryPath }
        });
        const codexHandoffPath = await writeRunCodexHandoff({
            runDirectory: input.runDirectory,
            summary,
            plan: input.plan,
            scenario: input.scenario
        });
        summary.codex_handoff_path = codexHandoffPath;
        await Promise.all([
            writeJson(input.currentResumeIdentityPath, input.currentResumeIdentity),
            ...(resumeDecisionArtifact && input.resumeDecisionPath
                ? [writeJson(input.resumeDecisionPath, resumeDecisionArtifact)]
                : [])
        ]);
        await writeRunCheckpoint({
            runDirectory: input.runDirectory,
            summary,
            currentBest: currentBestForRunCheckpoint({
                history: input.history,
                bestRound: input.bestRound,
                bestScore: input.bestScore,
                bestControlPlaneScore: input.bestControlPlaneScore,
                bestProofScore: input.bestProofScore,
                bestReleaseScore: input.bestReleaseScore,
                bestThresholdResults: input.bestThresholdResults,
                bestDimensionScores: input.bestDimensionScores,
                bestPatchRequestPath: input.bestPatchRequestPath,
                bestEvalReportPath: input.bestEvalReportPath,
                bestScoringTotalScoreFallback: 0
            })
        });
        await input.markProgress(`Final run artifacts saved for ${input.runId}.`);
        input.replaceHeartbeatNotes();
        input.setExecutionState("completed");
        input.updateSessionRefreshState({
            currentObjective: terminalRoundSummary?.objective ?? input.sessionCurrentObjective,
            latestRound: terminalRound,
            latestStopReason: summary.stop_reason
        });
        await input.refreshSessionPreparationArtifacts({
            stopReason: summary.stop_reason,
            executionState: "completed"
        });
        await input.recordRoundPhase({
            round: terminalRound ?? 0,
            phase: "run_finalize",
            status: "completed",
            artifacts: {
                summary_path: input.summaryPath,
                codex_handoff_path: codexHandoffPath
            }
        });
    });
    return {
        plan: input.plan,
        summary,
        runDirectory: input.runDirectory,
        plannedScenarioPath: input.plannedScenarioPath
    };
};
//# sourceMappingURL=terminal-run-finalization.js.map