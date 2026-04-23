import { existsSync } from "node:fs";

import {
  describePrototypeBaselineSourceSemantics,
  isPrototypeBaselineSourceSemantics,
  prototypeBaselineSourceSemanticsForPhase
} from "../prototype-baseline.js";
import type {
  AdapterCapabilityExecution,
  CoreVerificationProbeExecution,
  ContractAgreementArtifact,
  ContractReviewArtifact,
  EvalReport,
  EvalScoreDimension,
  LoadedAdapterContract,
  LoopRubric,
  ReleaseThresholdResults,
  RoundVerdict,
  RoundArtifacts,
  RoundCheckResult,
  RoundContractArtifact,
  TargetManifest
} from "../types.js";

import {
  adapterContractDocPath,
  adapterExamplePath,
  adapterHonestyCheck,
  adapterCriteriaGroundingCheck,
  adapterMeaningfulEvidenceCheck,
  adapterRuntimePath,
  artifactOnlyChecks,
  checkResult,
  evaluateVerificationProfile,
  expectedTargetSurfacesFor,
  fileSurfaceReservedCheck,
  fileWrittenCheck,
  independentTargetProbeCheck,
  isFailingCheck,
  isKnownCheck,
  isPassingCheck,
  isSatisfiedCheck,
  isVisualEvidencePath,
  liveVerificationPresentCheck,
  nonCarryForwardDerivedChecks,
  nonScoringDerivedChecks,
  pathExists,
  proofBoundaryIndependenceCheck,
  proofEvaluatorChecks,
  proofProvenanceAttestationCheck,
  proofScoreWeightsFor,
  releaseScoreWeightsFor,
  scoreFromResults,
  strictPartialCreditScore,
  successfulGradeRoundExecutionFor,
  unique
} from "./shared.js";

const staticCheckLookup = (input: {
  contractArtifact: RoundContractArtifact;
  contractReviewArtifact: ContractReviewArtifact;
  contractAgreementArtifact: ContractAgreementArtifact;
  artifacts: RoundArtifacts;
  plannerBriefPath: string;
  planPath: string;
  previousPatchTargetCheckIds: string[];
  previousPatchRequestAddressed: boolean;
}): Record<string, RoundCheckResult> => {
  const hasMeaningfulCheck = input.contractArtifact.acceptance_checks.some(
    (checkId) => !artifactOnlyChecks.has(checkId)
  );
  const allChecksKnown = input.contractArtifact.acceptance_checks.every((checkId) => isKnownCheck(checkId));
  const carriedChecksAccepted = input.contractArtifact.carry_over_check_ids.every((checkId) =>
    input.contractArtifact.acceptance_checks.includes(checkId)
  );
  const roundContractHasReleaseScope =
    input.contractArtifact.release_gate_check_ids.length > 0 &&
    input.contractArtifact.proof_plan.length > 0 &&
    input.contractArtifact.pivot_triggers.length > 0;

  return {
    planner_brief_written: fileWrittenCheck(
      "planner_brief_written",
      input.plannerBriefPath,
      "Planner brief"
    ),
    plan_written: fileWrittenCheck("plan_written", input.planPath, "Run-local plan"),
    round_contract_written: fileWrittenCheck(
      "round_contract_written",
      input.artifacts.contract_json_path,
      "Round contract artifact"
    ),
    round_contract_is_testable: checkResult(
      "round_contract_is_testable",
      hasMeaningfulCheck && allChecksKnown && carriedChecksAccepted ? "pass" : "fail",
      hasMeaningfulCheck && allChecksKnown && carriedChecksAccepted
        ? "The round contract includes evaluator-known checks and keeps carried issues explicit."
        : "The round contract is missing meaningful checks, known check ids, or carried issue coverage."
    ),
    contract_review_written: fileWrittenCheck(
      "contract_review_written",
      input.artifacts.contract_review_json_path,
      "Contract review artifact"
    ),
    contract_review_quality: checkResult(
      "contract_review_quality",
      input.contractReviewArtifact.decision === "revise"
        ? input.contractReviewArtifact.required_changes.length > 0
          ? "pass"
          : "fail"
        : input.contractReviewArtifact.required_changes.length === 0
          ? "pass"
          : "fail",
      input.contractReviewArtifact.decision === "revise"
        ? "The evaluator rejected the draft with explicit required changes."
        : "The evaluator accepted the draft because no structural gaps remained."
    ),
    contract_agreement_written: fileWrittenCheck(
      "contract_agreement_written",
      input.artifacts.contract_agreement_json_path,
      "Contract agreement artifact"
    ),
    round_contract_scopes_release_qa: checkResult(
      "round_contract_scopes_release_qa",
      roundContractHasReleaseScope ? "pass" : "fail",
      roundContractHasReleaseScope
        ? "The round contract names release-gate checks, proof expectations, and pivot triggers for end-pass QA."
        : "The round contract is missing release-gate checks, proof expectations, or pivot triggers for end-pass QA."
    ),
    agreement_matches_review: checkResult(
      "agreement_matches_review",
      (input.contractReviewArtifact.decision === "accept" &&
        input.contractAgreementArtifact.status === "agreed") ||
        (input.contractReviewArtifact.decision === "revise" &&
          input.contractAgreementArtifact.status === "blocked")
        ? "pass"
        : "fail",
      "The agreement status follows the review decision."
    ),
    generator_plan_written: fileWrittenCheck(
      "generator_plan_written",
      input.artifacts.generator_plan_json_path,
      "Generator plan artifact"
    ),
    planner_context_surface_reserved: fileSurfaceReservedCheck(
      "planner_context_surface_reserved",
      input.artifacts.planner_context_path,
      "Planner context handoff"
    ),
    generator_brief_surface_reserved: fileSurfaceReservedCheck(
      "generator_brief_surface_reserved",
      input.artifacts.generator_brief_path,
      "Generator brief handoff"
    ),
    qa_review_surface_reserved: fileSurfaceReservedCheck(
      "qa_review_surface_reserved",
      input.artifacts.qa_review_path,
      "QA review handoff"
    ),
    handoff_is_resumable: checkResult(
      "handoff_is_resumable",
      pathExists(input.artifacts.planner_context_path) &&
        pathExists(input.artifacts.generator_brief_path) &&
        pathExists(input.artifacts.qa_review_path) &&
        pathExists(input.artifacts.controller_decision_path) &&
        (input.previousPatchTargetCheckIds.length === 0 || input.previousPatchRequestAddressed)
        ? "pass"
        : "fail",
      "The round keeps the full handoff surface and does not drop carried patch context."
    ),
    evaluator_verdict_surface_reserved: fileSurfaceReservedCheck(
      "evaluator_verdict_surface_reserved",
      input.artifacts.evaluator_verdict_json_path,
      "Evaluator verdict artifact"
    ),
    patch_request_surface_reserved: fileSurfaceReservedCheck(
      "patch_request_surface_reserved",
      input.artifacts.patch_request_json_path,
      "Patch request artifact"
    ),
    previous_patch_request_addressed: checkResult(
      "previous_patch_request_addressed",
      input.previousPatchTargetCheckIds.length === 0 || input.previousPatchRequestAddressed
        ? "pass"
        : "fail",
      input.previousPatchTargetCheckIds.length === 0
        ? "No previous patch request required carry-forward."
        : input.previousPatchRequestAddressed
          ? `The current contract explicitly carries forward ${input.previousPatchTargetCheckIds.join(", ")}.`
          : `The current contract does not explicitly carry forward ${input.previousPatchTargetCheckIds.join(", ")}.`
    ),
    eval_report_surface_reserved: fileSurfaceReservedCheck(
      "eval_report_surface_reserved",
      input.artifacts.eval_report_path,
      "Eval report"
    ),
    controller_decision_surface_reserved: fileSurfaceReservedCheck(
      "controller_decision_surface_reserved",
      input.artifacts.controller_decision_path,
      "Controller decision handoff"
    ),
    adapter_boundary_documented: checkResult(
      "adapter_boundary_documented",
      existsSync(adapterContractDocPath) ? "pass" : "fail",
      existsSync(adapterContractDocPath)
        ? "Adapter contract document exists."
        : "Adapter contract document is missing."
    ),
    adapter_runtime_present: checkResult(
      "adapter_runtime_present",
      existsSync(adapterRuntimePath) ? "pass" : "fail",
      existsSync(adapterRuntimePath)
        ? "Adapter runtime source exists."
        : "Adapter runtime source is missing."
    ),
    adapter_example_written: checkResult(
      "adapter_example_written",
      existsSync(adapterExamplePath) ? "pass" : "fail",
      existsSync(adapterExamplePath)
        ? "Adapter example config exists."
        : "Adapter example config is missing."
    )
  };
};

const scoreDimensionApplicability = (input: {
  dimension: NonNullable<LoopRubric["score_dimensions"]>[number];
  contractArtifact: RoundContractArtifact;
  loadedAdapter?: LoadedAdapterContract;
}): boolean => {
  if (
    input.dimension.skip_in_negotiation_modes?.includes(
      input.contractArtifact.negotiation_mode
    )
  ) {
    return false;
  }

  if (input.dimension.requires_adapter && !input.loadedAdapter) {
    return false;
  }

  const expectedTargetSurfaces =
    input.loadedAdapter?.verification_profile?.profile.expected_target_surfaces ?? [];
  if (
    input.dimension.requires_target_surfaces?.length &&
    !input.dimension.requires_target_surfaces.some((surface) =>
      expectedTargetSurfaces.includes(surface)
    )
  ) {
    return false;
  }

  if (input.dimension.required_core_probe_modes?.length) {
    const profileProbeModes = new Set(
      input.loadedAdapter?.verification_profile?.profile.core_probes?.map((probe) => probe.mode) ?? []
    );
    if (
      !input.dimension.required_core_probe_modes.some((mode) => profileProbeModes.has(mode))
    ) {
      return false;
    }
  }

  return true;
};

const buildDimensionScores = (input: {
  rubric: LoopRubric;
  checkResults: RoundCheckResult[];
  staticCheckLookup: Partial<Record<string, RoundCheckResult>>;
  coreProbeResults: CoreVerificationProbeExecution[];
  contractArtifact: RoundContractArtifact;
  loadedAdapter?: LoadedAdapterContract;
}): EvalScoreDimension[] => {
  const dimensions = input.rubric.score_dimensions ?? [];
  const checkLookup = new Map(input.checkResults.map((result) => [result.check_id, result]));
  return dimensions.map((dimension) => {
    const applicable = scoreDimensionApplicability({
      dimension,
      contractArtifact: input.contractArtifact,
      loadedAdapter: input.loadedAdapter
    });
    const contributingChecks = (dimension.check_ids ?? [])
      .map((checkId) => checkLookup.get(checkId) ?? input.staticCheckLookup[checkId])
      .filter((result): result is RoundCheckResult => Boolean(result));
    const contributingProbes = input.coreProbeResults.filter((probe) => {
      if ((probe.role ?? "supporting") !== "release_gate") {
        return false;
      }
      if (!dimension.required_core_probe_modes?.length) {
        return false;
      }
      return dimension.required_core_probe_modes.includes(probe.mode);
    });
    const totalItems = contributingChecks.length + contributingProbes.length;
    const passedItems =
      contributingChecks.filter((result) => result.status === "pass").length +
      contributingProbes.filter((probe) => probe.ok).length;
    const score =
      !applicable
        ? 1
        : totalItems === 0
          ? 0
          : strictPartialCreditScore(passedItems, totalItems);
    const passed = !applicable || score + 0.0005 >= dimension.minimum_score;
    const detail = !applicable
      ? "Not applicable for the current adapter or target surfaces."
      : totalItems === 0
        ? "No contributing checks or release-gate probes were available for this dimension."
        : `${passedItems}/${totalItems} contributing checks and probes passed; strict partial-credit score is ${score.toFixed(3)}.`;

    return {
      dimension_id: dimension.dimension_id,
      label: dimension.label,
      ...(dimension.description ? { description: dimension.description } : {}),
      weight: dimension.weight ?? 1,
      minimum_score: dimension.minimum_score,
      applicable,
      passed,
      score,
      contributing_check_ids: contributingChecks.map((result) => result.check_id),
      contributing_probe_ids: contributingProbes.map((probe) => probe.probe_id),
      detail
    };
  });
};

const targetSignalBlockingFailures = (input: {
  rubric: LoopRubric;
  dimensionScores: EvalScoreDimension[];
}): EvalScoreDimension[] => {
  const dimensionLookup = new Map(
    (input.rubric.score_dimensions ?? []).map((dimension) => [
      dimension.dimension_id,
      dimension
    ])
  );

  return input.dimensionScores.filter((dimension) => {
    if (!dimension.applicable || dimension.passed) {
      return false;
    }

    return (
      dimensionLookup.get(dimension.dimension_id)?.blocks_target_signal ?? true
    );
  });
};

export const buildEvalReport = (input: {
  round: number;
  rubric: LoopRubric;
  contractArtifact: RoundContractArtifact;
  contractReviewArtifact: ContractReviewArtifact;
  contractAgreementArtifact: ContractAgreementArtifact;
  artifacts: RoundArtifacts;
  plannerBriefPath: string;
  planPath: string;
  loadedAdapter?: LoadedAdapterContract;
  adapterExecutions: AdapterCapabilityExecution[];
  coreProbeResults: CoreVerificationProbeExecution[];
  targetManifest?: TargetManifest;
  previousPatchTargetCheckIds: string[];
  previousPatchRequestAddressed: boolean;
}): EvalReport => {
  const evaluationCheckIds =
    input.contractAgreementArtifact.acceptance_checks.length > 0
      ? input.contractAgreementArtifact.acceptance_checks
      : input.contractArtifact.acceptance_checks;
  const thresholdAcceptanceCheckIds = evaluationCheckIds.filter(
    (checkId) => checkId !== "target_signal_thresholds_met"
  );
  const adapterResults = input.adapterExecutions.map((execution) =>
    checkResult(
      `adapter_${execution.capability}`,
      execution.result.ok ? "pass" : "fail",
      execution.result.summary
    )
  );
  const adapterResultCheckIds = new Set(adapterResults.map((result) => result.check_id));
  const failedAdapterResults = adapterResults.filter(isFailingCheck);
  const criticalAdapterFailures = new Set([
    "adapter_prepare_target",
    "adapter_run_target",
    "adapter_run_checks",
    "adapter_grade_round"
  ]);
  const lookup = staticCheckLookup({
    contractArtifact: input.contractArtifact,
    contractReviewArtifact: input.contractReviewArtifact,
    contractAgreementArtifact: input.contractAgreementArtifact,
    artifacts: input.artifacts,
    plannerBriefPath: input.plannerBriefPath,
    planPath: input.planPath,
    previousPatchTargetCheckIds: input.previousPatchTargetCheckIds,
    previousPatchRequestAddressed: input.previousPatchRequestAddressed
  });

  const actionablePreviousPatchTargetCheckIds = input.previousPatchTargetCheckIds.filter(
    (checkId) => !nonCarryForwardDerivedChecks.has(checkId)
  );

  lookup.adapter_claims_are_honest = adapterHonestyCheck({
    loadedAdapter: input.loadedAdapter,
    adapterExecutions: input.adapterExecutions
  });
  lookup.proof_provenance_is_attested = proofProvenanceAttestationCheck({
    loadedAdapter: input.loadedAdapter,
    adapterExecutions: input.adapterExecutions
  });
  lookup.live_verification_present = liveVerificationPresentCheck({
    loadedAdapter: input.loadedAdapter,
    adapterExecutions: input.adapterExecutions,
    coreProbeResults: input.coreProbeResults,
    targetManifest: input.targetManifest
  });
  lookup.independent_target_probe_present = independentTargetProbeCheck({
    loadedAdapter: input.loadedAdapter,
    coreProbeResults: input.coreProbeResults,
    targetManifest: input.targetManifest
  });
  lookup.proof_boundary_is_independent = proofBoundaryIndependenceCheck({
    loadedAdapter: input.loadedAdapter,
    adapterExecutions: input.adapterExecutions
  });
  lookup.adapter_evidence_is_meaningful = adapterMeaningfulEvidenceCheck({
    loadedAdapter: input.loadedAdapter,
    adapterExecutions: input.adapterExecutions
  });
  lookup.adapter_criteria_are_grounded = adapterCriteriaGroundingCheck({
    loadedAdapter: input.loadedAdapter,
    adapterExecutions: input.adapterExecutions
  });
  const verificationProfileEvaluation = evaluateVerificationProfile({
    loadedAdapter: input.loadedAdapter,
    adapterExecutions: input.adapterExecutions
  });
  lookup.adapter_criteria_match_profile = verificationProfileEvaluation.profileCheck;
  lookup.adapter_execution_healthy = checkResult(
    "adapter_execution_healthy",
    input.loadedAdapter
      ? failedAdapterResults.length === 0
        ? "pass"
        : "fail"
      : "not_applicable",
    input.loadedAdapter
      ? failedAdapterResults.length === 0
        ? "Every adapter capability completed without failure."
        : `Adapter capability failures remain: ${failedAdapterResults.map((result) => result.check_id).join(", ")}.`
      : "Adapter execution health is not applicable without an attached adapter."
  );
  const gradeRoundExecution = successfulGradeRoundExecutionFor(input.adapterExecutions);
  const browserSurfaceExpected = expectedTargetSurfacesFor(input.loadedAdapter).has("browser");
  const subjectiveMetricResults = gradeRoundExecution?.result.subjective_metric_results ?? [];
  const requiredSubjectiveMetricResults = subjectiveMetricResults.filter(
    (metric) => metric.required !== false
  );
  const failedRequiredSubjectiveMetrics = requiredSubjectiveMetricResults.filter(
    (metric) => metric.status === "fail"
  );
  const gradeRoundEvidencePaths = unique([
    ...(gradeRoundExecution?.verified_evidence_paths ?? []),
    ...(gradeRoundExecution?.result.evidence_paths ?? [])
  ]);
  const visualEvidencePresent = unique([
    ...gradeRoundEvidencePaths,
    ...input.coreProbeResults.flatMap((probe) => probe.evidence_paths)
  ]).some(isVisualEvidencePath);
  const prototypeBaselinePresent = gradeRoundExecution?.result.metadata?.prototype_baseline_present === true;
  const prototypeBaselineValid = gradeRoundExecution?.result.metadata?.prototype_baseline_valid === true;
  const prototypeBaselineSourcePhase =
    typeof gradeRoundExecution?.result.metadata?.prototype_baseline_source_phase === "string"
      ? gradeRoundExecution.result.metadata.prototype_baseline_source_phase
      : undefined;
  const prototypeBaselineSourceSemantics =
    isPrototypeBaselineSourceSemantics(
      gradeRoundExecution?.result.metadata?.prototype_baseline_source_semantics
    )
      ? gradeRoundExecution.result.metadata.prototype_baseline_source_semantics
      : prototypeBaselineSourceSemanticsForPhase(prototypeBaselineSourcePhase);
  const prototypeBaselineSourceSemanticsDetail =
    describePrototypeBaselineSourceSemantics(prototypeBaselineSourceSemantics);
  const prototypeBaselineSourceRound =
    typeof gradeRoundExecution?.result.metadata?.prototype_baseline_source_round === "number"
      ? gradeRoundExecution.result.metadata.prototype_baseline_source_round
      : undefined;
  const subjectiveJudgeDisabled =
    gradeRoundExecution?.result.metadata?.subjective_judge_disabled === true;
  const subjectiveJudgeUnavailable =
    gradeRoundExecution?.result.metadata?.subjective_judge_unavailable === true ||
    subjectiveJudgeDisabled;
  const subjectiveJudgeFailureReason =
    typeof gradeRoundExecution?.result.metadata?.subjective_judge_unavailable_reason === "string"
      ? gradeRoundExecution.result.metadata.subjective_judge_unavailable_reason
      : typeof gradeRoundExecution?.result.metadata?.subjective_judge_failure_reason === "string"
        ? gradeRoundExecution.result.metadata.subjective_judge_failure_reason
      : undefined;
  const subjectiveJudgeTransportMode =
    typeof gradeRoundExecution?.result.metadata?.subjective_judge_transport_mode === "string"
      ? gradeRoundExecution.result.metadata.subjective_judge_transport_mode
      : undefined;
  const subjectiveJudgeNeedsEvaluatorDetail = subjectiveJudgeUnavailable
    ? `Status: needs_evaluator. Subjective-quality judge could not complete browser scoring${
        subjectiveJudgeTransportMode
          ? ` on transport '${subjectiveJudgeTransportMode}'`
          : ""
      }. ${
        subjectiveJudgeFailureReason ??
        "Allow the read-only judge on the active operator surface or provide HARNESS_SUBJECTIVE_REVIEW_PATH."
      }`
    : undefined;
  const prototypeDeltaMetric = subjectiveMetricResults.find(
    (metric) => metric.metric_id === "prototype_delta"
  );
  const prototypeDeltaRequired = browserSurfaceExpected && input.round >= 2;
  const prototypeDeltaPassed =
    !prototypeDeltaRequired
      ? true
      : prototypeDeltaMetric?.status === "pass";
  lookup.subjective_quality_present = checkResult(
    "subjective_quality_present",
    !browserSurfaceExpected
      ? "not_applicable"
      : subjectiveMetricResults.length > 0
        ? "pass"
        : "fail",
    !browserSurfaceExpected
      ? "Subjective quality evidence is not required for non-browser targets."
      : subjectiveMetricResults.length > 0
        ? subjectiveJudgeUnavailable
          ? `grade_round reported fail-closed subjective metric results after the judge was unavailable. ${subjectiveJudgeNeedsEvaluatorDetail}`
          : `grade_round reported ${subjectiveMetricResults.length} subjective product-quality metric result(s).`
        : subjectiveJudgeNeedsEvaluatorDetail ??
          "Browser release quality requires subjective metric results, but grade_round did not report any."
  );
  lookup.subjective_thresholds_met = checkResult(
    "subjective_thresholds_met",
    !browserSurfaceExpected
      ? "not_applicable"
      : subjectiveMetricResults.length === 0
        ? "fail"
        : failedRequiredSubjectiveMetrics.length === 0
          ? "pass"
          : "fail",
    !browserSurfaceExpected
      ? "Subjective threshold gating is not required for non-browser targets."
      : subjectiveJudgeUnavailable
        ? subjectiveJudgeNeedsEvaluatorDetail ??
          "Required browser subjective thresholds could not be evaluated."
      : subjectiveMetricResults.length === 0
        ? "Required browser subjective thresholds could not be evaluated."
        : failedRequiredSubjectiveMetrics.length === 0
          ? "Every required subjective metric cleared its configured threshold."
          : `Required subjective metrics remain below threshold: ${failedRequiredSubjectiveMetrics.map((metric) => metric.metric_id).join(", ")}.`
  );
  lookup.visual_evidence_present = checkResult(
    "visual_evidence_present",
    !browserSurfaceExpected
      ? "not_applicable"
      : visualEvidencePresent
        ? "pass"
        : "fail",
    !browserSurfaceExpected
      ? "Rendered browser evidence is not required for non-browser targets."
      : visualEvidencePresent
        ? "Rendered browser evidence is attached via screenshots or traces."
        : "Browser release quality requires rendered screenshots or traces, but none were attached."
  );
  lookup.prototype_baseline_present = checkResult(
    "prototype_baseline_present",
    !browserSurfaceExpected
      ? "not_applicable"
      : input.round < 2
        ? "pass"
        : prototypeBaselinePresent
          ? "pass"
          : "fail",
    !browserSurfaceExpected
      ? "Prototype baseline comparison is not required for non-browser targets."
      : input.round < 2
        ? "Prototype baseline capture is optional on the first browser round."
        : prototypeBaselinePresent
          ? `A persisted baseline screenshot is available for prototype-to-release comparison${
              prototypeBaselineSourcePhase
                ? ` from '${prototypeBaselineSourcePhase}'`
                : ""
            }${
              typeof prototypeBaselineSourceRound === "number"
                ? ` (source round ${prototypeBaselineSourceRound}).`
                : "."
            }${
              prototypeBaselineSourceSemanticsDetail
                ? ` ${prototypeBaselineSourceSemanticsDetail}`
                : ""
            }`
          : "Browser rounds after the baseline capture must keep a persisted prototype screenshot for delta judging."
  );
  lookup.prototype_baseline_valid = checkResult(
    "prototype_baseline_valid",
    !browserSurfaceExpected
      ? "not_applicable"
      : input.round < 2
        ? "pass"
        : prototypeBaselineValid
          ? "pass"
          : "fail",
    !browserSurfaceExpected
      ? "Prototype baseline validity is not required for non-browser targets."
      : input.round < 2
        ? "Prototype baseline validity is optional on the first browser round."
        : prototypeBaselineValid
          ? `A valid initial prototype baseline is available${
              prototypeBaselineSourcePhase ? ` from '${prototypeBaselineSourcePhase}'` : ""
            }${
              typeof prototypeBaselineSourceRound === "number"
                ? ` (source round ${prototypeBaselineSourceRound}).`
                : "."
            }${
              prototypeBaselineSourceSemanticsDetail
                ? ` ${prototypeBaselineSourceSemanticsDetail}`
                : ""
            }`
          : prototypeBaselinePresent
            ? `A baseline file exists${
                prototypeBaselineSourcePhase ? ` from '${prototypeBaselineSourcePhase}'` : ""
              }, but that source phase does not count as a valid initial prototype baseline.${
                prototypeBaselineSourceSemanticsDetail
                  ? ` ${prototypeBaselineSourceSemanticsDetail}`
                  : ""
              }`
            : "Browser rounds after the initial prototype must keep a valid initial baseline before prototype_delta can pass."
  );
  lookup.prototype_delta_present = checkResult(
    "prototype_delta_present",
    !browserSurfaceExpected
      ? "not_applicable"
      : !prototypeDeltaRequired
        ? "pass"
        : prototypeBaselineValid && prototypeDeltaPassed
          ? "pass"
          : "fail",
    !browserSurfaceExpected
      ? "Prototype delta scoring is not required for non-browser targets."
      : !prototypeDeltaRequired
        ? "Prototype delta scoring is deferred until a follow-up browser round exists."
        : !prototypeBaselineValid
          ? "Prototype delta cannot pass until a valid initial prototype baseline is available."
        : prototypeDeltaMetric
          ? prototypeDeltaMetric.status === "pass"
            ? "The current browser surface materially improves beyond the stored baseline."
            : "The current result is not yet materially beyond the initial prototype in layout, hierarchy, workflow visibility, or state expression."
          : "Browser rounds after the baseline capture must score prototype_delta explicitly."
  );

  const preReleaseAcceptanceResults = unique([
    ...thresholdAcceptanceCheckIds.filter((checkId) => checkId !== "release_blockers_recorded"),
    "adapter_claims_are_honest",
    "proof_provenance_is_attested",
    "live_verification_present",
    "independent_target_probe_present",
    "proof_boundary_is_independent",
    "adapter_evidence_is_meaningful",
    "adapter_criteria_are_grounded",
    "adapter_criteria_match_profile",
    ...(browserSurfaceExpected
      ? [
          "subjective_quality_present",
          "subjective_thresholds_met",
          "visual_evidence_present",
          "prototype_baseline_present",
          "prototype_baseline_valid",
          "prototype_delta_present"
        ]
      : [])
  ])
    .map(
      (checkId) =>
        lookup[checkId] ??
        checkResult(checkId, "fail", `No evaluator rule is defined for check '${checkId}'.`)
    );

  const failedPreReleaseAcceptanceResults = preReleaseAcceptanceResults.filter(
    isFailingCheck
  );
  const releaseBlockerDetails = unique([
    ...input.contractReviewArtifact.required_changes,
    ...failedPreReleaseAcceptanceResults.map((result) => result.detail),
    ...failedAdapterResults.map((result) => result.detail)
  ]);

  lookup.release_blockers_recorded = checkResult(
    "release_blockers_recorded",
    failedPreReleaseAcceptanceResults.length > 0 ||
      input.contractAgreementArtifact.status === "blocked" ||
      failedAdapterResults.length > 0
      ? releaseBlockerDetails.length > 0
        ? "pass"
        : "fail"
      : "pass",
    failedPreReleaseAcceptanceResults.length > 0 ||
      input.contractAgreementArtifact.status === "blocked" ||
      failedAdapterResults.length > 0
      ? "Release blockers were captured from failed checks, adapter failures, or blocked negotiation."
      : "No release blockers were necessary because the round contract passed."
  );

  const previousPatchResolved =
    actionablePreviousPatchTargetCheckIds.length === 0
      ? input.previousPatchTargetCheckIds.length === 0 || input.previousPatchRequestAddressed
      : actionablePreviousPatchTargetCheckIds.every((checkId) => {
          const targetResult =
            lookup[checkId] ??
            checkResult(checkId, "fail", `No evaluator rule is defined for carried check '${checkId}'.`);
          return isPassingCheck(targetResult);
        });

  lookup.previous_patch_request_resolved = checkResult(
    "previous_patch_request_resolved",
    previousPatchResolved ? "pass" : "fail",
    actionablePreviousPatchTargetCheckIds.length === 0
      ? "No previous patch request required resolution."
      : previousPatchResolved
        ? `Every carried check now passes: ${actionablePreviousPatchTargetCheckIds.join(", ")}.`
        : `At least one carried check is still unresolved: ${actionablePreviousPatchTargetCheckIds.join(", ")}.`
  );

  const acceptanceResultsWithoutThresholdCarry = thresholdAcceptanceCheckIds.map(
    (checkId) =>
      lookup[checkId] ??
      checkResult(checkId, "fail", `No evaluator rule is defined for check '${checkId}'.`)
  );

  let check_results = unique([
    ...acceptanceResultsWithoutThresholdCarry.map((result) => result.check_id),
    "release_blockers_recorded",
    "previous_patch_request_addressed",
    "previous_patch_request_resolved",
    ...Array.from(proofEvaluatorChecks),
    "target_signal_thresholds_met",
    ...adapterResults.map((result) => result.check_id)
  ]).map((checkId) => {
    if (lookup[checkId]) {
      return lookup[checkId];
    }

    if (checkId.startsWith("adapter_")) {
      return (
        adapterResults.find((result) => result.check_id === checkId) ??
        checkResult(checkId, "fail", `Adapter result '${checkId}' is missing.`)
      );
    }

    return checkResult(checkId, "fail", `No evaluator rule is defined for check '${checkId}'.`);
  });

  const externalGrade =
    gradeRoundExecution?.result.score !== undefined ? gradeRoundExecution.result.score : undefined;
  const criterionResultsForScoring = verificationProfileEvaluation.criterionChecks.length > 0
    ? verificationProfileEvaluation.criterionChecks
    : input.loadedAdapter
      ? (
          gradeRoundExecution?.verified_criteria_results.length
            ? gradeRoundExecution.verified_criteria_results
            :
          input.adapterExecutions
            .filter((execution) => execution.capability === "run_checks" && execution.result.ok)
            .flatMap((execution) => execution.verified_criteria_results)
        ).map((criterion) =>
          checkResult(
            criterion.criterion_id,
            criterion.status,
            criterion.summary
          )
        )
      : [];
  const criterionPassRate = input.loadedAdapter
    ? scoreFromResults(criterionResultsForScoring, { strictPartialCredit: true })
    : 0;
  const thresholdVerdictScore = input.loadedAdapter
    ? gradeRoundExecution?.result.threshold_verdict === "pass" &&
      verificationProfileEvaluation.hardFailedCriterionIds.length === 0
      ? 1
      : 0
    : 0;
  const evidence_paths = unique(
    [
      ...input.adapterExecutions.flatMap((execution) => execution.verified_evidence_paths),
      ...input.coreProbeResults.flatMap((result) => result.evidence_paths)
    ]
  );
  const adapterVerdict = gradeRoundExecution?.result.overall_verdict;
  const hasCriticalAdapterFailure = failedAdapterResults.some((result) =>
    criticalAdapterFailures.has(result.check_id)
  );

  let overall_verdict: RoundVerdict =
    input.contractAgreementArtifact.status === "blocked" || input.contractReviewArtifact.decision === "revise"
      ? "hold"
      : adapterVerdict === "hold" || hasCriticalAdapterFailure
        ? "hold"
        : failedPreReleaseAcceptanceResults.length > 0 ||
            adapterVerdict === "revise" ||
            failedAdapterResults.length > 0
          ? "revise"
          : "advance";

  let contractCompleted =
    overall_verdict === "advance" &&
    acceptanceResultsWithoutThresholdCarry.every(isSatisfiedCheck);
  const controlPlaneResults = check_results.filter(
    (result) =>
      !proofEvaluatorChecks.has(result.check_id) &&
      !adapterResultCheckIds.has(result.check_id) &&
      !nonScoringDerivedChecks.has(result.check_id)
  );
  const proofResults = input.loadedAdapter
    ? unique([
        ...Array.from(proofEvaluatorChecks),
        ...adapterResults.map((result) => result.check_id)
      ]).map(
        (checkId) =>
          lookup[checkId] ??
          adapterResults.find((result) => result.check_id === checkId) ??
          checkResult(checkId, "fail", `No evaluator rule is defined for proof check '${checkId}'.`)
      )
    : [];
  const skepticalProofResults = input.loadedAdapter
    ? Array.from(proofEvaluatorChecks).map(
        (checkId) =>
          lookup[checkId] ??
          checkResult(checkId, "fail", `No evaluator rule is defined for skeptical proof check '${checkId}'.`)
      )
    : [];
  const control_plane_score = scoreFromResults(controlPlaneResults);
  const proofPassRate = input.loadedAdapter
    ? scoreFromResults(proofResults, { strictPartialCredit: true })
    : 0;
  const skepticalProofPassRate = input.loadedAdapter
    ? scoreFromResults(skepticalProofResults, { strictPartialCredit: true })
    : 0;
  const skepticalProofFailed = skepticalProofResults.some(isFailingCheck);
  const hasProofExecution = input.adapterExecutions.some(
    (execution) =>
      execution.result.ok &&
      (execution.capability === "capture_evidence" ||
        execution.capability === "run_checks" ||
        execution.capability === "grade_round")
  );
  const proofScoreWeights = proofScoreWeightsFor(input.loadedAdapter);
  const raw_proof_score =
    input.loadedAdapter
      ? !hasProofExecution
        ? 0
        : proofPassRate * proofScoreWeights.proof_pass_rate +
          criterionPassRate * proofScoreWeights.criterion_pass_rate +
          thresholdVerdictScore * proofScoreWeights.threshold_verdict +
          (externalGrade ?? 0) * proofScoreWeights.external_grade
      : 0;
  const proof_score = Number(
    (
      input.loadedAdapter
        ? skepticalProofFailed
          ? Math.min(raw_proof_score, skepticalProofPassRate * 0.6)
          : raw_proof_score
        : 0
    ).toFixed(3)
  );
  const releaseScoreWeights = releaseScoreWeightsFor(input.loadedAdapter);
  let release_score = Number(
    (
      input.loadedAdapter
        ? control_plane_score * releaseScoreWeights.control_plane_score +
          proof_score * releaseScoreWeights.proof_score
        : control_plane_score * releaseScoreWeights.control_plane_score
    ).toFixed(3)
  );
  const releaseScoreCapDetails: string[] = [];
  if (browserSurfaceExpected && subjectiveMetricResults.length === 0) {
    release_score = Math.min(release_score, 0.59);
    releaseScoreCapDetails.push(
      "Release score is capped at 0.590 because browser release quality did not report any subjective metrics."
    );
  }
  if (browserSurfaceExpected && !visualEvidencePresent) {
    release_score = Math.min(release_score, 0.59);
    releaseScoreCapDetails.push(
      "Release score is capped at 0.590 because no rendered browser screenshots or traces were attached."
    );
  }
  if (browserSurfaceExpected && failedRequiredSubjectiveMetrics.length > 0) {
    release_score = Math.min(release_score, 0.79);
    releaseScoreCapDetails.push(
      `Release score is capped at 0.790 because required subjective metrics still fail: ${failedRequiredSubjectiveMetrics.map((metric) => metric.metric_id).join(", ")}.`
    );
  }
  if (browserSurfaceExpected && prototypeDeltaRequired && !prototypeBaselineValid) {
    release_score = Math.min(release_score, 0.84);
    releaseScoreCapDetails.push(
      "Release score is capped at 0.840 because no valid initial prototype baseline was available for prototype_delta judging."
    );
  } else if (browserSurfaceExpected && prototypeDeltaRequired && !prototypeDeltaPassed) {
    release_score = Math.min(release_score, 0.84);
    releaseScoreCapDetails.push(
      "Release score is capped at 0.840 because the current browser surface does not yet materially improve beyond the stored baseline."
    );
  }
  release_score = Number(release_score.toFixed(3));
  const coreOwnedEvaluatorProfileAttached =
    !input.loadedAdapter || input.loadedAdapter.verification_profile_source === "core";
  const threshold_results: ReleaseThresholdResults = {
    contract_completed: contractCompleted,
    minimum_control_plane_score_met:
      control_plane_score + 0.0005 >= input.rubric.minimum_control_plane_score,
    minimum_proof_score_met:
      proof_score + 0.0005 >= input.rubric.minimum_proof_score,
    minimum_release_score_met:
      release_score + 0.0005 >= input.rubric.target_total_score,
    adapter_required_met:
      input.rubric.target_signal_requires_adapter ? Boolean(input.loadedAdapter) : true,
    grade_score_required_met:
      input.rubric.target_signal_requires_grade_score
        ? externalGrade !== undefined &&
          (!browserSurfaceExpected || subjectiveMetricResults.length > 0)
        : true,
    core_probe_required_met:
      !input.loadedAdapter
        ? true
        : !coreOwnedEvaluatorProfileAttached
          ? false
          : (input.loadedAdapter.verification_profile?.profile
                .target_reached_requires_core_probes ?? true)
            ? lookup.independent_target_probe_present?.status === "pass"
            : true,
    dimension_thresholds_met: true,
    target_reached_eligible: false
  };
  threshold_results.target_reached_eligible =
    threshold_results.contract_completed &&
    threshold_results.minimum_control_plane_score_met &&
    threshold_results.minimum_proof_score_met &&
    threshold_results.minimum_release_score_met &&
    threshold_results.adapter_required_met &&
    threshold_results.grade_score_required_met &&
    threshold_results.core_probe_required_met &&
    threshold_results.dimension_thresholds_met;
  const thresholdGapDetailsBase = input.loadedAdapter
    ? unique(
        [
          subjectiveJudgeNeedsEvaluatorDetail,
          !threshold_results.adapter_required_met
            ? "Target-reached signaling requires an attached adapter."
            : undefined,
          !threshold_results.grade_score_required_met
            ? browserSurfaceExpected
              ? "Target-reached signaling requires a numeric grade_round score with browser subjective quality results."
              : "Target-reached signaling requires a numeric grade_round score."
            : undefined,
          !threshold_results.core_probe_required_met
            ? lookup.independent_target_probe_present?.detail
            : undefined,
          lookup.proof_provenance_is_attested?.status === "fail"
            ? lookup.proof_provenance_is_attested.detail
            : undefined,
          lookup.live_verification_present?.status === "fail"
            ? lookup.live_verification_present.detail
            : undefined,
          !threshold_results.minimum_control_plane_score_met
            ? `Control-plane score ${control_plane_score.toFixed(3)} is below the minimum ${input.rubric.minimum_control_plane_score.toFixed(3)}.`
            : undefined,
          !threshold_results.minimum_proof_score_met
            ? `Proof score ${proof_score.toFixed(3)} is below the minimum ${input.rubric.minimum_proof_score.toFixed(3)}.`
            : undefined,
          !threshold_results.minimum_release_score_met
            ? `Release score ${release_score.toFixed(3)} is below the target ${input.rubric.target_total_score.toFixed(3)}.`
            : undefined,
          ...releaseScoreCapDetails
        ].filter((detail): detail is string => Boolean(detail))
      )
    : [];
  const recomputeDimensionThresholds = (): {
    dimension_scores: EvalScoreDimension[];
    failedDimensionScores: EvalScoreDimension[];
    thresholdGapDetails: string[];
  } => {
    const dimension_scores = buildDimensionScores({
      rubric: input.rubric,
      checkResults: check_results,
      staticCheckLookup: lookup,
      coreProbeResults: input.coreProbeResults,
      contractArtifact: input.contractArtifact,
      loadedAdapter: input.loadedAdapter
    });
    const failedDimensionScores = targetSignalBlockingFailures({
      rubric: input.rubric,
      dimensionScores: dimension_scores
    });
    threshold_results.dimension_thresholds_met = failedDimensionScores.length === 0;
    const dimensionGapDetails = failedDimensionScores.map(
      (dimension) =>
        `Dimension '${dimension.label}' scored ${dimension.score.toFixed(3)} below the minimum ${dimension.minimum_score.toFixed(3)}. ${dimension.detail}`
    );
    const thresholdGapDetails = unique([
      ...thresholdGapDetailsBase,
      ...dimensionGapDetails
    ]);
    threshold_results.target_reached_eligible =
      threshold_results.contract_completed &&
      threshold_results.minimum_control_plane_score_met &&
      threshold_results.minimum_proof_score_met &&
      threshold_results.minimum_release_score_met &&
      threshold_results.adapter_required_met &&
      threshold_results.grade_score_required_met &&
      threshold_results.core_probe_required_met &&
      threshold_results.dimension_thresholds_met;
    return {
      dimension_scores,
      failedDimensionScores,
      thresholdGapDetails
    };
  };

  let {
    dimension_scores,
    failedDimensionScores,
    thresholdGapDetails
  } = recomputeDimensionThresholds();

  lookup.target_signal_thresholds_met = checkResult(
    "target_signal_thresholds_met",
    !input.loadedAdapter
      ? "not_applicable"
      : contractCompleted && thresholdGapDetails.length === 0
        ? "pass"
      : "fail",
    !input.loadedAdapter
      ? "Target signal thresholds are not applicable without an attached adapter."
      : contractCompleted && thresholdGapDetails.length === 0
        ? "Terminal proof and release thresholds are satisfied."
        : thresholdGapDetails.length > 0
          ? `Terminal proof and release thresholds remain open: ${thresholdGapDetails.join(" ")}`
          : "Round contract is not complete yet, so target signaling thresholds are not ready."
  );
  check_results = check_results.map((result) =>
    result.check_id === "target_signal_thresholds_met"
      ? lookup.target_signal_thresholds_met
      : result
  );
  const recomputedPreviousPatchResolved =
    actionablePreviousPatchTargetCheckIds.length === 0
      ? input.previousPatchTargetCheckIds.length === 0 || input.previousPatchRequestAddressed
      : actionablePreviousPatchTargetCheckIds.every((checkId) => {
          const targetResult =
            lookup[checkId] ??
            checkResult(checkId, "fail", `No evaluator rule is defined for carried check '${checkId}'.`);
          return isPassingCheck(targetResult);
        });
  lookup.previous_patch_request_resolved = checkResult(
    "previous_patch_request_resolved",
    recomputedPreviousPatchResolved ? "pass" : "fail",
    actionablePreviousPatchTargetCheckIds.length === 0
      ? "No previous patch request required resolution."
      : recomputedPreviousPatchResolved
        ? `Every carried check now passes: ${actionablePreviousPatchTargetCheckIds.join(", ")}.`
        : `At least one carried check is still unresolved: ${actionablePreviousPatchTargetCheckIds.join(", ")}.`
  );
  check_results = check_results.map((result) =>
    result.check_id === "previous_patch_request_resolved"
      ? lookup.previous_patch_request_resolved
      : result
  );
  ({
    dimension_scores,
    failedDimensionScores,
    thresholdGapDetails
  } = recomputeDimensionThresholds());
  lookup.target_signal_thresholds_met = checkResult(
    "target_signal_thresholds_met",
    !input.loadedAdapter
      ? "not_applicable"
      : contractCompleted && thresholdGapDetails.length === 0
        ? "pass"
      : "fail",
    !input.loadedAdapter
      ? "Target signal thresholds are not applicable without an attached adapter."
      : contractCompleted && thresholdGapDetails.length === 0
        ? "Terminal proof and release thresholds are satisfied."
        : thresholdGapDetails.length > 0
          ? `Terminal proof and release thresholds remain open: ${thresholdGapDetails.join(" ")}`
          : "Round contract is not complete yet, so target signaling thresholds are not ready."
  );
  check_results = check_results.map((result) =>
    result.check_id === "target_signal_thresholds_met"
      ? lookup.target_signal_thresholds_met
      : result
  );
  if (overall_verdict === "advance" && failedDimensionScores.length > 0) {
    overall_verdict = "revise";
  }
  const acceptanceResults = evaluationCheckIds.map(
    (checkId) =>
      lookup[checkId] ??
      checkResult(checkId, "fail", `No evaluator rule is defined for check '${checkId}'.`)
  );
  const failedAcceptanceResults = acceptanceResults.filter(isFailingCheck);
  if (overall_verdict === "advance" && failedAcceptanceResults.length > 0) {
    overall_verdict = "revise";
  }
  contractCompleted =
    overall_verdict === "advance" &&
    acceptanceResults.every(isSatisfiedCheck);
  threshold_results.contract_completed = contractCompleted;
  threshold_results.target_reached_eligible =
    threshold_results.contract_completed &&
    threshold_results.minimum_control_plane_score_met &&
    threshold_results.minimum_proof_score_met &&
    threshold_results.minimum_release_score_met &&
    threshold_results.adapter_required_met &&
    threshold_results.grade_score_required_met &&
    threshold_results.core_probe_required_met &&
    threshold_results.dimension_thresholds_met;
  if (failedAcceptanceResults.length > 0 || failedAdapterResults.length > 0 || thresholdGapDetails.length > 0) {
    lookup.release_blockers_recorded = checkResult(
      "release_blockers_recorded",
      "pass",
      thresholdGapDetails.length > 0
        ? "Release blockers were captured from failed checks, adapter failures, or unmet target thresholds."
        : "Release blockers were captured from failed checks, adapter failures, or blocked negotiation."
    );
    check_results = check_results.map((result) =>
      result.check_id === "release_blockers_recorded"
        ? lookup.release_blockers_recorded
        : result
    );
  }
  if (contractCompleted && thresholdGapDetails.length > 0) {
    lookup.release_blockers_recorded = checkResult(
      "release_blockers_recorded",
      "pass",
      "Release blockers were captured from failed checks, adapter failures, or unmet terminal thresholds."
    );
    check_results = check_results.map((result) =>
      result.check_id === "release_blockers_recorded"
        ? lookup.release_blockers_recorded
        : result
    );
  }
  const total_score = release_score;
  const resolved_check_ids = check_results
    .filter(isPassingCheck)
    .map((result) => result.check_id);
  const unresolved_check_ids = check_results
    .filter(isFailingCheck)
    .map((result) => result.check_id);

  return {
    generated_at: new Date().toISOString(),
    round: input.round,
    total_score,
    control_plane_score,
    proof_score,
    release_score,
    overall_verdict,
    strengths: check_results
      .filter(isPassingCheck)
      .map((result) => result.detail)
      .slice(0, 8),
    blockers: unique([
      ...releaseBlockerDetails,
      ...thresholdGapDetails,
      ...check_results
        .filter(isFailingCheck)
        .map((result) => result.detail)
    ]).slice(0, 8),
    next_actions:
      input.contractReviewArtifact.decision === "revise"
        ? input.contractReviewArtifact.required_changes.slice(0, 8)
        : failedAcceptanceResults.length > 0
          ? failedAcceptanceResults
              .map((result) => `Close '${result.check_id}': ${result.detail}`)
              .slice(0, 8)
        : failedAdapterResults.length > 0
            ? failedAdapterResults
                .map((result) => `Repair '${result.check_id}': ${result.detail}`)
                .slice(0, 8)
          : thresholdGapDetails.length > 0
            ? thresholdGapDetails
                .map((detail) => `Do not claim target_reached yet: ${detail}`)
                .slice(0, 8)
          : [
              "No further remediation is required; record terminal completion and stop the run."
          ],
    evidence_paths,
    threshold_gap_details: thresholdGapDetails,
    check_results,
    resolved_check_ids,
    unresolved_check_ids,
    adapter_attached: Boolean(input.loadedAdapter),
    threshold_results,
    dimension_scores,
    adapter_results: input.adapterExecutions,
    core_probe_results: input.coreProbeResults
  };
};
