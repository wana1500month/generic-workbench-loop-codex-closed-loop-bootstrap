import { join, relative } from "node:path";

import { writeJson, writeText } from "./file-system.js";
import { isPureEnvironmentBlockedLineage } from "./failure-lineage.js";
import type {
  ContractAgreementArtifact,
  ContractReviewArtifact,
  EvalReport,
  EvaluatorVerdictArtifact,
  FailureLineage,
  GeneratorPlanArtifact,
  LoadedAdapterContract,
  LoopRubric,
  PatchRequestArtifact,
  QualityContractAxis,
  QualityCritiqueArtifact,
  QualityFinding,
  QualityFindingCategory,
  QualityFindingSeverity,
  RemediationStrategy,
  RoundArtifacts,
  RoundContractArtifact,
  RoundResultArtifact,
  VerificationAssertionTag
} from "./types.js";

const bulletList = (items: readonly string[]): string =>
  items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- none";

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];
const nonCarryForwardCheckIds = new Set<string>([
  "previous_patch_request_addressed",
  "previous_patch_request_resolved",
  "release_blockers_recorded"
]);
const remediationRequiredArtifacts = [
  "round-contract.json",
  "generator-plan.json",
  "evaluator-verdict.json",
  "patch-request.json",
  "quality-critique.json",
  "round-result.json",
  "eval_report.json",
  "agent_handoff/generator-brief.md",
  "agent_handoff/qa-review.md",
  "agent_handoff/controller-decision.md"
] as const;
const normalizeCarryForwardCheckId = (checkId: string): string =>
  checkId.startsWith("adapter_") ? "adapter_execution_healthy" : checkId;
const defaultPreserveSignals = [
  "Keep the repository focused on core harness mechanics.",
  "Keep protocol files authoritative and file-based."
] as const;
const qualityCritiqueNoteOnlyDimensions = new Set<string>(["repair_convergence"]);
const carryForwardSafeTargetCheckIds = (checkIds: readonly string[]): string[] =>
  unique(
    checkIds
      .map(normalizeCarryForwardCheckId)
      .filter((checkId) => !nonCarryForwardCheckIds.has(checkId))
  );

export const artifactsForRound = (roundDirectory: string): RoundArtifacts => {
  const handoffDirectory = join(roundDirectory, "agent_handoff");
  return {
    round_directory: roundDirectory,
    contract_json_path: join(roundDirectory, "round-contract.json"),
    contract_md_path: join(roundDirectory, "round-contract.md"),
    contract_review_json_path: join(roundDirectory, "contract-review.json"),
    contract_review_md_path: join(roundDirectory, "contract-review.md"),
    contract_agreement_json_path: join(roundDirectory, "contract-agreement.json"),
    contract_agreement_md_path: join(roundDirectory, "contract-agreement.md"),
    generator_plan_json_path: join(roundDirectory, "generator-plan.json"),
    generator_plan_md_path: join(roundDirectory, "generator-plan.md"),
    evaluator_verdict_json_path: join(roundDirectory, "evaluator-verdict.json"),
    evaluator_verdict_md_path: join(roundDirectory, "evaluator-verdict.md"),
    patch_request_json_path: join(roundDirectory, "patch-request.json"),
    patch_request_md_path: join(roundDirectory, "patch-request.md"),
    quality_critique_json_path: join(roundDirectory, "quality-critique.json"),
    quality_critique_md_path: join(roundDirectory, "quality-critique.md"),
    round_result_json_path: join(roundDirectory, "round-result.json"),
    eval_report_path: join(roundDirectory, "eval_report.json"),
    failure_lineage_path: join(roundDirectory, "failure-lineage.json"),
    planner_context_path: join(handoffDirectory, "planner-context.md"),
    generator_brief_path: join(handoffDirectory, "generator-brief.md"),
    qa_review_path: join(handoffDirectory, "qa-review.md"),
    controller_decision_path: join(handoffDirectory, "controller-decision.md"),
    adapter_directory: join(roundDirectory, "adapter")
  };
};

export const buildRoundContractArtifact = (input: {
  round: number;
  negotiationMode: RoundContractArtifact["negotiation_mode"];
  continuationAuthority: RoundContractArtifact["continuation_authority"];
  recontractReason?: RoundContractArtifact["recontract_reason"];
  contract: {
    contract_id: string;
    attempt_kind: RoundContractArtifact["attempt_kind"];
    objective: string;
    rewrite_scope: RoundContractArtifact["rewrite_scope"];
    focus_areas: RoundContractArtifact["focus_areas"];
    acceptance_checks: string[];
    notes: string[];
    carry_over_patch_ids?: string[];
    carry_over_check_ids?: string[];
  };
  rubric: LoopRubric;
  loadedAdapter?: LoadedAdapterContract;
  previousPatchRequest?: PatchRequestArtifact;
}): RoundContractArtifact => {
  const requiredLiveVerificationModes = derivedLiveVerificationModes(input.loadedAdapter);
  const browserReleaseGateProbeIds = probeIdsForModes(input.loadedAdapter, ["browser"]);
  const apiReleaseGateProbeIds = probeIdsForModes(input.loadedAdapter, ["api"]);
  const releaseGateCheckIds = unique([
    ...input.contract.acceptance_checks.filter(
      (checkId) =>
        !checkId.endsWith("_surface_reserved") &&
        checkId !== "previous_patch_request_addressed" &&
        checkId !== "previous_patch_request_resolved"
    ),
    "target_signal_thresholds_met"
  ]);

  return ({
  contract_id: input.contract.contract_id,
  round: input.round,
  attempt_kind: input.contract.attempt_kind,
  negotiation_mode: input.negotiationMode,
  continuation_authority: input.continuationAuthority,
  ...(input.recontractReason ? { recontract_reason: input.recontractReason } : {}),
  objective: input.contract.objective,
  rewrite_scope: input.contract.rewrite_scope,
  focus_areas: input.contract.focus_areas,
  acceptance_checks: input.contract.acceptance_checks,
  release_gate_check_ids: releaseGateCheckIds,
  browser_release_gate_probe_ids: browserReleaseGateProbeIds,
  api_release_gate_probe_ids: apiReleaseGateProbeIds,
  required_live_verification_modes: requiredLiveVerificationModes,
  proof_plan: unique([
    ...input.contract.acceptance_checks,
    ...(browserReleaseGateProbeIds.length > 0
      ? ["Pass the browser release-gate probes under the core-owned evaluator profile."]
      : []),
    ...(apiReleaseGateProbeIds.length > 0
      ? ["Pass the API release-gate probes under the core-owned evaluator profile."]
      : []),
    ...(requiredLiveVerificationModes.length > 0
      ? [
          `Capture live verification evidence for: ${requiredLiveVerificationModes.join(", ")}.`
        ]
      : [])
  ]),
  pivot_triggers: [
    "Release-gate regression against a previously passing check or probe.",
    "Repeated same failure signature across remediation rounds.",
    "Contradictory evidence or broken proof provenance.",
    "Plateau without material score improvement across the remediation window.",
    "Patch entropy spike or scope drift beyond the agreed attempt contract."
  ],
  success_thresholds: {
    target_total_score: input.rubric.target_total_score,
    minimum_control_plane_score: input.rubric.minimum_control_plane_score,
    minimum_proof_score: input.rubric.minimum_proof_score
  },
  required_artifacts:
    input.negotiationMode === "patch_only"
      ? [...remediationRequiredArtifacts]
      : input.contract.attempt_kind === "initial_build"
      ? input.rubric.required_artifacts
      : input.rubric.required_artifacts,
  non_goals: [
    "Do not embed a bundled adapter back into the harness repository.",
    "Do not claim end-to-end proof when no external adapter is attached.",
    input.negotiationMode === "patch_only"
      ? "Do not reopen planner contract negotiation unless the controller escalates to recontract."
      : "Do not pre-split the build into fixed feature sprints."
  ],
  carry_over_context: [
    `Negotiation mode: ${input.negotiationMode}.`,
    `Continuation authority: ${input.continuationAuthority}.`,
    ...(input.contract.carry_over_patch_ids?.map((patchId) => `Carry patch id: ${patchId}`) ?? []),
    ...(input.contract.carry_over_check_ids?.map((checkId) => `Carry check id: ${checkId}`) ?? []),
    ...input.contract.notes
  ].slice(0, 8),
  carry_over_patch_ids: input.contract.carry_over_patch_ids ?? [],
  carry_over_check_ids: input.contract.carry_over_check_ids ?? [],
  adapter_expectations: [
    "External adapters should expose prepare_target, apply_change, run_target, capture_evidence, run_checks, and grade_round capabilities.",
    "Target-facing adapters should let the harness select a core-owned evaluator profile through the rubric or CLI, rather than shipping target_reached policy inside adapter.json.",
    "The core harness should remain functional even when no adapter is attached."
  ]
  });
};

export const buildGeneratorPlanArtifact = (input: {
  contractArtifact: RoundContractArtifact;
  contractAgreementArtifact: ContractAgreementArtifact;
  previousPatchRequest?: PatchRequestArtifact;
  adapterAttached: boolean;
}): GeneratorPlanArtifact => {
  const remediationStrategy = input.previousPatchRequest?.remediation_strategy;
  const qualityFocus = unique(
    input.previousPatchRequest?.quality_findings?.map((finding) => finding.expected_change) ?? []
  ).slice(0, 6);
  const mustPreserve = unique([
    ...(input.previousPatchRequest?.preserve_signals ?? []),
    ...(input.previousPatchRequest?.must_preserve ?? [])
  ]).slice(0, 8);

  return {
  contract_id: input.contractArtifact.contract_id,
  agreement_id: input.contractAgreementArtifact.agreement_id,
  generator_plan_id: `${input.contractArtifact.contract_id}-generator-plan`,
  implementation_intent:
    input.contractArtifact.negotiation_mode === "patch_only"
      ? input.previousPatchRequest?.must_fix.length
        ? `Use the ${remediationStrategy ?? "tighten"} remediation strategy. Preserve ${
            mustPreserve.join("; ") || "the current contract surface"
          }. Close only the carried must-fix items from the latest patch request: ${input.previousPatchRequest.must_fix
            .map((item) => item.expected_change)
            .join(" ")}`
        : `Close only the carried patch authority: ${input.contractArtifact.carry_over_check_ids.join(", ")}.`
      : input.contractArtifact.attempt_kind === "remediation"
      ? input.previousPatchRequest?.must_fix.length
        ? `Use the ${remediationStrategy ?? "tighten"} remediation strategy. Preserve ${
            mustPreserve.join("; ") || "the strongest passing signals"
          }. Follow the latest patch request and QA feedback with a tight remediation scope: ${input.previousPatchRequest.must_fix
            .map((item) => item.expected_change)
            .join(" ")}`
        : `Close carried checks before expanding scope: ${input.contractArtifact.carry_over_check_ids.join(", ")}.`
      : "Take one long build attempt against the planner spec, then let evaluator feedback decide whether remediation is needed.",
  ...(remediationStrategy ? { remediation_strategy: remediationStrategy } : {}),
  target_check_ids: unique([
    ...input.contractArtifact.carry_over_check_ids,
    ...input.contractAgreementArtifact.acceptance_checks
  ]),
  ...(qualityFocus.length > 0 ? { quality_focus: qualityFocus } : {}),
  ...(mustPreserve.length > 0 ? { must_preserve: mustPreserve } : {}),
  files_to_touch: [
    "IDEA.md",
    "SPEC.md",
    "RUNBOOK.md",
    "AGENT_PROTOCOL.md",
    "ADAPTER_CONTRACT.md",
    "packages/loop-orchestrator/src"
  ],
  expected_proof: input.contractAgreementArtifact.acceptance_checks,
  risk_notes: [
      input.contractArtifact.negotiation_mode === "patch_only"
        ? "Do not widen scope beyond the latest patch request unless the controller escalates to recontract."
        : input.contractArtifact.attempt_kind === "remediation"
        ? "Keep remediation narrow: close carried checks and threshold gaps before expanding scope."
        : "Use the initial build attempt to integrate against the planner spec in one long pass.",
      input.contractArtifact.negotiation_mode === "patch_only"
        ? "Treat the latest patch request and QA evidence as the load-bearing continuation surface."
        : "Treat the negotiated contract and agreement as the load-bearing continuation surface.",
      input.adapterAttached
        ? "An external adapter is attached, so adapter capability outputs should be treated as first-class evidence under a core-owned evaluator profile."
        : "No adapter is attached, so only harness-side evidence can be claimed in this attempt.",
    "Keep the repository generic and adapter-free."
  ],
  out_of_scope: input.contractArtifact.non_goals,
  adapter_actions: input.adapterAttached
    ? [
        "Prepare the target through the adapter boundary.",
        "Apply changes through the adapter boundary.",
        "Run, capture evidence, and grade through adapter capabilities.",
        "Keep target-specific correctness criteria in the verification profile rather than adapter-authored status strings."
      ]
    : ["Document and preserve the adapter boundary without requiring a bundled target."]
  };
};

const releaseGateProbesFor = (loadedAdapter?: LoadedAdapterContract) =>
  loadedAdapter?.verification_profile?.profile.core_probes?.filter(
    (probe) => (probe.role ?? "supporting") === "release_gate"
  ) ?? [];

const probeIdsForModes = (
  loadedAdapter: LoadedAdapterContract | undefined,
  modes: readonly ("browser" | "api" | "db" | "shell")[]
): string[] =>
  releaseGateProbesFor(loadedAdapter)
    .filter((probe) =>
      (modes.includes("browser") &&
        (probe.mode === "browser_journey" || probe.mode === "browser")) ||
      (modes.includes("api") &&
        (probe.mode === "http_json" || probe.mode === "http")) ||
      (modes.includes("db") &&
        (probe.mode === "json_value" || probe.mode === "file_contains")) ||
      (modes.includes("shell") && probe.mode === "shell_command")
    )
    .map((probe) => probe.probe_id);

const derivedLiveVerificationModes = (
  loadedAdapter?: LoadedAdapterContract
): ("browser" | "api" | "db" | "shell")[] => {
  const profile = loadedAdapter?.verification_profile?.profile;
  if (!profile) {
    return [];
  }
  if (profile.required_live_verification_modes?.length) {
    return [...profile.required_live_verification_modes];
  }

  const releaseGateProbes = releaseGateProbesFor(loadedAdapter);
  const modes = new Set<"browser" | "api" | "db" | "shell">();
  for (const probe of releaseGateProbes) {
    if (probe.mode === "browser_journey" || probe.mode === "browser") {
      modes.add("browser");
    }
    if (probe.mode === "http_json" || probe.mode === "http") {
      modes.add("api");
    }
    if (probe.mode === "json_value" || probe.mode === "file_contains") {
      modes.add("db");
    }
    if (probe.mode === "shell_command") {
      modes.add("shell");
    }
  }
  return [...modes];
};

const qualityCategoryForTags = (
  tags: readonly VerificationAssertionTag[] = []
): QualityFindingCategory => {
  if (tags.includes("error_path")) {
    return "error_recovery";
  }
  if (tags.includes("persistence")) {
    return "persistence";
  }
  if (tags.includes("consistency")) {
    return "consistency";
  }
  if (tags.includes("workflow_multi_step")) {
    return "workflow_completeness";
  }
  if (tags.includes("browser") || tags.includes("api")) {
    return "interaction_clarity";
  }
  return "proof_signal";
};

const qualitySeverityForProbe = (input: {
  required: boolean;
  failureClassification?: string;
}): QualityFindingSeverity => {
  if (input.failureClassification === "environment_blocked") {
    return "medium";
  }
  return input.required ? "high" : "medium";
};

const remediationStrategyForQuality = (input: {
  evalReport: EvalReport;
  failureLineage?: FailureLineage;
}): RemediationStrategy => {
  if (input.failureLineage?.policy_snapshot?.recommended_action === "recontract") {
    return "pivot";
  }
  if (input.evalReport.threshold_results.contract_completed) {
    return "refine";
  }
  return "tighten";
};

const qualityAxisLookupFor = (
  loadedAdapter?: LoadedAdapterContract
): Map<string, QualityContractAxis> =>
  new Map(
    (loadedAdapter?.verification_profile?.profile.quality_contract?.quality_axes ?? []).map(
      (axis) => [axis.axis_id, axis]
    )
  );

const defaultExpectedChangeForCategory = (
  category: QualityFindingCategory
): string => {
  switch (category) {
    case "error_recovery":
      return "Make the failure path explicit and recoverable without widening scope.";
    case "persistence":
      return "Keep state continuity intact across reload, retry, or storage boundaries.";
    case "consistency":
      return "Remove contradictory states so repeated reads or submissions stay coherent.";
    case "workflow_completeness":
      return "Close the primary workflow so the finish line is reachable without missing steps.";
    case "interaction_clarity":
      return "Make the target surface render the expected affordance clearly and consistently.";
    case "reference_fit":
      return "Align the build with the requested reference direction without regressing working flows.";
    default:
      return "Tighten proof, release gates, and evaluator evidence before claiming completion.";
  }
};

export const buildQualityCritiqueArtifact = (input: {
  round: number;
  contractArtifact: RoundContractArtifact;
  evalReport: EvalReport;
  loadedAdapter?: LoadedAdapterContract;
  failureLineage?: FailureLineage;
}): QualityCritiqueArtifact => {
  const remediationStrategy = remediationStrategyForQuality({
    evalReport: input.evalReport,
    failureLineage: input.failureLineage
  });
  const axisLookup = qualityAxisLookupFor(input.loadedAdapter);
  const profileQualityContract = input.loadedAdapter?.verification_profile?.profile.quality_contract;
  const preserveSignals = unique([
    ...(profileQualityContract?.preserve_signals ?? []),
    ...defaultPreserveSignals
  ]).slice(0, 8);
  const failedCheckIds = new Set(
    input.evalReport.check_results
      .filter((result) => result.status === "fail")
      .map((result) => result.check_id)
  );
  const findings: QualityFinding[] = [];

  for (const dimension of input.evalReport.dimension_scores.filter(
    (candidate) => candidate.applicable && !candidate.passed
  )) {
    const targetCheckIds = qualityCritiqueNoteOnlyDimensions.has(dimension.dimension_id)
      ? []
      : carryForwardSafeTargetCheckIds([
          "target_signal_thresholds_met",
          ...dimension.contributing_check_ids.filter((checkId) => failedCheckIds.has(checkId))
        ]);
    findings.push({
      finding_id: `dimension-${dimension.dimension_id}`,
      category: "proof_signal",
      severity:
        dimension.dimension_id === "contract_execution" ? "critical" : "high",
      summary: `Dimension '${dimension.label}' remains below its floor. ${dimension.detail}`,
      expected_change:
        dimension.dimension_id === "repair_convergence"
          ? "Close the carried remediation request without reopening unrelated scope."
          : "Raise the contract and proof surface until this dimension clears its minimum score.",
      evidence: unique([
        ...dimension.contributing_probe_ids,
        ...dimension.contributing_check_ids
      ]),
      preserve: preserveSignals,
      pivot_or_refine: remediationStrategy,
      target_check_ids: targetCheckIds,
      dimension_id: dimension.dimension_id
    });
  }

  for (const probe of input.evalReport.core_probe_results.filter((candidate) => !candidate.ok)) {
    const category = qualityCategoryForTags(probe.assertion_tags);
    const axis = probe.quality_axis_id ? axisLookup.get(probe.quality_axis_id) : undefined;
    findings.push({
      finding_id: `probe-${probe.probe_id}`,
      category,
      severity: qualitySeverityForProbe({
        required: probe.required,
        failureClassification: probe.failure_classification
      }),
      summary: probe.summary,
      expected_change:
        axis?.desired_outcome ?? defaultExpectedChangeForCategory(category),
      evidence: probe.evidence_paths,
      preserve: unique([...(axis?.preserve_signals ?? []), ...preserveSignals]).slice(0, 8),
      pivot_or_refine: remediationStrategy,
      target_check_ids: carryForwardSafeTargetCheckIds([
        ...(failedCheckIds.has("independent_target_probe_present")
          ? ["independent_target_probe_present"]
          : []),
        "target_signal_thresholds_met"
      ]),
      probe_id: probe.probe_id,
      ...(probe.quality_axis_id ? { axis_id: probe.quality_axis_id } : {})
    });
  }

  if (input.evalReport.threshold_gap_details.length > 0) {
    findings.push({
      finding_id: `threshold-gap-round-${String(input.round).padStart(2, "0")}`,
      category: "proof_signal",
      severity: "high",
      summary: input.evalReport.threshold_gap_details.join(" "),
      expected_change:
        "Raise release quality, proof strength, and live verifier confidence until target signaling thresholds pass.",
      evidence: unique([
        ...input.evalReport.core_probe_results
          .filter((probe) => !probe.ok)
          .map((probe) => probe.probe_id),
        ...input.evalReport.unresolved_check_ids
      ]),
      preserve: preserveSignals,
      pivot_or_refine: remediationStrategy,
      target_check_ids: ["target_signal_thresholds_met"]
    });
  }

  const qualityFocus = unique([
    ...(profileQualityContract?.quality_axes.map((axis) => axis.label) ?? []),
    ...findings.map((finding) => finding.expected_change)
  ]).slice(0, 6);

  return {
    critique_id: `${input.contractArtifact.contract_id}-quality-critique`,
    contract_id: input.contractArtifact.contract_id,
    round: input.round,
    remediation_strategy: remediationStrategy,
    quality_focus: qualityFocus,
    preserve_signals: preserveSignals,
    findings: findings.slice(0, 8),
    notes: unique([
      profileQualityContract?.primary_goal
        ? `Primary goal: ${profileQualityContract.primary_goal}`
        : "Primary goal: keep target closure honest and product-oriented.",
      ...(profileQualityContract?.reference_signals?.map(
        (signal) => `Reference signal: ${signal}`
      ) ?? []),
      ...(input.failureLineage?.policy_snapshot?.reasons ?? []).map(
        (reason) => `Policy reason: ${reason}`
      )
    ]).slice(0, 8)
  };
};


export const buildEvaluatorVerdictArtifact = (input: {
  contractArtifact: RoundContractArtifact;
  evalReport: EvalReport;
}): EvaluatorVerdictArtifact => ({
  contract_id: input.contractArtifact.contract_id,
  verdict_id: `${input.contractArtifact.contract_id}-verdict`,
  overall_verdict: input.evalReport.overall_verdict,
  findings: [...input.evalReport.blockers, ...input.evalReport.next_actions].slice(0, 8),
  release_blockers: input.evalReport.blockers.slice(0, 6),
  contract_completed: input.evalReport.threshold_results.contract_completed
});

export const buildPatchRequestArtifact = (input: {
  round: number;
  evalReport: EvalReport;
  evaluatorVerdictArtifact: EvaluatorVerdictArtifact;
  qualityCritiqueArtifact: QualityCritiqueArtifact;
  adapterAttached: boolean;
  staticContractBlockers?: string[];
  failureLineage?: FailureLineage;
}): PatchRequestArtifact => {
  const environmentBlockedOnly = isPureEnvironmentBlockedLineage(input.failureLineage);
  const failedChecks = input.evalReport.check_results.filter(
    (result) =>
      result.status === "fail" &&
      !nonCarryForwardCheckIds.has(result.check_id) &&
      !(environmentBlockedOnly && result.check_id === "independent_target_probe_present") &&
      result.check_id !== "target_signal_thresholds_met"
  );
  const thresholdFixItems =
    input.adapterAttached && input.evalReport.threshold_gap_details.length > 0
      ? [
          {
            id: `raise-target-signal-round-${String(input.round).padStart(2, "0")}`,
            why: input.evalReport.threshold_gap_details.join(" "),
            expected_change:
              "Strengthen live verifier proof, provenance, and release quality until target_signal_thresholds_met passes.",
            target_check_ids: ["target_signal_thresholds_met"],
            source_round: input.round
          }
        ]
      : [];
  const staticContractFixItems =
    input.staticContractBlockers && input.staticContractBlockers.length > 0
      ? [
          {
            id: `repair-adapter-contract-round-${String(input.round).padStart(2, "0")}`,
            why: input.staticContractBlockers.join(" "),
            expected_change:
              "Fix the static adapter contract and verification policy before opening another run.",
            target_check_ids: ["proof_boundary_is_independent", "independent_target_probe_present"],
            source_round: input.round
          }
        ]
      : [];
  const environmentBlockers =
    input.failureLineage?.environment_blocked_probe_ids.length
      ? input.evalReport.core_probe_results
          .filter((probe) =>
            input.failureLineage?.environment_blocked_probe_ids.includes(probe.probe_id)
          )
          .map((probe) => probe.summary)
      : [];
  const environmentFixItems =
    environmentBlockers.length > 0
      ? [
          {
            id: `classify-environment-blocker-round-${String(input.round).padStart(2, "0")}`,
            why: environmentBlockers.join(" "),
            expected_change:
              "Treat the blocked validation environment as a runtime constraint, not as a product defect. Re-run in an unblocked environment or swap to a deterministic lane before expanding product remediation.",
            target_check_ids: ["target_signal_thresholds_met"],
            source_round: input.round
          }
        ]
      : [];
  const qualityFixItems = input.qualityCritiqueArtifact.findings.map((finding) => ({
    id: finding.finding_id,
    why: finding.summary,
    expected_change: finding.expected_change,
    target_check_ids: carryForwardSafeTargetCheckIds(finding.target_check_ids),
    source_round: input.round
  })).filter((item) => item.target_check_ids.length > 0);
  const needsTargetSignalRemediation = thresholdFixItems.length > 0;
  const nextAction =
    input.evaluatorVerdictArtifact.contract_completed &&
    !needsTargetSignalRemediation &&
    failedChecks.length === 0
      ? "complete"
      : environmentBlockedOnly && staticContractFixItems.length === 0
        ? "hold"
        : "revise";

  const mustFix =
    nextAction === "complete"
        ? []
      : nextAction === "hold"
        ? environmentFixItems
      : qualityFixItems.length > 0
        ? [
            ...staticContractFixItems,
            ...environmentFixItems,
            ...thresholdFixItems,
            ...qualityFixItems
          ].slice(0, 4)
      : failedChecks.length > 0
        ? [
            ...staticContractFixItems,
            ...environmentFixItems,
            ...thresholdFixItems,
            ...failedChecks.slice(0, 4).map((result, index) => ({
              id: `close-${result.check_id}-${index + 1}`,
              why: result.detail,
              expected_change: `Make '${result.check_id}' pass in the next remediation attempt.`,
              target_check_ids: [normalizeCarryForwardCheckId(result.check_id)],
              source_round: input.round
            }))
          ].slice(0, 4)
        : staticContractFixItems.length > 0
          ? staticContractFixItems
        : environmentFixItems.length > 0
          ? environmentFixItems
        : thresholdFixItems.length > 0
          ? thresholdFixItems
        : [
            {
              id: `stabilize-round-${String(input.round).padStart(2, "0")}`,
              why: "The attempt still needs revision even though no carry-forward-safe failed check ids remained.",
              expected_change: "Stabilize the attempt and close the remaining review blockers.",
              target_check_ids: [],
              source_round: input.round
            }
          ];

  return {
    request_id: `${input.evaluatorVerdictArtifact.verdict_id}-patch`,
    derived_from_verdict_id: input.evaluatorVerdictArtifact.verdict_id,
    next_action: nextAction,
    priority:
      nextAction === "complete"
        ? "polish"
        : nextAction === "hold"
          ? "important"
          : "blocking",
    remediation_strategy:
      nextAction === "complete"
        ? "refine"
        : input.qualityCritiqueArtifact.remediation_strategy,
    must_fix: mustFix,
    quality_findings: input.qualityCritiqueArtifact.findings,
    ...(environmentBlockers.length > 0 ? { environment_blockers: environmentBlockers } : {}),
    preserve_signals: input.qualityCritiqueArtifact.preserve_signals,
    must_preserve: unique([
      ...defaultPreserveSignals,
      ...input.qualityCritiqueArtifact.preserve_signals,
      ...input.qualityCritiqueArtifact.findings.flatMap((finding) => finding.preserve)
    ]).slice(0, 8),
    forbidden_scope_expansion: [
      "Do not reintroduce bundled product code into this repository.",
      input.adapterAttached
        ? "Do not bypass the adapter boundary by editing target code from the core repo."
        : "Do not claim adapter-owned runtime proof while no adapter is attached."
    ],
    promotion_rule:
      nextAction === "complete"
          ? input.evalReport.threshold_results.target_reached_eligible
            ? "Stop after recording terminal target completion for the current attempt."
            : "Stop after recording contract completion for the current attempt without claiming target_reached."
          : nextAction === "hold"
            ? "Stop the run until validation can resume in an unblocked environment or a deterministic lane."
          : staticContractFixItems.length > 0
            ? "Stop the run and repair the static adapter contract before retrying."
          : needsTargetSignalRemediation
            ? "Open another remediation attempt only if target signal thresholds still need to be raised."
            : "Open another remediation attempt only if blocking contract checks still remain."
  };
};

export const buildRoundResultArtifact = (input: {
  roundDirectory: string;
  round: number;
  contractAgreementArtifact: ContractAgreementArtifact;
  generatorPlanArtifact: GeneratorPlanArtifact;
  evaluatorVerdictArtifact: EvaluatorVerdictArtifact;
  patchRequestArtifact: PatchRequestArtifact;
  qualityCritiqueArtifact: QualityCritiqueArtifact;
  evalReport: EvalReport;
  selectedForRun: boolean;
  previousPatchRequestAddressed: boolean;
  previousPatchRequestResolved: boolean;
}): RoundResultArtifact => {
  const passed = input.evalReport.check_results.filter((result) => result.status === "pass").length;
  const total =
    input.evalReport.check_results.filter((result) => result.status !== "not_applicable").length || 1;

  return {
    round: input.round,
    contract_id: input.generatorPlanArtifact.contract_id,
    agreement_id: input.contractAgreementArtifact.agreement_id,
    generator_plan_id: input.generatorPlanArtifact.generator_plan_id,
    verdict_id: input.evaluatorVerdictArtifact.verdict_id,
    request_id: input.patchRequestArtifact.request_id,
    quality_critique_id: input.qualityCritiqueArtifact.critique_id,
    total_score: input.evalReport.total_score,
    control_plane_score: input.evalReport.control_plane_score,
    proof_score: input.evalReport.proof_score,
    release_score: input.evalReport.release_score,
    overall_verdict: input.evaluatorVerdictArtifact.overall_verdict,
    selected_for_run: input.selectedForRun,
    status:
      input.evaluatorVerdictArtifact.overall_verdict === "advance"
        ? "advanced"
        : input.evaluatorVerdictArtifact.overall_verdict === "revise"
          ? "revised"
          : "blocked",
    eval_report_path: relative(input.roundDirectory, join(input.roundDirectory, "eval_report.json")).replaceAll(
      "\\",
      "/"
    ),
    evidence_paths: input.evalReport.evidence_paths,
    check_pass_rate: Number((passed / total).toFixed(3)),
    previous_patch_request_addressed: input.previousPatchRequestAddressed,
    previous_patch_request_resolved: input.previousPatchRequestResolved,
    resolved_check_ids: input.evalReport.resolved_check_ids,
    unresolved_check_ids: input.evalReport.unresolved_check_ids,
    threshold_results: input.evalReport.threshold_results
  };
};

export const writeNegotiationArtifacts = async (input: {
  roundDirectory: string;
  contractArtifact: RoundContractArtifact;
  contractReviewArtifact: ContractReviewArtifact;
  contractAgreementArtifact: ContractAgreementArtifact;
  generatorPlanArtifact: GeneratorPlanArtifact;
  persistContractReviewArtifact?: boolean;
  persistContractAgreementArtifact?: boolean;
}): Promise<RoundArtifacts> => {
  const artifacts = artifactsForRound(input.roundDirectory);
  const persistContractReviewArtifact = input.persistContractReviewArtifact ?? true;
  const persistContractAgreementArtifact = input.persistContractAgreementArtifact ?? true;

  const writes = [
    writeJson(artifacts.contract_json_path, input.contractArtifact),
    writeText(
      artifacts.contract_md_path,
      `# Round Contract

## Attempt Kind

${input.contractArtifact.attempt_kind}

## Negotiation Mode

${input.contractArtifact.negotiation_mode}

## Continuation Authority

${input.contractArtifact.continuation_authority}

## Recontract Reason

${input.contractArtifact.recontract_reason ?? "none"}

## Objective

${input.contractArtifact.objective}

## Focus Areas

${bulletList(
        input.contractArtifact.focus_areas
      )}

## Acceptance Checks

${bulletList(input.contractArtifact.acceptance_checks)}

## Release-Gate Checks

${bulletList(
        input.contractArtifact.release_gate_check_ids
      )}

## Browser Release-Gate Probes

${bulletList(
        input.contractArtifact.browser_release_gate_probe_ids
      )}

## API Release-Gate Probes

${bulletList(
        input.contractArtifact.api_release_gate_probe_ids
      )}

## Required Live Verification Modes

${bulletList(
        input.contractArtifact.required_live_verification_modes
      )}

## Proof Plan

${bulletList(input.contractArtifact.proof_plan)}

## Pivot Triggers

${bulletList(input.contractArtifact.pivot_triggers)}
`
    ),
    writeJson(artifacts.generator_plan_json_path, input.generatorPlanArtifact),
    writeText(
      artifacts.generator_plan_md_path,
      `# Generator Plan

## Intent

${input.generatorPlanArtifact.implementation_intent}

## Remediation Strategy

${input.generatorPlanArtifact.remediation_strategy ?? "tighten"}

## Target Checks

${bulletList(
        input.generatorPlanArtifact.target_check_ids
      )}

## Quality Focus

${bulletList(input.generatorPlanArtifact.quality_focus ?? [])}

## Must Preserve

${bulletList(input.generatorPlanArtifact.must_preserve ?? [])}

## Files To Touch

${bulletList(
        input.generatorPlanArtifact.files_to_touch
      )}

## Adapter Actions

${bulletList(input.generatorPlanArtifact.adapter_actions)}
`
    )
  ];

  if (persistContractReviewArtifact) {
    writes.push(
      writeJson(artifacts.contract_review_json_path, input.contractReviewArtifact),
      writeText(
        artifacts.contract_review_md_path,
        `# Contract Review\n\n## Decision\n\n${input.contractReviewArtifact.decision}\n\n## Concerns\n\n${bulletList(
          input.contractReviewArtifact.concerns
        )}\n\n## Required Changes\n\n${bulletList(input.contractReviewArtifact.required_changes)}\n`
      )
    );
  }

  if (persistContractAgreementArtifact) {
    writes.push(
      writeJson(artifacts.contract_agreement_json_path, input.contractAgreementArtifact),
      writeText(
        artifacts.contract_agreement_md_path,
        `# Contract Agreement\n\n## Status\n\n${input.contractAgreementArtifact.status}\n\n## Generator Must Deliver\n\n${bulletList(
          input.contractAgreementArtifact.generator_must_deliver
        )}\n\n## Evaluator Must Verify\n\n${bulletList(
          input.contractAgreementArtifact.evaluator_must_verify
        )}\n`
      )
    );
  }

  await Promise.all(writes);

  return artifacts;
};

export const writeRoundEvaluationPlaceholders = async (input: {
  roundDirectory: string;
}): Promise<RoundArtifacts> => {
  const artifacts = artifactsForRound(input.roundDirectory);

  await Promise.all([
    writeJson(artifacts.evaluator_verdict_json_path, {
      status: "pending",
      generated_by: "writeRoundEvaluationPlaceholders"
    }),
    writeText(artifacts.evaluator_verdict_md_path, "# Evaluator Verdict\n\nPending final evaluation.\n"),
    writeJson(artifacts.patch_request_json_path, {
      status: "pending",
      generated_by: "writeRoundEvaluationPlaceholders"
    }),
    writeText(artifacts.patch_request_md_path, "# Patch Request\n\nPending final evaluation.\n"),
    writeJson(artifacts.quality_critique_json_path, {
      status: "pending",
      generated_by: "writeRoundEvaluationPlaceholders"
    }),
    writeText(
      artifacts.quality_critique_md_path,
      "# Quality Critique\n\nPending final evaluation.\n"
    ),
    writeJson(artifacts.round_result_json_path, {
      status: "pending",
      generated_by: "writeRoundEvaluationPlaceholders"
    }),
    writeJson(artifacts.eval_report_path, {
      status: "pending",
      generated_by: "writeRoundEvaluationPlaceholders"
    })
  ]);

  return artifacts;
};

export const writeRoundArtifacts = async (input: {
  roundDirectory: string;
  evaluatorVerdictArtifact: EvaluatorVerdictArtifact;
  patchRequestArtifact: PatchRequestArtifact;
  qualityCritiqueArtifact: QualityCritiqueArtifact;
  roundResultArtifact: RoundResultArtifact;
  evalReport: EvalReport;
  failureLineage?: FailureLineage;
}): Promise<RoundArtifacts> => {
  const artifacts = artifactsForRound(input.roundDirectory);

  await Promise.all([
    writeJson(artifacts.evaluator_verdict_json_path, input.evaluatorVerdictArtifact),
    writeText(
      artifacts.evaluator_verdict_md_path,
      `# Evaluator Verdict\n\n## Overall Verdict\n\n${input.evaluatorVerdictArtifact.overall_verdict}\n\n## Findings\n\n${bulletList(
        input.evaluatorVerdictArtifact.findings
      )}\n`
    ),
    writeJson(artifacts.patch_request_json_path, input.patchRequestArtifact),
    writeText(
      artifacts.patch_request_md_path,
      `# Patch Request\n\n## Next Action\n\n${input.patchRequestArtifact.next_action}\n\n## Must Fix\n\n${input.patchRequestArtifact.must_fix
        .map(
          (item) =>
            `- ${item.id}: ${item.expected_change} [targets: ${item.target_check_ids.join(", ") || "none"}]`
        )
        .join("\n") || "- none"}\n\n## Remediation Strategy\n\n${input.patchRequestArtifact.remediation_strategy ?? "tighten"}\n\n## Environment Blockers\n\n${bulletList(
        input.patchRequestArtifact.environment_blockers ?? []
      )}\n`
    ),
    writeJson(artifacts.quality_critique_json_path, input.qualityCritiqueArtifact),
    writeText(
      artifacts.quality_critique_md_path,
      `# Quality Critique\n\n## Remediation Strategy\n\n${input.qualityCritiqueArtifact.remediation_strategy}\n\n## Quality Focus\n\n${bulletList(
        input.qualityCritiqueArtifact.quality_focus
      )}\n\n## Preserve Signals\n\n${bulletList(
        input.qualityCritiqueArtifact.preserve_signals
      )}\n\n## Findings\n\n${input.qualityCritiqueArtifact.findings
        .map(
          (finding) =>
            `- ${finding.finding_id}: ${finding.expected_change} [${finding.category}/${finding.severity}]`
        )
        .join("\n") || "- none"}\n`
    ),
    writeJson(artifacts.round_result_json_path, input.roundResultArtifact),
    writeJson(artifacts.eval_report_path, input.evalReport),
    ...(input.failureLineage
      ? [writeJson(artifacts.failure_lineage_path, input.failureLineage)]
      : [])
  ]);

  return artifacts;
};
