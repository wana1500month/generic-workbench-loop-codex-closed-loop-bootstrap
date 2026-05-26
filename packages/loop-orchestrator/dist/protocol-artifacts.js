import { basename, join, relative } from "node:path";
import { approvalSemanticsForAdapterMigrationProposal, decisionOptionsForAdapterMigrationProposal } from "./adapter-migration.js";
import { writeJson, writeText } from "./file-system.js";
import { isPureEnvironmentBlockedLineage } from "./failure-lineage.js";
import { describePrototypeBaselineSourceSemantics, isPrototypeBaselineSourceSemantics, prototypeBaselineSourceSemanticsForPhase } from "./prototype-baseline.js";
const bulletList = (items) => items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- none";
const unique = (values) => [...new Set(values)];
const nonCarryForwardCheckIds = new Set([
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
    "trajectory-decision.json",
    "round-result.json",
    "eval_report.json",
    "agent_handoff/generator-brief.md",
    "agent_handoff/qa-review.md",
    "agent_handoff/controller-decision.md"
];
const generatedLocalAdapterOnlyPaths = [
    "adapter.generated.json",
    ".generated/codex-adapter/runtime-config.json",
    ".generated/codex-adapter/scripts"
];
export const PROTOCOL_ARTIFACT_SCHEMA_VERSION = "2026-05-08";
const externalAdapterOnlyPaths = [
    "adapter-migration-proposal.json",
    "adapter-migration-approval-prompt.md",
    "adapter-migration-response.json",
    "adapter-migration.patch",
    "adapter-migration-instructions.md"
];
const normalizeCarryForwardCheckId = (checkId) => checkId.startsWith("adapter_") ? "adapter_execution_healthy" : checkId;
const defaultPreserveSignals = [
    "Keep the repository focused on core harness mechanics.",
    "Keep protocol files authoritative and file-based."
];
const qualityCritiqueNoteOnlyDimensions = new Set(["repair_convergence"]);
const normalizeArtifactPath = (path) => path.replaceAll("\\", "/");
const relativeArtifactPath = (roundDirectory, path) => normalizeArtifactPath(relative(roundDirectory, path));
const identitySnapshotLines = (identity) => [
    `adapter_contract_path: ${identity.adapter_contract_path ?? "unchanged"}`,
    `target_root: ${identity.target_root ?? "unchanged"}`,
    `adapter_id: ${identity.adapter_id ?? "unchanged"}`,
    `provider_id: ${identity.provider_id ?? "unchanged"}`
];
const decisionSemanticsLines = (proposal) => {
    const semantics = approvalSemanticsForAdapterMigrationProposal(proposal);
    return decisionOptionsForAdapterMigrationProposal(proposal).map((decision) => `\`${decision}\`: ${semantics[decision]}`);
};
const proposalAffectedFileLines = (roundDirectory, proposal) => proposal.affected_files.map((path) => relativeArtifactPath(roundDirectory, path));
const renderAdapterMigrationProposalMarkdown = (roundDirectory, proposal) => `# Adapter Migration Proposal\n\n## Summary\n\n${proposal.summary}\n\n## Origin\n\n${proposal.adapter_origin}\n\n## Migration Class\n\n${proposal.migration_class}\n\n## Apply Mode\n\n${proposal.apply_mode}\n\n## Same Run Eligible\n\n${proposal.same_run_eligible ? "yes" : "no"}\n\n## Autoapply Eligible\n\n${proposal.autoapply_eligible ? "yes" : "no"}\n\n## Requires Operator Acceptance\n\n${proposal.requires_operator_acceptance ? "yes" : "no"}\n\n## Force New Run\n\n${proposal.force_new_run ? "yes" : "no"}\n\n## Current Identity\n\n${bulletList(identitySnapshotLines(proposal.current_identity))}\n\n## Proposed Identity\n\n${bulletList(identitySnapshotLines(proposal.proposed_identity))}\n\n## Expected Post-Apply Identity\n\n${bulletList(identitySnapshotLines(proposal.expected_post_apply_identity))}\n\n## Affected Files\n\n${bulletList(proposalAffectedFileLines(roundDirectory, proposal))}\n\n## Patch Bundle\n\n${proposal.patch_bundle_path ? relativeArtifactPath(roundDirectory, proposal.patch_bundle_path) : "not authored yet"}\n\n## Reasons\n\n${bulletList(proposal.reasons)}\n\n## Suggested Updates\n\n${bulletList(proposal.suggested_updates)}\n\n## Decision Semantics\n\n${bulletList(decisionSemanticsLines(proposal))}\n`;
const carryForwardSafeTargetCheckIds = (checkIds) => unique(checkIds
    .map(normalizeCarryForwardCheckId)
    .filter((checkId) => !nonCarryForwardCheckIds.has(checkId)));
export const artifactsForRound = (roundDirectory) => {
    const handoffDirectory = join(roundDirectory, "agent_handoff");
    const runtimeDirectory = join(roundDirectory, "runtime");
    return {
        round_directory: roundDirectory,
        runtime_directory: runtimeDirectory,
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
        trajectory_decision_json_path: join(roundDirectory, "trajectory-decision.json"),
        trajectory_decision_md_path: join(roundDirectory, "trajectory-decision.md"),
        round_result_json_path: join(roundDirectory, "round-result.json"),
        eval_report_path: join(roundDirectory, "eval_report.json"),
        scorecard_json_path: join(roundDirectory, "scorecard.json"),
        scorecard_md_path: join(roundDirectory, "scorecard.md"),
        failure_lineage_path: join(roundDirectory, "failure-lineage.json"),
        adapter_drift_report_json_path: join(roundDirectory, "adapter-drift-report.json"),
        adapter_drift_report_md_path: join(roundDirectory, "adapter-drift-report.md"),
        adapter_migration_proposal_json_path: join(roundDirectory, "adapter-migration-proposal.json"),
        adapter_migration_proposal_md_path: join(roundDirectory, "adapter-migration-proposal.md"),
        adapter_migration_approval_prompt_path: join(roundDirectory, "adapter-migration-approval-prompt.md"),
        adapter_migration_response_json_path: join(roundDirectory, "adapter-migration-response.json"),
        adapter_migration_response_md_path: join(roundDirectory, "adapter-migration-response.md"),
        adapter_migration_patch_path: join(roundDirectory, "adapter-migration.patch"),
        adapter_migration_instructions_path: join(roundDirectory, "adapter-migration-instructions.md"),
        adapter_migration_applied_json_path: join(roundDirectory, "adapter-migration-applied.json"),
        adapter_migration_applied_md_path: join(roundDirectory, "adapter-migration-applied.md"),
        adapter_migration_authoring_task_path: join(runtimeDirectory, "adapter-migration-authoring-task.json"),
        adapter_migration_authoring_prompt_path: join(runtimeDirectory, "adapter-migration-authoring-prompt.md"),
        adapter_migration_authoring_response_path: join(runtimeDirectory, "adapter-migration-authoring-response.json"),
        target_manifest_path: join(roundDirectory, "target-manifest.json"),
        core_probe_results_path: join(roundDirectory, "core-probe-results.json"),
        pre_verification_executions_path: join(runtimeDirectory, "pre-verification-executions.json"),
        post_verification_executions_path: join(runtimeDirectory, "post-verification-executions.json"),
        adapter_executions_path: join(runtimeDirectory, "adapter-executions.json"),
        negotiation_state_path: join(runtimeDirectory, "negotiation-state.json"),
        contract_review_enhancement_task_path: join(runtimeDirectory, "contract-review-enhancement-task.json"),
        contract_review_enhancement_prompt_path: join(runtimeDirectory, "contract-review-enhancement-prompt.md"),
        contract_review_enhancement_response_path: join(runtimeDirectory, "contract-review-enhancement-response.json"),
        generator_plan_enhancement_task_path: join(runtimeDirectory, "generator-plan-enhancement-task.json"),
        generator_plan_enhancement_prompt_path: join(runtimeDirectory, "generator-plan-enhancement-prompt.md"),
        generator_plan_enhancement_response_path: join(runtimeDirectory, "generator-plan-enhancement-response.json"),
        eval_enhancement_task_path: join(runtimeDirectory, "eval-enhancement-task.json"),
        eval_enhancement_prompt_path: join(runtimeDirectory, "eval-enhancement-prompt.md"),
        eval_enhancement_response_path: join(runtimeDirectory, "eval-enhancement-response.json"),
        attached_generator_task_path: join(runtimeDirectory, "attached-generator-task.json"),
        attached_generator_prompt_path: join(runtimeDirectory, "attached-generator-prompt.md"),
        attached_generator_response_path: join(runtimeDirectory, "attached-generator-response.json"),
        planner_context_path: join(handoffDirectory, "planner-context.md"),
        generator_brief_path: join(handoffDirectory, "generator-brief.md"),
        qa_review_path: join(handoffDirectory, "qa-review.md"),
        controller_decision_path: join(handoffDirectory, "controller-decision.md"),
        adapter_directory: join(roundDirectory, "adapter")
    };
};
const adapterOnlyPathsFor = (loadedAdapter) => {
    if (!loadedAdapter) {
        return undefined;
    }
    return basename(loadedAdapter.contract_path) === "adapter.generated.json"
        ? [...generatedLocalAdapterOnlyPaths]
        : [...externalAdapterOnlyPaths];
};
export const buildRoundContractArtifact = (input) => {
    const isProductBuild = input.sessionKind === "product_build";
    const requiredLiveVerificationModes = derivedLiveVerificationModes(input.loadedAdapter);
    const browserReleaseGateProbeIds = probeIdsForModes(input.loadedAdapter, ["browser"]);
    const apiReleaseGateProbeIds = probeIdsForModes(input.loadedAdapter, ["api"]);
    const releaseGateCheckIds = unique([
        ...input.contract.acceptance_checks.filter((checkId) => !checkId.endsWith("_surface_reserved") &&
            checkId !== "previous_patch_request_addressed" &&
            checkId !== "previous_patch_request_resolved"),
        "target_signal_thresholds_met"
    ]);
    return ({
        schema_version: PROTOCOL_ARTIFACT_SCHEMA_VERSION,
        artifact_type: "round_contract",
        run_id: input.runId,
        created_at: new Date().toISOString(),
        producer: "loop-orchestrator",
        contract_id: input.contract.contract_id,
        round: input.round,
        attempt_kind: input.contract.attempt_kind,
        negotiation_mode: input.negotiationMode,
        ...((input.negotiationMode === "recontract" &&
            input.recontractReason?.startsWith("adapter_"))
            ? {
                recontract_mode: true,
                adapter_only_paths: adapterOnlyPathsFor(input.loadedAdapter) ?? []
            }
            : {}),
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
        required_artifacts: input.negotiationMode === "patch_only"
            ? [...remediationRequiredArtifacts]
            : input.contract.attempt_kind === "initial_build"
                ? input.rubric.required_artifacts
                : input.rubric.required_artifacts,
        non_goals: isProductBuild
            ? [
                "Do not optimize or rewrite the harness core during this product build.",
                "Do not edit packages/loop-orchestrator/src unless the user explicitly asks to modify the harness.",
                "Do not broaden the product scope beyond runtime/build-brief.json.",
                "Do not claim workflow completion without runtime, browser, API, or command evidence.",
                input.negotiationMode === "patch_only"
                    ? "Do not reopen product scope unless the controller escalates to recontract."
                    : "Do not split the first build into fixed feature sprints."
            ]
            : [
                "Do not embed a bundled adapter back into the harness repository.",
                "Do not claim end-to-end proof when no external adapter is attached.",
                input.negotiationMode === "patch_only"
                    ? "Do not reopen planner contract negotiation unless the controller escalates to recontract."
                    : "Do not pre-split the build into fixed feature sprints."
            ],
        carry_over_context: [
            `Negotiation mode: ${input.negotiationMode}.`,
            `Continuation authority: ${input.continuationAuthority}.`,
            `Trajectory mode: ${input.trajectory.mode}.`,
            `Trajectory restart_from: ${input.trajectory.restart_from}.`,
            ...(input.contract.carry_over_patch_ids?.map((patchId) => `Carry patch id: ${patchId}`) ?? []),
            ...(input.contract.carry_over_check_ids?.map((checkId) => `Carry check id: ${checkId}`) ?? []),
            ...input.contract.notes
        ].slice(0, 8),
        carry_over_patch_ids: input.contract.carry_over_patch_ids ?? [],
        carry_over_check_ids: input.contract.carry_over_check_ids ?? [],
        trajectory: input.trajectory,
        adapter_expectations: isProductBuild
            ? [
                "The generated adapter is the execution boundary for this product target.",
                ...(input.productTargetRoot
                    ? [`Target changes should stay inside ${input.productTargetRoot}.`]
                    : ["Target changes should stay inside the captured target root."]),
                "The evaluator profile owns target_reached; the generator must satisfy release-gate probes instead of self-declaring success."
            ]
            : [
                "External adapters should expose prepare_target, apply_change, run_target, capture_evidence, run_checks, and grade_round capabilities.",
                "Target-facing adapters should let the harness select a core-owned evaluator profile through the rubric or CLI, rather than shipping target_reached policy inside adapter.json.",
                "The core harness should remain functional even when no adapter is attached."
            ]
    });
};
export const buildGeneratorPlanArtifact = (input) => {
    const isProductBuild = input.sessionKind === "product_build";
    const remediationStrategy = input.previousPatchRequest?.remediation_strategy;
    const qualityFocus = unique(input.previousPatchRequest?.quality_findings?.map((finding) => finding.expected_change) ?? []).slice(0, 6);
    const mustPreserve = unique([
        ...(input.previousPatchRequest?.preserve_signals ?? []),
        ...(input.previousPatchRequest?.must_preserve ?? [])
    ]).slice(0, 8);
    return {
        contract_id: input.contractArtifact.contract_id,
        agreement_id: input.contractAgreementArtifact.agreement_id,
        generator_plan_id: `${input.contractArtifact.contract_id}-generator-plan`,
        implementation_intent: input.contractArtifact.negotiation_mode === "patch_only"
            ? input.previousPatchRequest?.must_fix.length
                ? `Use the ${remediationStrategy ?? "tighten"} remediation strategy from ${input.trajectory.restart_from}. Preserve ${mustPreserve.join("; ") || "the current contract surface"}. Close only the carried must-fix items from the latest patch request: ${input.previousPatchRequest.must_fix
                    .map((item) => item.expected_change)
                    .join(" ")}`
                : `Close only the carried patch authority from ${input.trajectory.restart_from}: ${input.contractArtifact.carry_over_check_ids.join(", ")}.`
            : input.contractArtifact.attempt_kind === "remediation"
                ? input.previousPatchRequest?.must_fix.length
                    ? `Use the ${remediationStrategy ?? "tighten"} remediation strategy from ${input.trajectory.restart_from}. Preserve ${mustPreserve.join("; ") || "the strongest passing signals"}. Follow the latest patch request, trajectory controller, and QA feedback with a tight remediation scope: ${input.previousPatchRequest.must_fix
                        .map((item) => item.expected_change)
                        .join(" ")}`
                    : `Close carried checks before expanding scope from ${input.trajectory.restart_from}: ${input.contractArtifact.carry_over_check_ids.join(", ")}.`
                : isProductBuild
                    ? `Build the first product version against runtime/build-brief.json${input.buildBrief?.product.title ? ` for ${input.buildBrief.product.title}` : ""}.`
                    : "Take one long build attempt against the planner spec, then let evaluator feedback decide whether remediation is needed.",
        ...(remediationStrategy ? { remediation_strategy: remediationStrategy } : {}),
        trajectory: input.trajectory,
        target_check_ids: unique([
            ...input.contractArtifact.carry_over_check_ids,
            ...input.contractAgreementArtifact.acceptance_checks
        ]),
        ...(qualityFocus.length > 0 ? { quality_focus: qualityFocus } : {}),
        ...(mustPreserve.length > 0 ? { must_preserve: mustPreserve } : {}),
        files_to_touch: isProductBuild
            ? [
                input.targetRoot ?? "target root from runtime/run-contract.json",
                "runtime/attached-generator-response.json"
            ]
            : [
                "IDEA.md",
                "SPEC.md",
                "RUNBOOK.md",
                "AGENT_PROTOCOL.md",
                "ADAPTER_CONTRACT.md",
                "packages/loop-orchestrator/src"
            ],
        expected_proof: input.contractAgreementArtifact.acceptance_checks,
        risk_notes: isProductBuild
            ? [
                input.contractArtifact.negotiation_mode === "patch_only"
                    ? "Keep remediation narrow and close only the failed workflow/proof gaps."
                    : "Build the first product version against runtime/build-brief.json.",
                "Do not modify the harness core to make the product pass.",
                "Do not fake release-gate selectors or API responses without implementing the corresponding user-visible workflow.",
                "Create run/check scripts that match the configured run_command and check_command.",
                "Keep target changes inside the target root unless the contract explicitly allows otherwise."
            ]
            : [
                input.contractArtifact.negotiation_mode === "patch_only"
                    ? "Do not widen scope beyond the latest patch request unless the controller escalates to recontract."
                    : input.contractArtifact.attempt_kind === "remediation"
                        ? `Keep remediation narrow: close carried checks and threshold gaps before expanding scope. Trajectory mode: ${input.trajectory.mode}.`
                        : "Use the initial build attempt to integrate against the planner spec in one long pass.",
                input.contractArtifact.negotiation_mode === "patch_only"
                    ? "Treat the latest patch request and QA evidence as the load-bearing continuation surface."
                    : "Treat the negotiated contract and agreement as the load-bearing continuation surface.",
                input.trajectory.mode === "pivot" || input.trajectory.mode === "parallel_pivot"
                    ? `Restart from ${input.trajectory.restart_from}, preserve ${input.trajectory.preserve_signals.join("; ") || "the strongest contract signals"}, and discard ${input.trajectory.discardable_surface.join("; ") || "the stale failing surface"}.`
                    : `Trajectory mode '${input.trajectory.mode}' targets novelty ${input.trajectory.novelty_target.toFixed(2)} while preserving ${input.trajectory.preserve_signals.join("; ") || "the current contract surface"}.`,
                input.adapterAttached
                    ? "An external adapter is attached, so adapter capability outputs should be treated as first-class evidence under a core-owned evaluator profile."
                    : "No adapter is attached, so only harness-side evidence can be claimed in this attempt.",
                "Keep the repository generic and adapter-free."
            ],
        out_of_scope: input.contractArtifact.non_goals,
        adapter_actions: isProductBuild
            ? [
                "Prepare the captured product target root.",
                "Apply product changes inside the target root.",
                "Start the configured local runtime.",
                "Collect browser/API/check evidence against the generated evaluator profile.",
                "Treat failing release-gate probes as product defects to fix in the next round."
            ]
            : input.adapterAttached
                ? [
                    "Prepare the target through the adapter boundary.",
                    "Apply changes through the adapter boundary.",
                    "Run, capture evidence, and grade through adapter capabilities.",
                    "Keep target-specific correctness criteria in the verification profile rather than adapter-authored status strings."
                ]
                : ["Document and preserve the adapter boundary without requiring a bundled target."]
    };
};
const releaseGateProbesFor = (loadedAdapter) => loadedAdapter?.verification_profile?.profile.core_probes?.filter((probe) => (probe.role ?? "supporting") === "release_gate") ?? [];
const probeIdsForModes = (loadedAdapter, modes) => releaseGateProbesFor(loadedAdapter)
    .filter((probe) => (modes.includes("browser") &&
    (probe.mode === "browser_journey" || probe.mode === "browser")) ||
    (modes.includes("api") &&
        (probe.mode === "http_json" || probe.mode === "http")) ||
    (modes.includes("db") &&
        (probe.mode === "json_value" || probe.mode === "file_contains")) ||
    (modes.includes("shell") && probe.mode === "shell_command"))
    .map((probe) => probe.probe_id);
const derivedLiveVerificationModes = (loadedAdapter) => {
    const profile = loadedAdapter?.verification_profile?.profile;
    if (!profile) {
        return [];
    }
    if (profile.required_live_verification_modes?.length) {
        return [...profile.required_live_verification_modes];
    }
    const releaseGateProbes = releaseGateProbesFor(loadedAdapter);
    const modes = new Set();
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
const qualityCategoryForTags = (tags = []) => {
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
const qualitySeverityForProbe = (input) => {
    if (input.failureClassification === "environment_blocked") {
        return "medium";
    }
    return input.required ? "high" : "medium";
};
const remediationStrategyForQuality = (input) => {
    if (input.failureLineage?.policy_snapshot?.recommended_action === "recontract") {
        return "pivot";
    }
    if (input.evalReport.threshold_results.contract_completed) {
        return "refine";
    }
    return "tighten";
};
const qualityAxisLookupFor = (loadedAdapter) => new Map((loadedAdapter?.verification_profile?.profile.quality_contract?.quality_axes ?? []).map((axis) => [axis.axis_id, axis]));
const defaultExpectedChangeForCategory = (category) => {
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
const qualityFindingPriority = (finding) => {
    if (finding.finding_id === "subjective-prototype_delta" ||
        finding.dimension_id === "prototype_delta" ||
        finding.target_check_ids.includes("prototype_delta_present")) {
        return 120;
    }
    if (finding.dimension_id === "subjective_release_quality" ||
        finding.target_check_ids.includes("subjective_thresholds_met")) {
        return 110;
    }
    if (finding.target_check_ids.includes("visual_evidence_present") ||
        finding.target_check_ids.includes("subjective_quality_present")) {
        return 100;
    }
    if (finding.category === "subjective_quality") {
        return 90;
    }
    if (finding.severity === "critical") {
        return 80;
    }
    if (finding.severity === "high") {
        return 70;
    }
    if (finding.category === "proof_signal") {
        return 40;
    }
    return 20;
};
export const buildQualityCritiqueArtifact = (input) => {
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
    const failedCheckIds = new Set(input.evalReport.check_results
        .filter((result) => result.status === "fail")
        .map((result) => result.check_id));
    const findings = [];
    for (const dimension of input.evalReport.dimension_scores.filter((candidate) => candidate.applicable && !candidate.passed)) {
        const targetCheckIds = qualityCritiqueNoteOnlyDimensions.has(dimension.dimension_id)
            ? []
            : carryForwardSafeTargetCheckIds([
                "target_signal_thresholds_met",
                ...dimension.contributing_check_ids.filter((checkId) => failedCheckIds.has(checkId))
            ]);
        findings.push({
            finding_id: `dimension-${dimension.dimension_id}`,
            category: "proof_signal",
            severity: dimension.dimension_id === "contract_execution" ? "critical" : "high",
            summary: `Dimension '${dimension.label}' remains below its floor. ${dimension.detail}`,
            expected_change: dimension.dimension_id === "repair_convergence"
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
            expected_change: axis?.desired_outcome ?? defaultExpectedChangeForCategory(category),
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
    const gradeRoundExecution = input.evalReport.adapter_results.find((execution) => execution.capability === "grade_round");
    const prototypeBaselineValid = gradeRoundExecution?.result.metadata?.prototype_baseline_valid === true;
    const prototypeBaselineSourcePhase = typeof gradeRoundExecution?.result.metadata?.prototype_baseline_source_phase === "string"
        ? gradeRoundExecution.result.metadata.prototype_baseline_source_phase
        : undefined;
    const prototypeBaselineSourceSemantics = isPrototypeBaselineSourceSemantics(gradeRoundExecution?.result.metadata?.prototype_baseline_source_semantics)
        ? gradeRoundExecution.result.metadata.prototype_baseline_source_semantics
        : prototypeBaselineSourceSemanticsForPhase(prototypeBaselineSourcePhase);
    const prototypeBaselineSourceSemanticsDetail = describePrototypeBaselineSourceSemantics(prototypeBaselineSourceSemantics);
    const subjectiveFindings = gradeRoundExecution?.result.subjective_metric_results
        ?.filter((metric) => metric.status === "fail")
        .map((metric) => {
        const axis = metric.quality_axis_id
            ? axisLookup.get(metric.quality_axis_id)
            : undefined;
        const severity = metric.metric_id === "prototype_delta"
            ? "critical"
            : metric.required === false
                ? "medium"
                : "high";
        const expectedChange = metric.metric_id === "prototype_delta"
            ? !prototypeBaselineValid
                ? `Capture or provide a valid initial prototype baseline before scoring prototype_delta again${prototypeBaselineSourcePhase
                    ? `. The current baseline source phase '${prototypeBaselineSourcePhase}' does not count as an initial prototype baseline.`
                    : "."}${prototypeBaselineSourceSemanticsDetail
                    ? ` ${prototypeBaselineSourceSemanticsDetail}`
                    : ""}`
                : "The current result is not yet materially beyond the initial prototype. Raise information architecture, layout, state expression, and finish-line workflow visibility so the shipped surface is visibly more complete than the baseline."
            : metric.recommended_changes[0] ??
                axis?.desired_outcome ??
                `Raise ${metric.label} until it clears the requested threshold.`;
        const targetCheckIds = carryForwardSafeTargetCheckIds(metric.metric_id === "prototype_delta"
            ? ["prototype_baseline_valid", "prototype_delta_present", "target_signal_thresholds_met"]
            : ["subjective_thresholds_met", "target_signal_thresholds_met"]);
        return {
            finding_id: metric.metric_id === "prototype_delta"
                ? "subjective-prototype_delta"
                : `subjective-${metric.metric_id}`,
            category: "subjective_quality",
            severity,
            summary: `${metric.label} scored ${metric.score_out_of_ten}/10; required ${metric.minimum_score_out_of_ten}/10.`,
            expected_change: expectedChange,
            evidence: metric.evidence_paths,
            preserve: unique([...(axis?.preserve_signals ?? []), ...preserveSignals]).slice(0, 8),
            pivot_or_refine: remediationStrategy,
            target_check_ids: targetCheckIds,
            ...(metric.quality_axis_id ? { axis_id: metric.quality_axis_id } : {})
        };
    }) ?? [];
    findings.push(...subjectiveFindings);
    const subjectiveJudgeUnavailable = gradeRoundExecution?.result.metadata?.subjective_judge_unavailable === true ||
        gradeRoundExecution?.result.metadata?.subjective_judge_disabled === true;
    const subjectiveJudgeFailureReason = typeof gradeRoundExecution?.result.metadata?.subjective_judge_unavailable_reason === "string"
        ? gradeRoundExecution.result.metadata.subjective_judge_unavailable_reason
        : typeof gradeRoundExecution?.result.metadata?.subjective_judge_failure_reason === "string"
            ? gradeRoundExecution.result.metadata.subjective_judge_failure_reason
            : undefined;
    const subjectiveJudgeTransportMode = typeof gradeRoundExecution?.result.metadata?.subjective_judge_transport_mode === "string"
        ? gradeRoundExecution.result.metadata.subjective_judge_transport_mode
        : undefined;
    if (subjectiveJudgeUnavailable) {
        findings.push({
            finding_id: "subjective-judge-disabled",
            category: "proof_signal",
            severity: "critical",
            summary: `Status: needs_evaluator. Subjective-quality judge could not complete browser scoring${subjectiveJudgeTransportMode
                ? ` on transport '${subjectiveJudgeTransportMode}'`
                : ""}.` +
                (subjectiveJudgeFailureReason ? ` ${subjectiveJudgeFailureReason}` : ""),
            expected_change: "Allow the read-only subjective-quality judge on the active operator surface or provide HARNESS_SUBJECTIVE_REVIEW_PATH so browser quality scoring can complete honestly.",
            evidence: gradeRoundExecution?.result.evidence_paths ?? [],
            preserve: preserveSignals,
            pivot_or_refine: remediationStrategy,
            target_check_ids: carryForwardSafeTargetCheckIds([
                "subjective_thresholds_met",
                "target_signal_thresholds_met"
            ]),
            dimension_id: "subjective_release_quality"
        });
    }
    if (input.round >= 2 &&
        gradeRoundExecution?.result.metadata?.prototype_baseline_present === true &&
        !prototypeBaselineValid) {
        findings.push({
            finding_id: "prototype-baseline-invalid",
            category: "proof_signal",
            severity: "critical",
            summary: `The stored prototype baseline is not valid for prototype_delta judging${prototypeBaselineSourcePhase ? ` because it came from '${prototypeBaselineSourcePhase}'` : ""}${prototypeBaselineSourceSemanticsDetail
                ? ` ${prototypeBaselineSourceSemanticsDetail}`
                : "."}`,
            expected_change: "Capture or provide a valid initial prototype baseline before relying on prototype_delta. Do not reuse post-mutation screenshots from later rounds as the initial prototype.",
            evidence: gradeRoundExecution?.result.evidence_paths ?? [],
            preserve: preserveSignals,
            pivot_or_refine: remediationStrategy,
            target_check_ids: carryForwardSafeTargetCheckIds([
                "prototype_baseline_valid",
                "prototype_delta_present",
                "target_signal_thresholds_met"
            ]),
            dimension_id: "prototype_delta"
        });
    }
    if (input.evalReport.threshold_gap_details.length > 0) {
        findings.push({
            finding_id: `threshold-gap-round-${String(input.round).padStart(2, "0")}`,
            category: "proof_signal",
            severity: "high",
            summary: input.evalReport.threshold_gap_details.join(" "),
            expected_change: "Raise release quality, proof strength, and live verifier confidence until target signaling thresholds pass.",
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
    findings.sort((left, right) => qualityFindingPriority(right) - qualityFindingPriority(left));
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
            ...(profileQualityContract?.reference_signals?.map((signal) => `Reference signal: ${signal}`) ?? []),
            ...(input.failureLineage?.policy_snapshot?.reasons ?? []).map((reason) => `Policy reason: ${reason}`)
        ]).slice(0, 8)
    };
};
export const buildEvaluatorVerdictArtifact = (input) => ({
    contract_id: input.contractArtifact.contract_id,
    verdict_id: `${input.contractArtifact.contract_id}-verdict`,
    overall_verdict: input.evalReport.overall_verdict,
    findings: [...input.evalReport.blockers, ...input.evalReport.next_actions].slice(0, 8),
    release_blockers: input.evalReport.blockers.slice(0, 6),
    contract_completed: input.evalReport.threshold_results.contract_completed
});
export const buildPatchRequestArtifact = (input) => {
    const environmentBlockedOnly = isPureEnvironmentBlockedLineage(input.failureLineage);
    const failedChecks = input.evalReport.check_results.filter((result) => result.status === "fail" &&
        !nonCarryForwardCheckIds.has(result.check_id) &&
        !(environmentBlockedOnly && result.check_id === "independent_target_probe_present") &&
        result.check_id !== "target_signal_thresholds_met");
    const thresholdFixItems = input.adapterAttached && input.evalReport.threshold_gap_details.length > 0
        ? [
            {
                id: `raise-target-signal-round-${String(input.round).padStart(2, "0")}`,
                why: input.evalReport.threshold_gap_details.join(" "),
                expected_change: "Strengthen live verifier proof, provenance, and release quality until target_signal_thresholds_met passes.",
                target_check_ids: ["target_signal_thresholds_met"],
                source_round: input.round
            }
        ]
        : [];
    const staticContractFixItems = input.staticContractBlockers && input.staticContractBlockers.length > 0
        ? [
            {
                id: `repair-adapter-contract-round-${String(input.round).padStart(2, "0")}`,
                why: input.staticContractBlockers.join(" "),
                expected_change: "Fix the static adapter contract and verification policy before opening another run.",
                target_check_ids: ["proof_boundary_is_independent", "independent_target_probe_present"],
                source_round: input.round
            }
        ]
        : [];
    const environmentBlockers = input.failureLineage?.environment_blocked_probe_ids.length
        ? input.evalReport.core_probe_results
            .filter((probe) => input.failureLineage?.environment_blocked_probe_ids.includes(probe.probe_id))
            .map((probe) => probe.summary)
        : [];
    const environmentFixItems = environmentBlockers.length > 0
        ? [
            {
                id: `classify-environment-blocker-round-${String(input.round).padStart(2, "0")}`,
                why: environmentBlockers.join(" "),
                expected_change: "Treat the blocked validation environment as a runtime constraint, not as a product defect. Re-run in an unblocked environment or swap to a deterministic lane before expanding product remediation.",
                target_check_ids: ["target_signal_thresholds_met"],
                source_round: input.round
            }
        ]
        : [];
    const missingManifestFixItems = input.failureLineage?.missing_target_manifest_keys.length
        ? [
            {
                id: `repair-adapter-runtime-round-${String(input.round).padStart(2, "0")}`,
                why: `Required target manifest keys are missing: ${input.failureLineage.missing_target_manifest_keys.join(", ")}.`,
                expected_change: "Re-contract the adapter runtime surface so release-gate probes can resolve the required manifest keys before another remediation round opens.",
                target_check_ids: ["independent_target_probe_present"],
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
    const adapterDriftFixItems = [
        ...staticContractFixItems,
        ...missingManifestFixItems
    ];
    const nextAction = input.evaluatorVerdictArtifact.contract_completed &&
        !needsTargetSignalRemediation &&
        failedChecks.length === 0
        ? "complete"
        : environmentBlockedOnly && staticContractFixItems.length === 0
            ? "hold"
            : input.adapterDriftReport
                ? "recontract_adapter"
                : "revise";
    const mustFix = nextAction === "complete"
        ? []
        : nextAction === "hold"
            ? environmentFixItems
            : nextAction === "recontract_adapter"
                ? adapterDriftFixItems.length > 0
                    ? adapterDriftFixItems
                    : [
                        {
                            id: `recontract-adapter-round-${String(input.round).padStart(2, "0")}`,
                            why: input.adapterDriftReport?.summary ??
                                "The adapter boundary drifted outside the active remediation envelope.",
                            expected_change: "Re-contract the adapter execution and verification boundary before reopening another remediation round.",
                            target_check_ids: [],
                            source_round: input.round
                        }
                    ]
                : qualityFixItems.length > 0
                    ? [
                        ...staticContractFixItems,
                        ...missingManifestFixItems,
                        ...qualityFixItems,
                        ...environmentFixItems,
                        ...thresholdFixItems,
                    ].slice(0, 4)
                    : failedChecks.length > 0
                        ? [
                            ...staticContractFixItems,
                            ...missingManifestFixItems,
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
                            : missingManifestFixItems.length > 0
                                ? missingManifestFixItems
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
        priority: nextAction === "complete"
            ? "polish"
            : nextAction === "hold"
                ? "important"
                : "blocking",
        remediation_strategy: nextAction === "complete"
            ? "refine"
            : input.qualityCritiqueArtifact.remediation_strategy,
        must_fix: mustFix,
        quality_findings: input.qualityCritiqueArtifact.findings,
        ...(environmentBlockers.length > 0 ? { environment_blockers: environmentBlockers } : {}),
        ...(input.adapterDriftReport
            ? {
                adapter_drift_kind: input.adapterDriftReport.kind,
                adapter_drift_signals: input.adapterDriftReport.signals,
                adapter_drift_summary: input.adapterDriftReport.summary
            }
            : {}),
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
        promotion_rule: nextAction === "complete"
            ? input.evalReport.threshold_results.target_reached_eligible
                ? "Stop after recording terminal target completion for the current attempt."
                : "Stop after recording contract completion for the current attempt without claiming target_reached."
            : nextAction === "hold"
                ? "Stop the run until validation can resume in an unblocked environment or a deterministic lane."
                : nextAction === "recontract_adapter"
                    ? input.adapterDriftReport?.kind === "contract"
                        ? "Stop the run and re-contract the adapter execution or verification boundary before another remediation round opens."
                        : "Stop the run and re-contract the adapter runtime surface before another remediation round opens."
                    : staticContractFixItems.length > 0
                        ? "Stop the run and repair the static adapter contract before retrying."
                        : needsTargetSignalRemediation
                            ? "Open another remediation attempt only if target signal thresholds still need to be raised."
                            : "Open another remediation attempt only if blocking contract checks still remain."
    };
};
export const buildRoundResultArtifact = (input) => {
    const passed = input.evalReport.check_results.filter((result) => result.status === "pass").length;
    const total = input.evalReport.check_results.filter((result) => result.status !== "not_applicable").length || 1;
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
        status: input.evaluatorVerdictArtifact.overall_verdict === "advance"
            ? "advanced"
            : input.evaluatorVerdictArtifact.overall_verdict === "revise"
                ? "revised"
                : "blocked",
        eval_report_path: relative(input.roundDirectory, join(input.roundDirectory, "eval_report.json")).replaceAll("\\", "/"),
        ...(input.scorecardPath
            ? {
                scorecard_path: relative(input.roundDirectory, input.scorecardPath).replaceAll("\\", "/")
            }
            : {}),
        evidence_paths: input.evalReport.evidence_paths,
        check_pass_rate: Number((passed / total).toFixed(3)),
        previous_patch_request_addressed: input.previousPatchRequestAddressed,
        previous_patch_request_resolved: input.previousPatchRequestResolved,
        resolved_check_ids: input.evalReport.resolved_check_ids,
        unresolved_check_ids: input.evalReport.unresolved_check_ids,
        threshold_results: input.evalReport.threshold_results
    };
};
export const writeNegotiationArtifacts = async (input) => {
    const artifacts = artifactsForRound(input.roundDirectory);
    const persistContractReviewArtifact = input.persistContractReviewArtifact ?? true;
    const persistContractAgreementArtifact = input.persistContractAgreementArtifact ?? true;
    const writes = [
        writeJson(artifacts.contract_json_path, input.contractArtifact),
        writeText(artifacts.contract_md_path, `# Round Contract

## Attempt Kind

${input.contractArtifact.attempt_kind}

## Negotiation Mode

${input.contractArtifact.negotiation_mode}

## Continuation Authority

${input.contractArtifact.continuation_authority}

## Recontract Reason

${input.contractArtifact.recontract_reason ?? "none"}

## Recontract Mode

${input.contractArtifact.recontract_mode ? "adapter-only" : "standard"}

## Adapter-Only Paths

${bulletList(input.contractArtifact.adapter_only_paths ?? [])}

## Trajectory

- Mode: ${input.contractArtifact.trajectory.mode}
- Restart from: ${input.contractArtifact.trajectory.restart_from}
- Novelty target: ${input.contractArtifact.trajectory.novelty_target.toFixed(2)}
- Reason: ${input.contractArtifact.trajectory.reason}

## Objective

${input.contractArtifact.objective}

## Focus Areas

${bulletList(input.contractArtifact.focus_areas)}

## Acceptance Checks

${bulletList(input.contractArtifact.acceptance_checks)}

## Release-Gate Checks

${bulletList(input.contractArtifact.release_gate_check_ids)}

## Browser Release-Gate Probes

${bulletList(input.contractArtifact.browser_release_gate_probe_ids)}

## API Release-Gate Probes

${bulletList(input.contractArtifact.api_release_gate_probe_ids)}

## Required Live Verification Modes

${bulletList(input.contractArtifact.required_live_verification_modes)}

## Proof Plan

${bulletList(input.contractArtifact.proof_plan)}

## Pivot Triggers

${bulletList(input.contractArtifact.pivot_triggers)}
`),
        writeJson(artifacts.generator_plan_json_path, input.generatorPlanArtifact),
        writeText(artifacts.generator_plan_md_path, `# Generator Plan

## Intent

${input.generatorPlanArtifact.implementation_intent}

## Remediation Strategy

${input.generatorPlanArtifact.remediation_strategy ?? "tighten"}

## Trajectory

- Mode: ${input.generatorPlanArtifact.trajectory.mode}
- Restart from: ${input.generatorPlanArtifact.trajectory.restart_from}
- Novelty target: ${input.generatorPlanArtifact.trajectory.novelty_target.toFixed(2)}
- Reason: ${input.generatorPlanArtifact.trajectory.reason}

## Target Checks

${bulletList(input.generatorPlanArtifact.target_check_ids)}

## Quality Focus

${bulletList(input.generatorPlanArtifact.quality_focus ?? [])}

## Must Preserve

${bulletList(input.generatorPlanArtifact.must_preserve ?? [])}

## Files To Touch

${bulletList(input.generatorPlanArtifact.files_to_touch)}

## Adapter Actions

${bulletList(input.generatorPlanArtifact.adapter_actions)}
`)
    ];
    if (persistContractReviewArtifact) {
        writes.push(writeJson(artifacts.contract_review_json_path, input.contractReviewArtifact), writeText(artifacts.contract_review_md_path, `# Contract Review\n\n## Decision\n\n${input.contractReviewArtifact.decision}\n\n## Concerns\n\n${bulletList(input.contractReviewArtifact.concerns)}\n\n## Required Changes\n\n${bulletList(input.contractReviewArtifact.required_changes)}\n`));
    }
    if (persistContractAgreementArtifact) {
        writes.push(writeJson(artifacts.contract_agreement_json_path, input.contractAgreementArtifact), writeText(artifacts.contract_agreement_md_path, `# Contract Agreement\n\n## Status\n\n${input.contractAgreementArtifact.status}\n\n## Generator Must Deliver\n\n${bulletList(input.contractAgreementArtifact.generator_must_deliver)}\n\n## Evaluator Must Verify\n\n${bulletList(input.contractAgreementArtifact.evaluator_must_verify)}\n`));
    }
    await Promise.all(writes);
    return artifacts;
};
export const writeRoundEvaluationPlaceholders = async (input) => {
    const artifacts = artifactsForRound(input.roundDirectory);
    const createdAt = new Date().toISOString();
    await Promise.all([
        writeJson(artifacts.evaluator_verdict_json_path, {
            status: "pending",
            pending_phase: "evaluation",
            created_at: createdAt,
            generated_by: "writeRoundEvaluationPlaceholders"
        }),
        writeText(artifacts.evaluator_verdict_md_path, "# Evaluator Verdict\n\nPending final evaluation.\n"),
        writeJson(artifacts.patch_request_json_path, {
            status: "pending",
            pending_phase: "evaluation",
            created_at: createdAt,
            generated_by: "writeRoundEvaluationPlaceholders"
        }),
        writeText(artifacts.patch_request_md_path, "# Patch Request\n\nPending final evaluation.\n"),
        writeJson(artifacts.quality_critique_json_path, {
            status: "pending",
            pending_phase: "evaluation",
            created_at: createdAt,
            generated_by: "writeRoundEvaluationPlaceholders"
        }),
        writeText(artifacts.quality_critique_md_path, "# Quality Critique\n\nPending final evaluation.\n"),
        writeJson(artifacts.trajectory_decision_json_path, {
            status: "pending",
            pending_phase: "evaluation",
            created_at: createdAt,
            generated_by: "writeRoundEvaluationPlaceholders"
        }),
        writeText(artifacts.trajectory_decision_md_path, "# Trajectory Decision\n\nPending final evaluation.\n"),
        writeJson(artifacts.round_result_json_path, {
            status: "pending",
            pending_phase: "evaluation",
            created_at: createdAt,
            generated_by: "writeRoundEvaluationPlaceholders"
        }),
        writeJson(artifacts.eval_report_path, {
            status: "pending",
            pending_phase: "evaluation",
            created_at: createdAt,
            generated_by: "writeRoundEvaluationPlaceholders"
        })
    ]);
    return artifacts;
};
export const writeAdapterMigrationProposalArtifacts = async (input) => {
    const artifacts = artifactsForRound(input.roundDirectory);
    const decisionOptions = decisionOptionsForAdapterMigrationProposal(input.proposal);
    const decisionSemantics = approvalSemanticsForAdapterMigrationProposal(input.proposal);
    const responseTemplate = input.responseTemplate ?? {
        proposal_id: input.proposal.proposal_id,
        decision: input.proposal.force_new_run ? "open_new_run" : "accept",
        note: ""
    };
    await Promise.all([
        writeJson(artifacts.adapter_migration_proposal_json_path, input.proposal),
        writeText(artifacts.adapter_migration_proposal_md_path, renderAdapterMigrationProposalMarkdown(input.roundDirectory, input.proposal)),
        writeText(artifacts.adapter_migration_approval_prompt_path, `# Adapter Migration Approval\n\n## Proposal Summary\n\n${input.proposal.summary}\n\n## Proposal\n\n- JSON: ${relativeArtifactPath(input.roundDirectory, artifacts.adapter_migration_proposal_json_path)}\n- Markdown: ${relativeArtifactPath(input.roundDirectory, artifacts.adapter_migration_proposal_md_path)}\n${input.proposal.patch_bundle_path ? `- Patch bundle: ${relativeArtifactPath(input.roundDirectory, input.proposal.patch_bundle_path)}\n` : ""}\n## Expected Post-Apply Identity\n\n${bulletList(identitySnapshotLines(input.proposal.expected_post_apply_identity))}\n\n## Allowed decisions\n\n${bulletList(decisionOptions.map((decision) => `\`${decision}\``))}\n\n## Decision semantics\n\n${bulletList(decisionOptions.map((decision) => `\`${decision}\`: ${decisionSemantics[decision]}`))}\n\n## Response contract\n\nWrite JSON to ${relativeArtifactPath(input.roundDirectory, artifacts.adapter_migration_response_json_path)} with:\n\n\`\`\`json\n${JSON.stringify(responseTemplate, null, 2)}\n\`\`\`\n`),
        writeText(artifacts.adapter_migration_response_md_path, `# Adapter Migration Response\n\nWrite JSON to \`${relativeArtifactPath(input.roundDirectory, artifacts.adapter_migration_response_json_path)}\` with one of these decisions: ${decisionOptions.join(", ")}.\n`),
        writeText(artifacts.adapter_migration_instructions_path, `# Adapter Migration Instructions\n\n- Treat this as an adapter recontract decision, not a product patch request.\n- Review the proposal artifacts before responding.\n- Same-run in-place migration is ${input.proposal.same_run_eligible ? "eligible" : "not eligible"} for this proposal.\n- Expected post-apply identity:\n${bulletList(identitySnapshotLines(input.proposal.expected_post_apply_identity))}\n- Decision semantics:\n${bulletList(decisionOptions.map((decision) => `\`${decision}\`: ${decisionSemantics[decision]}`))}\n- If a patch bundle is authored, it lives at ${relativeArtifactPath(input.roundDirectory, artifacts.adapter_migration_patch_path)}.\n- Same-run generated-local bundles must stay inside the generated adapter write surface.\n- Proposal-only external bundles are advisory: apply them in the external adapter workspace, verify the expected post-apply identity, and resume this run only after that external/manual work is complete.\n`)
    ]);
    return artifacts;
};
export const writeRoundArtifacts = async (input) => {
    const artifacts = artifactsForRound(input.roundDirectory);
    await Promise.all([
        writeJson(artifacts.evaluator_verdict_json_path, input.evaluatorVerdictArtifact),
        writeText(artifacts.evaluator_verdict_md_path, `# Evaluator Verdict\n\n## Overall Verdict\n\n${input.evaluatorVerdictArtifact.overall_verdict}\n\n## Findings\n\n${bulletList(input.evaluatorVerdictArtifact.findings)}\n`),
        writeJson(artifacts.patch_request_json_path, input.patchRequestArtifact),
        writeText(artifacts.patch_request_md_path, `# Patch Request\n\n## Next Action\n\n${input.patchRequestArtifact.next_action}\n\n## Must Fix\n\n${input.patchRequestArtifact.must_fix
            .map((item) => `- ${item.id}: ${item.expected_change} [targets: ${item.target_check_ids.join(", ") || "none"}]`)
            .join("\n") || "- none"}\n\n## Remediation Strategy\n\n${input.patchRequestArtifact.remediation_strategy ?? "tighten"}\n\n## Adapter Drift\n\n${input.patchRequestArtifact.adapter_drift_summary ?? "none"}\n\n## Environment Blockers\n\n${bulletList(input.patchRequestArtifact.environment_blockers ?? [])}\n`),
        writeJson(artifacts.quality_critique_json_path, input.qualityCritiqueArtifact),
        writeText(artifacts.quality_critique_md_path, `# Quality Critique\n\n## Remediation Strategy\n\n${input.qualityCritiqueArtifact.remediation_strategy}\n\n## Quality Focus\n\n${bulletList(input.qualityCritiqueArtifact.quality_focus)}\n\n## Preserve Signals\n\n${bulletList(input.qualityCritiqueArtifact.preserve_signals)}\n\n## Findings\n\n${input.qualityCritiqueArtifact.findings
            .map((finding) => `- ${finding.finding_id}: ${finding.expected_change} [${finding.category}/${finding.severity}]`)
            .join("\n") || "- none"}\n`),
        writeJson(artifacts.trajectory_decision_json_path, input.trajectoryDecisionArtifact),
        writeText(artifacts.trajectory_decision_md_path, `# Trajectory Decision\n\n## Mode\n\n${input.trajectoryDecisionArtifact.mode}\n\n## Restart From\n\n${input.trajectoryDecisionArtifact.restart_from}\n\n## Frontier\n\n- Current head: ${input.trajectoryDecisionArtifact.frontier.current_head}\n- Last stable: ${input.trajectoryDecisionArtifact.frontier.last_stable ?? "none"}\n- Best passing: ${input.trajectoryDecisionArtifact.frontier.best_passing ?? "none"}\n\n## Preserve Signals\n\n${bulletList(input.trajectoryDecisionArtifact.preserve_signals)}\n\n## Discardable Surface\n\n${bulletList(input.trajectoryDecisionArtifact.discardable_surface)}\n\n## Novelty Target\n\n${input.trajectoryDecisionArtifact.novelty_target.toFixed(2)}\n\n## Reason\n\n${input.trajectoryDecisionArtifact.reason}\n\n## Anchor Reason\n\n${input.trajectoryDecisionArtifact.anchor_reason}\n`),
        writeJson(artifacts.round_result_json_path, input.roundResultArtifact),
        writeJson(artifacts.eval_report_path, input.evalReport),
        ...(input.failureLineage
            ? [writeJson(artifacts.failure_lineage_path, input.failureLineage)]
            : []),
        ...(input.adapterDriftReport
            ? [
                writeJson(artifacts.adapter_drift_report_json_path, input.adapterDriftReport),
                writeText(artifacts.adapter_drift_report_md_path, `# Adapter Drift Report\n\n## Summary\n\n${input.adapterDriftReport.summary}\n\n## Kind\n\n${input.adapterDriftReport.kind}\n\n## Signals\n\n${bulletList(input.adapterDriftReport.signals)}\n\n## Reasons\n\n${bulletList(input.adapterDriftReport.reasons)}\n\n## Suggested Updates\n\n${bulletList(input.adapterDriftReport.suggested_updates)}\n`)
            ]
            : []),
        ...(input.adapterMigrationProposal
            ? [
                writeJson(artifacts.adapter_migration_proposal_json_path, input.adapterMigrationProposal),
                writeText(artifacts.adapter_migration_proposal_md_path, renderAdapterMigrationProposalMarkdown(input.roundDirectory, input.adapterMigrationProposal))
            ]
            : []),
        ...(input.adapterMigrationApplied
            ? [
                writeJson(artifacts.adapter_migration_applied_json_path, input.adapterMigrationApplied),
                writeText(artifacts.adapter_migration_applied_md_path, `# Adapter Migration Applied\n\n## Proposal\n\n${input.adapterMigrationApplied.proposal_id}\n\n## Apply Mode\n\n${input.adapterMigrationApplied.apply_mode}\n\n## Same Run Authorized\n\n${input.adapterMigrationApplied.same_run_authorized ? "yes" : "no"}\n\n## Changed Files\n\n${bulletList(input.adapterMigrationApplied.changed_files)}\n`)
            ]
            : [])
    ]);
    return artifacts;
};
//# sourceMappingURL=protocol-artifacts.js.map