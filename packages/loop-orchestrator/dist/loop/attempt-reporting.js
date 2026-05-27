import { join } from "node:path";
import { writeRoundHandoff } from "../agent-handoff.js";
import { unresolvedSignatureFor } from "../attempt-lifecycle.js";
import { writeRoundSummary } from "./round-files.js";
import { externalBlockersFromPatchRequest, reviewFeedbackFromArtifacts, scopeGuardrailsFromPatchRequest } from "./runtime-warning-summary.js";
import { stopReasonForRoundTargetDecision } from "./round-target-decision.js";
export const buildAttemptRoundReport = (input) => {
    const roundSummary = {
        round: input.round,
        attempt_kind: input.attemptKind,
        negotiation_mode: input.lifecycleDecision.negotiation_mode,
        continuation_authority: input.lifecycleDecision.continuation_authority,
        decision_source: input.lifecycleDecision.decision_source,
        controller_mode: input.controllerMode,
        transport_mode: input.transportMode,
        ...(input.lifecycleDecision.recontract_reason
            ? { recontract_reason: input.lifecycleDecision.recontract_reason }
            : {}),
        label: input.directiveLabel ?? `round ${input.round}`,
        controller_reason: input.lifecycleDecision.reason,
        trajectory: input.trajectoryDecisionArtifact,
        objective: input.contractAgreementArtifact.objective,
        ...(input.targetFamily ? { target_family: input.targetFamily } : {}),
        ...(input.validationLane ? { validation_lane: input.validationLane } : {}),
        total_score: input.evalReport.total_score,
        control_plane_score: input.evalReport.control_plane_score,
        proof_score: input.evalReport.proof_score,
        release_score: input.evalReport.release_score,
        overall_verdict: input.evalReport.overall_verdict,
        check_pass_rate: input.roundResultArtifact.check_pass_rate,
        contract_path: input.artifacts.contract_json_path,
        contract_review_path: input.contractReviewPath,
        contract_agreement_path: input.contractAgreementPath,
        generator_plan_path: input.artifacts.generator_plan_json_path,
        evaluator_verdict_path: input.artifacts.evaluator_verdict_json_path,
        patch_request_path: input.artifacts.patch_request_json_path,
        quality_critique_path: input.artifacts.quality_critique_json_path,
        trajectory_decision_path: input.artifacts.trajectory_decision_json_path,
        eval_report_path: input.artifacts.eval_report_path,
        ...(input.roundScorecard
            ? { scorecard_path: input.artifacts.scorecard_json_path }
            : {}),
        failure_lineage_path: input.artifacts.failure_lineage_path,
        ...(input.adapterDriftReportPath
            ? { adapter_drift_report_path: input.adapterDriftReportPath }
            : {}),
        ...(input.adapterMigrationProposalPath
            ? { adapter_migration_proposal_path: input.adapterMigrationProposalPath }
            : {}),
        ...(input.adapterMigrationAppliedPath
            ? { adapter_migration_applied_path: input.adapterMigrationAppliedPath }
            : {}),
        planner_context_path: input.artifacts.planner_context_path,
        generator_brief_path: input.artifacts.generator_brief_path,
        qa_review_path: input.artifacts.qa_review_path,
        controller_decision_path: input.artifacts.controller_decision_path,
        evidence_paths: input.evalReport.evidence_paths,
        previous_patch_request_addressed: input.roundResultArtifact.previous_patch_request_addressed,
        previous_patch_request_resolved: input.roundResultArtifact.previous_patch_request_resolved,
        carry_forward_gate_path: input.artifacts.carry_forward_gate_path,
        resolved_check_ids: input.roundResultArtifact.resolved_check_ids,
        unresolved_check_ids: input.roundResultArtifact.unresolved_check_ids,
        threshold_results: input.evalReport.threshold_results,
        dimension_scores: input.evalReport.dimension_scores,
        ...(input.failureLineage ? { failure_lineage: input.failureLineage } : {})
    };
    const latestRoundState = {
        score: input.evalReport.total_score,
        controlPlaneScore: input.evalReport.control_plane_score,
        proofScore: input.evalReport.proof_score,
        verdict: input.evalReport.overall_verdict,
        unresolvedCheckIds: input.roundResultArtifact.unresolved_check_ids,
        patchNextAction: input.patchRequestArtifact.next_action,
        patchMustFixCount: input.patchRequestArtifact.must_fix.length,
        thresholdResults: input.evalReport.threshold_results,
        failureLineage: input.failureLineage,
        staticAdapterContractInvalid: input.contractReviewArtifact.static_blockers.length > 0 &&
            (!input.adapterMigrationStopPreview ||
                input.adapterMigrationStopPreview.apply_mode === "new_run_required")
    };
    const roundStopReason = stopReasonForRoundTargetDecision({
        state: latestRoundState,
        plateauCount: input.plateauCount,
        plateauLimit: input.plateauLimit,
        completedRounds: input.round,
        maxRounds: input.executionMaxRounds
    }) ?? "continue";
    roundSummary.round_stop_reason = roundStopReason;
    const unresolvedSignature = unresolvedSignatureFor(input.roundResultArtifact.unresolved_check_ids);
    const repeatedUnresolvedCount = !unresolvedSignature
        ? 0
        : unresolvedSignature === input.latestFailureLineage?.unresolved_signature
            ? input.repeatedUnresolvedCount + 1
            : 1;
    const previousScore = input.history[input.history.length - 1]?.total_score;
    const scoreDeltas = previousScore !== undefined
        ? [
            ...input.scoreDeltas,
            Number((input.evalReport.total_score - previousScore).toFixed(3))
        ].slice(-6)
        : input.scoreDeltas;
    return {
        roundSummary,
        latestRoundState,
        roundStopReason,
        stopReason: roundStopReason === "continue" ? undefined : roundStopReason,
        repeatedUnresolvedCount,
        latestFailureLineage: input.failureLineage,
        scoreDeltas
    };
};
export const commitAttemptRoundReport = async (input) => input.withPhaseBudget("round_commit", async () => {
    const latestRoundSummaryPath = join(input.roundDirectory, "round_summary.json");
    await input.recordRoundPhase({
        round: input.round,
        phase: "round_commit",
        status: "in_progress",
        artifacts: {
            round_summary_path: latestRoundSummaryPath
        }
    });
    input.history.push(input.roundSummary);
    await writeRoundSummary(input.roundDirectory, input.roundSummary);
    await input.markProgress(`Round summary saved for round ${input.round}.`);
    await writeRoundHandoff({
        roundDirectory: input.roundDirectory,
        scenario: input.scenario,
        round: input.round,
        contractReview: input.contractReviewArtifact,
        contractAgreement: input.contractAgreementArtifact,
        evalReport: input.evalReport,
        patchRequest: input.patchRequestArtifact,
        qualityCritique: input.qualityCritiqueArtifact,
        trajectoryDecision: input.trajectoryDecisionArtifact,
        failureLineage: input.failureLineage,
        executorMode: input.executorMode,
        targetFamily: input.targetFamily,
        validationLane: input.validationLane,
        decisionSource: input.decisionSource,
        previousPatchRequestAddressed: input.previousPatchRequestAddressed,
        previousPatchRequestResolved: input.previousPatchRequestResolved,
        stopReason: input.stopReason
    });
    input.updateSessionRefreshState({
        currentObjective: input.contractAgreementArtifact.objective,
        steeringNotes: [],
        reviewFeedback: reviewFeedbackFromArtifacts({
            contractReviewArtifact: input.contractReviewArtifact,
            patchRequestArtifact: input.patchRequestArtifact,
            qualityCritiqueArtifact: input.qualityCritiqueArtifact,
            evalReport: input.evalReport
        }),
        externalBlockers: externalBlockersFromPatchRequest(input.patchRequestArtifact),
        scopeGuardrails: scopeGuardrailsFromPatchRequest(input.patchRequestArtifact),
        latestRound: input.round,
        latestStopReason: input.stopReason
    });
    const checkpointSummary = await input.writeCheckpoint(input.stopReason);
    await input.markProgress(`Run checkpoint saved after round ${input.round}.`);
    await input.recordRoundPhase({
        round: input.round,
        phase: "round_commit",
        status: "completed",
        artifacts: {
            round_summary_path: latestRoundSummaryPath,
            summary_path: input.summaryPath
        }
    });
    return {
        checkpointSummary,
        latestRoundSummaryPath,
        latestEvalReportPath: input.artifacts.eval_report_path
    };
});
//# sourceMappingURL=attempt-reporting.js.map