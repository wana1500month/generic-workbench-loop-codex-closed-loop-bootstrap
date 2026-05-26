import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { buildActiveContractFrame, decideAttemptLifecycle, targetCheckIdsFromPatchRequest, unresolvedSignatureFor } from "./attempt-lifecycle.js";
import { writeRoundHandoffPlaceholders, writeRoundHandoff, writeRunControllerSummary, writeRunPlannerBrief } from "./agent-handoff.js";
import { enhanceContractReviewWithCodex, enhanceContractReviewWithAppServer, enhanceEvalReportWithCodex, enhanceEvalReportWithAppServer, enhanceGeneratorPlanWithCodex, enhanceGeneratorPlanWithAppServer, enhancePlanWithCodex, enhancePlanWithAppServer, experimentalExecutorRuntimeWarning } from "./codex-agents.js";
import { loadAdapterContract, restoreAdapterCapabilityExecutions, loadVerificationProfile } from "./adapter-runtime.js";
import { resolvedAdapterTargetRoot } from "./adapter-paths.js";
import { isAttachedGeneratorTransport, isBootstrapGeneratedAdapter, readAttachedGeneratorResponse, writeAttachedGeneratorTask } from "./attached-generator.js";
import { executeCoreVerificationProbes, restoreCoreVerificationProbeExecutions } from "./core-verifier.js";
import { writeRunCodexHandoff } from "./codex-handoff.js";
import { detectDurableMemoryPaths, ensureDurableMemoryArtifacts, loadDurableMemoryContext } from "./durable-memory.js";
import { loadJson, loadJsonIfExists, nextRunId, pathExists, repoRoot, resolveRunsDirectory, writeJson, writeText } from "./file-system.js";
import { attachedPreGeneratorBaselineWindowOpen, captureBootstrapGeneratedBaselineIfNeeded, describePrototypeBaselineSourceSemantics, hasValidPrototypeBaseline, loadPrototypeBaselineState, prototypeBaselineSourceSemanticsForPhase, prototypeBaselinePaths } from "./prototype-baseline.js";
import { defaultIdeaPath, readIdeaBrief } from "./idea-intake.js";
import { buildEvaluationPolicy, evaluationPolicyPathForRun, loadEvaluationPolicyForRun, writeEvaluationPolicyArtifacts, writeRoundScorecardArtifacts } from "./evaluation-policy.js";
import { applyEvaluationPolicyGate } from "./loop/evaluation-policy-gate.js";
import { defaultControllerMode, isControllerMode } from "./controller-mode.js";
import { defaultExecutorMode, isExecutorMode } from "./executor-mode.js";
import { buildTransportStateArtifact, defaultTransportModeForControllerMode, isCurrentThreadTransport, isTransportMode, transportRuntimeWarningsForMode, validateTransportMode } from "./transport-mode.js";
import { startAppServerTransport } from "./app-server-runtime.js";
import { buildPatchCarryForwardContract, buildSyntheticPatchCarryForwardAgreement, buildSyntheticPatchCarryForwardReview } from "./patch-carry-forward.js";
import { buildAttemptDirective, buildLoopPlan, buildRoundContract, buildScenarioFromIdea } from "./planner.js";
import { buildContractAgreementArtifact, buildContractReviewArtifact, buildEvalReport } from "./round-evaluator.js";
import { orderedAdapterExecutions, runAdapterCapabilities } from "./loop/adapter-executions.js";
import { buildCheckpointSummary, isCodexCheckpointPhaseStatus, isPausedPhaseStatus, phaseCompletedAtOrBeyond } from "./loop/checkpoints.js";
import { resolveEvaluatorBundleSelection } from "./loop/evaluator-bundle.js";
import { PhaseBudgetExceededError, parsePhaseTimeoutOverrides, parsePositiveTimeoutMs } from "./loop/phase-timeouts.js";
import { crashAfterCheckpointEnabled, ensureJsonFile, isImproved, roundDirectoryFor, writeRoundSummary } from "./loop/round-files.js";
import { buildRuntimeEvent, ephemeralRuntimeEventCodes, mergeRuntimeEvents, normalizeRuntimeWarnings } from "./loop/runtime-events.js";
import { isResumeNoopTerminalStopReason, stopReasonFromState } from "./loop/stop-reasons.js";
import { artifactsForRound, buildEvaluatorVerdictArtifact, buildGeneratorPlanArtifact, buildPatchRequestArtifact, buildQualityCritiqueArtifact, buildRoundContractArtifact, buildRoundResultArtifact, writeAdapterMigrationProposalArtifacts, writeNegotiationArtifacts, writeRoundEvaluationPlaceholders, writeRoundArtifacts } from "./protocol-artifacts.js";
import { applyFailureLineagePolicySnapshot } from "./failure-lineage.js";
import { buildResumeIdentityState, compareResumeIdentity, loadResumeIdentityArtifact, resumeIdentityArtifactPath, resumeIdentityFingerprint, summaryResumeIdentity } from "./resume-identity.js";
import { buildRemediationHistory, failureLineageForEvalReport, restoreRunState, scoreDeltasForHistory } from "./resume-state.js";
import { runtimeStatePathsForRun, startRuntimeHeartbeat, writeRuntimeRoundPhaseArtifact, writeTransportStateArtifact } from "./runtime-state.js";
import { buildOperatorSurfaceArtifact, resolveOperatorSurfaceContext, writeOperatorSurfaceArtifacts } from "./operator-surface.js";
import { buildOperatorSurfaceSessionProjection, writeSessionPreparationArtifacts } from "./session-artifacts.js";
import { clearReadyToStartSessionMarker, findLatestPreparedRunAwaitingStart, loadPreparedSessionSeedForRun } from "./prepare-session.js";
import { buildAdapterDriftReport } from "./adapter-drift.js";
import { applyGeneratedLocalAdapterMigration, buildAdapterMigrationProposal, decisionOptionsForAdapterMigrationProposal, generatedAdapterRuntimeConfigPath, isAuthorizedAdapterMigration, loadAdapterMigrationResponse, loadAuthorizedAdapterMigration } from "./adapter-migration.js";
import { readAdapterMigrationAuthoringResponse, writeAdapterMigrationAuthoringTask } from "./adapter-migration-authoring.js";
import { enhancePlanWithCurrentThread, enhanceContractReviewWithCurrentThread, enhanceEvalReportWithCurrentThread, enhanceGeneratorPlanWithCurrentThread } from "./current-thread-enhancement.js";
import { contractReviewRequiresHumanDecision } from "./current-thread-boundaries.js";
import { pausedStopReasons, phaseBudgetToStallThresholdMs } from "./runtime-health.js";
import { canonicalCodexCheckpointStopReason, isCurrentThreadCheckpointStopReason, normalizeRunStopReason } from "./stop-reason.js";
import { transportProtocolPathForRun, writeTransportProtocol } from "./transport-protocol.js";
import { buildTrajectoryDecisionArtifact } from "./trajectory-controller.js";
const defaultRubricPath = join(repoRoot, "evals", "rubrics", "generic-harness-rubric.json");
const preVerificationCapabilities = [
    "prepare_target",
    "apply_change",
    "run_target",
    "capture_evidence"
];
const postVerificationCapabilities = [
    "run_checks",
    "grade_round"
];
const unique = (values) => [...new Set(values)];
const writeRunCheckpoint = async (input) => {
    const normalizedSummary = input.summary.operator_surface_path &&
        input.summary.session_status_path &&
        input.summary.session_status_events_path &&
        input.summary.session_stream_path
        ? input.summary
        : {
            ...input.summary,
            operator_surface_path: input.summary.operator_surface_path ??
                join(input.runDirectory, "runtime", "operator-surface.json"),
            session_status_path: input.summary.session_status_path ??
                join(input.runDirectory, "runtime", "session-status.json"),
            session_status_events_path: input.summary.session_status_events_path ??
                join(input.runDirectory, "runtime", "session-status-events.jsonl"),
            session_stream_path: input.summary.session_stream_path ??
                join(input.runDirectory, "runtime", "session-stream.json")
        };
    const writes = [
        writeJson(join(input.runDirectory, "summary.json"), normalizedSummary),
        writeRunControllerSummary({
            runDirectory: input.runDirectory,
            summary: normalizedSummary
        })
    ];
    if (normalizedSummary.terminal_round !== undefined) {
        writes.push(writeJson(join(input.runDirectory, "current_best.json"), {
            round: input.currentBest.round ?? normalizedSummary.terminal_round,
            selection_basis: "terminal_round",
            total_score: input.currentBest.totalScore ?? normalizedSummary.total_score,
            control_plane_score: input.currentBest.controlPlaneScore ?? normalizedSummary.control_plane_score,
            proof_score: input.currentBest.proofScore ?? normalizedSummary.proof_score,
            release_score: input.currentBest.releaseScore ?? normalizedSummary.release_score,
            threshold_results: input.currentBest.thresholdResults ?? normalizedSummary.threshold_results,
            dimension_scores: input.currentBest.dimensionScores ?? normalizedSummary.dimension_scores,
            patch_request_path: input.currentBest.patchRequestPath,
            eval_report_path: input.currentBest.evalReportPath,
            best_scoring_round: input.currentBest.bestScoringRound ?? normalizedSummary.best_round,
            best_scoring_total_score: input.currentBest.bestScoringTotalScore ??
                normalizedSummary.best_scoring_total_score,
            best_scoring_control_plane_score: input.currentBest.bestScoringControlPlaneScore ??
                normalizedSummary.best_scoring_control_plane_score,
            best_scoring_proof_score: input.currentBest.bestScoringProofScore ??
                normalizedSummary.best_scoring_proof_score,
            best_scoring_release_score: input.currentBest.bestScoringReleaseScore ??
                normalizedSummary.best_scoring_release_score,
            best_scoring_threshold_results: input.currentBest.bestScoringThresholdResults ??
                normalizedSummary.best_scoring_threshold_results,
            best_scoring_dimension_scores: input.currentBest.bestScoringDimensionScores,
            best_scoring_patch_request_path: input.currentBest.bestScoringPatchRequestPath,
            best_scoring_eval_report_path: input.currentBest.bestScoringEvalReportPath
        }));
    }
    await Promise.all(writes);
};
export const runClosedLoop = async (input) => {
    const includeRemediationBudget = input.includeRemediationBudget ?? true;
    const restoredRun = input.resumeRunPath
        ? await restoreRunState(input.resumeRunPath)
        : undefined;
    if (input.repairOnly && !restoredRun) {
        throw new Error("Repair mode requires --resume-run so the controller can restore persisted state.");
    }
    const controllerMode = input.controllerMode ??
        (isControllerMode(process.env.HARNESS_CONTROLLER_MODE)
            ? process.env.HARNESS_CONTROLLER_MODE
            : undefined) ??
        restoredRun?.summary.controller_mode ??
        defaultControllerMode;
    const transportMode = input.transportMode ??
        (isTransportMode(process.env.HARNESS_TRANSPORT)
            ? process.env.HARNESS_TRANSPORT
            : undefined) ??
        restoredRun?.summary.transport_mode ??
        defaultTransportModeForControllerMode(controllerMode);
    const transportValidationError = validateTransportMode({
        controllerMode,
        transportMode
    });
    if (transportValidationError) {
        throw new Error(transportValidationError);
    }
    const currentThreadTransport = isCurrentThreadTransport(transportMode);
    let appServerTransport;
    const phaseTimeouts = {
        ...parsePhaseTimeoutOverrides(process.env.HARNESS_PHASE_TIMEOUT_MS),
        ...(input.phaseTimeouts ?? {})
    };
    const appServerTaskTimeoutMs = input.appServerTaskTimeoutMs ??
        parsePositiveTimeoutMs(process.env.HARNESS_APP_SERVER_TASK_TIMEOUT_MS) ??
        1_800_000;
    const appServerRequestTimeoutMs = input.appServerRequestTimeoutMs ??
        parsePositiveTimeoutMs(process.env.HARNESS_APP_SERVER_REQUEST_TIMEOUT_MS) ??
        30_000;
    const executorMode = input.executorMode ??
        (isExecutorMode(process.env.HARNESS_EXECUTOR_MODE)
            ? process.env.HARNESS_EXECUTOR_MODE
            : undefined) ??
        restoredRun?.summary.executor_mode ??
        defaultExecutorMode;
    const singleForegroundSeedDefaults = controllerMode === "attached" &&
        transportMode === "current-thread" &&
        input.maxRounds === 1 &&
        input.includeRemediationBudget === false;
    const preparedStartResolutionEligible = !restoredRun &&
        controllerMode === "attached" &&
        transportMode === "current-thread" &&
        input.adapterPath === undefined &&
        input.rubricPath === undefined &&
        input.evaluatorProfilePath === undefined &&
        input.targetFamily === undefined &&
        input.targetScore === undefined &&
        (input.maxRounds === undefined || singleForegroundSeedDefaults);
    const runsDirectory = resolveRunsDirectory();
    const preparedRunCandidate = preparedStartResolutionEligible
        ? await findLatestPreparedRunAwaitingStart(runsDirectory, process.env.CODEX_THREAD_ID?.trim() || undefined, input.preparedRunId
            ? {
                runId: input.preparedRunId,
                allowAssumedForeground: process.env.HARNESS_CODEX_APP_FOREGROUND === "1"
            }
            : {})
        : undefined;
    if (!restoredRun && input.preparedRunId && !preparedRunCandidate) {
        const readinessReport = await loadJsonIfExists(runtimeStatePathsForRun(join(runsDirectory, input.preparedRunId))
            .readinessReportPath);
        const readinessDetails = readinessReport
            ? [
                `Readiness status: ${readinessReport.status ?? "unknown"}.`,
                ...(readinessReport.blockers?.length
                    ? [
                        `Blockers: ${readinessReport.blockers
                            .map((blocker) => `${blocker.code ?? "UNKNOWN"} - ${blocker.human_explanation ?? "No explanation"} Fix: ${blocker.how_to_fix ?? "No fix recorded"}`)
                            .join("; ")}.`
                    ]
                    : [])
            ].join(" ")
            : "";
        throw new Error(`Prepared run '${input.preparedRunId}' is not ready_to_start for this current-thread start.${readinessDetails ? ` ${readinessDetails}` : ""}`);
    }
    const runId = restoredRun?.runId ?? preparedRunCandidate?.runId ?? (await nextRunId(runsDirectory));
    const runDirectory = restoredRun?.runDirectory ??
        preparedRunCandidate?.runDirectory ??
        join(runsDirectory, runId);
    if (preparedRunCandidate) {
        await clearReadyToStartSessionMarker(runsDirectory, preparedRunCandidate.marker ?? {
            run_id: preparedRunCandidate.runId,
            run_directory: preparedRunCandidate.runDirectory,
            updated_at: new Date().toISOString()
        });
    }
    await mkdir(runDirectory, { recursive: true });
    const runDiscoveryMarkerPath = process.env.HARNESS_RUN_DISCOVERY_MARKER;
    if (runDiscoveryMarkerPath) {
        await writeJson(runDiscoveryMarkerPath, {
            run_id: runId,
            run_directory: runDirectory,
            controller_mode: controllerMode,
            transport_mode: transportMode,
            supervisor_session_id: process.env.HARNESS_SUPERVISOR_SESSION_ID,
            written_at: new Date().toISOString()
        });
    }
    const runtimeStatePaths = runtimeStatePathsForRun(runDirectory);
    const runRuntimeDirectory = runtimeStatePaths.runtimeDirectory;
    const preparedSessionSeed = restoredRun
        ? undefined
        : await loadPreparedSessionSeedForRun(runDirectory);
    const restoredRunContractSeed = restoredRun
        ? await loadPreparedSessionSeedForRun(runDirectory)
        : undefined;
    const preparedValidationBundle = preparedSessionSeed?.runContract.validation_strategy.validation_bundle;
    const restoredValidationBundle = restoredRunContractSeed?.runContract.validation_strategy.validation_bundle;
    const persistedValidationBundle = preparedValidationBundle ?? restoredValidationBundle;
    const activePreparedSeed = preparedSessionSeed ?? restoredRunContractSeed;
    const sessionKind = activePreparedSeed?.runContract.discovery_source ||
        activePreparedSeed?.runContract.validation_strategy.validation_bundle?.target_family
        ? "product_build"
        : "harness";
    const explicitBundleOverrideRequested = input.adapterPath !== undefined ||
        input.rubricPath !== undefined ||
        input.evaluatorProfilePath !== undefined ||
        input.targetFamily !== undefined;
    const preservePreparedAttemptBudget = preparedSessionSeed !== undefined && singleForegroundSeedDefaults;
    const attemptBudget = (preservePreparedAttemptBudget
        ? undefined
        : input.maxRounds) ??
        restoredRun?.plan?.max_rounds ??
        preparedSessionSeed?.runContract.execution_controls.max_rounds ??
        3;
    const summaryPath = join(runDirectory, "summary.json");
    const transportProtocolPath = transportProtocolPathForRun(runDirectory, transportMode);
    const codexSessionRegistryPath = join(runRuntimeDirectory, "codex-sessions.json");
    await mkdir(runRuntimeDirectory, { recursive: true });
    await ensureJsonFile(codexSessionRegistryPath, {});
    const absoluteRubricPath = restoredRun
        ? join(runDirectory, "effective-rubric.json")
        : resolve(input.rubricPath ??
            persistedValidationBundle?.rubric_path ??
            defaultRubricPath);
    const hydratedRubric = restoredRun
        ? restoredRun.rubric
        : await loadJson(absoluteRubricPath);
    hydratedRubric.minimum_control_plane_score ??= 1;
    hydratedRubric.minimum_proof_score ??= 0.85;
    hydratedRubric.target_signal_requires_adapter ??= true;
    hydratedRubric.target_signal_requires_grade_score ??= true;
    let loadedAdapter = await loadAdapterContract(input.adapterPath ??
        restoredRun?.summary.adapter_contract_path ??
        persistedValidationBundle?.adapter_contract_path);
    const bundleSelection = resolveEvaluatorBundleSelection({
        explicitEvaluatorProfilePath: input.evaluatorProfilePath,
        explicitTargetFamily: input.targetFamily,
        rubric: hydratedRubric,
        rubricPath: absoluteRubricPath,
        preparedEvaluatorProfilePath: persistedValidationBundle?.evaluator_profile_path,
        preparedTargetFamily: persistedValidationBundle?.target_family,
        preparedValidationLane: persistedValidationBundle?.validation_lane,
        summaryEvaluatorProfilePath: restoredRun?.summary.evaluator_profile_path,
        summaryTargetFamily: restoredRun?.summary.target_family,
        summaryValidationLane: restoredRun?.summary.validation_lane,
        preferGenericCoreDefault: !loadedAdapter
    });
    const selectedVerificationProfile = bundleSelection.evaluatorProfilePath
        ? await loadVerificationProfile(bundleSelection.evaluatorProfilePath)
        : undefined;
    const resolvedTargetFamily = selectedVerificationProfile?.profile.target_family ??
        bundleSelection.targetFamily ??
        restoredRun?.summary.target_family;
    const resolvedValidationLane = selectedVerificationProfile?.profile.validation_lane ??
        bundleSelection.validationLane ??
        restoredRun?.summary.validation_lane;
    const shouldEnforcePreparedProductBundle = preparedValidationBundle !== undefined &&
        preparedValidationBundle.target_family !== "generic-core";
    const shouldEnforceRestoredProductBundle = restoredValidationBundle !== undefined &&
        restoredValidationBundle.target_family !== "generic-core" &&
        !explicitBundleOverrideRequested;
    const enforcedValidationBundle = shouldEnforcePreparedProductBundle
        ? preparedValidationBundle
        : shouldEnforceRestoredProductBundle
            ? restoredValidationBundle
            : undefined;
    if (enforcedValidationBundle) {
        const mismatches = [];
        if (!loadedAdapter) {
            mismatches.push("prepared session did not resolve an adapter contract path");
        }
        if (!selectedVerificationProfile) {
            mismatches.push("prepared session did not resolve an evaluator profile path");
        }
        if (resolvedTargetFamily !== enforcedValidationBundle.target_family) {
            mismatches.push(`resolved target family '${resolvedTargetFamily ?? "none"}' does not match prepared target family '${enforcedValidationBundle.target_family}'`);
        }
        if (enforcedValidationBundle.validation_lane &&
            resolvedValidationLane !== enforcedValidationBundle.validation_lane) {
            mismatches.push(`resolved validation lane '${resolvedValidationLane ?? "none"}' does not match prepared validation lane '${enforcedValidationBundle.validation_lane}'`);
        }
        if (mismatches.length > 0) {
            throw new Error([
                "Prepared product session could not restore its product validation bundle. Refusing to fall back to a generic or adapter-free start.",
                ...mismatches.map((mismatch) => `- ${mismatch}`)
            ].join("\n"));
        }
    }
    const resolvedSessionAdapterContractPath = loadedAdapter?.contract_path ?? restoredRun?.summary.adapter_contract_path;
    const resolvedSessionEvaluatorProfilePath = bundleSelection.evaluatorProfilePath ??
        restoredRun?.summary.evaluator_profile_path;
    const shouldCarryPersistedValidationBundle = Boolean(persistedValidationBundle) && !explicitBundleOverrideRequested;
    const resolvedSessionValidationBundle = shouldCarryPersistedValidationBundle
        ? persistedValidationBundle
        : resolvedTargetFamily && resolvedTargetFamily !== "generic-core"
            ? {
                target_family: resolvedTargetFamily,
                ...(resolvedValidationLane
                    ? { validation_lane: resolvedValidationLane }
                    : {}),
                ...(resolvedSessionAdapterContractPath
                    ? {
                        adapter_contract_path: resolvedSessionAdapterContractPath
                    }
                    : {}),
                rubric_path: absoluteRubricPath,
                ...(resolvedSessionEvaluatorProfilePath
                    ? {
                        evaluator_profile_path: resolve(resolvedSessionEvaluatorProfilePath)
                    }
                    : {})
            }
            : undefined;
    if (loadedAdapter && selectedVerificationProfile) {
        loadedAdapter = {
            ...loadedAdapter,
            verification_profile: selectedVerificationProfile,
            verification_profile_source: "core"
        };
    }
    hydratedRubric.max_remediation_rounds ??= loadedAdapter ? 2 : 0;
    if (input.targetScore !== undefined) {
        hydratedRubric.target_total_score = input.targetScore;
    }
    else if (preparedSessionSeed?.runContract.execution_controls.target_score !== undefined) {
        hydratedRubric.target_total_score =
            preparedSessionSeed.runContract.execution_controls.target_score;
    }
    let evaluationPolicy = await loadEvaluationPolicyForRun(runDirectory);
    evaluationPolicy ??= buildEvaluationPolicy({
        explicitTargetScore: hydratedRubric.target_total_score
    });
    await writeEvaluationPolicyArtifacts({
        runDirectory,
        policy: evaluationPolicy
    });
    if (input.targetScore === undefined &&
        preparedSessionSeed?.runContract.execution_controls.target_score === undefined &&
        evaluationPolicy) {
        hydratedRubric.target_total_score = evaluationPolicy.target_total_score;
    }
    const executionMaxRounds = attemptBudget +
        (loadedAdapter && includeRemediationBudget
            ? hydratedRubric.max_remediation_rounds
            : 0);
    const effectiveRubricPath = join(runDirectory, "effective-rubric.json");
    await writeJson(effectiveRubricPath, hydratedRubric);
    let currentResumeIdentity = await buildResumeIdentityState({
        adapterContractPath: loadedAdapter?.contract_path,
        evaluatorProfilePath: bundleSelection.evaluatorProfilePath,
        rubricPath: effectiveRubricPath,
        executorMode,
        transportMode,
        targetFamily: resolvedTargetFamily,
        validationLane: resolvedValidationLane
    });
    const previousResumeIdentity = (restoredRun ? await loadResumeIdentityArtifact(runDirectory) : undefined) ??
        summaryResumeIdentity(restoredRun?.summary);
    const currentResumeIdentityPath = resumeIdentityArtifactPath(runDirectory);
    const resumeDecisionPath = input.resumeRunPath
        ? join(runDirectory, "resume-decision.json")
        : undefined;
    const authorizedAdapterMigration = restoredRun
        ? await loadAuthorizedAdapterMigration(restoredRun.summary)
        : undefined;
    const resumeIdentityMismatches = restoredRun
        ? compareResumeIdentity({
            current: currentResumeIdentity,
            previous: previousResumeIdentity
        })
        : [];
    const adapterMigrationAuthorized = restoredRun &&
        resumeIdentityMismatches.length > 0 &&
        isAuthorizedAdapterMigration({
            applied: authorizedAdapterMigration,
            previousIdentity: previousResumeIdentity,
            currentIdentity: currentResumeIdentity
        });
    const restoredStopReason = normalizeRunStopReason(restoredRun?.summary.stop_reason);
    if (resumeIdentityMismatches.length > 0 &&
        !input.allowResumeMigration &&
        !adapterMigrationAuthorized) {
        throw new Error([
            `Resume identity mismatch for run '${runId}'. Refusing to continue because run history would no longer be directly comparable.`,
            ...resumeIdentityMismatches.map((mismatch) => `- ${mismatch}`),
            "Re-run with --allow-resume-migration only if you intentionally want to record a bundle migration on this run."
        ].join("\n"));
    }
    if (restoredRun &&
        resumeIdentityMismatches.length > 0 &&
        input.allowResumeMigration &&
        !input.forceReopenTerminal &&
        isResumeNoopTerminalStopReason(restoredStopReason)) {
        throw new Error([
            `Run '${runId}' already ended with terminal stop reason '${restoredStopReason}'. Terminal runs stay closed on default resume even when a migration override is requested.`,
            ...resumeIdentityMismatches.map((mismatch) => `- ${mismatch}`),
            "Re-run with both --allow-resume-migration and --force-reopen-terminal only if you intentionally want to reopen this terminal run and record the migration."
        ].join("\n"));
    }
    let resumeMigrationPath = restoredRun && resumeIdentityMismatches.length > 0
        ? join(runDirectory, "resume-migration.json")
        : undefined;
    let previousBundleFingerprint = resumeMigrationPath
        ? resumeIdentityFingerprint(previousResumeIdentity)
        : undefined;
    let newBundleFingerprint = resumeMigrationPath
        ? resumeIdentityFingerprint(currentResumeIdentity)
        : undefined;
    if (resumeMigrationPath) {
        await writeJson(resumeMigrationPath, {
            run_id: runId,
            migrated_at: new Date().toISOString(),
            mismatches: resumeIdentityMismatches,
            previous_identity: previousResumeIdentity,
            new_identity: currentResumeIdentity,
            authorized_adapter_migration: Boolean(adapterMigrationAuthorized)
        });
    }
    const previousEphemeralEventMessages = new Set((restoredRun?.summary.runtime_events ?? [])
        .filter((event) => ephemeralRuntimeEventCodes.has(event.code))
        .map((event) => event.message));
    const previousPersistentWarnings = (restoredRun?.summary.runtime_warnings ?? []).filter((warning) => !previousEphemeralEventMessages.has(warning));
    let currentRuntimeEvents = mergeRuntimeEvents([
        ...((restoredRun?.summary.runtime_events ?? []).filter((event) => !ephemeralRuntimeEventCodes.has(event.code)) ?? []),
        ...(loadedAdapter && resolvedValidationLane === "environment_integration"
            ? [
                buildRuntimeEvent("validation.environment_lane_hint", `Validation lane '${resolvedValidationLane}' depends on the local environment. Browser or fullstack probe failures may reflect sandbox or administrator policy, not only product defects.`, {
                    validation_lane: resolvedValidationLane,
                    target_family: resolvedTargetFamily ?? null
                })
            ]
            : []),
        ...(resumeMigrationPath
            ? [
                buildRuntimeEvent("resume.migration_override", adapterMigrationAuthorized
                    ? `Approved adapter migration was accepted automatically for run '${runId}'. This run now records the adapter identity migration without a manual override.`
                    : `Resume identity migration override was accepted for run '${runId}'. This run now records a bundle migration.`, {
                    mismatch_count: resumeIdentityMismatches.length,
                    resumed_run_id: runId,
                    authorized_adapter_migration: Boolean(adapterMigrationAuthorized)
                })
            ]
            : []),
        ...(input.resumeRunPath
            ? [
                buildRuntimeEvent("run.resumed_from_history", `Resumed run '${runId}' from persisted controller history.`, { resumed_run_id: runId })
            ]
            : []),
        ...(restoredRun?.summaryWasRecovered
            ? [
                buildRuntimeEvent("resume.recovered_round_checkpoint", `Recovered committed round checkpoint(s) for run '${runId}' from round directories before continuing.`, {
                    resumed_run_id: runId,
                    recovered_round_count: restoredRun.summary.round_history?.length ?? 0
                })
            ]
            : []),
        ...(restoredRun?.interruptedRound
            ? [
                buildRuntimeEvent("resume.repaired_interrupted_round", `Detected interrupted round ${restoredRun.interruptedRound.round} at phase '${input.resumePhase ?? restoredRun.interruptedRound.resumeFromPhase}'. Resume will continue from the persisted runtime journal.`, {
                    resumed_run_id: runId,
                    round: restoredRun.interruptedRound.round,
                    phase: input.resumePhase ?? restoredRun.interruptedRound.resumeFromPhase
                })
            ]
            : []),
        ...(restoredRun?.initializationIncomplete
            ? [
                buildRuntimeEvent("resume.partial_init_rebuild", `Resume detected incomplete planning initialization for run '${runId}'. Missing planner artifacts will be rebuilt from IDEA and rubric before continuing.`, {
                    resumed_run_id: runId,
                    missing_artifact_count: restoredRun.initializationMissingArtifacts.length,
                    missing_artifacts: restoredRun.initializationMissingArtifacts.join(", ")
                })
            ]
            : [])
    ]);
    let runtimeWarnings = normalizeRuntimeWarnings([
        ...previousPersistentWarnings,
        ...transportRuntimeWarningsForMode({
            controllerMode,
            transportMode
        }),
        ...(bundleSelection.runtimeWarnings ?? []),
        ...(loadedAdapter?.runtime_warnings ?? []),
        ...(executorMode === "subagents-experimental"
            ? [experimentalExecutorRuntimeWarning]
            : []),
        ...currentRuntimeEvents.map((event) => event.message)
    ]);
    await writeTransportStateArtifact(runtimeStatePaths.transportStatePath, buildTransportStateArtifact({
        runId,
        controllerMode,
        transportMode,
        executorMode,
        summaryPath,
        protocolPath: transportProtocolPath,
        dashboardPath: runtimeStatePaths.operatorSurfaceMarkdownPath,
        sessionStatusPath: runtimeStatePaths.sessionStatusPath,
        sessionStatusEventsPath: runtimeStatePaths.sessionStatusEventsPath,
        sessionStreamPath: runtimeStatePaths.sessionStreamPath,
        status: "configured",
        notes: transportRuntimeWarningsForMode({
            controllerMode,
            transportMode
        })
    }));
    const initialOperatorSurfaceArtifact = buildOperatorSurfaceArtifact({
        runId,
        controllerMode,
        transportMode,
        executionState: "configured",
        summaryPath,
        transportStatePath: runtimeStatePaths.transportStatePath,
        transportProtocolPath: transportProtocolPath,
        dashboardPath: runtimeStatePaths.operatorSurfaceMarkdownPath,
        sessionStatusPath: runtimeStatePaths.sessionStatusPath,
        sessionStatusEventsPath: runtimeStatePaths.sessionStatusEventsPath,
        sessionStreamPath: runtimeStatePaths.sessionStreamPath,
        notes: transportRuntimeWarningsForMode({
            controllerMode,
            transportMode
        })
    });
    await writeOperatorSurfaceArtifacts({
        jsonPath: runtimeStatePaths.operatorSurfacePath,
        markdownPath: runtimeStatePaths.operatorSurfaceMarkdownPath,
        artifact: initialOperatorSurfaceArtifact
    });
    if (restoredRun &&
        !restoredRun.initializationIncomplete &&
        restoredRun.plan &&
        restoredRun.scenario &&
        !input.forceReopenTerminal &&
        resumeIdentityMismatches.length === 0 &&
        isResumeNoopTerminalStopReason(restoredStopReason)) {
        const noopTransportProtocolPath = await writeTransportProtocol({
            runDirectory,
            transportMode,
            summary: {
                run_id: runId,
                controller_mode: controllerMode,
                transport_mode: transportMode,
                transport_state_path: runtimeStatePaths.transportStatePath,
                resume_identity_path: currentResumeIdentityPath,
                runtime_round_phase_path: runtimeStatePaths.roundPhasePath
            },
            activeRound: restoredRun.interruptedRound?.round,
            activePhase: input.resumePhase ?? restoredRun.interruptedRound?.resumeFromPhase,
            activeStatus: restoredRun.interruptedRound?.phaseStatus,
            latestPatchRequestPath: restoredRun.previousPatchRequestPath,
            latestRoundContractPath: restoredRun.latestRoundSummary?.contract_path,
            notes: [
                ...restoredRun.repairNotes,
                ...(transportMode === "current-thread"
                    ? [
                        "Keep the current thread as the generator/controller surface. $loop-control owns the same-thread autocontinue chain; use $attached-loop only if this foreground thread needs recovery after interruption."
                    ]
                    : [])
            ]
        });
        const noopRuntimeEvents = mergeRuntimeEvents([
            ...currentRuntimeEvents,
            buildRuntimeEvent("resume.noop_terminal", `Run '${runId}' already ended with terminal stop reason '${restoredStopReason}'. Resume returned without opening a new round. Re-run with --force-reopen-terminal to override this default.`, {
                stop_reason: restoredStopReason ?? null,
                resumed_run_id: runId
            })
        ]);
        runtimeWarnings = unique([
            ...previousPersistentWarnings,
            ...(bundleSelection.runtimeWarnings ?? []),
            ...(loadedAdapter?.runtime_warnings ?? []),
            ...noopRuntimeEvents.map((event) => event.message)
        ]);
        const resumeDecisionArtifact = resumeDecisionPath
            ? {
                run_id: runId,
                decided_at: new Date().toISOString(),
                decision: "noop_terminal",
                previous_stop_reason: restoredStopReason,
                force_reopen_terminal: Boolean(input.forceReopenTerminal),
                allow_resume_migration: Boolean(input.allowResumeMigration),
                mismatches: resumeIdentityMismatches,
                runtime_event_codes: noopRuntimeEvents.map((event) => event.code)
            }
            : undefined;
        const summary = {
            ...restoredRun.summary,
            controller_mode: controllerMode,
            transport_mode: transportMode,
            executor_mode: executorMode,
            ...(resolvedTargetFamily ? { target_family: resolvedTargetFamily } : {}),
            ...(resolvedValidationLane
                ? { validation_lane: resolvedValidationLane }
                : {}),
            ...(bundleSelection.evaluatorProfilePath
                ? { evaluator_profile_path: bundleSelection.evaluatorProfilePath }
                : {}),
            ...(currentResumeIdentity.adapter_contract_sha256
                ? { adapter_contract_sha256: currentResumeIdentity.adapter_contract_sha256 }
                : {}),
            ...(currentResumeIdentity.evaluator_bundle_sha256
                ? { evaluator_bundle_sha256: currentResumeIdentity.evaluator_bundle_sha256 }
                : {}),
            ...(currentResumeIdentity.rubric_sha256
                ? { rubric_sha256: currentResumeIdentity.rubric_sha256 }
                : {}),
            planner_brief_path: restoredRun.plannerBriefPath,
            planned_scenario_path: restoredRun.plannedScenarioPath,
            plan_path: restoredRun.planPath,
            ...(await detectDurableMemoryPaths(dirname(restoredRun.summary.idea_path ?? defaultIdeaPath))),
            codex_handoff_path: undefined,
            adapter_contract_path: loadedAdapter?.contract_path ?? restoredRun.summary.adapter_contract_path,
            adapter_id: loadedAdapter?.contract.adapter_id ?? restoredRun.summary.adapter_id,
            verification_provider_id: loadedAdapter?.contract.verification_provider?.provider_id ??
                restoredRun.summary.verification_provider_id,
            adapter_attached: Boolean(loadedAdapter),
            resume_identity_path: currentResumeIdentityPath,
            runtime_live_state_path: runtimeStatePaths.liveStatePath,
            runtime_round_phase_path: runtimeStatePaths.roundPhasePath,
            controller_lease_path: runtimeStatePaths.controllerLeasePath,
            transport_state_path: runtimeStatePaths.transportStatePath,
            transport_protocol_path: noopTransportProtocolPath,
            session_status_path: runtimeStatePaths.sessionStatusPath,
            session_status_events_path: runtimeStatePaths.sessionStatusEventsPath,
            session_stream_path: runtimeStatePaths.sessionStreamPath,
            runtime_events: noopRuntimeEvents,
            ...(resumeDecisionPath ? { resume_decision_path: resumeDecisionPath } : {}),
            ...(runtimeWarnings.length > 0 ? { runtime_warnings: runtimeWarnings } : {}),
            resumed_from_run_id: runId
        };
        const codexHandoffPath = await writeRunCodexHandoff({
            runDirectory,
            summary,
            plan: restoredRun.plan,
            scenario: restoredRun.scenario
        });
        summary.codex_handoff_path = codexHandoffPath;
        await Promise.all([
            writeJson(currentResumeIdentityPath, currentResumeIdentity),
            ...(resumeDecisionArtifact && resumeDecisionPath
                ? [writeJson(resumeDecisionPath, resumeDecisionArtifact)]
                : []),
            writeJson(join(runDirectory, "summary.json"), summary),
            writeRunControllerSummary({
                runDirectory,
                summary
            })
        ]);
        return {
            plan: restoredRun.plan,
            summary,
            runDirectory,
            plannedScenarioPath: restoredRun.plannedScenarioPath
        };
    }
    const idea = preparedSessionSeed?.idea ?? await readIdeaBrief(defaultIdeaPath);
    const durableMemory = preparedSessionSeed !== undefined
        ? {
            rootDirectory: dirname(defaultIdeaPath),
            context: preparedSessionSeed.durableMemory
        }
        : await loadDurableMemoryContext(idea);
    const durableMemoryPaths = await ensureDurableMemoryArtifacts(durableMemory.rootDirectory, durableMemory.context);
    let scenario = restoredRun?.scenario;
    let plan = restoredRun?.plan;
    const plannedScenarioPath = restoredRun?.plannedScenarioPath ?? join(runDirectory, "planned-scenario.json");
    const planPath = restoredRun?.planPath ?? join(runDirectory, "plan.json");
    const executionPlanPath = join(runDirectory, "docs", "EXECUTION_PLAN.md");
    let plannerBriefPath = restoredRun?.plannerBriefPath;
    let pendingPlannerEnhancementPause;
    const resumePlanningEnhancement = currentThreadTransport &&
        restoredRun?.runtimeRoundPhase?.phase === "planning" &&
        isCodexCheckpointPhaseStatus(restoredRun.runtimeRoundPhase.status);
    const ensureEarlyAppServerTransport = async () => {
        if (transportMode !== "app-server" || appServerTransport) {
            return;
        }
        appServerTransport = await startAppServerTransport({
            runId,
            controllerMode,
            executorMode,
            transportStatePath: runtimeStatePaths.transportStatePath,
            summaryPath,
            protocolPath: transportProtocolPath,
            dashboardPath: runtimeStatePaths.operatorSurfaceMarkdownPath,
            sessionStatusPath: runtimeStatePaths.sessionStatusPath,
            sessionStatusEventsPath: runtimeStatePaths.sessionStatusEventsPath,
            sessionStreamPath: runtimeStatePaths.sessionStreamPath,
            mirroredSessionEventsPath: runtimeStatePaths.appServerSessionEventsPath,
            restoredThreadId: restoredRun?.transportState?.app_server?.thread_id,
            initialRound: restoredRun?.interruptedRound?.round ?? restoredRun?.roundStart ?? 1,
            initialPhase: input.resumePhase ?? restoredRun?.interruptedRound?.resumeFromPhase ?? "negotiation",
            initialStatus: restoredRun?.interruptedRound?.phaseStatus ?? "in_progress",
            initialNotes: restoredRun?.repairNotes ?? [],
            threadName: `${runId} · ${resolvedTargetFamily ?? "attached-loop"}`,
            defaultTaskTimeoutMs: appServerTaskTimeoutMs,
            requestTimeoutMs: appServerRequestTimeoutMs
        });
    };
    if (!scenario || !plan || resumePlanningEnhancement) {
        try {
            await ensureEarlyAppServerTransport();
            const baseScenario = scenario ?? buildScenarioFromIdea(idea);
            const basePlan = plan ?? buildLoopPlan({
                scenario: baseScenario,
                rubric: hydratedRubric,
                maxRounds: attemptBudget,
                idea,
                planKind: sessionKind === "product_build" ? "product_build" : "harness"
            });
            if (transportMode === "app-server" && appServerTransport) {
                const plannerEnhancement = await enhancePlanWithAppServer({
                    transport: appServerTransport,
                    runDirectory,
                    idea,
                    rubric: hydratedRubric,
                    scenario: baseScenario,
                    plan: basePlan,
                    executorMode
                });
                scenario = plannerEnhancement.value.scenario;
                plan = plannerEnhancement.value.plan;
                runtimeWarnings = unique([
                    ...runtimeWarnings,
                    ...plannerEnhancement.runtimeWarnings
                ]);
                await Promise.all([
                    writeJson(plannedScenarioPath, scenario),
                    writeJson(planPath, plan)
                ]);
            }
            else if (currentThreadTransport) {
                const plannerEnhancement = await enhancePlanWithCurrentThread({
                    runId,
                    transportProtocolPath,
                    runtimePaths: runtimeStatePaths,
                    plannedScenarioPath,
                    planPath,
                    idea,
                    rubric: hydratedRubric,
                    scenario: baseScenario,
                    plan: basePlan,
                    executorMode
                });
                if (plannerEnhancement.kind === "checkpoint") {
                    scenario = baseScenario;
                    plan = basePlan;
                    pendingPlannerEnhancementPause = {
                        artifacts: plannerEnhancement.artifacts,
                        notes: plannerEnhancement.notes,
                        checkpointKind: plannerEnhancement.checkpointKind
                    };
                }
                else {
                    scenario = plannerEnhancement.value.scenario;
                    plan = plannerEnhancement.value.plan;
                    runtimeWarnings = unique([
                        ...runtimeWarnings,
                        ...plannerEnhancement.runtimeWarnings
                    ]);
                }
            }
            else {
                const plannerEnhancement = await enhancePlanWithCodex({
                    runDirectory,
                    idea,
                    rubric: hydratedRubric,
                    scenario: baseScenario,
                    plan: basePlan,
                    executorMode
                });
                scenario = plannerEnhancement.value.scenario;
                plan = plannerEnhancement.value.plan;
                runtimeWarnings = unique([
                    ...runtimeWarnings,
                    ...plannerEnhancement.runtimeWarnings
                ]);
                await Promise.all([
                    writeJson(plannedScenarioPath, scenario),
                    writeJson(planPath, plan)
                ]);
            }
            plannerBriefPath = await writeRunPlannerBrief({
                runDirectory,
                idea,
                scenario,
                plan
            });
        }
        catch (error) {
            await appServerTransport?.stop({
                notes: [
                    error instanceof Error ? error.message : String(error)
                ]
            });
            appServerTransport = undefined;
            throw error;
        }
    }
    if (!scenario || !plan || !plannerBriefPath) {
        throw new Error("Run initialization did not produce a resumable scenario, plan, and planner brief.");
    }
    const history = [...(restoredRun?.summary.round_history ?? [])];
    let previousPatchRequest = restoredRun?.previousPatchRequest;
    let bestScore = restoredRun?.bestScore;
    let bestControlPlaneScore = restoredRun?.bestControlPlaneScore ?? 0;
    let bestProofScore = restoredRun?.bestProofScore ?? 0;
    let bestReleaseScore = restoredRun?.bestReleaseScore ?? 0;
    let bestThresholdResults = restoredRun?.bestThresholdResults;
    let bestDimensionScores = restoredRun?.summary.dimension_scores ?? [];
    let bestRound = restoredRun?.bestRound;
    let bestEvalReportPath = restoredRun?.bestEvalReportPath ?? "";
    let bestPatchRequestPath = restoredRun?.bestPatchRequestPath ?? "";
    let plateauCount = restoredRun?.plateauCount ?? 0;
    let previousPatchRequestPath = restoredRun?.previousPatchRequestPath;
    let previousTrajectoryDecision = restoredRun?.previousTrajectoryDecision;
    let previousTrajectoryDecisionPath = restoredRun?.previousTrajectoryDecisionPath;
    let activeContractFrame = restoredRun?.activeContractFrame;
    let repeatedUnresolvedCount = restoredRun?.repeatedUnresolvedCount ?? 0;
    let latestFailureLineage = restoredRun?.latestFailureLineage;
    let latestEvalReport = restoredRun?.latestEvalReport;
    let previousRoundSummary = restoredRun?.previousRoundSummary;
    let scoreDeltas = scoreDeltasForHistory(history);
    let latestRoundState = restoredRun?.latestRoundSummary
        ? {
            score: restoredRun.latestRoundSummary.total_score,
            controlPlaneScore: restoredRun.latestRoundSummary.control_plane_score,
            proofScore: restoredRun.latestRoundSummary.proof_score,
            verdict: restoredRun.latestRoundSummary.overall_verdict,
            unresolvedCheckIds: restoredRun.latestRoundSummary.unresolved_check_ids,
            patchNextAction: restoredRun.previousPatchRequest?.next_action ?? "revise",
            patchMustFixCount: restoredRun.previousPatchRequest?.must_fix.length ?? 0,
            thresholdResults: restoredRun.latestRoundSummary.threshold_results,
            failureLineage: restoredRun.latestFailureLineage,
            staticAdapterContractInvalid: restoredRun.summary.stop_reason === "adapter_contract_invalid"
        }
        : undefined;
    let currentCheckpointStopReason = normalizeRunStopReason(restoredRun?.summary.stop_reason);
    let activeHeartbeatRound = restoredRun?.interruptedRound?.round;
    let activeHeartbeatPhase = input.resumePhase ?? restoredRun?.interruptedRound?.resumeFromPhase;
    let activeHeartbeatPhaseStatus = restoredRun?.interruptedRound?.phaseStatus;
    let activeHeartbeatPhaseStartedAt = restoredRun?.runtimeRoundPhase?.phase_started_at;
    let lastProgressAt = restoredRun?.runtimeLiveState?.last_progress_at ??
        restoredRun?.runtimeRoundPhase?.last_progress_at;
    let lastProgressNote = restoredRun?.runtimeLiveState?.last_progress_note ??
        restoredRun?.runtimeRoundPhase?.last_progress_note;
    let activePhaseTimeoutMs = (activeHeartbeatPhase ? phaseTimeouts[activeHeartbeatPhase] : undefined) ??
        restoredRun?.runtimeLiveState?.phase_timeout_ms ??
        restoredRun?.runtimeRoundPhase?.phase_timeout_ms;
    let activeStallThresholdMs = restoredRun?.runtimeLiveState?.stall_threshold_ms ??
        restoredRun?.runtimeRoundPhase?.stall_threshold_ms ??
        phaseBudgetToStallThresholdMs(activePhaseTimeoutMs);
    let activeExecutionState = restoredRun?.runtimeLiveState?.execution_state ??
        (currentCheckpointStopReason
            ? pausedStopReasons.has(currentCheckpointStopReason)
                ? "paused"
                : "completed"
            : isPausedPhaseStatus(activeHeartbeatPhaseStatus)
                ? "paused"
                : activeHeartbeatPhaseStatus === "stalled"
                    ? "stalled"
                    : "running");
    let activeLeaseStatus = restoredRun?.controllerLease?.status ??
        (activeExecutionState === "completed"
            ? "stopped"
            : activeExecutionState === "failed"
                ? "failed"
                : activeExecutionState === "paused"
                    ? "paused"
                    : activeExecutionState === "stalled"
                        ? "stalled"
                        : "running");
    let latestRoundSummaryPath = restoredRun?.latestRoundSummary && restoredRun.latestRoundSummary.round > 0
        ? join(roundDirectoryFor(runDirectory, restoredRun.latestRoundSummary.round), "round_summary.json")
        : undefined;
    let latestEvalReportPath = restoredRun?.latestRoundSummary?.eval_report_path;
    let latestAdapterMigrationAppliedPath = restoredRun?.summary.adapter_migration_applied_path ??
        restoredRun?.latestRoundSummary?.adapter_migration_applied_path;
    const preappliedAdapterMigrationRounds = new Set();
    const heartbeatNotes = [...(restoredRun?.repairNotes ?? [])];
    const replaceHeartbeatNotes = (notes) => {
        heartbeatNotes.splice(0, heartbeatNotes.length, ...(notes?.length ? unique(notes) : []));
    };
    const activeArtifactPathsFor = (artifacts) => {
        const artifactValues = artifacts
            ? Object.values(artifacts).filter((value) => typeof value === "string")
            : [];
        return {
            activePromptPath: artifactValues.find((value) => value.endsWith(".md") && /prompt/i.test(value)),
            activeResponsePath: artifactValues.find((value) => value.endsWith(".json") && /response/i.test(value))
        };
    };
    const activeCheckpointMetadataFor = async (artifacts, fallback) => {
        const artifactValues = artifacts
            ? Object.values(artifacts).filter((value) => typeof value === "string")
            : [];
        const taskPath = artifactValues.find((value) => value.endsWith(".json") && /task/i.test(value));
        if (taskPath) {
            const taskArtifact = await loadJsonIfExists(taskPath);
            if (taskArtifact && typeof taskArtifact === "object") {
                const checkpointId = "checkpoint_id" in taskArtifact &&
                    typeof taskArtifact.checkpoint_id === "string"
                    ? taskArtifact.checkpoint_id
                    : undefined;
                const checkpointSeq = "checkpoint_seq" in taskArtifact &&
                    typeof taskArtifact.checkpoint_seq === "number"
                    ? taskArtifact.checkpoint_seq
                    : undefined;
                if (checkpointId || checkpointSeq !== undefined) {
                    return {
                        checkpointId,
                        checkpointSeq
                    };
                }
            }
        }
        if (!fallback) {
            return {};
        }
        const checkpointSeq = Date.now();
        return {
            checkpointSeq,
            checkpointId: [
                runId,
                `r${fallback.round}`,
                fallback.phase,
                fallback.checkpointKind,
                String(checkpointSeq)
            ].join(":")
        };
    };
    let { activePromptPath: activePromptArtifactPath, activeResponsePath: activeResponseArtifactPath } = activeArtifactPathsFor(restoredRun?.runtimeRoundPhase?.artifacts);
    const restoredCheckpointMetadata = await activeCheckpointMetadataFor(restoredRun?.runtimeRoundPhase?.artifacts);
    let activeAttentionRequired;
    let activeCheckpointKind;
    let activeCheckpointId = restoredCheckpointMetadata.checkpointId;
    let activeCheckpointSeq = restoredCheckpointMetadata.checkpointSeq;
    let activeAutoResumeEligible;
    let activeUserVisiblePause;
    let activeDecisionOptions;
    let activeRecommendedSkill;
    let activeRecommendedCommand;
    const operatorSurfaceContext = resolveOperatorSurfaceContext({
        controllerMode,
        transportMode
    });
    const manualCurrentThreadProtocol = transportMode === "current-thread" &&
        operatorSurfaceContext.presentationMode === "manual-protocol";
    let transportProtocolCurrentPath = restoredRun?.summary.transport_protocol_path ?? transportProtocolPath;
    const syncActivePhaseBudget = () => {
        const configuredPhaseTimeout = activeHeartbeatPhase ? phaseTimeouts[activeHeartbeatPhase] : undefined;
        activePhaseTimeoutMs =
            configuredPhaseTimeout ??
                (activeHeartbeatPhase === restoredRun?.runtimeRoundPhase?.phase
                    ? restoredRun?.runtimeLiveState?.phase_timeout_ms ??
                        restoredRun?.runtimeRoundPhase?.phase_timeout_ms
                    : undefined);
        activeStallThresholdMs = phaseBudgetToStallThresholdMs(activePhaseTimeoutMs);
    };
    const setExecutionState = (nextState) => {
        activeExecutionState = nextState;
        activeLeaseStatus =
            nextState === "completed"
                ? "stopped"
                : nextState === "failed"
                    ? "failed"
                    : nextState === "paused"
                        ? "paused"
                        : nextState === "stalled"
                            ? "stalled"
                            : "running";
    };
    const defaultSessionObjective = durableMemory.context.finishLine
        ? `Ship a reviewable build that reaches: ${durableMemory.context.finishLine}`
        : `Ship a reviewable build for ${durableMemory.context.title} without leaving the current Codex thread.`;
    const reviewFeedbackFromArtifacts = (input) => unique([
        ...(input.contractReviewArtifact?.required_changes ?? []),
        ...(input.contractReviewArtifact?.concerns ?? []),
        ...(input.patchRequestArtifact?.must_fix.map((item) => item.expected_change) ?? []),
        ...(input.patchRequestArtifact?.quality_findings?.map((finding) => finding.expected_change) ?? []),
        ...(input.evalReport?.blockers ?? []),
        ...(input.evalReport?.next_actions ?? []),
        ...(input.qualityCritiqueArtifact?.findings.map((finding) => finding.expected_change) ?? [])
    ]).slice(0, 12);
    const steeringNotesFromContractReview = (contractReviewArtifact) => contractReviewArtifact
        ? unique([
            ...contractReviewArtifact.concerns,
            ...contractReviewArtifact.required_changes
        ]).slice(0, 12)
        : [];
    const externalBlockersFromPatchRequest = (patchRequestArtifact) => unique(patchRequestArtifact?.environment_blockers?.map((blocker) => `Resolve environment blocker: ${blocker}`) ?? []).slice(0, 12);
    const scopeGuardrailsFromPatchRequest = (patchRequestArtifact) => unique(patchRequestArtifact?.forbidden_scope_expansion ?? []).slice(0, 12);
    let sessionCurrentObjective = previousRoundSummary?.objective ?? defaultSessionObjective;
    let sessionSteeringNotes = [];
    let sessionReviewFeedback = reviewFeedbackFromArtifacts({
        patchRequestArtifact: previousPatchRequest,
        evalReport: latestEvalReport
    });
    let sessionExternalBlockers = externalBlockersFromPatchRequest(previousPatchRequest);
    let sessionScopeGuardrails = scopeGuardrailsFromPatchRequest(previousPatchRequest);
    let latestSessionStatusArtifact;
    let sessionLatestRound = restoredRun?.latestRoundSummary?.round;
    let sessionLatestStopReason = currentCheckpointStopReason;
    const sessionStatusForStopReason = (stopReason) => {
        switch (stopReason) {
            case "awaiting_codex_checkpoint":
            case "awaiting_current_thread_handoff":
            case "awaiting_manual_generator":
                return "running";
            case "awaiting_human_input":
            case "new_run_required":
                return "needs_steering";
            case "awaiting_external_condition":
            case "environment_blocked":
                return "blocked_externally";
            case "target_reached":
            case "contract_completed":
            case "max_rounds_reached":
                return "ready_for_review";
            case "adapter_migration_rejected":
                return "done";
            default:
                return undefined;
        }
    };
    const deriveSessionStatus = (input) => {
        if (input?.override) {
            return input.override;
        }
        const stopReasonStatus = sessionStatusForStopReason(input?.stopReason);
        if (stopReasonStatus) {
            return stopReasonStatus;
        }
        const executionState = input?.executionState ?? activeExecutionState;
        const attentionRequired = input?.attentionRequired ?? activeAttentionRequired;
        if (executionState === "completed") {
            return "done";
        }
        if (executionState === "paused") {
            if (attentionRequired === "human") {
                return "needs_steering";
            }
            if (attentionRequired === "external") {
                return "blocked_externally";
            }
        }
        return history.length > 0 ? "running" : "ready_to_start";
    };
    const updateSessionRefreshState = (input) => {
        if (!input) {
            return;
        }
        if (input.currentObjective !== undefined) {
            sessionCurrentObjective = input.currentObjective;
        }
        if (input.steeringNotes !== undefined) {
            sessionSteeringNotes = unique(input.steeringNotes);
        }
        if (input.reviewFeedback !== undefined) {
            sessionReviewFeedback = unique(input.reviewFeedback);
        }
        if (input.externalBlockers !== undefined) {
            sessionExternalBlockers = unique(input.externalBlockers);
        }
        if (input.scopeGuardrails !== undefined) {
            sessionScopeGuardrails = unique(input.scopeGuardrails);
        }
        if (input.latestRound !== undefined) {
            sessionLatestRound = input.latestRound;
        }
        if (input.latestStopReason !== undefined) {
            sessionLatestStopReason = input.latestStopReason;
        }
    };
    const refreshSessionPreparationArtifacts = async (input) => {
        const snapshot = appServerTransport?.snapshot();
        const sessionContext = resolveOperatorSurfaceContext({
            controllerMode,
            transportMode,
            threadId: snapshot?.thread_id,
            threadName: snapshot?.thread_name
        });
        const result = await writeSessionPreparationArtifacts({
            runId,
            runDirectory,
            rootDirectory: durableMemory.rootDirectory,
            buildBriefPath: runtimeStatePaths.buildBriefPath,
            runContractPath: runtimeStatePaths.runContractPath,
            openQuestionsPath: runtimeStatePaths.openQuestionsPath,
            sessionStatusPath: runtimeStatePaths.sessionStatusPath,
            sessionStatusEventsPath: runtimeStatePaths.sessionStatusEventsPath,
            sessionStreamPath: runtimeStatePaths.sessionStreamPath,
            operatorSurfacePath: runtimeStatePaths.operatorSurfacePath,
            executionPlanPath,
            transportMode,
            appServerSessionEventsPath: runtimeStatePaths.appServerSessionEventsPath,
            threadBindingState: sessionContext.threadBindingState,
            threadId: sessionContext.threadId,
            turnId: snapshot?.turn_id,
            idea,
            durableMemory: durableMemory.context,
            scenario,
            plan,
            workspaceMode: initialOperatorSurfaceArtifact.workspace_surface,
            targetFamily: resolvedTargetFamily,
            ...(resolvedSessionValidationBundle
                ? { validationBundle: resolvedSessionValidationBundle }
                : {}),
            sessionStatus: deriveSessionStatus({
                override: input?.status,
                stopReason: input?.stopReason ?? sessionLatestStopReason,
                attentionRequired: input?.attentionRequired,
                executionState: input?.executionState
            }),
            currentObjective: sessionCurrentObjective,
            steeringNotes: sessionSteeringNotes,
            reviewFeedback: sessionReviewFeedback,
            externalBlockers: sessionExternalBlockers,
            scopeGuardrails: sessionScopeGuardrails,
            latestRound: sessionLatestRound,
            latestStopReason: input?.stopReason ?? sessionLatestStopReason,
            checkpointKind: input?.checkpointKind ?? activeCheckpointKind,
            checkpointId: input?.checkpointId ?? activeCheckpointId,
            checkpointPromptPath: input?.activePromptPath ?? activePromptArtifactPath,
            checkpointResponsePath: input?.activeResponsePath ?? activeResponseArtifactPath,
            checkpointSkill: input?.recommendedSkill ?? activeRecommendedSkill,
            decisionOptions: input?.decisionOptions ?? activeDecisionOptions
        });
        latestSessionStatusArtifact = result.sessionStatus;
    };
    const assertPhaseBudget = () => {
        if (!activeHeartbeatPhase ||
            activeHeartbeatPhaseStatus !== "in_progress" ||
            activePhaseTimeoutMs === undefined ||
            !activeHeartbeatPhaseStartedAt) {
            return;
        }
        const phaseStartedAt = Date.parse(activeHeartbeatPhaseStartedAt);
        if (Number.isNaN(phaseStartedAt)) {
            return;
        }
        if (Date.now() - phaseStartedAt > activePhaseTimeoutMs) {
            throw new PhaseBudgetExceededError(activeHeartbeatPhase, activePhaseTimeoutMs);
        }
    };
    const writeLiveTransportProtocol = async () => {
        transportProtocolCurrentPath = await writeTransportProtocol({
            runDirectory,
            transportMode,
            summary: {
                run_id: runId,
                controller_mode: controllerMode,
                transport_mode: transportMode,
                transport_state_path: runtimeStatePaths.transportStatePath,
                resume_identity_path: currentResumeIdentityPath,
                runtime_round_phase_path: runtimeStatePaths.roundPhasePath
            },
            activeRound: activeHeartbeatRound,
            activePhase: activeHeartbeatPhase,
            activeStatus: activeHeartbeatPhaseStatus,
            latestPatchRequestPath: previousPatchRequestPath,
            latestRoundContractPath: history[history.length - 1]?.contract_path,
            notes: [
                ...heartbeatNotes,
                ...(transportMode === "current-thread"
                    ? [
                        "Keep the current thread as the generator/controller surface. $loop-control owns the same-thread autocontinue chain; use $attached-loop only if this foreground thread needs recovery after interruption."
                    ]
                    : [])
            ]
        });
    };
    const writeOperatorSurface = async (input) => {
        const snapshot = appServerTransport?.snapshot();
        if (input?.activePromptPath !== undefined) {
            activePromptArtifactPath = input.activePromptPath;
        }
        if (input?.activeResponsePath !== undefined) {
            activeResponseArtifactPath = input.activeResponsePath;
        }
        if (input?.attentionRequired !== undefined) {
            activeAttentionRequired = input.attentionRequired;
        }
        if (input?.checkpointKind !== undefined) {
            activeCheckpointKind = input.checkpointKind;
        }
        if (input?.checkpointId !== undefined) {
            activeCheckpointId = input.checkpointId;
        }
        if (input?.checkpointSeq !== undefined) {
            activeCheckpointSeq = input.checkpointSeq;
        }
        if (input?.autoResumeEligible !== undefined) {
            activeAutoResumeEligible = input.autoResumeEligible;
        }
        if (input?.userVisiblePause !== undefined) {
            activeUserVisiblePause = input.userVisiblePause;
        }
        if (input?.decisionOptions !== undefined) {
            activeDecisionOptions =
                input.decisionOptions.length > 0 ? input.decisionOptions : undefined;
        }
        if (input?.recommendedSkill !== undefined) {
            activeRecommendedSkill = input.recommendedSkill;
        }
        if (input?.recommendedCommand !== undefined) {
            activeRecommendedCommand = input.recommendedCommand;
        }
        if (transportMode !== "app-server") {
            await writeTransportStateArtifact(runtimeStatePaths.transportStatePath, buildTransportStateArtifact({
                runId,
                controllerMode,
                transportMode,
                executorMode,
                summaryPath,
                protocolPath: transportProtocolCurrentPath,
                dashboardPath: runtimeStatePaths.operatorSurfaceMarkdownPath,
                sessionStatusPath: runtimeStatePaths.sessionStatusPath,
                sessionStatusEventsPath: runtimeStatePaths.sessionStatusEventsPath,
                sessionStreamPath: runtimeStatePaths.sessionStreamPath,
                ...(latestSessionStatusArtifact
                    ? {
                        session: buildOperatorSurfaceSessionProjection(latestSessionStatusArtifact)
                    }
                    : {}),
                status: "configured",
                notes: transportRuntimeWarningsForMode({
                    controllerMode,
                    transportMode
                })
            }));
        }
        await writeOperatorSurfaceArtifacts({
            jsonPath: runtimeStatePaths.operatorSurfacePath,
            markdownPath: runtimeStatePaths.operatorSurfaceMarkdownPath,
            artifact: buildOperatorSurfaceArtifact({
                runId,
                controllerMode,
                transportMode,
                executionState: input?.executionState ?? activeExecutionState,
                round: input?.round ?? activeHeartbeatRound,
                phase: input?.phase ?? activeHeartbeatPhase,
                phaseStatus: input?.phaseStatus ?? activeHeartbeatPhaseStatus,
                attentionRequired: input?.attentionRequired ?? activeAttentionRequired,
                checkpointKind: input?.checkpointKind ?? activeCheckpointKind,
                checkpointId: input?.checkpointId ?? activeCheckpointId,
                checkpointSeq: input?.checkpointSeq ?? activeCheckpointSeq,
                autoResumeEligible: input?.autoResumeEligible ?? activeAutoResumeEligible,
                userVisiblePause: input?.userVisiblePause ?? activeUserVisiblePause,
                decisionOptions: input?.decisionOptions ?? activeDecisionOptions,
                summaryPath,
                transportStatePath: runtimeStatePaths.transportStatePath,
                transportProtocolPath: transportProtocolCurrentPath,
                sessionStatusPath: runtimeStatePaths.sessionStatusPath,
                sessionStatusEventsPath: runtimeStatePaths.sessionStatusEventsPath,
                sessionStreamPath: runtimeStatePaths.sessionStreamPath,
                activePromptPath: input?.activePromptPath ?? activePromptArtifactPath,
                activeResponsePath: input?.activeResponsePath ?? activeResponseArtifactPath,
                dashboardPath: runtimeStatePaths.operatorSurfaceMarkdownPath,
                threadId: snapshot?.thread_id,
                threadName: snapshot?.thread_name,
                recommendedSkill: input?.recommendedSkill ?? activeRecommendedSkill,
                recommendedCommand: input?.recommendedCommand ?? activeRecommendedCommand,
                session: latestSessionStatusArtifact
                    ? buildOperatorSurfaceSessionProjection(latestSessionStatusArtifact)
                    : undefined,
                nextAction: input?.nextAction,
                notes: input?.notes ?? heartbeatNotes
            })
        });
    };
    await refreshSessionPreparationArtifacts({
        stopReason: currentCheckpointStopReason,
        executionState: activeExecutionState
    });
    await writeOperatorSurface();
    let heartbeat;
    let runtimeStopped = false;
    const stopRuntime = async () => {
        if (runtimeStopped) {
            return;
        }
        runtimeStopped = true;
        await Promise.allSettled([
            appServerTransport?.stop({
                stopReason: currentCheckpointStopReason,
                notes: heartbeatNotes
            }) ?? Promise.resolve(),
            heartbeat?.stop() ?? Promise.resolve()
        ]);
    };
    try {
        await writeLiveTransportProtocol();
        if (transportMode === "app-server" && !appServerTransport) {
            appServerTransport = await startAppServerTransport({
                runId,
                controllerMode,
                executorMode,
                transportStatePath: runtimeStatePaths.transportStatePath,
                summaryPath,
                protocolPath: transportProtocolCurrentPath,
                dashboardPath: runtimeStatePaths.operatorSurfaceMarkdownPath,
                sessionStatusPath: runtimeStatePaths.sessionStatusPath,
                sessionStatusEventsPath: runtimeStatePaths.sessionStatusEventsPath,
                sessionStreamPath: runtimeStatePaths.sessionStreamPath,
                mirroredSessionEventsPath: runtimeStatePaths.appServerSessionEventsPath,
                restoredThreadId: restoredRun?.transportState?.app_server?.thread_id,
                initialRound: activeHeartbeatRound ?? restoredRun?.roundStart ?? history.length + 1,
                initialPhase: activeHeartbeatPhase ?? "negotiation",
                initialStatus: activeHeartbeatPhaseStatus ?? "in_progress",
                initialNotes: heartbeatNotes,
                threadName: `${runId} · ${resolvedTargetFamily ?? "attached-loop"}`,
                defaultTaskTimeoutMs: appServerTaskTimeoutMs,
                requestTimeoutMs: appServerRequestTimeoutMs
            });
        }
        else {
            await writeTransportStateArtifact(runtimeStatePaths.transportStatePath, buildTransportStateArtifact({
                runId,
                controllerMode,
                transportMode,
                executorMode,
                summaryPath,
                protocolPath: transportProtocolCurrentPath,
                dashboardPath: runtimeStatePaths.operatorSurfaceMarkdownPath,
                sessionStatusPath: runtimeStatePaths.sessionStatusPath,
                sessionStatusEventsPath: runtimeStatePaths.sessionStatusEventsPath,
                sessionStreamPath: runtimeStatePaths.sessionStreamPath,
                ...(latestSessionStatusArtifact
                    ? {
                        session: buildOperatorSurfaceSessionProjection(latestSessionStatusArtifact)
                    }
                    : {}),
                status: "configured",
                notes: transportRuntimeWarningsForMode({
                    controllerMode,
                    transportMode
                })
            }));
        }
        await writeOperatorSurface({
            executionState: "configured",
            notes: transportRuntimeWarningsForMode({
                controllerMode,
                transportMode
            })
        });
        heartbeat = startRuntimeHeartbeat({
            runId,
            controllerMode,
            transportMode,
            executorMode,
            paths: runtimeStatePaths,
            getSnapshot: () => ({
                roundCount: history.length,
                executionState: activeExecutionState,
                leaseStatus: activeLeaseStatus,
                ...(activeHeartbeatRound !== undefined ? { round: activeHeartbeatRound } : {}),
                ...(activeHeartbeatPhase ? { phase: activeHeartbeatPhase } : {}),
                ...(activeHeartbeatPhaseStatus
                    ? { phaseStatus: activeHeartbeatPhaseStatus }
                    : {}),
                ...(lastProgressAt ? { lastProgressAt } : {}),
                ...(lastProgressNote ? { lastProgressNote } : {}),
                ...(activePhaseTimeoutMs !== undefined
                    ? { phaseTimeoutMs: activePhaseTimeoutMs }
                    : {}),
                ...(activeStallThresholdMs !== undefined
                    ? { stallThresholdMs: activeStallThresholdMs }
                    : {}),
                ...(activeHeartbeatPhaseStartedAt
                    ? { phaseStartedAt: activeHeartbeatPhaseStartedAt }
                    : {}),
                ...(latestRoundSummaryPath
                    ? { latestRoundSummaryPath }
                    : {}),
                ...(latestEvalReportPath ? { latestEvalReportPath } : {}),
                ...(bestRound !== undefined ? { bestRound } : {}),
                ...(bestScore !== undefined ? { bestTotalScore: bestScore } : {}),
                ...(summaryPath ? { summaryPath } : {}),
                ...(currentCheckpointStopReason
                    ? { stopReason: currentCheckpointStopReason }
                    : {}),
                ...(heartbeatNotes.length > 0 ? { notes: heartbeatNotes } : {})
            })
        });
        const markProgress = async (note) => {
            assertPhaseBudget();
            lastProgressAt = new Date().toISOString();
            lastProgressNote = note;
            if (activeExecutionState !== "paused" &&
                activeExecutionState !== "stalled" &&
                activeExecutionState !== "failed" &&
                activeExecutionState !== "completed") {
                setExecutionState("running");
            }
            await heartbeat.tick();
        };
        const withPhaseBudget = async (phase, work) => {
            const result = await work();
            if (activeHeartbeatPhase === phase) {
                assertPhaseBudget();
            }
            return result;
        };
        const recordRoundPhase = async (inputPhase) => {
            const now = new Date().toISOString();
            activeHeartbeatRound = inputPhase.round;
            activeHeartbeatPhase = inputPhase.phase;
            activeHeartbeatPhaseStatus = inputPhase.status;
            syncActivePhaseBudget();
            if (inputPhase.status === "in_progress") {
                activeHeartbeatPhaseStartedAt = now;
                setExecutionState("running");
            }
            else if (isPausedPhaseStatus(inputPhase.status)) {
                setExecutionState("paused");
            }
            else if (inputPhase.status === "stalled") {
                setExecutionState("stalled");
            }
            if (!isPausedPhaseStatus(inputPhase.status)) {
                activeAttentionRequired = undefined;
                activeCheckpointKind = undefined;
                activeAutoResumeEligible = undefined;
                activeRecommendedSkill = undefined;
                activeRecommendedCommand = undefined;
            }
            if (inputPhase.notes?.length) {
                replaceHeartbeatNotes(inputPhase.notes);
            }
            else if (inputPhase.status === "in_progress" ||
                inputPhase.status === "completed") {
                replaceHeartbeatNotes();
            }
            await writeRuntimeRoundPhaseArtifact(runtimeStatePaths.roundPhasePath, {
                run_id: runId,
                round: inputPhase.round,
                controller_mode: controllerMode,
                transport_mode: transportMode,
                executor_mode: executorMode,
                phase: inputPhase.phase,
                status: inputPhase.status,
                updated_at: now,
                heartbeat_at: now,
                ...(lastProgressAt ? { last_progress_at: lastProgressAt } : {}),
                ...(lastProgressNote ? { last_progress_note: lastProgressNote } : {}),
                ...(activePhaseTimeoutMs !== undefined
                    ? { phase_timeout_ms: activePhaseTimeoutMs }
                    : {}),
                ...(activeStallThresholdMs !== undefined
                    ? { stall_threshold_ms: activeStallThresholdMs }
                    : {}),
                owner_pid: process.pid,
                ...(activeHeartbeatPhaseStartedAt
                    ? { phase_started_at: activeHeartbeatPhaseStartedAt }
                    : {}),
                ...(inputPhase.status === "completed"
                    ? { phase_completed_at: now }
                    : {}),
                ...(appServerTransport?.snapshot().thread_id
                    ? { session: { thread_id: appServerTransport.snapshot().thread_id } }
                    : {}),
                ...(inputPhase.artifacts ? { artifacts: inputPhase.artifacts } : {}),
                ...(heartbeatNotes.length > 0 ? { notes: heartbeatNotes } : {})
            });
            await writeLiveTransportProtocol();
            const { activePromptPath, activeResponsePath } = activeArtifactPathsFor(inputPhase.artifacts);
            activePromptArtifactPath = activePromptPath;
            activeResponseArtifactPath = activeResponsePath;
            await writeOperatorSurface({
                round: inputPhase.round,
                phase: inputPhase.phase,
                phaseStatus: inputPhase.status,
                activePromptPath,
                activeResponsePath,
                notes: heartbeatNotes
            });
            if (appServerTransport) {
                await appServerTransport.syncPhase({
                    round: inputPhase.round,
                    phase: inputPhase.phase,
                    status: inputPhase.status,
                    notes: heartbeatNotes
                });
            }
            await heartbeat.tick();
        };
        const writeCheckpoint = async (stopReason) => {
            const summary = buildCheckpointSummary({
                runId,
                scenarioId: scenario.scenario_id,
                rubricId: hydratedRubric.rubric_id,
                controllerMode,
                transportMode,
                executorMode,
                targetFamily: resolvedTargetFamily,
                validationLane: resolvedValidationLane,
                evaluatorProfilePath: bundleSelection.evaluatorProfilePath,
                adapterContractSha256: currentResumeIdentity.adapter_contract_sha256,
                evaluatorBundleSha256: currentResumeIdentity.evaluator_bundle_sha256,
                rubricSha256: currentResumeIdentity.rubric_sha256,
                plannerBriefPath,
                plannedScenarioPath,
                planPath,
                ideaPath: defaultIdeaPath,
                featureListPath: durableMemoryPaths.feature_list_path,
                progressPath: durableMemoryPaths.progress_path,
                progressLogPath: durableMemoryPaths.progress_log_path,
                doneWhenPath: durableMemoryPaths.done_when_path,
                initScriptPath: durableMemoryPaths.init_script_path,
                adapterContractPath: loadedAdapter?.contract_path,
                adapterId: loadedAdapter?.contract.adapter_id,
                verificationProviderId: loadedAdapter?.contract.verification_provider?.provider_id,
                adapterAttached: Boolean(loadedAdapter),
                codexSessionRegistryPath,
                resumeIdentityPath: currentResumeIdentityPath,
                runtimeLiveStatePath: runtimeStatePaths.liveStatePath,
                runtimeRoundPhasePath: runtimeStatePaths.roundPhasePath,
                controllerLeasePath: runtimeStatePaths.controllerLeasePath,
                transportStatePath: runtimeStatePaths.transportStatePath,
                transportProtocolPath: transportProtocolCurrentPath,
                operatorSurfacePath: runtimeStatePaths.operatorSurfacePath,
                sessionStatusPath: runtimeStatePaths.sessionStatusPath,
                sessionStatusEventsPath: runtimeStatePaths.sessionStatusEventsPath,
                sessionStreamPath: runtimeStatePaths.sessionStreamPath,
                stopReason,
                bestRound,
                bestScore,
                bestControlPlaneScore,
                bestProofScore,
                bestReleaseScore,
                bestThresholdResults,
                bestDimensionScores,
                history,
                runtimeEvents: currentRuntimeEvents,
                runtimeWarnings,
                resumeMigrationPath,
                previousBundleFingerprint,
                newBundleFingerprint,
                adapterMigrationAppliedPath: latestAdapterMigrationAppliedPath,
                resumeDecisionPath: undefined,
                resumedFromRunId: input.resumeRunPath ? runId : undefined
            });
            await Promise.all([
                writeJson(currentResumeIdentityPath, currentResumeIdentity),
                writeRunCheckpoint({
                    runDirectory,
                    summary,
                    currentBest: {
                        round: history[history.length - 1]?.round,
                        totalScore: history[history.length - 1]?.total_score ?? bestScore,
                        controlPlaneScore: history[history.length - 1]?.control_plane_score ?? bestControlPlaneScore,
                        proofScore: history[history.length - 1]?.proof_score ?? bestProofScore,
                        releaseScore: history[history.length - 1]?.release_score ?? bestReleaseScore,
                        thresholdResults: history[history.length - 1]?.threshold_results ?? bestThresholdResults,
                        dimensionScores: history[history.length - 1]?.dimension_scores ?? bestDimensionScores,
                        patchRequestPath: history[history.length - 1]?.patch_request_path ?? bestPatchRequestPath,
                        evalReportPath: history[history.length - 1]?.eval_report_path ?? bestEvalReportPath,
                        bestScoringRound: bestRound,
                        bestScoringTotalScore: bestScore,
                        bestScoringControlPlaneScore: bestControlPlaneScore,
                        bestScoringProofScore: bestProofScore,
                        bestScoringReleaseScore: bestReleaseScore,
                        bestScoringThresholdResults: bestThresholdResults,
                        bestScoringDimensionScores: bestDimensionScores,
                        bestScoringPatchRequestPath: bestPatchRequestPath,
                        bestScoringEvalReportPath: bestEvalReportPath
                    }
                })
            ]);
            if (crashAfterCheckpointEnabled() && history.length > 0) {
                const crashMarkerPath = join(runtimeStatePaths.runtimeDirectory, "test-crash-after-checkpoint.marker");
                if (!(await pathExists(crashMarkerPath))) {
                    await writeText(crashMarkerPath, `Triggered after round ${history[history.length - 1]?.round ?? 0}.\n`);
                    throw new Error(`HARNESS_TEST_CRASH_AFTER_CHECKPOINT_ONCE triggered after round ${history[history.length - 1]?.round ?? 0}.`);
                }
            }
            currentCheckpointStopReason = summary.stop_reason;
            updateSessionRefreshState({
                latestStopReason: summary.stop_reason,
                latestRound: history[history.length - 1]?.round
            });
            await refreshSessionPreparationArtifacts({
                stopReason: summary.stop_reason,
                executionState: activeExecutionState
            });
            await writeOperatorSurface({
                executionState: activeExecutionState,
                notes: heartbeatNotes
            });
            await heartbeat.tick();
            return summary;
        };
        const clearActiveCheckpointSurface = () => {
            activeAttentionRequired = undefined;
            activeCheckpointKind = undefined;
            activeCheckpointId = undefined;
            activeCheckpointSeq = undefined;
            activeAutoResumeEligible = undefined;
            activeUserVisiblePause = undefined;
            activeDecisionOptions = undefined;
            activeRecommendedSkill = undefined;
            activeRecommendedCommand = undefined;
            activePromptArtifactPath = undefined;
            activeResponseArtifactPath = undefined;
        };
        const finalizeRunAsPausedStop = async (input) => {
            runtimeWarnings = unique([...runtimeWarnings, ...input.notes]);
            replaceHeartbeatNotes(unique([...heartbeatNotes, ...input.notes]));
            updateSessionRefreshState({
                ...(input.attentionRequired === "human"
                    ? { steeringNotes: input.notes }
                    : {}),
                ...(input.attentionRequired === "external"
                    ? { externalBlockers: input.notes }
                    : {}),
                latestStopReason: input.stopReason
            });
            await refreshSessionPreparationArtifacts({
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
            await writeLiveTransportProtocol();
            await writeOperatorSurface({
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
                notes: heartbeatNotes
            });
            const summary = await writeCheckpoint(input.stopReason);
            return {
                plan,
                summary,
                runDirectory,
                plannedScenarioPath
            };
        };
        const finalizeRunAsTerminalDecisionStop = async (input) => {
            currentRuntimeEvents = mergeRuntimeEvents([
                ...currentRuntimeEvents,
                buildRuntimeEvent(input.runtimeEventCode, input.runtimeEventMessage, input.runtimeEventMetadata)
            ]);
            runtimeWarnings = normalizeRuntimeWarnings([
                ...runtimeWarnings,
                ...input.notes,
                input.runtimeEventMessage
            ]);
            replaceHeartbeatNotes(unique([...heartbeatNotes, ...input.notes]));
            updateSessionRefreshState({
                steeringNotes: input.notes,
                latestStopReason: input.stopReason
            });
            await refreshSessionPreparationArtifacts({
                stopReason: input.stopReason,
                attentionRequired: "human",
                executionState: "completed"
            });
            await recordRoundPhase({
                round: input.round,
                phase: input.phase,
                status: "completed",
                artifacts: input.artifacts ?? {},
                notes: input.notes
            });
            clearActiveCheckpointSurface();
            setExecutionState("completed");
            await writeLiveTransportProtocol();
            await writeOperatorSurface({
                executionState: "completed",
                attentionRequired: "none",
                decisionOptions: [],
                notes: heartbeatNotes
            });
            const summary = await writeCheckpoint(input.stopReason);
            return {
                plan,
                summary,
                runDirectory,
                plannedScenarioPath
            };
        };
        const pauseForHumanInput = async (input) => {
            const { activePromptPath, activeResponsePath } = activeArtifactPathsFor(input.artifacts);
            const checkpointMetadata = await activeCheckpointMetadataFor(input.artifacts, {
                round: input.round,
                phase: input.phase,
                checkpointKind: input.checkpointKind ?? "planner"
            });
            await recordRoundPhase({
                round: input.round,
                phase: input.phase,
                status: "awaiting_human_input",
                artifacts: input.artifacts ?? {},
                notes: input.notes
            });
            return finalizeRunAsPausedStop({
                stopReason: "awaiting_human_input",
                notes: input.notes,
                attentionRequired: "human",
                checkpointKind: input.checkpointKind,
                checkpointId: checkpointMetadata.checkpointId,
                checkpointSeq: checkpointMetadata.checkpointSeq,
                autoResumeEligible: false,
                userVisiblePause: true,
                decisionOptions: input.decisionOptions,
                recommendedSkill: "loop-control",
                recommendedCommand: input.recommendedCommand,
                activePromptPath,
                activeResponsePath
            });
        };
        const pauseForExternalCondition = async (input) => {
            const { activePromptPath, activeResponsePath } = activeArtifactPathsFor(input.artifacts);
            const checkpointMetadata = await activeCheckpointMetadataFor(input.artifacts, {
                round: input.round,
                phase: input.phase,
                checkpointKind: input.checkpointKind ?? "evaluator"
            });
            await recordRoundPhase({
                round: input.round,
                phase: input.phase,
                status: "awaiting_external_condition",
                artifacts: input.artifacts ?? {},
                notes: input.notes
            });
            return finalizeRunAsPausedStop({
                stopReason: "awaiting_external_condition",
                notes: input.notes,
                attentionRequired: "external",
                checkpointKind: input.checkpointKind,
                checkpointId: checkpointMetadata.checkpointId,
                checkpointSeq: checkpointMetadata.checkpointSeq,
                autoResumeEligible: false,
                userVisiblePause: true,
                recommendedSkill: "loop-control",
                recommendedCommand: input.recommendedCommand,
                activePromptPath,
                activeResponsePath
            });
        };
        const checkpointForCurrentThreadWork = async (input) => {
            if (manualCurrentThreadProtocol) {
                const manualProtocolNotes = input.notes.filter((note) => !/not a human decision stop/i.test(note));
                return pauseForHumanInput({
                    round: input.round,
                    phase: input.phase,
                    checkpointKind: input.checkpointKind,
                    artifacts: input.artifacts,
                    notes: unique([
                        ...manualProtocolNotes,
                        "This current-thread run is using the manual protocol, so a human operator must complete the active checkpoint before resuming."
                    ])
                });
            }
            const { activePromptPath, activeResponsePath } = activeArtifactPathsFor(input.artifacts);
            const checkpointMetadata = await activeCheckpointMetadataFor(input.artifacts, {
                round: input.round,
                phase: input.phase,
                checkpointKind: input.checkpointKind
            });
            await recordRoundPhase({
                round: input.round,
                phase: input.phase,
                status: "awaiting_codex_work",
                artifacts: input.artifacts,
                notes: input.notes
            });
            return finalizeRunAsPausedStop({
                stopReason: canonicalCodexCheckpointStopReason,
                notes: input.notes,
                attentionRequired: "codex",
                checkpointKind: input.checkpointKind,
                checkpointId: checkpointMetadata.checkpointId,
                checkpointSeq: checkpointMetadata.checkpointSeq,
                autoResumeEligible: true,
                userVisiblePause: false,
                recommendedSkill: "loop-control",
                activePromptPath,
                activeResponsePath
            });
        };
        const applyAuthorizedGeneratedLocalMigrationForRound = async (input) => {
            if (!loadedAdapter) {
                throw new Error(`Adapter migration '${input.proposal.proposal_id}' cannot apply because no adapter is loaded.`);
            }
            const previousAdapterResumeIdentity = currentResumeIdentity;
            const adapterContractPath = loadedAdapter.contract_path;
            const migrationResult = await applyGeneratedLocalAdapterMigration({
                proposal: input.proposal,
                loadedAdapter,
                runtimeDirectory: runRuntimeDirectory
            });
            const generatedAdapterRoot = dirname(resolve(adapterContractPath));
            const generatedScriptRoot = basename(generatedAdapterRoot) === "generated-adapter"
                ? resolve(generatedAdapterRoot, "codex-adapter", "scripts")
                : resolve(generatedAdapterRoot, ".generated", "codex-adapter", "scripts");
            const generatedRuntimeConfig = resolve(generatedAdapterRuntimeConfigPath(adapterContractPath));
            const scopeViolation = migrationResult.changedFiles.find((changedFile) => {
                const resolvedChangedFile = resolve(changedFile);
                return !(resolvedChangedFile === resolve(adapterContractPath) ||
                    resolvedChangedFile === generatedRuntimeConfig ||
                    resolvedChangedFile.startsWith(`${generatedScriptRoot}\\`) ||
                    resolvedChangedFile.startsWith(`${generatedScriptRoot}/`));
            });
            if (scopeViolation) {
                throw new Error(`Adapter recontract scope violation: '${scopeViolation}' is outside the generated adapter write surface.`);
            }
            const reloadedAdapter = await loadAdapterContract(adapterContractPath);
            if (!reloadedAdapter) {
                throw new Error(`Adapter migration '${input.proposal.proposal_id}' rewrote '${adapterContractPath}' but the adapter could not be reloaded.`);
            }
            loadedAdapter = selectedVerificationProfile
                ? {
                    ...reloadedAdapter,
                    verification_profile: selectedVerificationProfile,
                    verification_profile_source: "core"
                }
                : reloadedAdapter;
            currentResumeIdentity = await buildResumeIdentityState({
                adapterContractPath: loadedAdapter.contract_path,
                evaluatorProfilePath: bundleSelection.evaluatorProfilePath,
                rubricPath: effectiveRubricPath,
                executorMode,
                transportMode,
                targetFamily: resolvedTargetFamily,
                validationLane: resolvedValidationLane
            });
            await writeJson(currentResumeIdentityPath, currentResumeIdentity);
            const migrationMismatches = compareResumeIdentity({
                current: currentResumeIdentity,
                previous: previousAdapterResumeIdentity
            });
            resumeMigrationPath = join(runDirectory, "resume-migration.json");
            previousBundleFingerprint = resumeIdentityFingerprint(previousAdapterResumeIdentity);
            newBundleFingerprint = resumeIdentityFingerprint(currentResumeIdentity);
            await writeJson(resumeMigrationPath, {
                run_id: runId,
                migrated_at: new Date().toISOString(),
                mismatches: migrationMismatches,
                previous_identity: previousAdapterResumeIdentity,
                new_identity: currentResumeIdentity,
                authorized_adapter_migration: true,
                adapter_migration_proposal_path: input.artifacts.adapter_migration_proposal_json_path
            });
            const appliedMigration = {
                proposal_id: input.proposal.proposal_id,
                applied_at: new Date().toISOString(),
                apply_mode: input.proposal.apply_mode,
                changed_files: migrationResult.changedFiles,
                backup_directory: migrationResult.backupDirectory,
                old_identity: previousAdapterResumeIdentity,
                new_identity: currentResumeIdentity,
                same_run_authorized: true
            };
            await writeJson(input.artifacts.adapter_migration_applied_json_path, appliedMigration);
            latestAdapterMigrationAppliedPath =
                input.artifacts.adapter_migration_applied_json_path;
            currentRuntimeEvents = mergeRuntimeEvents([
                ...currentRuntimeEvents,
                buildRuntimeEvent("adapter.migration_applied", `Applied adapter migration '${input.proposal.proposal_id}' on this run before recontract negotiation continued.`, {
                    round: input.round,
                    proposal_id: input.proposal.proposal_id,
                    migrated_run_id: runId
                })
            ]);
            runtimeWarnings = normalizeRuntimeWarnings([
                ...runtimeWarnings,
                `Adapter migration '${input.proposal.proposal_id}' updated the generated adapter surface before recontract negotiation continued.`
            ]);
            return appliedMigration;
        };
        const hydrateRestoredAdapterMigrationProposal = async (input) => {
            if (!loadedAdapter) {
                return input.proposal;
            }
            const authoringTask = input.authoringTask ??
                (await loadJsonIfExists(input.artifacts.adapter_migration_authoring_task_path));
            if (!authoringTask) {
                return input.proposal;
            }
            const authoringResponse = await readAdapterMigrationAuthoringResponse(input.artifacts.adapter_migration_authoring_response_path, authoringTask.checkpoint_id);
            if (!authoringResponse || authoringResponse.status !== "authored") {
                return input.proposal;
            }
            const authoredPatchBundlePath = resolve(authoringResponse.patch_bundle_path ??
                input.artifacts.adapter_migration_patch_path);
            if (!(await pathExists(authoredPatchBundlePath))) {
                return input.proposal;
            }
            const authoredAdapterRoot = dirname(loadedAdapter.contract_path);
            const hydratedProposal = {
                ...input.proposal,
                patch_bundle_path: authoredPatchBundlePath,
                affected_files: unique([
                    ...input.proposal.affected_files,
                    ...(authoringResponse.changed_files ?? []).map((changedFile) => resolve(authoredAdapterRoot, changedFile))
                ])
            };
            await writeAdapterMigrationProposalArtifacts({
                roundDirectory: input.artifacts.round_directory,
                proposal: hydratedProposal
            });
            return hydratedProposal;
        };
        const adapterMigrationApprovalReadyNote = (proposal) => proposal.force_new_run
            ? "This migration crosses an adapter boundary that cannot be authorized in place, so opening a new run is the canonical next step."
            : proposal.same_run_eligible && proposal.patch_bundle_path
                ? "A same-run migration bundle is ready. Accept applies it on this run, reject closes the proposal, and open_new_run moves the migration to a fresh run."
                : proposal.patch_bundle_path
                    ? "A proposal bundle is ready. Accept pauses on external/manual apply, reject closes the proposal, and open_new_run moves the migration to a fresh run."
                    : "This migration cannot auto-apply safely, so an operator must accept, reject, or open a new run before recontract negotiation continues.";
        const adapterMigrationAuthoringNotes = (proposal) => proposal.same_run_eligible
            ? [
                "Author a patch bundle for the generated adapter surface before human approval opens.",
                "Keep the migration inside adapter.generated.json or .generated/codex-adapter/* only.",
                "This is a same-thread Codex checkpoint, not a human decision stop."
            ]
            : [
                "Author an advisory migration bundle for the external adapter surface before human approval opens.",
                "Keep the bundle scoped to the external adapter workspace so it can be applied outside this run.",
                "This is a same-thread Codex checkpoint, not a human decision stop."
            ];
        if (restoredRun &&
            isCurrentThreadCheckpointStopReason(restoredStopReason) &&
            restoredRun.interruptedRound?.resumeFromPhase === "negotiation") {
            const restoredRoundArtifacts = artifactsForRound(restoredRun.interruptedRound.roundDirectory);
            const restoredAuthoringTask = await loadJsonIfExists(restoredRoundArtifacts.adapter_migration_authoring_task_path);
            if (restoredAuthoringTask) {
                const restoredAuthoringResponse = await readAdapterMigrationAuthoringResponse(restoredRoundArtifacts.adapter_migration_authoring_response_path, restoredAuthoringTask.checkpoint_id);
                const authoringArtifacts = {
                    adapter_migration_authoring_task_path: restoredRoundArtifacts.adapter_migration_authoring_task_path,
                    adapter_migration_authoring_prompt_path: restoredRoundArtifacts.adapter_migration_authoring_prompt_path,
                    adapter_migration_authoring_response_path: restoredRoundArtifacts.adapter_migration_authoring_response_path,
                    adapter_migration_patch_path: restoredRoundArtifacts.adapter_migration_patch_path,
                    adapter_migration_proposal_json_path: restoredRoundArtifacts.adapter_migration_proposal_json_path,
                    adapter_migration_instructions_path: restoredRoundArtifacts.adapter_migration_instructions_path
                };
                if (!restoredAuthoringResponse) {
                    return checkpointForCurrentThreadWork({
                        round: restoredRun.interruptedRound.round,
                        phase: "negotiation",
                        checkpointKind: "adapter-migration-authoring",
                        artifacts: authoringArtifacts,
                        notes: unique([
                            `Adapter migration authoring checkpoint '${restoredAuthoringTask.checkpoint_id}' is still waiting for a response.`,
                            `Write ${restoredRoundArtifacts.adapter_migration_authoring_response_path} after authoring ${restoredRoundArtifacts.adapter_migration_patch_path}.`
                        ])
                    });
                }
                if (restoredAuthoringResponse.status !== "authored") {
                    return checkpointForCurrentThreadWork({
                        round: restoredRun.interruptedRound.round,
                        phase: "negotiation",
                        checkpointKind: "adapter-migration-authoring",
                        artifacts: authoringArtifacts,
                        notes: unique([
                            `Adapter migration authoring response for proposal round ${restoredRun.interruptedRound.round} reported status '${restoredAuthoringResponse.status}'.`,
                            `Rewrite ${restoredRoundArtifacts.adapter_migration_authoring_response_path} with status 'authored' after updating ${restoredRoundArtifacts.adapter_migration_patch_path}.`,
                            ...(restoredAuthoringResponse.notes ?? [])
                        ])
                    });
                }
                const restoredProposal = await loadJsonIfExists(restoredRoundArtifacts.adapter_migration_proposal_json_path);
                if (restoredProposal) {
                    const hydratedRestoredProposal = await hydrateRestoredAdapterMigrationProposal({
                        artifacts: restoredRoundArtifacts,
                        proposal: restoredProposal,
                        authoringTask: restoredAuthoringTask
                    });
                    const restoredResponse = await loadAdapterMigrationResponse(restoredRoundArtifacts.adapter_migration_response_json_path);
                    if (!restoredResponse) {
                        const decisionOptions = decisionOptionsForAdapterMigrationProposal(hydratedRestoredProposal);
                        return pauseForHumanInput({
                            round: restoredRun.interruptedRound.round,
                            phase: "negotiation",
                            checkpointKind: "adapter-migration-approval",
                            artifacts: {
                                adapter_migration_proposal_json_path: restoredRoundArtifacts.adapter_migration_proposal_json_path,
                                adapter_migration_proposal_md_path: restoredRoundArtifacts.adapter_migration_proposal_md_path,
                                adapter_migration_approval_prompt_path: restoredRoundArtifacts.adapter_migration_approval_prompt_path,
                                adapter_migration_response_json_path: restoredRoundArtifacts.adapter_migration_response_json_path,
                                adapter_migration_response_md_path: restoredRoundArtifacts.adapter_migration_response_md_path,
                                adapter_migration_instructions_path: restoredRoundArtifacts.adapter_migration_instructions_path
                            },
                            decisionOptions,
                            notes: unique([
                                `Adapter migration proposal '${hydratedRestoredProposal.proposal_id}' is ready for review on this thread.`,
                                adapterMigrationApprovalReadyNote(hydratedRestoredProposal),
                                `Review ${restoredRoundArtifacts.adapter_migration_proposal_md_path} and write ${restoredRoundArtifacts.adapter_migration_response_json_path} with an explicit migration decision.`,
                                ...(hydratedRestoredProposal.force_new_run
                                    ? ["Prefer 'open_new_run' unless you are explicitly rejecting the migration proposal."]
                                    : [])
                            ])
                        });
                    }
                }
            }
        }
        if (restoredRun &&
            restoredStopReason === "awaiting_human_input" &&
            restoredRun.interruptedRound?.resumeFromPhase === "negotiation") {
            const restoredRoundArtifacts = artifactsForRound(restoredRun.interruptedRound.roundDirectory);
            const authoringArtifacts = {
                adapter_migration_authoring_task_path: restoredRoundArtifacts.adapter_migration_authoring_task_path,
                adapter_migration_authoring_prompt_path: restoredRoundArtifacts.adapter_migration_authoring_prompt_path,
                adapter_migration_authoring_response_path: restoredRoundArtifacts.adapter_migration_authoring_response_path,
                adapter_migration_patch_path: restoredRoundArtifacts.adapter_migration_patch_path,
                adapter_migration_proposal_json_path: restoredRoundArtifacts.adapter_migration_proposal_json_path,
                adapter_migration_instructions_path: restoredRoundArtifacts.adapter_migration_instructions_path
            };
            const restoredAuthoringTask = await loadJsonIfExists(restoredRoundArtifacts.adapter_migration_authoring_task_path);
            if (restoredAuthoringTask) {
                const restoredAuthoringResponse = await readAdapterMigrationAuthoringResponse(restoredRoundArtifacts.adapter_migration_authoring_response_path, restoredAuthoringTask.checkpoint_id);
                if (!restoredAuthoringResponse) {
                    return pauseForHumanInput({
                        round: restoredRun.interruptedRound.round,
                        phase: "negotiation",
                        checkpointKind: "adapter-migration-authoring",
                        artifacts: authoringArtifacts,
                        notes: unique([
                            `Adapter migration authoring checkpoint '${restoredAuthoringTask.checkpoint_id}' is still waiting for a response.`,
                            `Write ${restoredRoundArtifacts.adapter_migration_authoring_response_path} after authoring ${restoredRoundArtifacts.adapter_migration_patch_path}.`
                        ])
                    });
                }
                if (restoredAuthoringResponse.status !== "authored") {
                    return pauseForHumanInput({
                        round: restoredRun.interruptedRound.round,
                        phase: "negotiation",
                        checkpointKind: "adapter-migration-authoring",
                        artifacts: authoringArtifacts,
                        notes: unique([
                            `Adapter migration authoring checkpoint '${restoredAuthoringTask.checkpoint_id}' reported status '${restoredAuthoringResponse.status}'.`,
                            `Rewrite ${restoredRoundArtifacts.adapter_migration_authoring_response_path} with status 'authored' after updating ${restoredRoundArtifacts.adapter_migration_patch_path}.`,
                            ...(restoredAuthoringResponse.notes ?? [])
                        ])
                    });
                }
            }
            const approvalArtifacts = {
                adapter_migration_proposal_json_path: restoredRoundArtifacts.adapter_migration_proposal_json_path,
                adapter_migration_proposal_md_path: restoredRoundArtifacts.adapter_migration_proposal_md_path,
                adapter_migration_approval_prompt_path: restoredRoundArtifacts.adapter_migration_approval_prompt_path,
                adapter_migration_response_json_path: restoredRoundArtifacts.adapter_migration_response_json_path,
                adapter_migration_response_md_path: restoredRoundArtifacts.adapter_migration_response_md_path,
                adapter_migration_instructions_path: restoredRoundArtifacts.adapter_migration_instructions_path
            };
            const restoredProposal = await loadJsonIfExists(approvalArtifacts.adapter_migration_proposal_json_path);
            if (restoredProposal) {
                const hydratedRestoredProposal = await hydrateRestoredAdapterMigrationProposal({
                    artifacts: restoredRoundArtifacts,
                    proposal: restoredProposal,
                    authoringTask: restoredAuthoringTask ?? undefined
                });
                const restoredResponse = await loadAdapterMigrationResponse(approvalArtifacts.adapter_migration_response_json_path);
                const decisionOptions = decisionOptionsForAdapterMigrationProposal(hydratedRestoredProposal);
                if (!restoredResponse) {
                    return pauseForHumanInput({
                        round: restoredRun.interruptedRound.round,
                        phase: "negotiation",
                        checkpointKind: "adapter-migration-approval",
                        artifacts: approvalArtifacts,
                        decisionOptions,
                        notes: unique([
                            `Adapter migration proposal '${hydratedRestoredProposal.proposal_id}' is still waiting for an explicit approval response.`,
                            `Write ${approvalArtifacts.adapter_migration_response_json_path} with one of: ${decisionOptions.join(", ")}.`
                        ])
                    });
                }
                if (restoredResponse.proposal_id !== hydratedRestoredProposal.proposal_id) {
                    return pauseForHumanInput({
                        round: restoredRun.interruptedRound.round,
                        phase: "negotiation",
                        checkpointKind: "adapter-migration-approval",
                        artifacts: approvalArtifacts,
                        decisionOptions,
                        notes: unique([
                            `Adapter migration response '${approvalArtifacts.adapter_migration_response_json_path}' targets proposal '${restoredResponse.proposal_id}', but the active proposal is '${hydratedRestoredProposal.proposal_id}'.`,
                            "Rewrite the response artifact so it references the active proposal before resuming this run."
                        ])
                    });
                }
                if (!decisionOptions.includes(restoredResponse.decision)) {
                    return pauseForHumanInput({
                        round: restoredRun.interruptedRound.round,
                        phase: "negotiation",
                        checkpointKind: "adapter-migration-approval",
                        artifacts: approvalArtifacts,
                        decisionOptions,
                        notes: unique([
                            `Decision '${restoredResponse.decision}' is not valid for adapter migration proposal '${hydratedRestoredProposal.proposal_id}'.`,
                            `Allowed decisions: ${decisionOptions.join(", ")}.`
                        ])
                    });
                }
                if (restoredResponse.decision === "reject") {
                    return finalizeRunAsTerminalDecisionStop({
                        round: restoredRun.interruptedRound.round,
                        phase: "negotiation",
                        stopReason: "adapter_migration_rejected",
                        artifacts: approvalArtifacts,
                        notes: unique([
                            `Adapter migration proposal '${hydratedRestoredProposal.proposal_id}' was rejected by the operator.`,
                            ...(restoredResponse.note
                                ? [`Operator note: ${restoredResponse.note}`]
                                : [])
                        ]),
                        runtimeEventCode: "adapter.migration_rejected",
                        runtimeEventMessage: `Adapter migration proposal '${hydratedRestoredProposal.proposal_id}' was rejected on this run.`,
                        runtimeEventMetadata: {
                            round: restoredRun.interruptedRound.round,
                            proposal_id: hydratedRestoredProposal.proposal_id,
                            decision: restoredResponse.decision,
                            migrated_run_id: runId
                        }
                    });
                }
                if (restoredResponse.decision === "open_new_run") {
                    return finalizeRunAsTerminalDecisionStop({
                        round: restoredRun.interruptedRound.round,
                        phase: "negotiation",
                        stopReason: "new_run_required",
                        artifacts: approvalArtifacts,
                        notes: unique([
                            `Adapter migration proposal '${hydratedRestoredProposal.proposal_id}' was routed to a new run by the operator.`,
                            ...(restoredResponse.note
                                ? [`Operator note: ${restoredResponse.note}`]
                                : [])
                        ]),
                        runtimeEventCode: "adapter.migration_new_run_requested",
                        runtimeEventMessage: `Adapter migration proposal '${hydratedRestoredProposal.proposal_id}' was routed to a new run after operator review.`,
                        runtimeEventMetadata: {
                            round: restoredRun.interruptedRound.round,
                            proposal_id: hydratedRestoredProposal.proposal_id,
                            decision: restoredResponse.decision,
                            migrated_run_id: runId
                        }
                    });
                }
                if (hydratedRestoredProposal.adapter_origin === "generated_local" &&
                    hydratedRestoredProposal.same_run_eligible &&
                    hydratedRestoredProposal.patch_bundle_path) {
                    currentRuntimeEvents = mergeRuntimeEvents([
                        ...currentRuntimeEvents,
                        buildRuntimeEvent("adapter.migration_accepted", `Adapter migration proposal '${hydratedRestoredProposal.proposal_id}' was accepted for same-run apply on this run.`, {
                            round: restoredRun.interruptedRound.round,
                            proposal_id: hydratedRestoredProposal.proposal_id,
                            decision: restoredResponse.decision,
                            migrated_run_id: runId
                        })
                    ]);
                    await applyAuthorizedGeneratedLocalMigrationForRound({
                        round: restoredRun.interruptedRound.round,
                        artifacts: restoredRoundArtifacts,
                        proposal: hydratedRestoredProposal
                    });
                    preappliedAdapterMigrationRounds.add(restoredRun.interruptedRound.round);
                }
                if (!(hydratedRestoredProposal.adapter_origin === "generated_local" &&
                    hydratedRestoredProposal.same_run_eligible &&
                    hydratedRestoredProposal.patch_bundle_path)) {
                    currentRuntimeEvents = mergeRuntimeEvents([
                        ...currentRuntimeEvents,
                        buildRuntimeEvent("adapter.migration_accepted", `Adapter migration proposal '${hydratedRestoredProposal.proposal_id}' was accepted and now waits for external or manual apply work before this run can continue.`, {
                            round: restoredRun.interruptedRound.round,
                            proposal_id: hydratedRestoredProposal.proposal_id,
                            decision: restoredResponse.decision,
                            migrated_run_id: runId
                        })
                    ]);
                    runtimeWarnings = normalizeRuntimeWarnings([
                        ...runtimeWarnings,
                        `Adapter migration proposal '${hydratedRestoredProposal.proposal_id}' was accepted but still requires external or manual apply work before same-run continuation can resume.`
                    ]);
                    return pauseForExternalCondition({
                        round: restoredRun.interruptedRound.round,
                        phase: "negotiation",
                        checkpointKind: "adapter-migration-approval",
                        artifacts: approvalArtifacts,
                        notes: unique([
                            `Adapter migration proposal '${hydratedRestoredProposal.proposal_id}' was accepted.`,
                            hydratedRestoredProposal.force_new_run
                                ? "This proposal still requires opening a new run because it cannot be migrated in place."
                                : "This proposal cannot auto-apply in place. Apply the proposal bundle or complete the adapter migration manually before resuming this run.",
                            `Reference ${approvalArtifacts.adapter_migration_proposal_md_path}, ${approvalArtifacts.adapter_migration_response_json_path}, and ${approvalArtifacts.adapter_migration_instructions_path} while applying the migration.`,
                            ...(restoredResponse.note
                                ? [`Operator note: ${restoredResponse.note}`]
                                : [])
                        ])
                    });
                }
            }
        }
        if (pendingPlannerEnhancementPause) {
            return checkpointForCurrentThreadWork({
                round: 0,
                phase: "planning",
                checkpointKind: pendingPlannerEnhancementPause.checkpointKind,
                artifacts: pendingPlannerEnhancementPause.artifacts,
                notes: pendingPlannerEnhancementPause.notes
            });
        }
        await writeCheckpoint(restoredStopReason);
        const repairRoundLimit = input.repairOnly
            ? restoredRun?.interruptedRound?.round
            : undefined;
        if (input.repairOnly && !repairRoundLimit) {
            const repairedSummary = await writeCheckpoint(restoredStopReason);
            return {
                plan,
                summary: repairedSummary,
                runDirectory,
                plannedScenarioPath
            };
        }
        for (let round = restoredRun?.roundStart ?? 1; round <= (repairRoundLimit ?? executionMaxRounds); round += 1) {
            const roundDirectory = roundDirectoryFor(runDirectory, round);
            await mkdir(roundDirectory, { recursive: true });
            const remediationHistory = buildRemediationHistory({
                previousPatchRequest,
                activeContractFrame,
                latestFailureLineage,
                repeatedUnresolvedCount,
                scoreDeltas
            });
            const lifecycleDecision = decideAttemptLifecycle({
                round,
                previousPatchRequest,
                previousTrajectoryDecision,
                hasActiveContractFrame: Boolean(activeContractFrame),
                remediationHistory
            });
            let directive = buildAttemptDirective({
                scenario,
                plan,
                round,
                previousPatchRequest
            });
            if (lifecycleDecision.negotiation_mode === "patch_only") {
                directive = {
                    ...directive,
                    label: lifecycleDecision.trajectory.mode === "refine"
                        ? `patch-only refine attempt ${round - 1}`
                        : `patch-only repair attempt ${round - 1}`
                };
            }
            else if (lifecycleDecision.negotiation_mode === "recontract") {
                directive = {
                    ...directive,
                    label: lifecycleDecision.trajectory.mode === "parallel_pivot"
                        ? `parallel pivot attempt ${round - 1}`
                        : lifecycleDecision.trajectory.mode === "pivot"
                            ? `pivot attempt ${round - 1}`
                            : `recontract attempt ${round - 1}`,
                    objective: `Re-open contract negotiation before continuing the build from ${lifecycleDecision.trajectory.restart_from}: ${lifecycleDecision.reason}`
                };
            }
            const artifacts = artifactsForRound(roundDirectory);
            let adapterMigrationProposal;
            let adapterMigrationApplied;
            if (preappliedAdapterMigrationRounds.has(round)) {
                adapterMigrationProposal = await loadJsonIfExists(artifacts.adapter_migration_proposal_json_path);
                adapterMigrationApplied = await loadJsonIfExists(artifacts.adapter_migration_applied_json_path);
            }
            const adapterDriftRecontractSource = lifecycleDecision.negotiation_mode === "recontract" &&
                (lifecycleDecision.recontract_reason === "adapter_runtime_drift" ||
                    lifecycleDecision.recontract_reason === "adapter_contract_drift") &&
                previousRoundSummary?.adapter_drift_report_path &&
                loadedAdapter
                ? await loadJsonIfExists(previousRoundSummary.adapter_drift_report_path)
                : undefined;
            const applyAuthorizedGeneratedLocalMigration = async (proposal) => {
                adapterMigrationApplied =
                    await applyAuthorizedGeneratedLocalMigrationForRound({
                        round,
                        artifacts,
                        proposal
                    });
            };
            if (!preappliedAdapterMigrationRounds.has(round) &&
                adapterDriftRecontractSource &&
                loadedAdapter) {
                adapterMigrationProposal = await buildAdapterMigrationProposal({
                    runId,
                    round,
                    sourceAdapterDriftReportPath: previousRoundSummary.adapter_drift_report_path,
                    loadedAdapter,
                    adapterDriftReport: adapterDriftRecontractSource
                });
                if (adapterMigrationProposal.autoapply_eligible) {
                    await applyAuthorizedGeneratedLocalMigration(adapterMigrationProposal);
                }
                else if (adapterMigrationProposal.requires_operator_acceptance) {
                    await writeAdapterMigrationProposalArtifacts({
                        roundDirectory,
                        proposal: adapterMigrationProposal
                    });
                    const requiresSameThreadAuthoring = transportMode === "current-thread" &&
                        adapterMigrationProposal.requires_operator_acceptance &&
                        !adapterMigrationProposal.force_new_run;
                    if (requiresSameThreadAuthoring) {
                        const authoringArtifacts = {
                            adapter_migration_authoring_task_path: artifacts.adapter_migration_authoring_task_path,
                            adapter_migration_authoring_prompt_path: artifacts.adapter_migration_authoring_prompt_path,
                            adapter_migration_authoring_response_path: artifacts.adapter_migration_authoring_response_path,
                            adapter_migration_patch_path: artifacts.adapter_migration_patch_path,
                            adapter_migration_proposal_json_path: artifacts.adapter_migration_proposal_json_path,
                            adapter_migration_instructions_path: artifacts.adapter_migration_instructions_path
                        };
                        const existingAuthoringTask = await loadJsonIfExists(artifacts.adapter_migration_authoring_task_path);
                        const authoringTask = await writeAdapterMigrationAuthoringTask({
                            runId,
                            round,
                            checkpointId: existingAuthoringTask?.checkpoint_id,
                            checkpointSeq: existingAuthoringTask?.checkpoint_seq,
                            artifacts,
                            proposal: adapterMigrationProposal,
                            loadedAdapter,
                            transportProtocolPath: transportProtocolCurrentPath,
                            notes: adapterMigrationAuthoringNotes(adapterMigrationProposal)
                        });
                        const authoringResponse = await readAdapterMigrationAuthoringResponse(artifacts.adapter_migration_authoring_response_path, authoringTask.checkpoint_id);
                        if (!authoringResponse) {
                            return checkpointForCurrentThreadWork({
                                round,
                                phase: "negotiation",
                                checkpointKind: "adapter-migration-authoring",
                                artifacts: authoringArtifacts,
                                notes: unique([
                                    `Adapter migration authoring checkpoint '${authoringTask.checkpoint_id}' is ready for round ${round}.`,
                                    `Review ${artifacts.adapter_migration_authoring_prompt_path}, write ${artifacts.adapter_migration_patch_path}, and then write ${artifacts.adapter_migration_authoring_response_path}.`
                                ])
                            });
                        }
                        if (authoringResponse.status !== "authored") {
                            return checkpointForCurrentThreadWork({
                                round,
                                phase: "negotiation",
                                checkpointKind: "adapter-migration-authoring",
                                artifacts: authoringArtifacts,
                                notes: unique([
                                    `Adapter migration authoring response for proposal '${adapterMigrationProposal.proposal_id}' reported status '${authoringResponse.status}'.`,
                                    `Rewrite ${artifacts.adapter_migration_authoring_response_path} with status 'authored' after updating ${artifacts.adapter_migration_patch_path}.`,
                                    ...(authoringResponse.notes ?? [])
                                ])
                            });
                        }
                        const authoredPatchBundlePath = resolve(authoringResponse.patch_bundle_path ??
                            artifacts.adapter_migration_patch_path);
                        if (!(await pathExists(authoredPatchBundlePath))) {
                            return checkpointForCurrentThreadWork({
                                round,
                                phase: "negotiation",
                                checkpointKind: "adapter-migration-authoring",
                                artifacts: authoringArtifacts,
                                notes: unique([
                                    `Adapter migration authoring response referenced '${authoredPatchBundlePath}', but no patch bundle exists there yet.`,
                                    `Write ${artifacts.adapter_migration_patch_path} before resuming this run.`
                                ])
                            });
                        }
                        const authoredAdapterRoot = dirname(loadedAdapter.contract_path);
                        adapterMigrationProposal = {
                            ...adapterMigrationProposal,
                            patch_bundle_path: authoredPatchBundlePath,
                            affected_files: unique([
                                ...adapterMigrationProposal.affected_files,
                                ...(authoringResponse.changed_files ?? []).map((changedFile) => resolve(authoredAdapterRoot, changedFile))
                            ])
                        };
                        await writeAdapterMigrationProposalArtifacts({
                            roundDirectory,
                            proposal: adapterMigrationProposal
                        });
                    }
                    const adapterMigrationResponse = await loadAdapterMigrationResponse(artifacts.adapter_migration_response_json_path);
                    const decisionOptions = decisionOptionsForAdapterMigrationProposal(adapterMigrationProposal);
                    const approvalArtifacts = {
                        adapter_migration_proposal_json_path: artifacts.adapter_migration_proposal_json_path,
                        adapter_migration_proposal_md_path: artifacts.adapter_migration_proposal_md_path,
                        adapter_migration_approval_prompt_path: artifacts.adapter_migration_approval_prompt_path,
                        adapter_migration_response_json_path: artifacts.adapter_migration_response_json_path,
                        adapter_migration_response_md_path: artifacts.adapter_migration_response_md_path,
                        adapter_migration_instructions_path: artifacts.adapter_migration_instructions_path
                    };
                    if (!adapterMigrationResponse) {
                        return pauseForHumanInput({
                            round,
                            phase: "negotiation",
                            checkpointKind: "adapter-migration-approval",
                            artifacts: approvalArtifacts,
                            decisionOptions,
                            notes: unique([
                                `Adapter migration proposal '${adapterMigrationProposal.proposal_id}' is ready for review on this thread.`,
                                adapterMigrationApprovalReadyNote(adapterMigrationProposal),
                                `Review ${artifacts.adapter_migration_proposal_md_path} and write ${artifacts.adapter_migration_response_json_path} with an explicit migration decision.`,
                                ...(adapterMigrationProposal.force_new_run
                                    ? ["Prefer 'open_new_run' unless you are explicitly rejecting the migration proposal."]
                                    : [])
                            ])
                        });
                    }
                    if (adapterMigrationResponse.proposal_id !== adapterMigrationProposal.proposal_id) {
                        return pauseForHumanInput({
                            round,
                            phase: "negotiation",
                            checkpointKind: "adapter-migration-approval",
                            artifacts: approvalArtifacts,
                            decisionOptions,
                            notes: unique([
                                `Adapter migration response '${artifacts.adapter_migration_response_json_path}' referenced proposal '${adapterMigrationResponse.proposal_id}', but the active proposal is '${adapterMigrationProposal.proposal_id}'.`,
                                "Write a new adapter-migration-response.json that targets the active proposal before resuming this run."
                            ])
                        });
                    }
                    if (!decisionOptions.includes(adapterMigrationResponse.decision)) {
                        return pauseForHumanInput({
                            round,
                            phase: "negotiation",
                            checkpointKind: "adapter-migration-approval",
                            artifacts: approvalArtifacts,
                            decisionOptions,
                            notes: unique([
                                `Decision '${adapterMigrationResponse.decision}' is not valid for adapter migration proposal '${adapterMigrationProposal.proposal_id}'.`,
                                `Allowed decisions: ${decisionOptions.join(", ")}.`
                            ])
                        });
                    }
                    if (adapterMigrationResponse.decision === "reject") {
                        return finalizeRunAsTerminalDecisionStop({
                            round,
                            phase: "negotiation",
                            stopReason: "adapter_migration_rejected",
                            artifacts: approvalArtifacts,
                            notes: unique([
                                `Adapter migration proposal '${adapterMigrationProposal.proposal_id}' was rejected by the operator.`,
                                ...(adapterMigrationResponse.note
                                    ? [`Operator note: ${adapterMigrationResponse.note}`]
                                    : [])
                            ]),
                            runtimeEventCode: "adapter.migration_rejected",
                            runtimeEventMessage: `Adapter migration proposal '${adapterMigrationProposal.proposal_id}' was rejected on this run.`,
                            runtimeEventMetadata: {
                                round,
                                proposal_id: adapterMigrationProposal.proposal_id,
                                decision: adapterMigrationResponse.decision,
                                migrated_run_id: runId
                            }
                        });
                    }
                    if (adapterMigrationResponse.decision === "open_new_run") {
                        return finalizeRunAsTerminalDecisionStop({
                            round,
                            phase: "negotiation",
                            stopReason: "new_run_required",
                            artifacts: approvalArtifacts,
                            notes: unique([
                                `Adapter migration proposal '${adapterMigrationProposal.proposal_id}' requires a new run instead of same-run continuation.`,
                                ...(adapterMigrationResponse.note
                                    ? [`Operator note: ${adapterMigrationResponse.note}`]
                                    : [])
                            ]),
                            runtimeEventCode: "adapter.migration_new_run_requested",
                            runtimeEventMessage: `Adapter migration proposal '${adapterMigrationProposal.proposal_id}' was routed to a new run after operator review.`,
                            runtimeEventMetadata: {
                                round,
                                proposal_id: adapterMigrationProposal.proposal_id,
                                decision: adapterMigrationResponse.decision,
                                migrated_run_id: runId
                            }
                        });
                    }
                    currentRuntimeEvents = mergeRuntimeEvents([
                        ...currentRuntimeEvents,
                        buildRuntimeEvent("adapter.migration_accepted", adapterMigrationProposal.same_run_eligible &&
                            adapterMigrationProposal.patch_bundle_path
                            ? `Adapter migration proposal '${adapterMigrationProposal.proposal_id}' was accepted for same-run apply on this run.`
                            : `Adapter migration proposal '${adapterMigrationProposal.proposal_id}' was accepted and now waits for external or manual apply work before this run can continue.`, {
                            round,
                            proposal_id: adapterMigrationProposal.proposal_id,
                            decision: adapterMigrationResponse.decision,
                            migrated_run_id: runId
                        })
                    ]);
                    if (adapterMigrationProposal.adapter_origin === "generated_local" &&
                        adapterMigrationProposal.same_run_eligible &&
                        adapterMigrationProposal.patch_bundle_path) {
                        await applyAuthorizedGeneratedLocalMigration(adapterMigrationProposal);
                    }
                    else {
                        runtimeWarnings = normalizeRuntimeWarnings([
                            ...runtimeWarnings,
                            `Adapter migration proposal '${adapterMigrationProposal.proposal_id}' was accepted but still requires external or manual apply work before same-run continuation can resume.`
                        ]);
                        return pauseForExternalCondition({
                            round,
                            phase: "negotiation",
                            checkpointKind: "adapter-migration-approval",
                            artifacts: approvalArtifacts,
                            notes: unique([
                                `Adapter migration proposal '${adapterMigrationProposal.proposal_id}' was accepted.`,
                                adapterMigrationProposal.force_new_run
                                    ? "This proposal still requires opening a new run because it cannot be migrated in place."
                                    : "This proposal cannot auto-apply in place. Apply the proposal bundle or complete the adapter migration manually before resuming this run.",
                                `Reference ${artifacts.adapter_migration_proposal_md_path}, ${artifacts.adapter_migration_response_json_path}, and ${artifacts.adapter_migration_instructions_path} while applying the migration.`,
                                ...(adapterMigrationResponse.note
                                    ? [`Operator note: ${adapterMigrationResponse.note}`]
                                    : [])
                            ])
                        });
                    }
                }
            }
            const resumedRoundPhase = restoredRun?.interruptedRound?.round === round
                ? {
                    phase: input.resumePhase ?? restoredRun.interruptedRound.resumeFromPhase,
                    status: restoredRun.interruptedRound.phaseStatus
                }
                : undefined;
            let persistContractReviewArtifact = false;
            let persistContractAgreementArtifact = false;
            let contractArtifact;
            let contractReviewArtifact;
            let contractAgreementArtifact;
            let generatorPlanArtifact;
            if (phaseCompletedAtOrBeyond(resumedRoundPhase, "negotiation")) {
                const negotiationState = await loadJson(artifacts.negotiation_state_path);
                contractArtifact = negotiationState.contractArtifact;
                contractReviewArtifact = negotiationState.contractReviewArtifact;
                contractAgreementArtifact = negotiationState.contractAgreementArtifact;
                generatorPlanArtifact = negotiationState.generatorPlanArtifact;
                persistContractReviewArtifact =
                    negotiationState.persistContractReviewArtifact;
                persistContractAgreementArtifact =
                    negotiationState.persistContractAgreementArtifact;
            }
            else {
                const negotiationResult = await withPhaseBudget("negotiation", async () => {
                    await recordRoundPhase({
                        round,
                        phase: "negotiation",
                        status: "in_progress",
                        notes: resumedRoundPhase
                            ? [
                                ...heartbeatNotes,
                                `Re-entering round ${round} negotiation from persisted phase '${resumedRoundPhase.phase}'.`
                            ]
                            : heartbeatNotes
                    });
                    const contract = lifecycleDecision.negotiation_mode === "patch_only" &&
                        previousPatchRequest &&
                        activeContractFrame
                        ? buildPatchCarryForwardContract({
                            scenarioId: scenario.scenario_id,
                            round,
                            activeContractFrame,
                            previousPatchRequest
                        })
                        : buildRoundContract({
                            scenario,
                            directive,
                            round,
                            previousPatchRequest
                        });
                    contractArtifact = buildRoundContractArtifact({
                        runId,
                        round,
                        negotiationMode: lifecycleDecision.negotiation_mode,
                        continuationAuthority: lifecycleDecision.continuation_authority,
                        recontractReason: lifecycleDecision.recontract_reason,
                        trajectory: lifecycleDecision.trajectory,
                        contract,
                        rubric: hydratedRubric,
                        loadedAdapter,
                        previousPatchRequest,
                        sessionKind,
                        productTargetRoot: activePreparedSeed?.runContract.execution_controls.target_root
                    });
                    const baseContractReviewArtifact = lifecycleDecision.negotiation_mode === "patch_only" && previousPatchRequest
                        ? buildSyntheticPatchCarryForwardReview({
                            contractArtifact,
                            previousPatchRequest,
                            reason: lifecycleDecision.reason
                        })
                        : buildContractReviewArtifact({
                            contractArtifact,
                            loadedAdapter
                        });
                    const currentThreadContractReviewEnhancement = transportMode === "current-thread"
                        ? await enhanceContractReviewWithCurrentThread({
                            runId,
                            round,
                            transportProtocolPath: transportProtocolCurrentPath,
                            artifacts,
                            contractArtifact,
                            contractReviewArtifact: baseContractReviewArtifact,
                            loadedAdapter,
                            executorMode
                        })
                        : undefined;
                    if (currentThreadContractReviewEnhancement?.kind === "checkpoint") {
                        if (contractReviewRequiresHumanDecision(baseContractReviewArtifact)) {
                            updateSessionRefreshState({
                                currentObjective: contractArtifact.objective,
                                steeringNotes: steeringNotesFromContractReview(baseContractReviewArtifact)
                            });
                            return pauseForHumanInput({
                                round,
                                phase: "negotiation",
                                checkpointKind: currentThreadContractReviewEnhancement.checkpointKind,
                                artifacts: currentThreadContractReviewEnhancement.artifacts,
                                notes: unique([
                                    ...currentThreadContractReviewEnhancement.notes,
                                    "The deterministic contract review already requires structural revisions without an external blocker, so a human operator should decide how to revise the contract before Codex continues."
                                ])
                            });
                        }
                        return checkpointForCurrentThreadWork({
                            round,
                            phase: "negotiation",
                            checkpointKind: currentThreadContractReviewEnhancement.checkpointKind,
                            artifacts: currentThreadContractReviewEnhancement.artifacts,
                            notes: currentThreadContractReviewEnhancement.notes
                        });
                    }
                    const contractReviewEnhancement = transportMode === "app-server" && appServerTransport
                        ? await enhanceContractReviewWithAppServer({
                            transport: appServerTransport,
                            round,
                            contractArtifact,
                            contractReviewArtifact: baseContractReviewArtifact,
                            loadedAdapter,
                            executorMode
                        })
                        : currentThreadContractReviewEnhancement
                            ? {
                                value: currentThreadContractReviewEnhancement.value,
                                runtimeWarnings: currentThreadContractReviewEnhancement.runtimeWarnings
                            }
                            : await enhanceContractReviewWithCodex({
                                roundDirectory,
                                contractArtifact,
                                contractReviewArtifact: baseContractReviewArtifact,
                                loadedAdapter,
                                executorMode
                            });
                    runtimeWarnings = unique([
                        ...runtimeWarnings,
                        ...contractReviewEnhancement.runtimeWarnings
                    ]);
                    contractReviewArtifact = contractReviewEnhancement.value;
                    contractAgreementArtifact =
                        lifecycleDecision.negotiation_mode === "patch_only" && previousPatchRequest
                            ? buildSyntheticPatchCarryForwardAgreement({
                                contractArtifact,
                                previousPatchRequest
                            })
                            : buildContractAgreementArtifact({
                                contractArtifact,
                                contractReviewArtifact
                            });
                    const baseGeneratorPlanArtifact = buildGeneratorPlanArtifact({
                        contractArtifact,
                        contractAgreementArtifact,
                        previousPatchRequest,
                        trajectory: lifecycleDecision.trajectory,
                        adapterAttached: Boolean(loadedAdapter),
                        sessionKind,
                        targetRoot: activePreparedSeed?.runContract.execution_controls.target_root,
                        buildBrief: activePreparedSeed?.buildBrief
                    });
                    const currentThreadGeneratorPlanEnhancement = transportMode === "current-thread"
                        ? await enhanceGeneratorPlanWithCurrentThread({
                            runId,
                            round,
                            transportProtocolPath: transportProtocolCurrentPath,
                            artifacts,
                            idea,
                            contractArtifact,
                            contractAgreementArtifact,
                            generatorPlanArtifact: baseGeneratorPlanArtifact,
                            previousPatchRequest,
                            executorMode
                        })
                        : undefined;
                    if (currentThreadGeneratorPlanEnhancement?.kind === "checkpoint") {
                        return checkpointForCurrentThreadWork({
                            round,
                            phase: "negotiation",
                            checkpointKind: currentThreadGeneratorPlanEnhancement.checkpointKind,
                            artifacts: currentThreadGeneratorPlanEnhancement.artifacts,
                            notes: currentThreadGeneratorPlanEnhancement.notes
                        });
                    }
                    const generatorPlanEnhancement = transportMode === "app-server" && appServerTransport
                        ? await enhanceGeneratorPlanWithAppServer({
                            transport: appServerTransport,
                            round,
                            idea,
                            contractArtifact,
                            contractAgreementArtifact,
                            generatorPlanArtifact: baseGeneratorPlanArtifact,
                            previousPatchRequest,
                            executorMode
                        })
                        : currentThreadGeneratorPlanEnhancement
                            ? {
                                value: currentThreadGeneratorPlanEnhancement.value,
                                runtimeWarnings: currentThreadGeneratorPlanEnhancement.runtimeWarnings
                            }
                            : await enhanceGeneratorPlanWithCodex({
                                roundDirectory,
                                idea,
                                contractArtifact,
                                contractAgreementArtifact,
                                generatorPlanArtifact: baseGeneratorPlanArtifact,
                                previousPatchRequest,
                                executorMode
                            });
                    runtimeWarnings = unique([
                        ...runtimeWarnings,
                        ...generatorPlanEnhancement.runtimeWarnings
                    ]);
                    generatorPlanArtifact = generatorPlanEnhancement.value;
                    const reviewChecksRequired = contractArtifact.acceptance_checks.some((checkId) => checkId === "contract_review_written" || checkId === "contract_review_quality");
                    const agreementChecksRequired = contractArtifact.acceptance_checks.some((checkId) => checkId === "contract_agreement_written" || checkId === "agreement_matches_review");
                    persistContractReviewArtifact =
                        lifecycleDecision.persist_contract_review ||
                            contractReviewArtifact.decision !== "accept" ||
                            reviewChecksRequired;
                    persistContractAgreementArtifact =
                        lifecycleDecision.persist_contract_agreement ||
                            contractAgreementArtifact.status !== "agreed" ||
                            agreementChecksRequired;
                    await writeNegotiationArtifacts({
                        roundDirectory,
                        contractArtifact,
                        contractReviewArtifact,
                        contractAgreementArtifact,
                        generatorPlanArtifact,
                        persistContractReviewArtifact,
                        persistContractAgreementArtifact
                    });
                    await Promise.all([
                        writeJson(artifacts.negotiation_state_path, {
                            contractArtifact,
                            contractReviewArtifact,
                            contractAgreementArtifact,
                            generatorPlanArtifact,
                            persistContractReviewArtifact,
                            persistContractAgreementArtifact
                        }),
                        writeRoundEvaluationPlaceholders({ roundDirectory }),
                        writeRoundHandoffPlaceholders({ roundDirectory })
                    ]);
                    await markProgress(`Negotiation artifacts saved for round ${round}.`);
                    await recordRoundPhase({
                        round,
                        phase: "negotiation",
                        status: "completed",
                        artifacts: {
                            negotiation_state_path: artifacts.negotiation_state_path,
                            contract_path: artifacts.contract_json_path,
                            generator_plan_path: artifacts.generator_plan_json_path
                        }
                    });
                });
                if (negotiationResult) {
                    return negotiationResult;
                }
            }
            if (lifecycleDecision.negotiation_mode !== "patch_only" &&
                contractAgreementArtifact.status === "agreed") {
                activeContractFrame = buildActiveContractFrame({
                    round,
                    contractArtifact,
                    contractAgreementArtifact
                });
            }
            const previousPatchTargetCheckIds = unique(previousPatchRequest?.must_fix.flatMap((item) => item.target_check_ids) ?? []);
            const previousPatchRequestAddressed = previousPatchTargetCheckIds.length === 0 ||
                previousPatchTargetCheckIds.every((checkId) => contractArtifact.carry_over_check_ids.includes(checkId));
            const attachedGeneratorEligible = currentThreadTransport &&
                contractAgreementArtifact.status === "agreed" &&
                isBootstrapGeneratedAdapter(loadedAdapter);
            const attachedGeneratorTargetRoot = loadedAdapter &&
                attachedGeneratorEligible
                ? resolvedAdapterTargetRoot(loadedAdapter)
                : undefined;
            const attachedGeneratorWritableRoots = attachedGeneratorTargetRoot
                ? unique([attachedGeneratorTargetRoot, runDirectory])
                : [];
            const attachedGeneratorTaskTimeoutMs = phaseTimeouts.pre_verification ?? appServerTaskTimeoutMs;
            const persistedTargetManifest = await loadJsonIfExists(artifacts.target_manifest_path);
            const prototypeBaselineState = round === 1 ? await loadPrototypeBaselineState(runRuntimeDirectory) : undefined;
            const prototypeBaselinePathInfo = prototypeBaselinePaths(runRuntimeDirectory);
            const preRoundBaselineStatusPath = join(roundDirectory, "pre-round-baseline.md");
            const preRoundBaselineJsonPath = join(roundDirectory, "pre-round-baseline.json");
            const existingAttachedGeneratorTask = attachedGeneratorEligible && attachedGeneratorTargetRoot
                ? await loadJsonIfExists(artifacts.attached_generator_task_path)
                : undefined;
            const existingAttachedGeneratorResponse = attachedGeneratorEligible
                ? await readAttachedGeneratorResponse(artifacts.attached_generator_response_path, existingAttachedGeneratorTask?.checkpoint_id)
                : undefined;
            const attachedGeneratorProfile = loadedAdapter?.verification_profile?.profile;
            const browserBaselineEligible = round === 1 &&
                attachedGeneratorEligible &&
                Boolean(attachedGeneratorProfile &&
                    ((attachedGeneratorProfile.expected_target_surfaces ?? []).includes("browser") ||
                        (attachedGeneratorProfile.core_probes ?? []).some((probe) => probe.mode === "browser" || probe.mode === "browser_journey")));
            const preGeneratorBaselineWindowOpen = attachedPreGeneratorBaselineWindowOpen({
                round,
                attachedGeneratorEligible,
                existingTask: existingAttachedGeneratorTask,
                existingResponse: existingAttachedGeneratorResponse
            });
            const attachedGeneratorBaselineCapture = browserBaselineEligible && loadedAdapter && preGeneratorBaselineWindowOpen
                ? await captureBootstrapGeneratedBaselineIfNeeded({
                    loadedAdapter,
                    runtimeDirectory: runRuntimeDirectory,
                    targetManifest: persistedTargetManifest
                })
                : browserBaselineEligible && !preGeneratorBaselineWindowOpen
                    ? {
                        status: "skipped",
                        reason: existingAttachedGeneratorResponse
                            ? "attached_generator_response_already_present"
                            : "attached_generator_checkpoint_already_issued",
                        ...(typeof prototypeBaselineState?.baseline_path === "string"
                            ? { baseline_path: prototypeBaselineState.baseline_path }
                            : {}),
                        ...(typeof prototypeBaselineState?.source_phase === "string"
                            ? { source_phase: prototypeBaselineState.source_phase }
                            : {}),
                        ...(prototypeBaselineSourceSemanticsForPhase(prototypeBaselineState?.source_phase)
                            ? {
                                source_semantics: prototypeBaselineSourceSemanticsForPhase(prototypeBaselineState?.source_phase)
                            }
                            : {}),
                        ...(typeof prototypeBaselineState?.source_round === "number"
                            ? { source_round: prototypeBaselineState.source_round }
                            : {}),
                        ...(typeof prototypeBaselineState?.source_target === "string"
                            ? { source_target: prototypeBaselineState.source_target }
                            : {}),
                        ...(Array.isArray(prototypeBaselineState?.evidence_paths)
                            ? { evidence_paths: prototypeBaselineState.evidence_paths }
                            : {}),
                        prototype_baseline_present: typeof prototypeBaselineState?.baseline_path === "string" &&
                            prototypeBaselineState.baseline_path.trim().length > 0,
                        prototype_baseline_valid: hasValidPrototypeBaseline(prototypeBaselineState)
                    }
                    : undefined;
            if (attachedGeneratorBaselineCapture) {
                const baselineSourceSemanticsDetail = describePrototypeBaselineSourceSemantics(attachedGeneratorBaselineCapture.source_semantics);
                await Promise.all([
                    writeText(preRoundBaselineStatusPath, [
                        "# Pre-round baseline",
                        "",
                        `Status: ${attachedGeneratorBaselineCapture.status}`,
                        `Baseline present: ${attachedGeneratorBaselineCapture.prototype_baseline_present}`,
                        `Baseline valid: ${attachedGeneratorBaselineCapture.prototype_baseline_valid}`,
                        `Source phase: ${attachedGeneratorBaselineCapture.source_phase ?? "n/a"}`,
                        `Source semantics: ${attachedGeneratorBaselineCapture.source_semantics ?? "n/a"}`,
                        `Source round: ${String(attachedGeneratorBaselineCapture.source_round ?? "n/a")}`,
                        `Baseline path: ${attachedGeneratorBaselineCapture.baseline_path ?? "n/a"}`,
                        `Target: ${attachedGeneratorBaselineCapture.source_target ??
                            attachedGeneratorBaselineCapture.readiness_url ??
                            "n/a"}`,
                        `Reason: ${attachedGeneratorBaselineCapture.reason ?? "none"}`,
                        `Meaning: ${baselineSourceSemanticsDetail ?? "n/a"}`
                    ].join("\n")),
                    writeJson(preRoundBaselineJsonPath, attachedGeneratorBaselineCapture)
                ]);
                if (attachedGeneratorBaselineCapture.status === "blocked") {
                    runtimeWarnings = unique([
                        ...runtimeWarnings,
                        `Pre-round baseline capture was blocked before attached generator round ${round}: ${attachedGeneratorBaselineCapture.reason ?? "unknown reason"}`
                    ]);
                }
            }
            let attachedGeneratorTask = existingAttachedGeneratorTask;
            if (attachedGeneratorEligible && attachedGeneratorTargetRoot) {
                attachedGeneratorTask = await writeAttachedGeneratorTask({
                    runId,
                    round,
                    controllerMode: "attached",
                    transportMode: isAttachedGeneratorTransport(transportMode)
                        ? transportMode
                        : "current-thread",
                    checkpointId: existingAttachedGeneratorTask?.checkpoint_id ??
                        existingAttachedGeneratorResponse?.checkpoint_id,
                    checkpointSeq: existingAttachedGeneratorTask?.checkpoint_seq,
                    targetRoot: attachedGeneratorTargetRoot,
                    taskCwd: attachedGeneratorTargetRoot,
                    writableRoots: attachedGeneratorWritableRoots,
                    networkAccess: false,
                    completionTimeoutMs: attachedGeneratorTaskTimeoutMs,
                    transportProtocolPath: transportProtocolCurrentPath,
                    artifacts,
                    contract: contractArtifact,
                    agreement: contractAgreementArtifact,
                    generatorPlan: generatorPlanArtifact,
                    previousPatchRequest,
                    buildBrief: activePreparedSeed?.buildBrief,
                    verificationProbes: loadedAdapter?.verification_profile?.profile.core_probes ?? [],
                    prototypeBaselineManifestPath: prototypeBaselinePathInfo.manifestPath,
                    prototypeBaselineScreenshotPath: prototypeBaselinePathInfo.screenshotPath,
                    prototypeBaselineSourcePhase: attachedGeneratorBaselineCapture?.source_phase ??
                        (hasValidPrototypeBaseline(prototypeBaselineState)
                            ? prototypeBaselineState.source_phase
                            : prototypeBaselineState?.source_phase),
                    prototypeBaselineValid: attachedGeneratorBaselineCapture?.prototype_baseline_valid ??
                        hasValidPrototypeBaseline(prototypeBaselineState),
                    notes: [
                        transportMode === "current-thread"
                            ? "Complete the generator work on the current Codex thread, then write the response JSON before resuming the controller."
                            : "The App Server generator turn will write the response JSON before the controller resumes adapter verification.",
                        ...(attachedGeneratorBaselineCapture
                            ? attachedGeneratorBaselineCapture.reason ===
                                "attached_generator_checkpoint_already_issued" ||
                                attachedGeneratorBaselineCapture.reason ===
                                    "attached_generator_response_already_present"
                                ? attachedGeneratorBaselineCapture.prototype_baseline_valid
                                    ? [
                                        `The pre-generator baseline window is already closed for this checkpoint, and a valid initial prototype baseline already exists at ${prototypeBaselinePathInfo.manifestPath}. Do not overwrite it with a resumed post-mutation screenshot.`
                                    ]
                                    : [
                                        `The pre-generator baseline window is already closed for this checkpoint, and no valid initial prototype baseline exists. Do not mint a new valid baseline from a resumed post-mutation screenshot.`
                                    ]
                                : attachedGeneratorBaselineCapture.prototype_baseline_valid
                                    ? [
                                        `A valid initial prototype baseline is already available at ${prototypeBaselinePathInfo.manifestPath} (${attachedGeneratorBaselineCapture.source_phase ?? "unknown source phase"}). Do not overwrite it with a post-mutation screenshot.`
                                    ]
                                    : [
                                        `No valid initial prototype baseline was captured before the generator started. If the browser surface is reachable before edits, capture it to ${prototypeBaselinePathInfo.manifestPath} before mutating. Otherwise leave the baseline absent and do not mark any post-mutation screenshot as valid.`
                                    ]
                            : [])
                    ]
                });
            }
            let attachedGeneratorResponse = existingAttachedGeneratorResponse;
            if (!attachedGeneratorResponse && attachedGeneratorEligible) {
                attachedGeneratorResponse = await readAttachedGeneratorResponse(artifacts.attached_generator_response_path, attachedGeneratorTask?.checkpoint_id);
            }
            const persistedPreVerificationExecutions = await loadJsonIfExists(artifacts.pre_verification_executions_path);
            let preVerificationExecutions = persistedPreVerificationExecutions ??
                orderedAdapterExecutions(preVerificationCapabilities, await restoreAdapterCapabilityExecutions({
                    loadedAdapter,
                    capabilities: preVerificationCapabilities,
                    roundDirectory
                }));
            const restoredPreVerificationExecutions = !persistedPreVerificationExecutions && preVerificationExecutions.length > 0;
            let targetManifest = persistedTargetManifest ??
                preVerificationExecutions.find((execution) => execution.capability === "run_target" && execution.result.ok)?.result.target_manifest;
            if (restoredPreVerificationExecutions) {
                runtimeWarnings = unique([
                    ...runtimeWarnings,
                    `Reconstructed pre_verification capability aggregate from adapter result files for round ${round}.`
                ]);
                await Promise.all([
                    writeJson(artifacts.pre_verification_executions_path, preVerificationExecutions),
                    writeJson(artifacts.target_manifest_path, targetManifest ?? {})
                ]);
            }
            else if (!persistedTargetManifest) {
                await writeJson(artifacts.target_manifest_path, targetManifest ?? {});
            }
            if (!phaseCompletedAtOrBeyond(resumedRoundPhase, "pre_verification")) {
                const preVerificationResult = await withPhaseBudget("pre_verification", async () => {
                    await recordRoundPhase({
                        round,
                        phase: "pre_verification",
                        status: "in_progress",
                        ...(attachedGeneratorEligible
                            ? {
                                artifacts: {
                                    attached_generator_task_path: artifacts.attached_generator_task_path,
                                    attached_generator_response_path: artifacts.attached_generator_response_path,
                                    ...(attachedGeneratorBaselineCapture
                                        ? {
                                            pre_round_baseline_path: preRoundBaselineStatusPath
                                        }
                                        : {})
                                }
                            }
                            : {})
                    });
                    const repairedPreVerificationCapabilities = new Set(preVerificationExecutions.map((execution) => execution.capability));
                    const missingPreVerificationCapabilities = preVerificationCapabilities.filter((capability) => !repairedPreVerificationCapabilities.has(capability));
                    if (attachedGeneratorEligible &&
                        attachedGeneratorTargetRoot &&
                        missingPreVerificationCapabilities.includes("apply_change") &&
                        !attachedGeneratorResponse) {
                        const attachedGeneratorPrompt = await readFile(artifacts.attached_generator_prompt_path, "utf8");
                        if (transportMode === "app-server" && appServerTransport) {
                            await appServerTransport.runTask({
                                round,
                                phase: "pre_verification",
                                prompt: attachedGeneratorPrompt,
                                taskLabel: `attached generator round ${round}`,
                                taskCwd: attachedGeneratorTargetRoot,
                                writableRoots: attachedGeneratorWritableRoots,
                                networkAccess: false,
                                completionTimeoutMs: attachedGeneratorTaskTimeoutMs
                            });
                            attachedGeneratorResponse = await readAttachedGeneratorResponse(artifacts.attached_generator_response_path, attachedGeneratorTask?.checkpoint_id);
                            await markProgress(`App Server attached generator completed for round ${round}.`);
                            if (!attachedGeneratorResponse ||
                                attachedGeneratorResponse.status === "blocked") {
                                throw new Error(`App Server attached generator did not write a usable response artifact for round ${round}. Expected ${artifacts.attached_generator_response_path}.`);
                            }
                            runtimeWarnings = unique([
                                ...runtimeWarnings,
                                `App Server attached generator completed for round ${round} and wrote ${artifacts.attached_generator_response_path}.`
                            ]);
                        }
                        else if (transportMode === "current-thread") {
                            const attachedGeneratorNotes = [
                                `Current-thread attached generator checkpoint is ready for round ${round}.`,
                                `The same Codex thread should review ${artifacts.attached_generator_prompt_path} and write ${artifacts.attached_generator_response_path}.`,
                                "This is a same-thread Codex checkpoint, not a human decision stop."
                            ];
                            return checkpointForCurrentThreadWork({
                                round,
                                phase: "pre_verification",
                                artifacts: {
                                    attached_generator_task_path: artifacts.attached_generator_task_path,
                                    attached_generator_prompt_path: artifacts.attached_generator_prompt_path,
                                    attached_generator_response_path: artifacts.attached_generator_response_path,
                                    ...(attachedGeneratorBaselineCapture
                                        ? { pre_round_baseline_path: preRoundBaselineStatusPath }
                                        : {})
                                },
                                checkpointKind: "attached-generator",
                                notes: attachedGeneratorNotes
                            });
                        }
                    }
                    const resumedPreVerificationExecutions = loadedAdapter &&
                        contractAgreementArtifact.status === "agreed" &&
                        missingPreVerificationCapabilities.length > 0
                        ? await runAdapterCapabilities({
                            loadedAdapter,
                            capabilities: missingPreVerificationCapabilities,
                            runId,
                            round,
                            runDirectory,
                            runtimeDirectory: runRuntimeDirectory,
                            codexSessionRegistryPath,
                            roundDirectory,
                            ideaPath: defaultIdeaPath,
                            plannedScenarioPath,
                            planPath,
                            roundContractPath: artifacts.contract_json_path,
                            contractReviewPath: persistContractReviewArtifact
                                ? artifacts.contract_review_json_path
                                : undefined,
                            contractAgreementPath: persistContractAgreementArtifact
                                ? artifacts.contract_agreement_json_path
                                : undefined,
                            generatorPlanPath: artifacts.generator_plan_json_path,
                            previousPatchRequestPath,
                            previousTrajectoryDecisionPath,
                            extraEnv: {
                                ...(attachedGeneratorEligible
                                    ? {
                                        HARNESS_ATTACHED_GENERATOR_TASK_PATH: artifacts.attached_generator_task_path,
                                        HARNESS_GENERATOR_PROMPT_PATH: artifacts.attached_generator_prompt_path,
                                        HARNESS_GENERATOR_RESPONSE_PATH: artifacts.attached_generator_response_path,
                                        HARNESS_TRANSPORT_PROTOCOL_PATH: transportProtocolCurrentPath
                                    }
                                    : {}),
                                HARNESS_CONTROLLER_MODE: controllerMode,
                                HARNESS_TRANSPORT: transportMode,
                                HARNESS_EXECUTOR_MODE: executorMode
                            },
                            onCapabilityComplete: async (execution) => {
                                await markProgress(`Adapter capability '${execution.capability}' finished for round ${round}.`);
                            }
                        })
                        : [];
                    preVerificationExecutions = orderedAdapterExecutions(preVerificationCapabilities, [...preVerificationExecutions, ...resumedPreVerificationExecutions]);
                    targetManifest = preVerificationExecutions.find((execution) => execution.capability === "run_target" && execution.result.ok)?.result.target_manifest;
                    await Promise.all([
                        writeJson(artifacts.pre_verification_executions_path, preVerificationExecutions),
                        writeJson(artifacts.target_manifest_path, targetManifest ?? {})
                    ]);
                    await markProgress(`Pre-verification artifacts saved for round ${round}.`);
                    await recordRoundPhase({
                        round,
                        phase: "pre_verification",
                        status: "completed",
                        artifacts: {
                            pre_verification_executions_path: artifacts.pre_verification_executions_path,
                            target_manifest_path: artifacts.target_manifest_path,
                            ...(attachedGeneratorEligible
                                ? {
                                    attached_generator_task_path: artifacts.attached_generator_task_path,
                                    attached_generator_response_path: artifacts.attached_generator_response_path
                                }
                                : {})
                        }
                    });
                    return undefined;
                });
                if (preVerificationResult) {
                    return preVerificationResult;
                }
            }
            const persistedCoreProbeResults = await loadJsonIfExists(artifacts.core_probe_results_path);
            let coreProbeResults = persistedCoreProbeResults ??
                (await restoreCoreVerificationProbeExecutions({
                    loadedAdapter,
                    roundDirectory
                }));
            const restoredCoreProbeResults = !persistedCoreProbeResults && coreProbeResults.length > 0;
            if (restoredCoreProbeResults) {
                runtimeWarnings = unique([
                    ...runtimeWarnings,
                    `Reconstructed core_probes aggregate from probe result files for round ${round}.`
                ]);
                await writeJson(artifacts.core_probe_results_path, coreProbeResults);
            }
            if (!phaseCompletedAtOrBeyond(resumedRoundPhase, "core_probes")) {
                await withPhaseBudget("core_probes", async () => {
                    await recordRoundPhase({
                        round,
                        phase: "core_probes",
                        status: "in_progress"
                    });
                    const restoredProbeIds = new Set(coreProbeResults.map((probeExecution) => probeExecution.probe_id));
                    const missingCoreProbeIds = loadedAdapter?.verification_profile?.profile.core_probes
                        ?.map((probe) => probe.probe_id)
                        .filter((probeId) => !restoredProbeIds.has(probeId)) ?? [];
                    const resumedCoreProbeResults = loadedAdapter &&
                        contractAgreementArtifact.status === "agreed" &&
                        missingCoreProbeIds.length > 0
                        ? await executeCoreVerificationProbes({
                            loadedAdapter,
                            runDirectory,
                            roundDirectory,
                            targetManifest,
                            probeIds: missingCoreProbeIds,
                            onProbeComplete: async (probeExecution) => {
                                await markProgress(`Core probe '${probeExecution.probe_id}' finished for round ${round}.`);
                            }
                        })
                        : [];
                    coreProbeResults = [
                        ...new Map([...coreProbeResults, ...resumedCoreProbeResults].map((probeExecution) => [
                            probeExecution.probe_id,
                            probeExecution
                        ])).values()
                    ];
                    await writeJson(artifacts.core_probe_results_path, coreProbeResults);
                    await markProgress(`Core probe results saved for round ${round}.`);
                    await recordRoundPhase({
                        round,
                        phase: "core_probes",
                        status: "completed",
                        artifacts: {
                            core_probe_results_path: artifacts.core_probe_results_path
                        }
                    });
                });
            }
            const persistedPostVerificationExecutions = await loadJsonIfExists(artifacts.post_verification_executions_path);
            let postVerificationExecutions = persistedPostVerificationExecutions ??
                orderedAdapterExecutions(postVerificationCapabilities, await restoreAdapterCapabilityExecutions({
                    loadedAdapter,
                    capabilities: postVerificationCapabilities,
                    roundDirectory
                }));
            const restoredPostVerificationExecutions = !persistedPostVerificationExecutions && postVerificationExecutions.length > 0;
            const persistedAdapterExecutions = await loadJsonIfExists(artifacts.adapter_executions_path);
            let adapterExecutions = persistedAdapterExecutions ??
                orderedAdapterExecutions([...preVerificationCapabilities, ...postVerificationCapabilities], [...preVerificationExecutions, ...postVerificationExecutions]);
            if (restoredPostVerificationExecutions) {
                runtimeWarnings = unique([
                    ...runtimeWarnings,
                    `Reconstructed post_verification capability aggregate from adapter result files for round ${round}.`
                ]);
                await Promise.all([
                    writeJson(artifacts.post_verification_executions_path, postVerificationExecutions),
                    writeJson(artifacts.adapter_executions_path, adapterExecutions)
                ]);
            }
            else if (!persistedAdapterExecutions) {
                await writeJson(artifacts.adapter_executions_path, adapterExecutions);
            }
            if (!phaseCompletedAtOrBeyond(resumedRoundPhase, "post_verification")) {
                await withPhaseBudget("post_verification", async () => {
                    await recordRoundPhase({
                        round,
                        phase: "post_verification",
                        status: "in_progress"
                    });
                    const repairedPostVerificationCapabilities = new Set(postVerificationExecutions.map((execution) => execution.capability));
                    const missingPostVerificationCapabilities = postVerificationCapabilities.filter((capability) => !repairedPostVerificationCapabilities.has(capability));
                    const resumedPostVerificationExecutions = loadedAdapter &&
                        contractAgreementArtifact.status === "agreed" &&
                        missingPostVerificationCapabilities.length > 0
                        ? await runAdapterCapabilities({
                            loadedAdapter,
                            capabilities: missingPostVerificationCapabilities,
                            runId,
                            round,
                            runDirectory,
                            runtimeDirectory: runRuntimeDirectory,
                            codexSessionRegistryPath,
                            roundDirectory,
                            ideaPath: defaultIdeaPath,
                            plannedScenarioPath,
                            planPath,
                            roundContractPath: artifacts.contract_json_path,
                            contractReviewPath: persistContractReviewArtifact
                                ? artifacts.contract_review_json_path
                                : undefined,
                            contractAgreementPath: persistContractAgreementArtifact
                                ? artifacts.contract_agreement_json_path
                                : undefined,
                            generatorPlanPath: artifacts.generator_plan_json_path,
                            previousPatchRequestPath,
                            previousTrajectoryDecisionPath,
                            extraEnv: {
                                HARNESS_CORE_PROBE_RESULTS_PATH: artifacts.core_probe_results_path,
                                HARNESS_TARGET_MANIFEST_PATH: artifacts.target_manifest_path,
                                HARNESS_CONTROLLER_MODE: controllerMode,
                                HARNESS_TRANSPORT: transportMode,
                                HARNESS_EXECUTOR_MODE: executorMode,
                                ...(selectedVerificationProfile
                                    ? {
                                        HARNESS_VERIFICATION_PROFILE_PATH: selectedVerificationProfile.profile_path
                                    }
                                    : {})
                            },
                            onCapabilityComplete: async (execution) => {
                                await markProgress(`Adapter capability '${execution.capability}' finished for round ${round}.`);
                            }
                        })
                        : [];
                    postVerificationExecutions = orderedAdapterExecutions(postVerificationCapabilities, [...postVerificationExecutions, ...resumedPostVerificationExecutions]);
                    adapterExecutions = orderedAdapterExecutions([...preVerificationCapabilities, ...postVerificationCapabilities], [...preVerificationExecutions, ...postVerificationExecutions]);
                    await Promise.all([
                        writeJson(artifacts.post_verification_executions_path, postVerificationExecutions),
                        writeJson(artifacts.adapter_executions_path, adapterExecutions)
                    ]);
                    await markProgress(`Post-verification artifacts saved for round ${round}.`);
                    await recordRoundPhase({
                        round,
                        phase: "post_verification",
                        status: "completed",
                        artifacts: {
                            post_verification_executions_path: artifacts.post_verification_executions_path,
                            adapter_executions_path: artifacts.adapter_executions_path
                        }
                    });
                });
            }
            let evalReport;
            let previousPatchRequestResolved;
            let evaluatorVerdictArtifact;
            let qualityCritiqueArtifact;
            let patchRequestArtifact;
            let trajectoryDecisionArtifact;
            let roundResultArtifact;
            let roundScorecard;
            let failureLineage;
            let adapterDriftReport;
            let adapterMigrationStopPreview;
            if (phaseCompletedAtOrBeyond(resumedRoundPhase, "evaluation")) {
                evalReport = await loadJson(artifacts.eval_report_path);
                evaluatorVerdictArtifact = await loadJson(artifacts.evaluator_verdict_json_path);
                qualityCritiqueArtifact = await loadJson(artifacts.quality_critique_json_path);
                patchRequestArtifact = await loadJson(artifacts.patch_request_json_path);
                trajectoryDecisionArtifact = await loadJson(artifacts.trajectory_decision_json_path);
                roundResultArtifact = await loadJson(artifacts.round_result_json_path);
                roundScorecard = await loadJsonIfExists(artifacts.scorecard_json_path);
                failureLineage =
                    (await loadJsonIfExists(artifacts.failure_lineage_path)) ??
                        failureLineageForEvalReport({
                            evalReport,
                            loadedAdapter,
                            previousRoundSummary
                        });
                adapterDriftReport = await loadJsonIfExists(artifacts.adapter_drift_report_json_path);
                adapterMigrationStopPreview =
                    adapterMigrationProposal ??
                        (await loadJsonIfExists(artifacts.adapter_migration_proposal_json_path));
                previousPatchRequestResolved =
                    roundResultArtifact.previous_patch_request_resolved;
            }
            else {
                const evaluationResult = await withPhaseBudget("evaluation", async () => {
                    await recordRoundPhase({
                        round,
                        phase: "evaluation",
                        status: "in_progress"
                    });
                    const baseEvalReport = buildEvalReport({
                        round,
                        rubric: hydratedRubric,
                        contractArtifact,
                        contractReviewArtifact,
                        contractAgreementArtifact,
                        artifacts,
                        plannerBriefPath,
                        planPath,
                        loadedAdapter,
                        adapterExecutions,
                        coreProbeResults,
                        targetManifest,
                        previousPatchTargetCheckIds,
                        previousPatchRequestAddressed
                    });
                    const evalEnhancement = transportMode === "current-thread"
                        ? await enhanceEvalReportWithCurrentThread({
                            runId,
                            round,
                            transportProtocolPath: transportProtocolCurrentPath,
                            artifacts,
                            idea,
                            contractArtifact,
                            generatorPlanArtifact,
                            evalReport: baseEvalReport,
                            adapterExecutions,
                            coreProbeResults,
                            targetManifest,
                            executorMode
                        })
                        : undefined;
                    if (evalEnhancement?.kind === "checkpoint") {
                        return checkpointForCurrentThreadWork({
                            round,
                            phase: "evaluation",
                            checkpointKind: evalEnhancement.checkpointKind,
                            artifacts: evalEnhancement.artifacts,
                            notes: evalEnhancement.notes
                        });
                    }
                    const resolvedEvalEnhancement = transportMode === "app-server" && appServerTransport
                        ? await enhanceEvalReportWithAppServer({
                            transport: appServerTransport,
                            round,
                            idea,
                            contractArtifact,
                            generatorPlanArtifact,
                            evalReport: baseEvalReport,
                            adapterExecutions,
                            coreProbeResults,
                            targetManifest,
                            executorMode
                        })
                        : evalEnhancement
                            ? {
                                value: evalEnhancement.value,
                                runtimeWarnings: evalEnhancement.runtimeWarnings
                            }
                            : await enhanceEvalReportWithCodex({
                                roundDirectory,
                                idea,
                                contractArtifact,
                                generatorPlanArtifact,
                                evalReport: baseEvalReport,
                                adapterExecutions,
                                coreProbeResults,
                                targetManifest,
                                executorMode
                            });
                    runtimeWarnings = unique([
                        ...runtimeWarnings,
                        ...resolvedEvalEnhancement.runtimeWarnings
                    ]);
                    evalReport = resolvedEvalEnhancement.value;
                    previousPatchRequestResolved =
                        previousPatchTargetCheckIds.length === 0 ||
                            evalReport.check_results.some((result) => result.check_id === "previous_patch_request_resolved" &&
                                result.status === "pass");
                    if (evaluationPolicy) {
                        const gatedEvaluation = applyEvaluationPolicyGate({
                            policy: evaluationPolicy,
                            evalReport
                        });
                        evalReport = gatedEvaluation.evalReport;
                        roundScorecard = gatedEvaluation.scorecard;
                    }
                    evaluatorVerdictArtifact = buildEvaluatorVerdictArtifact({
                        contractArtifact,
                        evalReport
                    });
                    const rawFailureLineage = failureLineageForEvalReport({
                        evalReport,
                        loadedAdapter,
                        previousRoundSummary
                    });
                    const provisionalPatchRequestArtifact = buildPatchRequestArtifact({
                        round,
                        evalReport,
                        evaluatorVerdictArtifact,
                        qualityCritiqueArtifact: {
                            critique_id: `${contractArtifact.contract_id}-quality-critique-provisional`,
                            contract_id: contractArtifact.contract_id,
                            round,
                            remediation_strategy: evalReport.threshold_results.contract_completed
                                ? "refine"
                                : "tighten",
                            quality_focus: [],
                            preserve_signals: [],
                            findings: [],
                            notes: []
                        },
                        adapterAttached: Boolean(loadedAdapter),
                        staticContractBlockers: contractReviewArtifact.static_blockers,
                        failureLineage: rawFailureLineage
                    });
                    const allowedCheckIds = new Set([
                        ...(activeContractFrame?.acceptance_checks ??
                            contractAgreementArtifact.acceptance_checks),
                        ...evalReport.unresolved_check_ids,
                        "target_signal_thresholds_met",
                        "adapter_execution_healthy",
                        "release_blockers_recorded"
                    ]);
                    const currentScopeDrift = targetCheckIdsFromPatchRequest(provisionalPatchRequestArtifact).some((checkId) => !allowedCheckIds.has(checkId));
                    const projectedScoreDeltas = history.length > 0
                        ? [
                            ...scoreDeltas,
                            Number((evalReport.total_score - history[history.length - 1].total_score).toFixed(3))
                        ].slice(-6)
                        : scoreDeltas.slice(-6);
                    const projectedPlateauCount = isImproved(evalReport.total_score, bestScore)
                        ? 0
                        : plateauCount + 1;
                    failureLineage = rawFailureLineage
                        ? applyFailureLineagePolicySnapshot({
                            history,
                            failureLineage: rawFailureLineage,
                            scoreDeltas: projectedScoreDeltas,
                            scopeDriftDetected: currentScopeDrift,
                            patchEntropy: Number((provisionalPatchRequestArtifact.must_fix.length > 0
                                ? provisionalPatchRequestArtifact.must_fix.length
                                : targetCheckIdsFromPatchRequest(provisionalPatchRequestArtifact).length).toFixed(3)),
                            projectedPlateauCount,
                            plateauLimit: hydratedRubric.stop_after_plateau_rounds
                        })
                        : undefined;
                    adapterDriftReport = buildAdapterDriftReport({
                        contractId: contractArtifact.contract_id,
                        round,
                        contractReviewArtifact,
                        failureLineage
                    });
                    adapterMigrationStopPreview =
                        adapterDriftReport && loadedAdapter
                            ? await buildAdapterMigrationProposal({
                                runId,
                                round: round + 1,
                                sourceAdapterDriftReportPath: artifacts.adapter_drift_report_json_path,
                                loadedAdapter,
                                adapterDriftReport
                            })
                            : undefined;
                    qualityCritiqueArtifact = buildQualityCritiqueArtifact({
                        round,
                        contractArtifact,
                        evalReport,
                        loadedAdapter,
                        failureLineage
                    });
                    patchRequestArtifact = buildPatchRequestArtifact({
                        round,
                        evalReport,
                        evaluatorVerdictArtifact,
                        qualityCritiqueArtifact,
                        adapterAttached: Boolean(loadedAdapter),
                        staticContractBlockers: contractReviewArtifact.static_blockers,
                        failureLineage,
                        adapterDriftReport
                    });
                    trajectoryDecisionArtifact = buildTrajectoryDecisionArtifact({
                        round,
                        contractId: contractArtifact.contract_id,
                        history,
                        currentRound: {
                            round,
                            total_score: evalReport.total_score,
                            release_score: evalReport.release_score,
                            overall_verdict: evalReport.overall_verdict,
                            previous_patch_request_resolved: previousPatchRequestResolved,
                            threshold_results: evalReport.threshold_results
                        },
                        patchRequest: patchRequestArtifact,
                        qualityCritique: qualityCritiqueArtifact,
                        failureLineage
                    });
                    roundResultArtifact = buildRoundResultArtifact({
                        roundDirectory,
                        round,
                        contractAgreementArtifact,
                        generatorPlanArtifact,
                        evaluatorVerdictArtifact,
                        patchRequestArtifact,
                        qualityCritiqueArtifact,
                        evalReport,
                        selectedForRun: false,
                        previousPatchRequestAddressed,
                        previousPatchRequestResolved,
                        ...(roundScorecard ? { scorecardPath: artifacts.scorecard_json_path } : {})
                    });
                    await writeRoundArtifacts({
                        roundDirectory,
                        evaluatorVerdictArtifact,
                        patchRequestArtifact,
                        qualityCritiqueArtifact,
                        trajectoryDecisionArtifact,
                        roundResultArtifact,
                        evalReport,
                        failureLineage,
                        adapterDriftReport,
                        adapterMigrationProposal,
                        adapterMigrationApplied
                    });
                    if (roundScorecard) {
                        await writeRoundScorecardArtifacts({
                            roundDirectory,
                            scorecard: roundScorecard
                        });
                    }
                    await markProgress(`Evaluation artifacts saved for round ${round}.`);
                    await recordRoundPhase({
                        round,
                        phase: "evaluation",
                        status: "completed",
                        artifacts: {
                            eval_report_path: artifacts.eval_report_path,
                            ...(roundScorecard ? { scorecard_path: artifacts.scorecard_json_path } : {}),
                            patch_request_path: artifacts.patch_request_json_path,
                            round_result_path: artifacts.round_result_json_path,
                            ...(adapterDriftReport
                                ? { adapter_drift_report_path: artifacts.adapter_drift_report_json_path }
                                : {})
                        }
                    });
                    return undefined;
                });
                if (evaluationResult) {
                    return evaluationResult;
                }
            }
            latestEvalReport = evalReport;
            const improved = isImproved(evalReport.total_score, bestScore);
            if (improved) {
                bestScore = evalReport.total_score;
                bestControlPlaneScore = evalReport.control_plane_score;
                bestProofScore = evalReport.proof_score;
                bestReleaseScore = evalReport.release_score;
                bestThresholdResults = evalReport.threshold_results;
                bestDimensionScores = evalReport.dimension_scores;
                bestRound = round;
                bestEvalReportPath = artifacts.eval_report_path;
                bestPatchRequestPath = artifacts.patch_request_json_path;
                plateauCount = 0;
            }
            else {
                plateauCount += 1;
            }
            const roundSummary = {
                round,
                attempt_kind: directive.attempt_kind,
                negotiation_mode: lifecycleDecision.negotiation_mode,
                continuation_authority: lifecycleDecision.continuation_authority,
                decision_source: lifecycleDecision.decision_source,
                controller_mode: controllerMode,
                transport_mode: transportMode,
                ...(lifecycleDecision.recontract_reason
                    ? { recontract_reason: lifecycleDecision.recontract_reason }
                    : {}),
                label: directive?.label ?? `round ${round}`,
                controller_reason: lifecycleDecision.reason,
                trajectory: trajectoryDecisionArtifact,
                objective: contractArtifact.objective,
                ...(resolvedTargetFamily ? { target_family: resolvedTargetFamily } : {}),
                ...(resolvedValidationLane
                    ? { validation_lane: resolvedValidationLane }
                    : {}),
                total_score: evalReport.total_score,
                control_plane_score: evalReport.control_plane_score,
                proof_score: evalReport.proof_score,
                release_score: evalReport.release_score,
                overall_verdict: evalReport.overall_verdict,
                check_pass_rate: roundResultArtifact.check_pass_rate,
                contract_path: artifacts.contract_json_path,
                contract_review_path: persistContractReviewArtifact
                    ? artifacts.contract_review_json_path
                    : undefined,
                contract_agreement_path: persistContractAgreementArtifact
                    ? artifacts.contract_agreement_json_path
                    : undefined,
                generator_plan_path: artifacts.generator_plan_json_path,
                evaluator_verdict_path: artifacts.evaluator_verdict_json_path,
                patch_request_path: artifacts.patch_request_json_path,
                quality_critique_path: artifacts.quality_critique_json_path,
                trajectory_decision_path: artifacts.trajectory_decision_json_path,
                eval_report_path: artifacts.eval_report_path,
                ...(roundScorecard ? { scorecard_path: artifacts.scorecard_json_path } : {}),
                failure_lineage_path: artifacts.failure_lineage_path,
                ...(adapterDriftReport
                    ? { adapter_drift_report_path: artifacts.adapter_drift_report_json_path }
                    : {}),
                ...(adapterMigrationProposal
                    ? {
                        adapter_migration_proposal_path: artifacts.adapter_migration_proposal_json_path
                    }
                    : {}),
                ...(adapterMigrationApplied
                    ? {
                        adapter_migration_applied_path: artifacts.adapter_migration_applied_json_path
                    }
                    : {}),
                planner_context_path: artifacts.planner_context_path,
                generator_brief_path: artifacts.generator_brief_path,
                qa_review_path: artifacts.qa_review_path,
                controller_decision_path: artifacts.controller_decision_path,
                evidence_paths: evalReport.evidence_paths,
                previous_patch_request_addressed: roundResultArtifact.previous_patch_request_addressed,
                previous_patch_request_resolved: roundResultArtifact.previous_patch_request_resolved,
                resolved_check_ids: roundResultArtifact.resolved_check_ids,
                unresolved_check_ids: roundResultArtifact.unresolved_check_ids,
                threshold_results: evalReport.threshold_results,
                dimension_scores: evalReport.dimension_scores,
                ...(failureLineage ? { failure_lineage: failureLineage } : {})
            };
            latestRoundState = {
                score: evalReport.total_score,
                controlPlaneScore: evalReport.control_plane_score,
                proofScore: evalReport.proof_score,
                verdict: evalReport.overall_verdict,
                unresolvedCheckIds: roundResultArtifact.unresolved_check_ids,
                patchNextAction: patchRequestArtifact.next_action,
                patchMustFixCount: patchRequestArtifact.must_fix.length,
                thresholdResults: evalReport.threshold_results,
                failureLineage,
                staticAdapterContractInvalid: contractReviewArtifact.static_blockers.length > 0 &&
                    (!adapterMigrationStopPreview ||
                        adapterMigrationStopPreview.apply_mode === "new_run_required")
            };
            const roundStopReason = stopReasonFromState({
                latestVerdict: latestRoundState.verdict,
                latestUnresolvedCheckIds: latestRoundState.unresolvedCheckIds,
                latestPatchNextAction: latestRoundState.patchNextAction,
                latestMustFixCount: latestRoundState.patchMustFixCount,
                latestThresholdResults: latestRoundState.thresholdResults,
                latestFailureLineage: latestRoundState.failureLineage,
                latestStaticAdapterContractInvalid: latestRoundState.staticAdapterContractInvalid,
                plateauCount,
                plateauLimit: hydratedRubric.stop_after_plateau_rounds,
                completedRounds: round,
                maxRounds: executionMaxRounds
            }) ?? "continue";
            roundSummary.round_stop_reason = roundStopReason;
            const unresolvedSignature = unresolvedSignatureFor(roundResultArtifact.unresolved_check_ids);
            if (!unresolvedSignature) {
                repeatedUnresolvedCount = 0;
            }
            else if (unresolvedSignature === latestFailureLineage?.unresolved_signature) {
                repeatedUnresolvedCount += 1;
            }
            else {
                repeatedUnresolvedCount = 1;
            }
            latestFailureLineage = failureLineage;
            if (history.length > 0) {
                const previousScore = history[history.length - 1]?.total_score;
                if (previousScore !== undefined) {
                    scoreDeltas = [
                        ...scoreDeltas,
                        Number((evalReport.total_score - previousScore).toFixed(3))
                    ].slice(-6);
                }
            }
            const stopReason = roundStopReason === "continue" ? undefined : roundStopReason;
            const roundCheckpointSummary = await withPhaseBudget("round_commit", async () => {
                await recordRoundPhase({
                    round,
                    phase: "round_commit",
                    status: "in_progress",
                    artifacts: {
                        round_summary_path: join(roundDirectory, "round_summary.json")
                    }
                });
                history.push(roundSummary);
                await writeRoundSummary(roundDirectory, roundSummary);
                latestRoundSummaryPath = join(roundDirectory, "round_summary.json");
                latestEvalReportPath = artifacts.eval_report_path;
                await markProgress(`Round summary saved for round ${round}.`);
                await writeRoundHandoff({
                    roundDirectory,
                    scenario,
                    round,
                    contractReview: contractReviewArtifact,
                    contractAgreement: contractAgreementArtifact,
                    evalReport,
                    patchRequest: patchRequestArtifact,
                    qualityCritique: qualityCritiqueArtifact,
                    trajectoryDecision: trajectoryDecisionArtifact,
                    failureLineage,
                    executorMode,
                    targetFamily: resolvedTargetFamily,
                    validationLane: resolvedValidationLane,
                    decisionSource: lifecycleDecision.decision_source,
                    previousPatchRequestAddressed,
                    previousPatchRequestResolved,
                    stopReason
                });
                previousPatchRequest = patchRequestArtifact;
                previousPatchRequestPath = artifacts.patch_request_json_path;
                previousTrajectoryDecision = trajectoryDecisionArtifact;
                previousTrajectoryDecisionPath = artifacts.trajectory_decision_json_path;
                previousRoundSummary = roundSummary;
                updateSessionRefreshState({
                    currentObjective: contractAgreementArtifact.objective,
                    steeringNotes: [],
                    reviewFeedback: reviewFeedbackFromArtifacts({
                        contractReviewArtifact,
                        patchRequestArtifact,
                        qualityCritiqueArtifact,
                        evalReport
                    }),
                    externalBlockers: externalBlockersFromPatchRequest(patchRequestArtifact),
                    scopeGuardrails: scopeGuardrailsFromPatchRequest(patchRequestArtifact),
                    latestRound: round,
                    latestStopReason: stopReason
                });
                const checkpointSummary = await writeCheckpoint(stopReason);
                await markProgress(`Run checkpoint saved after round ${round}.`);
                await recordRoundPhase({
                    round,
                    phase: "round_commit",
                    status: "completed",
                    artifacts: {
                        round_summary_path: latestRoundSummaryPath,
                        summary_path: summaryPath
                    }
                });
                return checkpointSummary;
            });
            if (repairRoundLimit === round) {
                return {
                    plan,
                    summary: roundCheckpointSummary,
                    runDirectory,
                    plannedScenarioPath
                };
            }
            if (transportMode === "current-thread" && stopReason === "environment_blocked") {
                const environmentBlockers = patchRequestArtifact.environment_blockers ?? [];
                return pauseForExternalCondition({
                    round,
                    phase: "evaluation",
                    checkpointKind: "evaluator",
                    notes: unique([
                        `Round ${round} is blocked by an external environment condition.`,
                        ...(environmentBlockers.length > 0
                            ? environmentBlockers.map((blocker) => `Resolve environment blocker: ${blocker}`)
                            : [
                                "Resolve the environment blocker recorded in the latest failure lineage before resuming this run."
                            ])
                    ])
                });
            }
            if (stopReason) {
                break;
            }
        }
        const finalStopReason = latestRoundState
            ? stopReasonFromState({
                latestVerdict: latestRoundState.verdict,
                latestUnresolvedCheckIds: latestRoundState.unresolvedCheckIds,
                latestPatchNextAction: latestRoundState.patchNextAction,
                latestMustFixCount: latestRoundState.patchMustFixCount,
                latestThresholdResults: latestRoundState.thresholdResults,
                latestFailureLineage: latestRoundState.failureLineage,
                latestStaticAdapterContractInvalid: latestRoundState.staticAdapterContractInvalid,
                plateauCount,
                plateauLimit: hydratedRubric.stop_after_plateau_rounds,
                completedRounds: history.length,
                maxRounds: executionMaxRounds
            })
            : undefined;
        const resolvedStopReason = stopReasonFromState({
            latestVerdict: latestRoundState?.verdict ?? "hold",
            latestUnresolvedCheckIds: latestRoundState?.unresolvedCheckIds ?? [],
            latestPatchNextAction: latestRoundState?.patchNextAction,
            latestMustFixCount: latestRoundState?.patchMustFixCount ?? 0,
            latestThresholdResults: latestRoundState?.thresholdResults,
            latestFailureLineage: latestRoundState?.failureLineage,
            latestStaticAdapterContractInvalid: latestRoundState?.staticAdapterContractInvalid,
            plateauCount,
            plateauLimit: hydratedRubric.stop_after_plateau_rounds,
            completedRounds: history.length,
            maxRounds: executionMaxRounds
        }) ?? "max_rounds_reached";
        const terminalRoundSummary = history[history.length - 1];
        const terminalRound = terminalRoundSummary?.round ?? bestRound;
        const terminalTotalScore = terminalRoundSummary?.total_score ?? bestScore ?? 0;
        const terminalControlPlaneScore = terminalRoundSummary?.control_plane_score ?? bestControlPlaneScore;
        const terminalProofScore = terminalRoundSummary?.proof_score ?? bestProofScore;
        const terminalReleaseScore = terminalRoundSummary?.release_score ?? bestReleaseScore;
        const terminalThresholdResults = terminalRoundSummary?.threshold_results ?? bestThresholdResults;
        const terminalDimensionScores = terminalRoundSummary?.dimension_scores ?? bestDimensionScores;
        const finalRuntimeEvents = mergeRuntimeEvents([
            ...currentRuntimeEvents,
            ...(restoredRun
                ? [
                    buildRuntimeEvent(input.forceReopenTerminal &&
                        isResumeNoopTerminalStopReason(restoredStopReason)
                        ? "resume.reopened_terminal"
                        : "resume.continued", input.forceReopenTerminal &&
                        isResumeNoopTerminalStopReason(restoredStopReason)
                        ? `Run '${runId}' reopened a terminal stop reason '${restoredStopReason}' because --force-reopen-terminal was supplied explicitly.`
                        : `Resume for run '${runId}' continued by opening a new round.`, {
                        stop_reason: restoredStopReason ?? null,
                        resumed_run_id: runId
                    })
                ]
                : [])
        ]);
        runtimeWarnings = normalizeRuntimeWarnings([
            ...runtimeWarnings,
            ...finalRuntimeEvents.map((event) => event.message)
        ]);
        const resumeDecisionArtifact = resumeDecisionPath
            ? {
                run_id: runId,
                decided_at: new Date().toISOString(),
                decision: input.forceReopenTerminal &&
                    isResumeNoopTerminalStopReason(restoredStopReason)
                    ? "reopened_terminal"
                    : "continue",
                previous_stop_reason: restoredStopReason,
                force_reopen_terminal: Boolean(input.forceReopenTerminal),
                allow_resume_migration: Boolean(input.allowResumeMigration),
                mismatches: resumeIdentityMismatches,
                runtime_event_codes: finalRuntimeEvents.map((event) => event.code)
            }
            : undefined;
        let summary = buildCheckpointSummary({
            runId,
            scenarioId: scenario.scenario_id,
            rubricId: hydratedRubric.rubric_id,
            controllerMode,
            transportMode,
            executorMode,
            targetFamily: resolvedTargetFamily,
            validationLane: resolvedValidationLane,
            evaluatorProfilePath: bundleSelection.evaluatorProfilePath,
            adapterContractSha256: currentResumeIdentity.adapter_contract_sha256,
            evaluatorBundleSha256: currentResumeIdentity.evaluator_bundle_sha256,
            rubricSha256: currentResumeIdentity.rubric_sha256,
            plannerBriefPath,
            plannedScenarioPath,
            planPath,
            ideaPath: defaultIdeaPath,
            featureListPath: durableMemoryPaths.feature_list_path,
            progressPath: durableMemoryPaths.progress_path,
            progressLogPath: durableMemoryPaths.progress_log_path,
            doneWhenPath: durableMemoryPaths.done_when_path,
            initScriptPath: durableMemoryPaths.init_script_path,
            adapterContractPath: loadedAdapter?.contract_path,
            adapterId: loadedAdapter?.contract.adapter_id,
            verificationProviderId: loadedAdapter?.contract.verification_provider?.provider_id,
            adapterAttached: Boolean(loadedAdapter),
            codexSessionRegistryPath,
            resumeIdentityPath: currentResumeIdentityPath,
            runtimeLiveStatePath: runtimeStatePaths.liveStatePath,
            runtimeRoundPhasePath: runtimeStatePaths.roundPhasePath,
            controllerLeasePath: runtimeStatePaths.controllerLeasePath,
            transportStatePath: runtimeStatePaths.transportStatePath,
            transportProtocolPath: transportProtocolCurrentPath,
            sessionStatusPath: runtimeStatePaths.sessionStatusPath,
            sessionStatusEventsPath: runtimeStatePaths.sessionStatusEventsPath,
            sessionStreamPath: runtimeStatePaths.sessionStreamPath,
            stopReason: finalStopReason ?? resolvedStopReason,
            bestRound,
            bestScore: bestScore ?? terminalTotalScore,
            bestControlPlaneScore,
            bestProofScore,
            bestReleaseScore,
            bestThresholdResults: bestThresholdResults ?? terminalThresholdResults,
            bestDimensionScores,
            history,
            runtimeEvents: finalRuntimeEvents,
            runtimeWarnings,
            resumeMigrationPath,
            previousBundleFingerprint,
            newBundleFingerprint,
            adapterMigrationAppliedPath: latestAdapterMigrationAppliedPath,
            resumeDecisionPath,
            resumedFromRunId: input.resumeRunPath ? runId : undefined
        });
        if (evaluationPolicy) {
            summary.evaluation_policy_path = evaluationPolicyPathForRun(runDirectory);
        }
        currentCheckpointStopReason = summary.stop_reason;
        await withPhaseBudget("run_finalize", async () => {
            await recordRoundPhase({
                round: terminalRound ?? 0,
                phase: "run_finalize",
                status: "in_progress",
                artifacts: {
                    summary_path: summaryPath
                }
            });
            const codexHandoffPath = await writeRunCodexHandoff({
                runDirectory,
                summary,
                plan,
                scenario
            });
            summary.codex_handoff_path = codexHandoffPath;
            await Promise.all([
                writeJson(currentResumeIdentityPath, currentResumeIdentity),
                ...(resumeDecisionArtifact && resumeDecisionPath
                    ? [writeJson(resumeDecisionPath, resumeDecisionArtifact)]
                    : [])
            ]);
            await writeRunCheckpoint({
                runDirectory,
                summary,
                currentBest: {
                    round: terminalRound,
                    totalScore: terminalRoundSummary?.total_score ?? bestScore ?? 0,
                    controlPlaneScore: terminalRoundSummary?.control_plane_score ?? bestControlPlaneScore,
                    proofScore: terminalRoundSummary?.proof_score ?? bestProofScore,
                    releaseScore: terminalRoundSummary?.release_score ?? bestReleaseScore,
                    thresholdResults: terminalRoundSummary?.threshold_results ?? bestThresholdResults,
                    dimensionScores: terminalRoundSummary?.dimension_scores ?? bestDimensionScores,
                    patchRequestPath: terminalRoundSummary?.patch_request_path ?? bestPatchRequestPath,
                    evalReportPath: terminalRoundSummary?.eval_report_path ?? bestEvalReportPath,
                    bestScoringRound: bestRound,
                    bestScoringTotalScore: bestScore ?? 0,
                    bestScoringControlPlaneScore: bestControlPlaneScore,
                    bestScoringProofScore: bestProofScore,
                    bestScoringReleaseScore: bestReleaseScore,
                    bestScoringThresholdResults: bestThresholdResults,
                    bestScoringDimensionScores: bestDimensionScores,
                    bestScoringPatchRequestPath: bestPatchRequestPath,
                    bestScoringEvalReportPath: bestEvalReportPath
                }
            });
            await markProgress(`Final run artifacts saved for ${runId}.`);
            replaceHeartbeatNotes();
            setExecutionState("completed");
            updateSessionRefreshState({
                currentObjective: terminalRoundSummary?.objective ?? sessionCurrentObjective,
                latestRound: terminalRound,
                latestStopReason: summary.stop_reason
            });
            await refreshSessionPreparationArtifacts({
                stopReason: summary.stop_reason,
                executionState: "completed"
            });
            await recordRoundPhase({
                round: terminalRound ?? 0,
                phase: "run_finalize",
                status: "completed",
                artifacts: {
                    summary_path: summaryPath,
                    codex_handoff_path: codexHandoffPath
                }
            });
        });
        return {
            plan,
            summary,
            runDirectory,
            plannedScenarioPath
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const note = error instanceof PhaseBudgetExceededError
            ? `Phase '${error.phase}' exhausted its ${error.timeoutMs}ms budget and was marked stalled.`
            : `Controller failed while '${activeHeartbeatPhase ?? "initializing"}': ${message}`;
        replaceHeartbeatNotes(unique([...heartbeatNotes, note]));
        if (heartbeat && activeHeartbeatRound !== undefined && activeHeartbeatPhase) {
            const stalledAt = new Date().toISOString();
            activeHeartbeatPhaseStatus = "stalled";
            setExecutionState(error instanceof PhaseBudgetExceededError ? "stalled" : "failed");
            await writeRuntimeRoundPhaseArtifact(runtimeStatePaths.roundPhasePath, {
                run_id: runId,
                round: activeHeartbeatRound,
                controller_mode: controllerMode,
                transport_mode: transportMode,
                executor_mode: executorMode,
                phase: activeHeartbeatPhase,
                status: "stalled",
                updated_at: stalledAt,
                heartbeat_at: stalledAt,
                ...(lastProgressAt ? { last_progress_at: lastProgressAt } : {}),
                ...(lastProgressNote ? { last_progress_note: lastProgressNote } : {}),
                ...(activePhaseTimeoutMs !== undefined
                    ? { phase_timeout_ms: activePhaseTimeoutMs }
                    : {}),
                ...(activeStallThresholdMs !== undefined
                    ? { stall_threshold_ms: activeStallThresholdMs }
                    : {}),
                owner_pid: process.pid,
                ...(activeHeartbeatPhaseStartedAt
                    ? { phase_started_at: activeHeartbeatPhaseStartedAt }
                    : {}),
                ...(appServerTransport?.snapshot().thread_id
                    ? { session: { thread_id: appServerTransport.snapshot().thread_id } }
                    : {}),
                ...(heartbeatNotes.length > 0 ? { notes: heartbeatNotes } : {})
            });
            await writeLiveTransportProtocol();
            if (appServerTransport) {
                await appServerTransport.syncPhase({
                    round: activeHeartbeatRound,
                    phase: activeHeartbeatPhase,
                    status: "stalled",
                    notes: heartbeatNotes
                });
            }
            await heartbeat.tick();
        }
        if (!(error instanceof PhaseBudgetExceededError)) {
            setExecutionState("failed");
            await heartbeat?.tick();
        }
        throw error;
    }
    finally {
        await stopRuntime();
    }
};
//# sourceMappingURL=loop.js.map