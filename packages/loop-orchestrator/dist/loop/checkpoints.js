import { controllerPhaseOrder } from "./phase-timeouts.js";
export const controllerPhaseIndex = (phase) => controllerPhaseOrder.indexOf(phase);
const pausedPhaseStatuses = new Set([
    "awaiting_input",
    "awaiting_codex_work",
    "awaiting_human_input",
    "awaiting_external_condition"
]);
export const isPausedPhaseStatus = (status) => Boolean(status && pausedPhaseStatuses.has(status));
export const isCodexCheckpointPhaseStatus = (status) => status === "awaiting_codex_work" || status === "awaiting_input";
export const phaseCompletedAtOrBeyond = (resumeState, targetPhase) => {
    if (!resumeState) {
        return false;
    }
    const currentIndex = controllerPhaseIndex(resumeState.phase);
    const targetIndex = controllerPhaseIndex(targetPhase);
    if (currentIndex > targetIndex) {
        return true;
    }
    return currentIndex === targetIndex && resumeState.status === "completed";
};
export const buildCheckpointSummary = (input) => {
    const latestRoundSummary = input.history[input.history.length - 1];
    const terminalRound = latestRoundSummary?.round ?? input.bestRound;
    const terminalTotalScore = latestRoundSummary?.total_score ?? input.bestScore ?? 0;
    const terminalControlPlaneScore = latestRoundSummary?.control_plane_score ?? input.bestControlPlaneScore ?? 0;
    const terminalProofScore = latestRoundSummary?.proof_score ?? input.bestProofScore ?? 0;
    const terminalReleaseScore = latestRoundSummary?.release_score ?? input.bestReleaseScore ?? 0;
    const terminalThresholdResults = latestRoundSummary?.threshold_results ?? input.bestThresholdResults;
    const terminalDimensionScores = latestRoundSummary?.dimension_scores ?? input.bestDimensionScores;
    return {
        run_id: input.runId,
        round_count: input.history.length,
        scenario_id: input.scenarioId,
        rubric_id: input.rubricId,
        controller_mode: input.controllerMode,
        transport_mode: input.transportMode,
        ...(input.executorMode ? { executor_mode: input.executorMode } : {}),
        ...(input.targetFamily ? { target_family: input.targetFamily } : {}),
        ...(input.validationLane ? { validation_lane: input.validationLane } : {}),
        ...(input.evaluatorProfilePath
            ? { evaluator_profile_path: input.evaluatorProfilePath }
            : {}),
        ...(input.adapterContractSha256
            ? { adapter_contract_sha256: input.adapterContractSha256 }
            : {}),
        ...(input.evaluatorBundleSha256
            ? { evaluator_bundle_sha256: input.evaluatorBundleSha256 }
            : {}),
        ...(input.rubricSha256 ? { rubric_sha256: input.rubricSha256 } : {}),
        total_score: terminalTotalScore,
        control_plane_score: terminalControlPlaneScore,
        proof_score: terminalProofScore,
        release_score: terminalReleaseScore,
        ...(input.plannerBriefPath ? { planner_brief_path: input.plannerBriefPath } : {}),
        ...(input.ideaPath ? { idea_path: input.ideaPath } : {}),
        ...(input.featureListPath ? { feature_list_path: input.featureListPath } : {}),
        ...(input.progressPath ? { progress_path: input.progressPath } : {}),
        ...(input.progressLogPath ? { progress_log_path: input.progressLogPath } : {}),
        ...(input.doneWhenPath ? { done_when_path: input.doneWhenPath } : {}),
        ...(input.initScriptPath ? { init_script_path: input.initScriptPath } : {}),
        ...(input.plannedScenarioPath
            ? { planned_scenario_path: input.plannedScenarioPath }
            : {}),
        ...(input.planPath ? { plan_path: input.planPath } : {}),
        ...(input.adapterContractPath
            ? { adapter_contract_path: input.adapterContractPath }
            : {}),
        ...(input.adapterId ? { adapter_id: input.adapterId } : {}),
        ...(input.verificationProviderId
            ? { verification_provider_id: input.verificationProviderId }
            : {}),
        adapter_attached: input.adapterAttached,
        ...(input.codexSessionRegistryPath
            ? { codex_session_registry_path: input.codexSessionRegistryPath }
            : {}),
        ...(input.resumeIdentityPath
            ? { resume_identity_path: input.resumeIdentityPath }
            : {}),
        runtime_live_state_path: input.runtimeLiveStatePath,
        runtime_round_phase_path: input.runtimeRoundPhasePath,
        controller_lease_path: input.controllerLeasePath,
        transport_state_path: input.transportStatePath,
        ...(input.transportProtocolPath
            ? { transport_protocol_path: input.transportProtocolPath }
            : {}),
        ...(input.operatorSurfacePath
            ? { operator_surface_path: input.operatorSurfacePath }
            : {}),
        ...(input.sessionStatusPath
            ? { session_status_path: input.sessionStatusPath }
            : {}),
        ...(input.sessionStatusEventsPath
            ? { session_status_events_path: input.sessionStatusEventsPath }
            : {}),
        ...(input.sessionStreamPath
            ? { session_stream_path: input.sessionStreamPath }
            : {}),
        ...(input.adapterMigrationAppliedPath
            ? { adapter_migration_applied_path: input.adapterMigrationAppliedPath }
            : {}),
        ...(input.stopReason ? { stop_reason: input.stopReason } : {}),
        ...(terminalRound !== undefined
            ? {
                selection_basis: "terminal_round",
                terminal_round: terminalRound
            }
            : {}),
        ...(input.bestRound !== undefined ? { best_round: input.bestRound } : {}),
        ...(terminalThresholdResults
            ? { threshold_results: terminalThresholdResults }
            : {}),
        ...(terminalDimensionScores ? { dimension_scores: terminalDimensionScores } : {}),
        ...(input.bestScore !== undefined
            ? { best_scoring_total_score: input.bestScore }
            : {}),
        ...(input.bestControlPlaneScore !== undefined
            ? { best_scoring_control_plane_score: input.bestControlPlaneScore }
            : {}),
        ...(input.bestProofScore !== undefined
            ? { best_scoring_proof_score: input.bestProofScore }
            : {}),
        ...(input.bestReleaseScore !== undefined
            ? { best_scoring_release_score: input.bestReleaseScore }
            : {}),
        ...(input.bestThresholdResults
            ? { best_scoring_threshold_results: input.bestThresholdResults }
            : {}),
        round_history: input.history,
        ...(input.runtimeEvents.length > 0 ? { runtime_events: input.runtimeEvents } : {}),
        ...(input.runtimeWarnings.length > 0
            ? { runtime_warnings: input.runtimeWarnings }
            : {}),
        ...(input.resumeMigrationPath
            ? {
                bundle_migrated: true,
                previous_bundle_fingerprint: input.previousBundleFingerprint,
                new_bundle_fingerprint: input.newBundleFingerprint,
                resume_migration_path: input.resumeMigrationPath
            }
            : {}),
        ...(input.resumeDecisionPath
            ? { resume_decision_path: input.resumeDecisionPath }
            : {}),
        ...(input.resumedFromRunId ? { resumed_from_run_id: input.resumedFromRunId } : {})
    };
};
//# sourceMappingURL=checkpoints.js.map