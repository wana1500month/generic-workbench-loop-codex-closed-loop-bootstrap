import { existsSync } from "node:fs";
import { extname, isAbsolute, join, resolve } from "node:path";
import { repoRoot } from "../file-system.js";
export const adapterContractDocPath = join(repoRoot, "ADAPTER_CONTRACT.md");
export const adapterExamplePath = join(repoRoot, "adapter.example.json");
export const adapterRuntimePath = join(repoRoot, "packages", "loop-orchestrator", "src", "adapter-runtime.ts");
export const placeholderSurfaceChecks = new Set([
    "planner_context_surface_reserved",
    "generator_brief_surface_reserved",
    "qa_review_surface_reserved",
    "evaluator_verdict_surface_reserved",
    "patch_request_surface_reserved",
    "eval_report_surface_reserved",
    "controller_decision_surface_reserved"
]);
export const artifactOnlyChecks = new Set([
    "planner_brief_written",
    "plan_written",
    "round_contract_written",
    "contract_review_written",
    "contract_agreement_written",
    "generator_plan_written",
    ...placeholderSurfaceChecks
]);
export const knownCheckIds = new Set([
    ...artifactOnlyChecks,
    "round_contract_is_testable",
    "round_contract_scopes_release_qa",
    "contract_review_quality",
    "agreement_matches_review",
    "handoff_is_resumable",
    "previous_patch_request_addressed",
    "previous_patch_request_resolved",
    "release_blockers_recorded",
    "adapter_boundary_documented",
    "adapter_runtime_present",
    "adapter_example_written",
    "adapter_execution_healthy",
    "adapter_claims_are_honest",
    "proof_provenance_is_attested",
    "live_verification_present",
    "adapter_evidence_is_meaningful",
    "proof_boundary_is_independent",
    "adapter_criteria_are_grounded",
    "adapter_criteria_match_profile",
    "independent_target_probe_present",
    "subjective_quality_present",
    "subjective_thresholds_met",
    "visual_evidence_present",
    "prototype_baseline_present",
    "prototype_baseline_valid",
    "prototype_delta_present",
    "build_brief_matches_user_intake",
    "target_root_created_or_updated",
    "core_workflows_have_user_visible_paths",
    "local_runtime_starts",
    "browser_journey_evidence_present",
    "no_scope_drift_from_build_brief",
    "target_signal_thresholds_met"
]);
export const nonCarryForwardDerivedChecks = new Set([
    "previous_patch_request_addressed",
    "previous_patch_request_resolved"
]);
export const proofEvaluatorChecks = new Set([
    "adapter_execution_healthy",
    "adapter_claims_are_honest",
    "proof_provenance_is_attested",
    "live_verification_present",
    "adapter_evidence_is_meaningful",
    "proof_boundary_is_independent",
    "adapter_criteria_are_grounded",
    "adapter_criteria_match_profile",
    "independent_target_probe_present",
    "subjective_quality_present",
    "subjective_thresholds_met",
    "visual_evidence_present",
    "prototype_baseline_present",
    "prototype_baseline_valid",
    "prototype_delta_present"
]);
export const nonScoringDerivedChecks = new Set([
    "target_signal_thresholds_met",
    "previous_patch_request_addressed",
    "previous_patch_request_resolved"
]);
export const liveVerificationKinds = new Set([
    "interaction-log",
    "verification-log",
    "browser-trace",
    "playwright-trace",
    "api-log",
    "db-log",
    "transcript",
    "shell-session"
]);
export const proofCapabilityKinds = new Set(["capture_evidence", "run_checks", "grade_round"]);
export const releaseGateCoreProbeModes = new Set([
    "http_json",
    "browser_journey",
    "shell_command",
    "file_contains",
    "json_value"
]);
export const releaseGateCoreProbeModeList = "'http_json', 'browser_journey', 'shell_command', 'file_contains', or 'json_value'";
export const unique = (values) => [...new Set(values)];
export const isProofCapabilityName = (value) => proofCapabilityKinds.has(value);
export const proofExecutionsFor = (adapterExecutions) => adapterExecutions.filter((execution) => execution.capability === "capture_evidence" ||
    execution.capability === "run_checks" ||
    execution.capability === "grade_round");
export const buildProofEvidenceOriginIndex = (adapterExecutions) => {
    const index = new Map();
    const remember = (path, capability) => {
        if (!path || !isProofCapabilityName(capability)) {
            return;
        }
        const current = index.get(path) ?? new Set();
        current.add(capability);
        index.set(path, current);
    };
    for (const execution of proofExecutionsFor(adapterExecutions)) {
        for (const evidence of execution.verified_evidence) {
            remember(evidence.path, evidence.witness?.capability ?? evidence.produced_by_capability);
            if (evidence.witness) {
                remember(evidence.witness.interaction_log_path, evidence.witness.capability);
                for (const step of evidence.witness.steps) {
                    for (const artifactPath of step.artifact_paths) {
                        remember(artifactPath, evidence.witness.capability);
                    }
                }
            }
        }
    }
    return index;
};
export const commandTokens = (command) => command.match(/"[^"]+"|'[^']+'|\S+/g)?.map((token) => token.replace(/^['"]|['"]$/g, "")) ?? [];
export const commandVectorFor = (input) => input.args && input.args.length > 0 ? [input.command, ...input.args] : commandTokens(input.command);
export const commandTargetFingerprint = (input) => {
    const tokens = commandVectorFor(input);
    if (tokens.length === 0) {
        return "raw:";
    }
    const commandName = tokens[0].toLowerCase();
    const candidateScript = tokens[1];
    const scriptLike = candidateScript &&
        [".js", ".cjs", ".mjs", ".ts", ".ps1", ".sh", ".cmd", ".bat", ".py"].includes(extname(candidateScript).toLowerCase());
    if (scriptLike &&
        [
            "node",
            "node.exe",
            "bun",
            "bun.exe",
            "python",
            "python3",
            "python.exe",
            "bash",
            "sh",
            "powershell",
            "powershell.exe",
            "cmd",
            "cmd.exe"
        ].includes(commandName)) {
        const scriptPath = isAbsolute(candidateScript)
            ? resolve(candidateScript)
            : resolve(input.cwd ?? input.baseDirectory, candidateScript);
        return `${commandName}:${scriptPath}`;
    }
    return `raw:${commandVectorFor(input).join("\u0000").trim().toLowerCase()}`;
};
export const observedValueMatches = (operator, observedValue, expectedValue) => {
    switch (operator) {
        case "equals":
            return observedValue === expectedValue;
        case "contains":
            return observedValue.includes(expectedValue);
        case "regex":
            try {
                return new RegExp(expectedValue).test(observedValue);
            }
            catch {
                return false;
            }
        case "number_gte": {
            const observed = Number(observedValue);
            const expected = Number(expectedValue);
            return Number.isFinite(observed) && Number.isFinite(expected) && observed >= expected;
        }
        case "number_lte": {
            const observed = Number(observedValue);
            const expected = Number(expectedValue);
            return Number.isFinite(observed) && Number.isFinite(expected) && observed <= expected;
        }
        default:
            return false;
    }
};
export const checkResult = (check_id, status, detail) => ({
    check_id,
    status,
    detail
});
export const isPassingCheck = (result) => result.status === "pass";
export const isFailingCheck = (result) => result.status === "fail";
export const isSatisfiedCheck = (result) => result.status !== "fail";
export const isApplicableCheck = (result) => result.status !== "not_applicable";
export const ratioScore = (passedItems, totalItems) => totalItems === 0 ? 0 : passedItems / totalItems;
export const strictPartialCreditScore = (passedItems, totalItems) => totalItems === 0
    ? 0
    : Number(Math.pow(ratioScore(passedItems, totalItems), 2).toFixed(3));
export const scoreFromResults = (results, options) => {
    const applicableResults = results.filter(isApplicableCheck);
    const applicableCount = applicableResults.length;
    if (applicableCount === 0) {
        return 0;
    }
    const passedCount = applicableResults.filter(isPassingCheck).length;
    return options?.strictPartialCredit
        ? strictPartialCreditScore(passedCount, applicableCount)
        : Number(ratioScore(passedCount, applicableCount).toFixed(3));
};
export const isKnownCheck = (checkId) => knownCheckIds.has(checkId);
export const pathExists = (path) => (path ? existsSync(path) : false);
export const requiredProofCapabilities = ["capture_evidence", "run_checks", "grade_round"];
export const requiredCoreProbesFor = (loadedAdapter) => loadedAdapter?.verification_profile?.profile.core_probes?.filter((probe) => probe.required !== false &&
    (loadedAdapter.verification_profile?.profile.target_reached_requires_core_probes ?? true)) ?? [];
export const coreProbeRole = (probe) => probe.role ?? (releaseGateCoreProbeModes.has(probe.mode) ? "release_gate" : "supporting");
export const probeSemanticLevel = (probe) => probe.semantic_level ??
    (releaseGateCoreProbeModes.has(probe.mode) ? "feature" : "liveness");
export const assertionIdForCriterion = (criterion) => criterion.assertion_id?.trim() || criterion.criterion_id;
export const releaseAssertionIdForProbe = (probe) => coreProbeRole(probe) === "release_gate" &&
    (probeSemanticLevel(probe) === "feature" || probeSemanticLevel(probe) === "workflow")
    ? probe.assertion_id?.trim()
    : undefined;
export const requiredReleaseGateCoreProbesFor = (loadedAdapter) => requiredCoreProbesFor(loadedAdapter).filter((probe) => coreProbeRole(probe) === "release_gate" && releaseGateCoreProbeModes.has(probe.mode));
export const requiredBrowserJourneyReleaseProbesFor = (loadedAdapter) => requiredReleaseGateCoreProbesFor(loadedAdapter).filter((probe) => probe.mode === "browser_journey");
export const requiredHttpJsonReleaseProbesFor = (loadedAdapter) => requiredReleaseGateCoreProbesFor(loadedAdapter).filter((probe) => probe.mode === "http_json");
export const minimumFeatureReleaseAssertionsFor = (loadedAdapter) => loadedAdapter?.verification_profile?.profile.minimum_feature_release_assertions ?? 2;
export const minimumAssertionTagCountsFor = (loadedAdapter) => loadedAdapter?.verification_profile?.profile.minimum_assertion_tag_counts ?? {};
export const expectedTargetSurfacesFor = (loadedAdapter) => new Set(loadedAdapter?.verification_profile?.profile.expected_target_surfaces ?? []);
export const normalizedWeights = (weights, fallback) => {
    const merged = { ...fallback, ...weights };
    const total = Object.values(merged).reduce((sum, value) => sum + value, 0);
    if (total <= 0) {
        return fallback;
    }
    return Object.fromEntries(Object.entries(merged).map(([key, value]) => [
        key,
        value / total
    ]));
};
export const proofScoreWeightsFor = (loadedAdapter) => {
    const externalGradeConfigured = loadedAdapter?.verification_profile?.profile.score_policy?.proof_weights?.external_grade !==
        undefined;
    const fallback = externalGradeConfigured
        ? {
            proof_pass_rate: 0.25,
            criterion_pass_rate: 0.35,
            threshold_verdict: 0.1,
            external_grade: 0.3
        }
        : {
            proof_pass_rate: 0.45,
            criterion_pass_rate: 0.4,
            threshold_verdict: 0.15,
            external_grade: 0
        };
    return normalizedWeights(loadedAdapter?.verification_profile?.profile.score_policy?.proof_weights ?? {}, fallback);
};
export const releaseScoreWeightsFor = (loadedAdapter) => normalizedWeights(loadedAdapter?.verification_profile?.profile.score_policy?.release_weights ?? {}, {
    control_plane_score: 0.6,
    proof_score: 0.4
});
export const visualEvidenceExtensions = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".bmp"
]);
export const isVisualEvidencePath = (path) => {
    const normalized = path.toLowerCase();
    if (visualEvidenceExtensions.has(extname(normalized))) {
        return true;
    }
    return normalized.endsWith(".zip") && normalized.includes("trace");
};
export const successfulGradeRoundExecutionFor = (adapterExecutions) => adapterExecutions.find((execution) => execution.capability === "grade_round" && execution.result.ok);
export const assertionTagLabel = (tag) => {
    switch (tag) {
        case "browser":
            return "browser";
        case "api":
            return "api";
        case "persistence":
            return "persistence";
        case "error_path":
            return "error-path";
        case "auth":
            return "auth";
        case "consistency":
            return "consistency";
        case "workflow_multi_step":
            return "workflow-multi-step";
        case "latency_budget":
            return "latency-budget";
        case "undo_redo":
            return "undo-redo";
        case "grounded_tool_use":
            return "grounded-tool-use";
    }
};
export const configuredReleaseAssertionIdsForTag = (loadedAdapter, tag) => new Set(requiredReleaseGateCoreProbesFor(loadedAdapter).flatMap((probe) => probe.assertion_id && probe.assertion_tags?.includes(tag) ? [probe.assertion_id] : []));
export const releaseGateAssertionIdsFor = (loadedAdapter) => new Set(requiredReleaseGateCoreProbesFor(loadedAdapter)
    .map((probe) => releaseAssertionIdForProbe(probe))
    .filter((assertionId) => Boolean(assertionId)));
export const hardReleaseAssertionIdsFor = (loadedAdapter) => {
    const releaseAssertionIds = releaseGateAssertionIdsFor(loadedAdapter);
    const criteria = loadedAdapter?.verification_profile?.profile.criteria ?? [];
    return new Set(criteria
        .filter((criterion) => criterion.hard)
        .map((criterion) => assertionIdForCriterion(criterion))
        .filter((assertionId) => releaseAssertionIds.has(assertionId)));
};
export const passedFeatureReleaseAssertionIds = (input) => {
    const profile = input.loadedAdapter?.verification_profile?.profile;
    const probeById = new Map(profile?.core_probes?.map((probe) => [probe.probe_id, probe]) ?? []);
    return new Set(input.coreProbeResults.flatMap((result) => {
        const probe = probeById.get(result.probe_id);
        if (!probe || !result.ok || result.evidence_paths.length === 0) {
            return [];
        }
        const assertionId = releaseAssertionIdForProbe(probe);
        return assertionId ? [assertionId] : [];
    }));
};
export const passedBrowserJourneyAssertionIds = (input) => {
    const resultByProbeId = new Map(input.coreProbeResults.map((result) => [result.probe_id, result]));
    return new Set(requiredBrowserJourneyReleaseProbesFor(input.loadedAdapter).flatMap((probe) => {
        const result = resultByProbeId.get(probe.probe_id);
        return result?.ok && result.evidence_paths.length > 0 && probe.assertion_id
            ? [probe.assertion_id]
            : [];
    }));
};
export const passedHttpJsonAssertionIds = (input) => {
    const resultByProbeId = new Map(input.coreProbeResults.map((result) => [result.probe_id, result]));
    return new Set(requiredHttpJsonReleaseProbesFor(input.loadedAdapter).flatMap((probe) => {
        const result = resultByProbeId.get(probe.probe_id);
        return result?.ok && result.evidence_paths.length > 0 && probe.assertion_id
            ? [probe.assertion_id]
            : [];
    }));
};
export const passedReleaseAssertionIdsForTag = (input) => {
    const profile = input.loadedAdapter?.verification_profile?.profile;
    const probeById = new Map(profile?.core_probes?.map((probe) => [probe.probe_id, probe]) ?? []);
    return new Set(input.coreProbeResults.flatMap((result) => {
        const probe = probeById.get(result.probe_id);
        if (!probe ||
            !result.ok ||
            result.evidence_paths.length === 0 ||
            !probe.assertion_id ||
            !probe.assertion_tags?.includes(input.tag)) {
            return [];
        }
        return [probe.assertion_id];
    }));
};
export const verificationBoundaryIssues = (loadedAdapter) => {
    if (!loadedAdapter) {
        return [];
    }
    const issues = [];
    if (!loadedAdapter.verification_profile) {
        issues.push("No core-owned evaluator profile is attached, so target-specific criteria remain outside the harness trust domain.");
    }
    else if (loadedAdapter.verification_profile_source !== "core") {
        issues.push(`verification_profile '${loadedAdapter.verification_profile.profile_path}' was loaded from the adapter trust domain. target_reached requires a core-owned evaluator profile selected by the harness.`);
    }
    const verificationProvider = loadedAdapter.contract.verification_provider;
    if (!verificationProvider) {
        issues.push("No verification_provider is attached, so target proof would run inside the executor trust domain.");
    }
    else {
        if (!verificationProvider.provider_id?.trim()) {
            issues.push("verification_provider.provider_id is missing or empty.");
        }
        if (verificationProvider.provider_id === loadedAdapter.contract.adapter_id) {
            issues.push("verification_provider.provider_id must differ from adapter_id so proof stays in a separate trust domain.");
        }
        const missingCapabilities = requiredProofCapabilities.filter((capability) => !verificationProvider.capabilities?.[capability]);
        if (missingCapabilities.length > 0) {
            issues.push(`verification_provider is missing proof capabilities: ${missingCapabilities.join(", ")}.`);
        }
        const executorFingerprints = unique(Object.values(loadedAdapter.contract.capabilities)
            .filter((spec) => Boolean(spec))
            .map((spec) => commandTargetFingerprint({
            command: spec.command,
            args: spec.args,
            baseDirectory: loadedAdapter.base_directory,
            cwd: spec.cwd ? resolve(loadedAdapter.base_directory, spec.cwd) : undefined
        })));
        const overlappingVerifierCommands = requiredProofCapabilities.filter((capability) => {
            const spec = verificationProvider.capabilities?.[capability];
            if (!spec) {
                return false;
            }
            const verifierFingerprint = commandTargetFingerprint({
                command: spec.command,
                args: spec.args,
                baseDirectory: loadedAdapter.base_directory,
                cwd: spec.cwd ? resolve(loadedAdapter.base_directory, spec.cwd) : undefined
            });
            return executorFingerprints.includes(verifierFingerprint);
        });
        if (overlappingVerifierCommands.length > 0) {
            issues.push(`verification_provider must use command targets distinct from executor capabilities for: ${overlappingVerifierCommands.join(", ")}.`);
        }
    }
    if (loadedAdapter.verification_profile &&
        (!loadedAdapter.verification_profile.profile.required_live_verification_modes ||
            loadedAdapter.verification_profile.profile.required_live_verification_modes.length === 0)) {
        issues.push("verification_profile.required_live_verification_modes is missing, so the core cannot demand a specific live verification modality.");
    }
    const requiredCoreProbes = requiredCoreProbesFor(loadedAdapter);
    if (loadedAdapter.verification_profile &&
        (loadedAdapter.verification_profile.profile.target_reached_requires_core_probes ?? true) &&
        requiredCoreProbes.length === 0) {
        issues.push("verification_profile.core_probes is missing, so the core cannot generate independent target evidence for target_reached.");
    }
    if (loadedAdapter.verification_profile &&
        (loadedAdapter.verification_profile.profile.target_reached_requires_core_probes ?? true) &&
        requiredCoreProbes.length > 0 &&
        requiredReleaseGateCoreProbesFor(loadedAdapter).length === 0) {
        issues.push(`verification_profile.core_probes must include at least one required release-gate probe using mode ${releaseGateCoreProbeModeList} before target_reached can be claimed.`);
    }
    const verificationProfile = loadedAdapter.verification_profile?.profile;
    const expectedSurfaces = expectedTargetSurfacesFor(loadedAdapter);
    const requiredReleaseGateProbes = requiredReleaseGateCoreProbesFor(loadedAdapter);
    for (const probe of requiredReleaseGateProbes) {
        if (!releaseGateCoreProbeModes.has(probe.mode)) {
            issues.push(`verification_profile core probe '${probe.probe_id}' must use mode ${releaseGateCoreProbeModeList} for release-gate use.`);
        }
        if ((probe.mode === "http_json" || probe.mode === "browser_journey") &&
            !probe.target_manifest_key) {
            issues.push(`verification_profile core probe '${probe.probe_id}' must declare target_manifest_key for release-gate use.`);
        }
        if (!probe.assertion_id?.trim()) {
            issues.push(`verification_profile core probe '${probe.probe_id}' must declare assertion_id for release-gate use.`);
        }
        if (probeSemanticLevel(probe) === "liveness") {
            issues.push(`verification_profile core probe '${probe.probe_id}' cannot use semantic_level 'liveness' for release-gate use.`);
        }
        if (probe.mode === "http_json" && (!probe.json_path || probe.expected_value === undefined)) {
            issues.push(`verification_profile core probe '${probe.probe_id}' must declare json_path and expected_value for mode 'http_json'.`);
        }
        if (probe.mode === "browser_journey" && (!probe.steps || probe.steps.length === 0)) {
            issues.push(`verification_profile core probe '${probe.probe_id}' must declare at least one browser journey step.`);
        }
    }
    if (verificationProfile &&
        (verificationProfile.target_reached_requires_core_probes ?? true)) {
        const releaseAssertionIds = releaseGateAssertionIdsFor(loadedAdapter);
        if (releaseAssertionIds.size < minimumFeatureReleaseAssertionsFor(loadedAdapter)) {
            issues.push(`verification_profile needs at least ${minimumFeatureReleaseAssertionsFor(loadedAdapter)} distinct feature/workflow release assertions, but only ${releaseAssertionIds.size} were configured.`);
        }
    }
    if (expectedSurfaces.has("browser")) {
        if (!verificationProfile?.required_live_verification_modes?.includes("browser")) {
            issues.push("verification_profile expects a browser surface, but required_live_verification_modes does not include 'browser'.");
        }
        if (requiredBrowserJourneyReleaseProbesFor(loadedAdapter).length === 0) {
            issues.push("verification_profile expects a browser surface, but no required browser_journey release-gate probe is configured.");
        }
    }
    if (expectedSurfaces.has("api")) {
        if (!verificationProfile?.required_live_verification_modes?.includes("api")) {
            issues.push("verification_profile expects an API surface, but required_live_verification_modes does not include 'api'.");
        }
        if (requiredHttpJsonReleaseProbesFor(loadedAdapter).length === 0) {
            issues.push("verification_profile expects an API surface, but no required http_json release-gate probe is configured.");
        }
    }
    const minimumAssertionTagCounts = minimumAssertionTagCountsFor(loadedAdapter);
    if (minimumAssertionTagCounts.browser && !expectedSurfaces.has("browser")) {
        issues.push("verification_profile cannot require browser assertion coverage without declaring browser in expected_target_surfaces.");
    }
    if (minimumAssertionTagCounts.api && !expectedSurfaces.has("api")) {
        issues.push("verification_profile cannot require api assertion coverage without declaring api in expected_target_surfaces.");
    }
    if (minimumAssertionTagCounts.persistence && !expectedSurfaces.has("api")) {
        issues.push("verification_profile cannot require persistence assertion coverage without declaring api in expected_target_surfaces.");
    }
    for (const [tag, minimumCount] of Object.entries(minimumAssertionTagCounts)) {
        const configuredCount = configuredReleaseAssertionIdsForTag(loadedAdapter, tag).size;
        if (configuredCount < minimumCount) {
            issues.push(`verification_profile requires at least ${minimumCount} configured ${assertionTagLabel(tag)} release assertion(s), but only ${configuredCount} were configured.`);
        }
    }
    return issues;
};
export const fileWrittenCheck = (check_id, path, label) => checkResult(check_id, pathExists(path) ? "pass" : "fail", pathExists(path) ? `${label} exists.` : `${label} is missing.`);
export const fileSurfaceReservedCheck = (check_id, path, label) => checkResult(check_id, pathExists(path) ? "pass" : "fail", pathExists(path)
    ? `${label} surface exists for placeholder or final content.`
    : `${label} surface is missing.`);
export const adapterHonestyCheck = (input) => (() => {
    if (!input.loadedAdapter) {
        return checkResult("adapter_claims_are_honest", input.adapterExecutions.length === 0 ? "pass" : "fail", input.adapterExecutions.length === 0
            ? "No adapter-owned runtime proof was claimed while no adapter is attached."
            : "Adapter capability outputs appeared even though no adapter is attached.");
    }
    if (input.adapterExecutions.length === 0) {
        return checkResult("adapter_claims_are_honest", "pass", "No adapter capability claims were recorded for this round.");
    }
    const validationErrors = input.adapterExecutions.flatMap((execution) => execution.validation_errors.map((error) => `${execution.capability}: ${error}`));
    return checkResult("adapter_claims_are_honest", validationErrors.length === 0 ? "pass" : "fail", validationErrors.length === 0
        ? "Adapter claims passed schema validation and every cited evidence path resolved."
        : `Adapter claims failed validation: ${validationErrors.join(" ")}`);
})();
export const proofBoundaryIndependenceCheck = (input) => (() => {
    if (!input.loadedAdapter) {
        return checkResult("proof_boundary_is_independent", input.adapterExecutions.length === 0 ? "pass" : "fail", input.adapterExecutions.length === 0
            ? "No external proof boundary was required for this round."
            : "Adapter executions appeared even though no adapter is attached.");
    }
    const boundaryIssues = verificationBoundaryIssues(input.loadedAdapter);
    const proofExecutions = input.adapterExecutions.filter((execution) => execution.capability === "capture_evidence" ||
        execution.capability === "run_checks" ||
        execution.capability === "grade_round");
    const runtimeIssues = [];
    const verifierId = input.loadedAdapter.contract.verification_provider?.provider_id;
    for (const execution of proofExecutions) {
        if (execution.provider_role !== "verifier") {
            runtimeIssues.push(`Capability '${execution.capability}' executed under provider role '${execution.provider_role}' instead of 'verifier'.`);
        }
        if (verifierId && execution.provider_id !== verifierId) {
            runtimeIssues.push(`Capability '${execution.capability}' executed under provider '${execution.provider_id}' instead of verifier '${verifierId}'.`);
        }
    }
    const failures = [...boundaryIssues, ...runtimeIssues];
    return checkResult("proof_boundary_is_independent", failures.length === 0 ? "pass" : "fail", failures.length === 0
        ? `Proof capabilities are routed through verifier '${verifierId ?? "unknown"}' instead of the executor boundary.`
        : `Proof boundary is not independent: ${failures.join(" ")}`);
})();
export const proofProvenanceAttestationCheck = (input) => (() => {
    if (!input.loadedAdapter) {
        return checkResult("proof_provenance_is_attested", input.adapterExecutions.length === 0 ? "pass" : "fail", input.adapterExecutions.length === 0
            ? "No verifier provenance was required for this round."
            : "Adapter executions appeared even though no adapter is attached.");
    }
    const proofExecutions = input.adapterExecutions.filter((execution) => execution.capability === "capture_evidence" ||
        execution.capability === "run_checks" ||
        execution.capability === "grade_round");
    if (proofExecutions.length === 0) {
        return checkResult("proof_provenance_is_attested", "fail", "No verifier proof executions were available to attest provenance.");
    }
    const failures = [];
    const originIndex = buildProofEvidenceOriginIndex(proofExecutions);
    for (const execution of proofExecutions) {
        if (!execution.attestation) {
            failures.push(`Capability '${execution.capability}' is missing execution attestation.`);
            continue;
        }
        if (!execution.attestation.command_sha256) {
            failures.push(`Capability '${execution.capability}' is missing a command hash.`);
        }
        if (!execution.attestation.result_sha256) {
            failures.push(`Capability '${execution.capability}' is missing a result hash.`);
        }
        if (!execution.attestation.stdout_sha256 || !execution.attestation.stderr_sha256) {
            failures.push(`Capability '${execution.capability}' is missing stdout/stderr hash attestation.`);
        }
        if (!pathExists(execution.attestation.stdout_path) ||
            !pathExists(execution.attestation.stderr_path)) {
            failures.push(`Capability '${execution.capability}' is missing persisted stdout/stderr logs for provenance review.`);
        }
        for (const evidence of execution.verified_evidence) {
            if (!evidence.sha256) {
                failures.push(`Capability '${execution.capability}' evidence '${evidence.path}' is missing a sha256 attestation.`);
            }
            if (!isProofCapabilityName(evidence.produced_by_capability)) {
                failures.push(`Capability '${execution.capability}' evidence '${evidence.path}' was attributed to non-proof capability '${evidence.produced_by_capability}'.`);
                continue;
            }
            if (evidence.produced_by_capability !== execution.capability &&
                !originIndex.get(evidence.path)?.has(evidence.produced_by_capability)) {
                failures.push(`Capability '${execution.capability}' cited upstream evidence '${evidence.path}' without an attested proof origin for '${evidence.produced_by_capability}'.`);
            }
            if (evidence.witness) {
                if (!originIndex.get(evidence.path)?.has(evidence.witness.capability)) {
                    failures.push(`Verification witness '${evidence.witness.witness_id}' is not anchored to an attested proof origin.`);
                }
                if (!originIndex
                    .get(evidence.witness.interaction_log_path)
                    ?.has(evidence.witness.capability)) {
                    failures.push(`Verification witness '${evidence.witness.witness_id}' referenced interaction log '${evidence.witness.interaction_log_path}' without an attested proof origin.`);
                }
            }
        }
    }
    return checkResult("proof_provenance_is_attested", failures.length === 0 ? "pass" : "fail", failures.length === 0
        ? "Verifier proof executions carry command, log, result, and evidence hashes for provenance review."
        : `Verifier provenance is not fully attested: ${failures.join(" ")}`);
})();
export const liveVerificationPresentCheck = (input) => (() => {
    if (!input.loadedAdapter) {
        return checkResult("live_verification_present", input.adapterExecutions.length === 0 ? "pass" : "fail", input.adapterExecutions.length === 0
            ? "No live verification artifact was required for this round."
            : "Adapter executions appeared even though no adapter is attached.");
    }
    const proofExecutions = proofExecutionsFor(input.adapterExecutions).filter((execution) => execution.provider_role === "verifier" &&
        execution.result.ok);
    const liveEvidence = proofExecutions.flatMap((execution) => execution.verified_evidence.filter((item) => liveVerificationKinds.has(item.kind?.trim().toLowerCase() ?? "")));
    const witnessEvidence = proofExecutions.flatMap((execution) => execution.verified_evidence.filter((item) => item.witness));
    if (liveEvidence.length === 0 || witnessEvidence.length === 0) {
        return checkResult("live_verification_present", "fail", "No verifier-produced interaction log plus structured verification-witness pair was recorded.");
    }
    const originIndex = buildProofEvidenceOriginIndex(proofExecutions);
    const liveEvidencePaths = new Set(liveEvidence.map((item) => item.path));
    const witnessEvidencePaths = new Set(witnessEvidence.map((item) => item.path));
    const proofEvidencePaths = new Set(proofExecutions.flatMap((execution) => execution.verified_evidence.map((item) => item.path)));
    const criterionIds = new Set(proofExecutions.flatMap((execution) => execution.verified_criteria_results.map((criterion) => criterion.criterion_id)));
    const criterionEvidencePaths = new Set(proofExecutions.flatMap((execution) => execution.verified_criteria_results.flatMap((criterion) => criterion.evidence_paths)));
    const gradeDerivedPaths = new Set(proofExecutions
        .filter((execution) => execution.capability === "grade_round")
        .flatMap((execution) => execution.verified_evidence.flatMap((item) => item.derived_from_evidence_paths)));
    const requiredModes = input.loadedAdapter.verification_profile?.profile.required_live_verification_modes ?? [];
    const expectedHardReleaseAssertionIds = hardReleaseAssertionIdsFor(input.loadedAdapter);
    const expectedSurfaces = expectedTargetSurfacesFor(input.loadedAdapter);
    const witnessedAssertionIds = new Set(witnessEvidence.flatMap((item) => item.witness?.assertion_ids ?? []));
    const corePassedAssertionIds = passedFeatureReleaseAssertionIds({
        loadedAdapter: input.loadedAdapter,
        coreProbeResults: input.coreProbeResults
    });
    const witnessedModes = new Set(witnessEvidence
        .map((item) => item.witness?.mode)
        .filter((mode) => Boolean(mode)));
    const criteriaPathLinked = [...criterionEvidencePaths].some((path) => liveEvidencePaths.has(path) || witnessEvidencePaths.has(path));
    const criteriaSupportLinked = liveEvidence.some((item) => item.supports_criterion_ids.some((criterionId) => criterionIds.has(criterionId))) ||
        witnessEvidence.some((item) => item.supports_criterion_ids.some((criterionId) => criterionIds.has(criterionId)));
    const referencedByCriteria = criteriaPathLinked || criteriaSupportLinked;
    const referencedByGrade = [...gradeDerivedPaths].some((path) => liveEvidencePaths.has(path) || witnessEvidencePaths.has(path));
    const explicitlyLinked = liveEvidence.some((item) => item.supports_check_ids.length > 0 || item.supports_criterion_ids.length > 0) ||
        witnessEvidence.some((item) => item.supports_check_ids.length > 0 || item.supports_criterion_ids.length > 0);
    const failures = [];
    for (const requiredMode of requiredModes) {
        if (!witnessedModes.has(requiredMode)) {
            failures.push(`No verification witness satisfied required live verification mode '${requiredMode}'.`);
        }
    }
    if (expectedSurfaces.has("browser") && !input.targetManifest?.app_url) {
        failures.push("Core-owned evaluator profile expects a browser surface, but run_target did not publish target_manifest.app_url.");
    }
    if (expectedSurfaces.has("api") && !input.targetManifest?.api_base_url) {
        failures.push("Core-owned evaluator profile expects an API surface, but run_target did not publish target_manifest.api_base_url.");
    }
    if (expectedSurfaces.has("api") && !witnessedModes.has("api")) {
        failures.push("Core-owned evaluator profile expects an API surface, but no verification witness satisfied api mode.");
    }
    if (expectedSurfaces.has("browser") && !witnessedModes.has("browser")) {
        failures.push("Core-owned evaluator profile expects a browser surface, but no verification witness satisfied browser mode.");
    }
    for (const assertionId of expectedHardReleaseAssertionIds) {
        if (!witnessedAssertionIds.has(assertionId)) {
            failures.push(`No verification witness covered hard release assertion '${assertionId}'.`);
        }
        if (!corePassedAssertionIds.has(assertionId)) {
            failures.push(`No core-owned release gate passed hard release assertion '${assertionId}'.`);
        }
    }
    if (!explicitlyLinked) {
        failures.push("Live verification artifacts were present but did not declare supported checks or criteria.");
    }
    for (const witnessItem of witnessEvidence) {
        const witness = witnessItem.witness;
        if (!witness) {
            continue;
        }
        if (!liveEvidencePaths.has(witness.interaction_log_path)) {
            failures.push(`Verification witness '${witness.witness_id}' did not point to a verified live interaction artifact.`);
        }
        if (!originIndex.get(witness.interaction_log_path)?.has(witness.capability)) {
            failures.push(`Verification witness '${witness.witness_id}' did not carry an attested proof origin for its interaction log.`);
        }
        const stepArtifactsGrounded = witness.steps.every((step) => step.artifact_paths.some((path) => proofEvidencePaths.has(path) ||
            path === witness.interaction_log_path ||
            originIndex.get(path)?.has(witness.capability)));
        if (!stepArtifactsGrounded) {
            failures.push(`Verification witness '${witness.witness_id}' referenced step artifacts that were not grounded in verified proof files.`);
        }
    }
    if (!referencedByCriteria && !referencedByGrade) {
        failures.push("Live verification artifacts were present but were not referenced by criteria or grade derivation.");
    }
    return checkResult("live_verification_present", failures.length === 0 ? "pass" : "fail", failures.length === 0
        ? `Verifier recorded ${liveEvidence.length} live verification artifact(s) and ${witnessEvidence.length} structured witness artifact(s) across required modes.`
        : `Live verification is too weak: ${failures.join(" ")}`);
})();
export const independentTargetProbeCheck = (input) => (() => {
    if (!input.loadedAdapter) {
        return checkResult("independent_target_probe_present", input.coreProbeResults.length === 0 ? "pass" : "fail", input.coreProbeResults.length === 0
            ? "No independent core-owned target probe was required for this round."
            : "Core probe results appeared even though no adapter is attached.");
    }
    const profile = input.loadedAdapter.verification_profile?.profile;
    const requiresCoreProbes = profile?.target_reached_requires_core_probes ?? true;
    if (!requiresCoreProbes) {
        return checkResult("independent_target_probe_present", "pass", "Independent core-owned target probes are not required by the verification profile.");
    }
    const requiredProbes = requiredCoreProbesFor(input.loadedAdapter);
    const expectedSurfaces = expectedTargetSurfacesFor(input.loadedAdapter);
    if (requiredProbes.length === 0) {
        return checkResult("independent_target_probe_present", "fail", "No required core-owned target probes are configured in the verification profile.");
    }
    const requiredReleaseGateProbes = requiredReleaseGateCoreProbesFor(input.loadedAdapter);
    const requiredBrowserReleaseGateProbes = requiredBrowserJourneyReleaseProbesFor(input.loadedAdapter);
    if (requiredReleaseGateProbes.length === 0) {
        return checkResult("independent_target_probe_present", "fail", `No required release-gate core probe is configured. target_reached now requires at least one required ${releaseGateCoreProbeModeList} probe.`);
    }
    const resultByProbeId = new Map(input.coreProbeResults.map((result) => [result.probe_id, result]));
    const failures = requiredProbes.flatMap((probe) => {
        const result = resultByProbeId.get(probe.probe_id);
        if (!result) {
            return [`Required core probe '${probe.probe_id}' did not run.`];
        }
        if (!result.ok) {
            return [`Required core probe '${probe.probe_id}' failed: ${result.summary}`];
        }
        if (result.evidence_paths.length === 0) {
            return [`Required core probe '${probe.probe_id}' did not persist evidence.`];
        }
        return [];
    });
    const passedReleaseGateProbeIds = requiredReleaseGateProbes.flatMap((probe) => {
        const result = resultByProbeId.get(probe.probe_id);
        return result && result.ok && result.evidence_paths.length > 0 ? [result.probe_id] : [];
    });
    if (passedReleaseGateProbeIds.length === 0) {
        failures.push(`No required release-gate core probe passed. Expected one of: ${requiredReleaseGateProbes.map((probe) => probe.probe_id).join(", ")}.`);
    }
    const passedAssertionIds = passedFeatureReleaseAssertionIds({
        loadedAdapter: input.loadedAdapter,
        coreProbeResults: input.coreProbeResults
    });
    const passedBrowserAssertionIds = passedBrowserJourneyAssertionIds({
        loadedAdapter: input.loadedAdapter,
        coreProbeResults: input.coreProbeResults
    });
    const passedApiAssertionIds = passedHttpJsonAssertionIds({
        loadedAdapter: input.loadedAdapter,
        coreProbeResults: input.coreProbeResults
    });
    const minimumAssertionTagCounts = minimumAssertionTagCountsFor(input.loadedAdapter);
    if (expectedSurfaces.has("browser") && !input.targetManifest?.app_url) {
        failures.push("Core-owned evaluator profile expects a browser surface, but run_target did not publish target_manifest.app_url.");
    }
    if (expectedSurfaces.has("api") && !input.targetManifest?.api_base_url) {
        failures.push("Core-owned evaluator profile expects an API surface, but run_target did not publish target_manifest.api_base_url.");
    }
    if (expectedSurfaces.has("browser") &&
        requiredBrowserReleaseGateProbes.length === 0) {
        failures.push("Core-owned evaluator profile expects a browser surface, but no required browser_journey release-gate probe is configured.");
    }
    if (expectedSurfaces.has("api") &&
        requiredHttpJsonReleaseProbesFor(input.loadedAdapter).length === 0) {
        failures.push("Core-owned evaluator profile expects an API surface, but no required http_json release-gate probe is configured.");
    }
    if (expectedSurfaces.has("browser") && passedBrowserAssertionIds.size === 0) {
        failures.push("Core-owned evaluator profile expects a browser surface, but no browser_journey release assertion passed.");
    }
    if (expectedSurfaces.has("api") && passedApiAssertionIds.size === 0) {
        failures.push("Core-owned evaluator profile expects an API surface, but no http_json release assertion passed.");
    }
    for (const [tag, minimumCount] of Object.entries(minimumAssertionTagCounts)) {
        const passedCount = passedReleaseAssertionIdsForTag({
            loadedAdapter: input.loadedAdapter,
            coreProbeResults: input.coreProbeResults,
            tag
        }).size;
        if (passedCount < minimumCount) {
            failures.push(`Core-owned evaluator profile requires at least ${minimumCount} passing ${assertionTagLabel(tag)} release assertion(s), but only ${passedCount} passed.`);
        }
    }
    const minimumAssertions = minimumFeatureReleaseAssertionsFor(input.loadedAdapter);
    if (passedAssertionIds.size < minimumAssertions) {
        failures.push(`Only ${passedAssertionIds.size} feature/workflow release assertion(s) passed; need at least ${minimumAssertions}.`);
    }
    return checkResult("independent_target_probe_present", failures.length === 0 ? "pass" : "fail", failures.length === 0
        ? `Core-owned target probes passed, including release-gate assertion(s): ${[...passedAssertionIds].join(", ")}.`
        : `Independent target probing is incomplete: ${failures.join(" ")}`);
})();
export const adapterMeaningfulEvidenceCheck = (input) => (() => {
    if (!input.loadedAdapter) {
        return checkResult("adapter_evidence_is_meaningful", input.adapterExecutions.length === 0 ? "pass" : "fail", input.adapterExecutions.length === 0
            ? "No adapter-owned evidence was required for this round."
            : "Adapter evidence appeared even though no adapter is attached.");
    }
    if (input.adapterExecutions.length === 0) {
        return checkResult("adapter_evidence_is_meaningful", "pass", "No adapter evidence was evaluated in this round.");
    }
    const semanticFailures = [];
    const executionsWithValidationErrors = input.adapterExecutions.filter((execution) => execution.validation_errors.length > 0);
    if (executionsWithValidationErrors.length > 0) {
        semanticFailures.push("Meaningful evidence cannot be established while adapter validation errors remain.");
    }
    const successfulCheckExecutions = input.adapterExecutions.filter((execution) => execution.capability === "run_checks" && execution.result.ok);
    const successfulCaptureExecutions = input.adapterExecutions.filter((execution) => execution.capability === "capture_evidence" && execution.result.ok);
    const successfulGradeExecutions = input.adapterExecutions.filter((execution) => execution.capability === "grade_round" && execution.result.ok);
    const successfulRuntimeEvidencePaths = new Set(unique([
        ...successfulCheckExecutions.flatMap((execution) => execution.verified_evidence.map((item) => item.path)),
        ...successfulCaptureExecutions.flatMap((execution) => execution.verified_evidence.map((item) => item.path))
    ]));
    for (const execution of successfulCheckExecutions) {
        const linkedEvidenceCount = execution.verified_evidence.filter((item) => item.supports_check_ids.length > 0).length;
        if (linkedEvidenceCount === 0) {
            semanticFailures.push("Capability 'run_checks' succeeded but none of its evidence items declare supported check ids.");
        }
    }
    const hasSupportingRuntimeEvidence = successfulCheckExecutions.some((execution) => execution.verified_evidence.length > 0) ||
        successfulCaptureExecutions.some((execution) => execution.verified_evidence.length > 0);
    for (const execution of successfulGradeExecutions) {
        const hasUpstreamCapabilityLink = execution.verified_evidence.some((item) => item.derived_from_capabilities.some((capability) => capability === "run_checks" || capability === "capture_evidence"));
        const hasUpstreamEvidencePathLink = execution.verified_evidence.some((item) => item.derived_from_evidence_paths.some((path) => successfulRuntimeEvidencePaths.has(path)));
        if (!hasUpstreamCapabilityLink) {
            semanticFailures.push("Capability 'grade_round' succeeded but none of its evidence items reference run_checks or capture_evidence output.");
        }
        if (!hasUpstreamEvidencePathLink) {
            semanticFailures.push("Capability 'grade_round' succeeded but none of its evidence items trace back to concrete run_checks or capture_evidence files.");
        }
    }
    if (successfulGradeExecutions.length > 0 && !hasSupportingRuntimeEvidence) {
        semanticFailures.push("Capability 'grade_round' succeeded without any successful run_checks or capture_evidence evidence in the same round.");
    }
    return checkResult("adapter_evidence_is_meaningful", semanticFailures.length === 0 ? "pass" : "fail", semanticFailures.length === 0
        ? "Adapter evidence is non-empty and preserves explicit links between checks, proof, and grading."
        : `Adapter evidence semantics are weak: ${semanticFailures.join(" ")}`);
})();
export const adapterCriteriaGroundingCheck = (input) => (() => {
    if (!input.loadedAdapter) {
        return checkResult("adapter_criteria_are_grounded", input.adapterExecutions.length === 0 ? "pass" : "fail", input.adapterExecutions.length === 0
            ? "No adapter-owned criteria were required for this round."
            : "Adapter criteria appeared even though no adapter is attached.");
    }
    if (input.adapterExecutions.length === 0) {
        return checkResult("adapter_criteria_are_grounded", "pass", "No adapter criteria were evaluated in this round.");
    }
    const failures = [];
    const successfulCheckExecutions = input.adapterExecutions.filter((execution) => execution.capability === "run_checks" && execution.result.ok);
    const successfulCaptureExecutions = input.adapterExecutions.filter((execution) => execution.capability === "capture_evidence" && execution.result.ok);
    const successfulGradeExecutions = input.adapterExecutions.filter((execution) => execution.capability === "grade_round" && execution.result.ok);
    const runtimeEvidencePaths = new Set(unique([
        ...successfulCheckExecutions.flatMap((execution) => execution.verified_evidence_paths),
        ...successfulCaptureExecutions.flatMap((execution) => execution.verified_evidence_paths)
    ]));
    const runCheckCriteria = successfulCheckExecutions.flatMap((execution) => execution.verified_criteria_results);
    const runCheckCriterionMap = new Map(runCheckCriteria.map((criterion) => [criterion.criterion_id, criterion]));
    const gradeOnlyCriterionIds = new Set((input.loadedAdapter?.verification_profile?.profile.criteria ?? [])
        .filter((criterion) => criterion.capability === "grade_round" &&
        !(input.loadedAdapter?.verification_profile?.profile.criteria ?? []).some((candidate) => candidate.capability === "run_checks" &&
            candidate.criterion_id === criterion.criterion_id))
        .map((criterion) => criterion.criterion_id));
    for (const execution of successfulCheckExecutions) {
        if (execution.verified_criteria_results.length === 0) {
            failures.push("Capability 'run_checks' succeeded but did not produce any verified criterion results.");
            continue;
        }
        for (const criterion of execution.verified_criteria_results) {
            const criterionSupported = execution.verified_evidence.some((item) => item.supports_criterion_ids.includes(criterion.criterion_id) &&
                criterion.evidence_paths.includes(item.path));
            if (!criterionSupported) {
                failures.push(`Capability 'run_checks' criterion '${criterion.criterion_id}' is not grounded by evidence items that explicitly support it.`);
            }
        }
    }
    for (const execution of successfulGradeExecutions) {
        if (execution.verified_criteria_results.length === 0) {
            failures.push("Capability 'grade_round' succeeded but did not produce any verified criterion results.");
            continue;
        }
        for (const criterion of execution.verified_criteria_results) {
            const matchingRunCheckCriterion = runCheckCriterionMap.get(criterion.criterion_id);
            const isGradeOnlyCriterion = gradeOnlyCriterionIds.has(criterion.criterion_id);
            if (!matchingRunCheckCriterion && !isGradeOnlyCriterion) {
                failures.push(`Capability 'grade_round' introduced criterion '${criterion.criterion_id}' without a matching run_checks criterion.`);
                continue;
            }
            if (matchingRunCheckCriterion &&
                matchingRunCheckCriterion.status === "fail" &&
                criterion.status === "pass") {
                failures.push(`Capability 'grade_round' upgraded failed run_checks criterion '${criterion.criterion_id}' to pass without new grounded proof.`);
            }
            if (!criterion.evidence_paths.some((path) => runtimeEvidencePaths.has(path))) {
                failures.push(`Capability 'grade_round' criterion '${criterion.criterion_id}' is not grounded in concrete run_checks or capture_evidence files.`);
            }
        }
        const blockingCriterionIds = execution.result.blocking_criterion_ids ?? [];
        if (blockingCriterionIds.some((criterionId) => !execution.verified_criteria_results.some((criterion) => criterion.criterion_id === criterionId && criterion.status === "fail"))) {
            failures.push("Capability 'grade_round' marked blocking criteria that are not present as failing criterion results.");
        }
        if (execution.result.threshold_verdict === "pass" &&
            execution.verified_criteria_results.some((criterion) => criterion.hard && criterion.status === "fail")) {
            failures.push("Capability 'grade_round' reported threshold_verdict 'pass' while hard criteria still fail.");
        }
    }
    return checkResult("adapter_criteria_are_grounded", failures.length === 0 ? "pass" : "fail", failures.length === 0
        ? "Adapter criteria are explicitly grounded in evidence and stay consistent between checks and grading."
        : `Adapter criteria are weakly grounded: ${failures.join(" ")}`);
})();
export const evaluateVerificationProfile = (input) => {
    if (!input.loadedAdapter) {
        return {
            profileCheck: checkResult("adapter_criteria_match_profile", input.adapterExecutions.length === 0 ? "pass" : "fail", input.adapterExecutions.length === 0
                ? "No core-owned evaluator profile was required for this round."
                : "Adapter criteria appeared even though no adapter is attached."),
            criterionChecks: [],
            hardFailedCriterionIds: []
        };
    }
    const successfulCriteriaExecutions = input.adapterExecutions.filter((execution) => execution.result.ok &&
        (execution.capability === "run_checks" || execution.capability === "grade_round"));
    const verificationProfile = input.loadedAdapter.verification_profile?.profile;
    if (!verificationProfile) {
        return {
            profileCheck: checkResult("adapter_criteria_match_profile", "fail", "Adapter criteria were reported without a core-owned evaluator profile."),
            criterionChecks: [],
            hardFailedCriterionIds: []
        };
    }
    if (successfulCriteriaExecutions.length === 0) {
        return {
            profileCheck: checkResult("adapter_criteria_match_profile", "pass", "No adapter-owned criteria were evaluated against a verification profile in this round."),
            criterionChecks: [],
            hardFailedCriterionIds: []
        };
    }
    const failures = [];
    const criterionChecks = [];
    const hardFailedCriterionIds = [];
    for (const expectedCriterion of verificationProfile.criteria) {
        const matchingExecution = successfulCriteriaExecutions.find((execution) => execution.capability === expectedCriterion.capability);
        if (!matchingExecution) {
            failures.push(`Verification profile criterion '${expectedCriterion.criterion_id}' expected capability '${expectedCriterion.capability}', but that capability did not produce successful criteria for this round.`);
            criterionChecks.push(checkResult(`${expectedCriterion.capability}:${expectedCriterion.criterion_id}`, "fail", `${expectedCriterion.summary} No matching capability output was available.`));
            if (expectedCriterion.hard) {
                hardFailedCriterionIds.push(expectedCriterion.criterion_id);
            }
            continue;
        }
        const matchingCriterion = matchingExecution.verified_criteria_results.find((criterion) => criterion.criterion_id === expectedCriterion.criterion_id);
        if (!matchingCriterion) {
            failures.push(`Verification profile criterion '${expectedCriterion.criterion_id}' was not reported by capability '${expectedCriterion.capability}'.`);
            criterionChecks.push(checkResult(`${expectedCriterion.capability}:${expectedCriterion.criterion_id}`, "fail", `${expectedCriterion.summary} The expected criterion was not reported.`));
            if (expectedCriterion.hard) {
                hardFailedCriterionIds.push(expectedCriterion.criterion_id);
            }
            continue;
        }
        if (!matchingCriterion.observed_value) {
            failures.push(`Verification profile criterion '${expectedCriterion.criterion_id}' did not include an observed_value.`);
            criterionChecks.push(checkResult(`${expectedCriterion.capability}:${expectedCriterion.criterion_id}`, "fail", `${expectedCriterion.summary} The criterion is missing an observed_value.`));
            if (expectedCriterion.hard ?? matchingCriterion.hard) {
                hardFailedCriterionIds.push(expectedCriterion.criterion_id);
            }
            continue;
        }
        const expectedStatus = observedValueMatches(expectedCriterion.operator, matchingCriterion.observed_value, expectedCriterion.expected_value)
            ? "pass"
            : "fail";
        criterionChecks.push(checkResult(`${expectedCriterion.capability}:${expectedCriterion.criterion_id}`, expectedStatus, `${expectedCriterion.summary} Observed '${matchingCriterion.observed_value}' against ${expectedCriterion.operator} '${expectedCriterion.expected_value}'.`));
        if (matchingCriterion.status !== expectedStatus) {
            failures.push(`Capability '${expectedCriterion.capability}' reported criterion '${expectedCriterion.criterion_id}' as '${matchingCriterion.status}', but the evaluator-owned profile derived '${expectedStatus}' from observed_value '${matchingCriterion.observed_value}'.`);
        }
        if (expectedCriterion.hard !== undefined &&
            matchingCriterion.hard !== expectedCriterion.hard) {
            failures.push(`Capability '${expectedCriterion.capability}' reported criterion '${expectedCriterion.criterion_id}' with hard=${String(matchingCriterion.hard)}, but the verification profile requires hard=${String(expectedCriterion.hard)}.`);
        }
        if (expectedStatus === "fail" && (expectedCriterion.hard ?? matchingCriterion.hard)) {
            hardFailedCriterionIds.push(expectedCriterion.criterion_id);
        }
    }
    return {
        profileCheck: checkResult("adapter_criteria_match_profile", failures.length === 0 ? "pass" : "fail", failures.length === 0
            ? `Adapter criteria matched core-owned evaluator profile '${verificationProfile.profile_id}'.`
            : `Adapter criteria did not match core-owned evaluator profile '${verificationProfile.profile_id}': ${failures.join(" ")}`),
        criterionChecks,
        hardFailedCriterionIds: unique(hardFailedCriterionIds)
    };
};
//# sourceMappingURL=shared.js.map