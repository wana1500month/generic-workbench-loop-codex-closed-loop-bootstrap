import { enhanceEvalReportWithAppServer, enhanceEvalReportWithCodex } from "../codex-agents.js";
import { enhanceEvalReportWithCurrentThread } from "../current-thread-enhancement.js";
import { buildAdapterDriftReport } from "../adapter-drift.js";
import { buildAdapterMigrationProposal } from "../adapter-migration.js";
import { applyFailureLineagePolicySnapshot } from "../failure-lineage.js";
import { loadJson, loadJsonIfExists } from "../file-system.js";
import { buildEvaluatorVerdictArtifact, buildPatchRequestArtifact, buildQualityCritiqueArtifact, buildRoundResultArtifact, writeRoundArtifacts } from "../protocol-artifacts.js";
import { buildEvalReport } from "../round-evaluator.js";
import { failureLineageForEvalReport } from "../resume-state.js";
import { targetCheckIdsFromPatchRequest } from "../attempt-lifecycle.js";
import { buildTrajectoryDecisionArtifact } from "../trajectory-controller.js";
import { applyRoundScorecardGate, writeOptionalRoundScorecardArtifacts } from "./scorecard-artifacts.js";
import { isImproved } from "./round-files.js";
import { phaseCompletedAtOrBeyond } from "./checkpoints.js";
export const runEvaluatorStep = async (input) => {
    if (phaseCompletedAtOrBeyond(input.resumedRoundPhase, "evaluation")) {
        const evalReport = await loadJson(input.artifacts.eval_report_path);
        const roundResultArtifact = await loadJson(input.artifacts.round_result_json_path);
        return {
            evalReport,
            evaluatorVerdictArtifact: await loadJson(input.artifacts.evaluator_verdict_json_path),
            qualityCritiqueArtifact: await loadJson(input.artifacts.quality_critique_json_path),
            patchRequestArtifact: await loadJson(input.artifacts.patch_request_json_path),
            trajectoryDecisionArtifact: await loadJson(input.artifacts.trajectory_decision_json_path),
            roundResultArtifact,
            roundScorecard: await loadJsonIfExists(input.artifacts.scorecard_json_path),
            failureLineage: (await loadJsonIfExists(input.artifacts.failure_lineage_path)) ??
                failureLineageForEvalReport({
                    evalReport,
                    loadedAdapter: input.loadedAdapter,
                    previousRoundSummary: input.previousRoundSummary
                }),
            adapterDriftReport: await loadJsonIfExists(input.artifacts.adapter_drift_report_json_path),
            adapterMigrationStopPreview: input.adapterMigrationProposal ??
                (await loadJsonIfExists(input.artifacts.adapter_migration_proposal_json_path)),
            previousPatchRequestResolved: roundResultArtifact.previous_patch_request_resolved,
            runtimeWarnings: []
        };
    }
    let output;
    const evaluationResult = await input.withPhaseBudget("evaluation", async () => {
        await input.recordRoundPhase({
            round: input.round,
            phase: "evaluation",
            status: "in_progress"
        });
        const baseEvalReport = buildEvalReport({
            round: input.round,
            rubric: input.rubric,
            contractArtifact: input.contractArtifact,
            contractReviewArtifact: input.contractReviewArtifact,
            contractAgreementArtifact: input.contractAgreementArtifact,
            artifacts: input.artifacts,
            plannerBriefPath: input.plannerBriefPath,
            planPath: input.planPath,
            loadedAdapter: input.loadedAdapter,
            adapterExecutions: input.adapterExecutions,
            coreProbeResults: input.coreProbeResults,
            targetManifest: input.targetManifest,
            previousPatchTargetCheckIds: input.previousPatchTargetCheckIds,
            previousPatchRequestAddressed: input.previousPatchRequestAddressed
        });
        const evalEnhancement = input.transportMode === "current-thread"
            ? await enhanceEvalReportWithCurrentThread({
                runId: input.runId,
                round: input.round,
                transportProtocolPath: input.transportProtocolCurrentPath,
                artifacts: input.artifacts,
                idea: input.idea,
                contractArtifact: input.contractArtifact,
                generatorPlanArtifact: input.generatorPlanArtifact,
                evalReport: baseEvalReport,
                adapterExecutions: input.adapterExecutions,
                coreProbeResults: input.coreProbeResults,
                targetManifest: input.targetManifest,
                executorMode: input.executorMode
            })
            : undefined;
        if (evalEnhancement?.kind === "checkpoint") {
            return input.checkpointForCurrentThreadWork({
                round: input.round,
                phase: "evaluation",
                checkpointKind: evalEnhancement.checkpointKind,
                artifacts: evalEnhancement.artifacts,
                notes: evalEnhancement.notes
            });
        }
        const resolvedEvalEnhancement = input.transportMode === "app-server" && input.appServerTransport
            ? await enhanceEvalReportWithAppServer({
                transport: input.appServerTransport,
                round: input.round,
                idea: input.idea,
                contractArtifact: input.contractArtifact,
                generatorPlanArtifact: input.generatorPlanArtifact,
                evalReport: baseEvalReport,
                adapterExecutions: input.adapterExecutions,
                coreProbeResults: input.coreProbeResults,
                targetManifest: input.targetManifest,
                executorMode: input.executorMode
            })
            : evalEnhancement
                ? {
                    value: evalEnhancement.value,
                    runtimeWarnings: evalEnhancement.runtimeWarnings
                }
                : await enhanceEvalReportWithCodex({
                    roundDirectory: input.roundDirectory,
                    idea: input.idea,
                    contractArtifact: input.contractArtifact,
                    generatorPlanArtifact: input.generatorPlanArtifact,
                    evalReport: baseEvalReport,
                    adapterExecutions: input.adapterExecutions,
                    coreProbeResults: input.coreProbeResults,
                    targetManifest: input.targetManifest,
                    executorMode: input.executorMode
                });
        let evalReport = resolvedEvalEnhancement.value;
        const previousPatchRequestResolved = input.previousPatchTargetCheckIds.length === 0 ||
            evalReport.check_results.some((result) => result.check_id === "previous_patch_request_resolved" &&
                result.status === "pass");
        let roundScorecard;
        if (input.evaluationPolicy) {
            const gatedEvaluation = applyRoundScorecardGate({
                policy: input.evaluationPolicy,
                evalReport
            });
            evalReport = gatedEvaluation.evalReport;
            roundScorecard = gatedEvaluation.scorecard;
        }
        const evaluatorVerdictArtifact = buildEvaluatorVerdictArtifact({
            contractArtifact: input.contractArtifact,
            evalReport
        });
        const rawFailureLineage = failureLineageForEvalReport({
            evalReport,
            loadedAdapter: input.loadedAdapter,
            previousRoundSummary: input.previousRoundSummary
        });
        const provisionalPatchRequestArtifact = buildPatchRequestArtifact({
            round: input.round,
            evalReport,
            evaluatorVerdictArtifact,
            qualityCritiqueArtifact: {
                critique_id: `${input.contractArtifact.contract_id}-quality-critique-provisional`,
                contract_id: input.contractArtifact.contract_id,
                round: input.round,
                remediation_strategy: evalReport.threshold_results.contract_completed
                    ? "refine"
                    : "tighten",
                quality_focus: [],
                preserve_signals: [],
                findings: [],
                notes: []
            },
            adapterAttached: Boolean(input.loadedAdapter),
            staticContractBlockers: input.contractReviewArtifact.static_blockers,
            failureLineage: rawFailureLineage
        });
        const allowedCheckIds = new Set([
            ...(input.activeContractFrame?.acceptance_checks ??
                input.contractAgreementArtifact.acceptance_checks),
            ...evalReport.unresolved_check_ids,
            "target_signal_thresholds_met",
            "adapter_execution_healthy",
            "release_blockers_recorded"
        ]);
        const currentScopeDrift = targetCheckIdsFromPatchRequest(provisionalPatchRequestArtifact).some((checkId) => !allowedCheckIds.has(checkId));
        const projectedScoreDeltas = input.history.length > 0
            ? [
                ...input.scoreDeltas,
                Number((evalReport.total_score -
                    input.history[input.history.length - 1].total_score).toFixed(3))
            ].slice(-6)
            : input.scoreDeltas.slice(-6);
        const projectedPlateauCount = isImproved(evalReport.total_score, input.bestScore)
            ? 0
            : input.plateauCount + 1;
        const failureLineage = rawFailureLineage
            ? applyFailureLineagePolicySnapshot({
                history: input.history,
                failureLineage: rawFailureLineage,
                scoreDeltas: projectedScoreDeltas,
                scopeDriftDetected: currentScopeDrift,
                patchEntropy: Number((provisionalPatchRequestArtifact.must_fix.length > 0
                    ? provisionalPatchRequestArtifact.must_fix.length
                    : targetCheckIdsFromPatchRequest(provisionalPatchRequestArtifact).length).toFixed(3)),
                projectedPlateauCount,
                plateauLimit: input.plateauLimit
            })
            : undefined;
        const adapterDriftReport = buildAdapterDriftReport({
            contractId: input.contractArtifact.contract_id,
            round: input.round,
            contractReviewArtifact: input.contractReviewArtifact,
            failureLineage
        });
        const adapterMigrationStopPreview = adapterDriftReport && input.loadedAdapter
            ? await buildAdapterMigrationProposal({
                runId: input.runId,
                round: input.round + 1,
                sourceAdapterDriftReportPath: input.artifacts.adapter_drift_report_json_path,
                loadedAdapter: input.loadedAdapter,
                adapterDriftReport
            })
            : undefined;
        const qualityCritiqueArtifact = buildQualityCritiqueArtifact({
            round: input.round,
            contractArtifact: input.contractArtifact,
            evalReport,
            loadedAdapter: input.loadedAdapter,
            failureLineage
        });
        const patchRequestArtifact = buildPatchRequestArtifact({
            round: input.round,
            evalReport,
            evaluatorVerdictArtifact,
            qualityCritiqueArtifact,
            adapterAttached: Boolean(input.loadedAdapter),
            staticContractBlockers: input.contractReviewArtifact.static_blockers,
            failureLineage,
            adapterDriftReport
        });
        const trajectoryDecisionArtifact = buildTrajectoryDecisionArtifact({
            round: input.round,
            contractId: input.contractArtifact.contract_id,
            history: input.history,
            currentRound: {
                round: input.round,
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
        const roundResultArtifact = buildRoundResultArtifact({
            roundDirectory: input.roundDirectory,
            round: input.round,
            contractAgreementArtifact: input.contractAgreementArtifact,
            generatorPlanArtifact: input.generatorPlanArtifact,
            evaluatorVerdictArtifact,
            patchRequestArtifact,
            qualityCritiqueArtifact,
            evalReport,
            selectedForRun: false,
            previousPatchRequestAddressed: input.previousPatchRequestAddressed,
            previousPatchRequestResolved,
            ...(roundScorecard
                ? { scorecardPath: input.artifacts.scorecard_json_path }
                : {})
        });
        await writeRoundArtifacts({
            roundDirectory: input.roundDirectory,
            evaluatorVerdictArtifact,
            patchRequestArtifact,
            qualityCritiqueArtifact,
            trajectoryDecisionArtifact,
            roundResultArtifact,
            evalReport,
            failureLineage,
            adapterDriftReport,
            adapterMigrationProposal: input.adapterMigrationProposal,
            adapterMigrationApplied: input.adapterMigrationApplied
        });
        await writeOptionalRoundScorecardArtifacts({
            roundDirectory: input.roundDirectory,
            scorecard: roundScorecard
        });
        await input.markProgress(`Evaluation artifacts saved for round ${input.round}.`);
        await input.recordRoundPhase({
            round: input.round,
            phase: "evaluation",
            status: "completed",
            artifacts: {
                eval_report_path: input.artifacts.eval_report_path,
                ...(roundScorecard
                    ? { scorecard_path: input.artifacts.scorecard_json_path }
                    : {}),
                patch_request_path: input.artifacts.patch_request_json_path,
                round_result_path: input.artifacts.round_result_json_path,
                ...(adapterDriftReport
                    ? {
                        adapter_drift_report_path: input.artifacts.adapter_drift_report_json_path
                    }
                    : {})
            }
        });
        output = {
            evalReport,
            previousPatchRequestResolved,
            evaluatorVerdictArtifact,
            qualityCritiqueArtifact,
            patchRequestArtifact,
            trajectoryDecisionArtifact,
            roundResultArtifact,
            roundScorecard,
            failureLineage,
            adapterDriftReport,
            adapterMigrationStopPreview,
            runtimeWarnings: resolvedEvalEnhancement.runtimeWarnings
        };
        return undefined;
    });
    return evaluationResult ? { checkpointResult: evaluationResult } : output;
};
//# sourceMappingURL=evaluator-step.js.map