import { access } from "node:fs/promises";
import { join } from "node:path";
import { loadJson } from "./file-system.js";
import { unresolvedSignatureFor } from "./attempt-lifecycle.js";
const unique = (values) => [...new Set(values)];
const defaultProbeRoleForMode = (mode) => mode === "http_json" || mode === "browser_journey" ? "release_gate" : "supporting";
const failingAssertionIdsFor = (evalReport) => {
    const criterionAssertionIds = evalReport.adapter_results.flatMap((execution) => execution.verified_criteria_results
        .filter((criterion) => criterion.status === "fail")
        .map((criterion) => criterion.criterion_id));
    const failingProbeAssertionIds = evalReport.core_probe_results.flatMap((probe) => !probe.ok && probe.assertion_id ? [probe.assertion_id] : []);
    return unique([...criterionAssertionIds, ...failingProbeAssertionIds]);
};
const contradictoryWitnessAssertionIdsFor = (evalReport) => {
    const witnessedAssertionIds = unique(evalReport.adapter_results.flatMap((execution) => execution.verified_evidence.flatMap((evidence) => evidence.witness?.assertion_ids ?? [])));
    const expectedAssertionIds = new Set(unique([
        ...evalReport.adapter_results.flatMap((execution) => execution.verified_criteria_results.map((criterion) => criterion.criterion_id)),
        ...evalReport.core_probe_results.flatMap((probe) => probe.assertion_id ? [probe.assertion_id] : [])
    ]));
    return witnessedAssertionIds.filter((assertionId) => !expectedAssertionIds.has(assertionId));
};
const missingTargetManifestKeysFor = (input) => unique(input.loadedAdapter?.verification_profile?.profile.core_probes?.flatMap((probe) => {
    const role = probe.role ?? defaultProbeRoleForMode(probe.mode);
    if (probe.required === false ||
        role !== "release_gate" ||
        !probe.target_manifest_key) {
        return [];
    }
    return input.targetManifest?.[probe.target_manifest_key]
        ? []
        : [probe.target_manifest_key];
}) ?? []);
export const buildFailureLineageArtifact = (input) => {
    const failingProbeIds = input.evalReport.core_probe_results
        .filter((probe) => !probe.ok && probe.role === "release_gate")
        .map((probe) => probe.probe_id);
    const environmentBlockedProbeIds = input.evalReport.core_probe_results
        .filter((probe) => !probe.ok &&
        probe.role === "release_gate" &&
        probe.failure_classification === "environment_blocked")
        .map((probe) => probe.probe_id);
    const environmentBlockedAssertionIds = new Set(input.evalReport.core_probe_results.flatMap((probe) => !probe.ok &&
        probe.role === "release_gate" &&
        probe.failure_classification === "environment_blocked" &&
        probe.assertion_id
        ? [probe.assertion_id]
        : []));
    const failingAssertionIds = failingAssertionIdsFor(input.evalReport);
    const contradictoryWitnessAssertionIds = contradictoryWitnessAssertionIdsFor(input.evalReport);
    const missingTargetManifestKeys = missingTargetManifestKeysFor({
        loadedAdapter: input.loadedAdapter,
        targetManifest: input.targetManifest
    });
    const releaseRegressionIds = input.previousRoundSummary?.resolved_check_ids.filter((checkId) => input.evalReport.unresolved_check_ids.includes(checkId)) ?? [];
    const hasAnyFailures = input.evalReport.unresolved_check_ids.length > 0 ||
        failingAssertionIds.length > 0 ||
        failingProbeIds.length > 0 ||
        missingTargetManifestKeys.length > 0 ||
        contradictoryWitnessAssertionIds.length > 0 ||
        releaseRegressionIds.length > 0;
    const hasOnlyEnvironmentBlockedReleaseProbes = failingProbeIds.length > 0 &&
        environmentBlockedProbeIds.length === failingProbeIds.length &&
        failingAssertionIds.every((assertionId) => environmentBlockedAssertionIds.has(assertionId)) &&
        missingTargetManifestKeys.length === 0 &&
        contradictoryWitnessAssertionIds.length === 0 &&
        releaseRegressionIds.length === 0;
    return {
        failing_check_ids: input.evalReport.unresolved_check_ids,
        failing_assertion_ids: failingAssertionIds,
        failing_probe_ids: failingProbeIds,
        missing_target_manifest_keys: missingTargetManifestKeys,
        contradictory_witness_assertion_ids: contradictoryWitnessAssertionIds,
        release_regression_ids: releaseRegressionIds,
        environment_blocked_probe_ids: environmentBlockedProbeIds,
        ...(!hasAnyFailures
            ? { failure_classification: "none" }
            : environmentBlockedProbeIds.length > 0
                ? {
                    failure_classification: hasOnlyEnvironmentBlockedReleaseProbes
                        ? "environment_blocked"
                        : "mixed"
                }
                : { failure_classification: "product_defect" }),
        unresolved_signature: unresolvedSignatureFor(input.evalReport.unresolved_check_ids)
    };
};
const repeatedCountFromHistory = (history, currentValue, selector, allowNone = false) => {
    if (currentValue === undefined) {
        return 0;
    }
    if (!allowNone && currentValue === "none") {
        return 0;
    }
    let count = 1;
    for (const round of [...history].reverse()) {
        if (selector(round) !== currentValue) {
            break;
        }
        count += 1;
    }
    return count;
};
const repeatedUnresolvedCheckCount = (history, currentFailureLineage, checkId) => {
    if (!currentFailureLineage.failing_check_ids.includes(checkId)) {
        return 0;
    }
    let count = 1;
    for (const round of [...history].reverse()) {
        if (!round.unresolved_check_ids.includes(checkId)) {
            break;
        }
        count += 1;
    }
    return count;
};
export const buildFailureLineagePolicySnapshot = (input) => {
    const repeatedFailureSignatureCount = repeatedCountFromHistory(input.history, input.failureLineage.unresolved_signature, (round) => round.failure_lineage?.unresolved_signature ?? round.failure_lineage?.unresolved_signature);
    const repeatedFailureClassificationCount = repeatedCountFromHistory(input.history, input.failureLineage.failure_classification, (round) => round.failure_lineage?.failure_classification);
    const plateauDeltaWindow = input.scoreDeltas.slice(-3);
    const repeatedSubjectiveThresholdFailures = repeatedUnresolvedCheckCount(input.history, input.failureLineage, "subjective_thresholds_met");
    const repeatedPrototypeDeltaFailures = repeatedUnresolvedCheckCount(input.history, input.failureLineage, "prototype_delta_present");
    const repeatedBrowserQualityFailures = Math.max(repeatedSubjectiveThresholdFailures, repeatedPrototypeDeltaFailures);
    const plateauWithoutProgress = (plateauDeltaWindow.length > 0 &&
        plateauDeltaWindow.every((delta) => delta <= 0.01)) ||
        repeatedBrowserQualityFailures >= 2;
    const plateauLimitReached = input.plateauLimit > 0 && input.projectedPlateauCount >= input.plateauLimit;
    const contradictionCount = input.failureLineage.contradictory_witness_assertion_ids.length;
    const regressionCount = input.failureLineage.release_regression_ids.length;
    const missingManifestCount = input.failureLineage.missing_target_manifest_keys.length;
    const environmentBlocked = input.failureLineage.failure_classification === "environment_blocked";
    const patchEntropySpike = input.patchEntropy >= 2;
    const triggerScores = {
        environment_blocked: environmentBlocked ? 1 : 0,
        manifest_contract_broken: missingManifestCount > 0 ? Math.min(1, 0.8 + missingManifestCount * 0.05) : 0,
        release_gate_regression: regressionCount > 0 ? Math.min(1, 0.75 + regressionCount * 0.05) : 0,
        scope_drift: input.scopeDriftDetected ? 0.72 : 0,
        contradiction_detected: contradictionCount > 0 ? Math.min(1, 0.7 + contradictionCount * 0.08) : 0,
        repeated_same_failure_signature: repeatedFailureSignatureCount >= 2
            ? Math.min(1, 0.58 + (repeatedFailureSignatureCount - 2) * 0.12)
            : 0,
        plateau_without_progress: plateauWithoutProgress
            ? plateauLimitReached
                ? 0.71
                : repeatedPrototypeDeltaFailures >= 2
                    ? 0.69
                    : repeatedSubjectiveThresholdFailures >= 2
                        ? 0.64
                        : 0.52
            : 0,
        patch_entropy_spike: patchEntropySpike
            ? Math.min(0.9, 0.45 + Math.max(0, input.patchEntropy - 2) * 0.1)
            : 0,
        stable_patch_authority: 0.2
    };
    const triggerEntries = Object.entries(triggerScores);
    const activeTriggerCodes = triggerEntries
        .filter(([code, score]) => code === "stable_patch_authority" || score > 0)
        .map(([code]) => code);
    const dominantWeightedTrigger = triggerEntries
        .filter(([code]) => code !== "stable_patch_authority")
        .sort((left, right) => right[1] - left[1])[0];
    const [dominantTriggerCode, dominantTriggerScore] = dominantWeightedTrigger && dominantWeightedTrigger[1] > 0
        ? dominantWeightedTrigger
        : [
            "stable_patch_authority",
            triggerScores.stable_patch_authority ?? 0.2
        ];
    let patchAuthorityState = "healthy";
    if (environmentBlocked ||
        missingManifestCount > 0 ||
        regressionCount > 0 ||
        input.scopeDriftDetected ||
        contradictionCount > 0 ||
        repeatedFailureSignatureCount >= 2 ||
        plateauLimitReached) {
        patchAuthorityState = "collapsed";
    }
    else if (plateauWithoutProgress || patchEntropySpike) {
        patchAuthorityState = "strained";
    }
    const reasons = [];
    let recommendedAction = "patch_only";
    let recommendationSource = "weighted_policy";
    if (environmentBlocked) {
        recommendedAction = "stop";
        recommendationSource = "hard_rule";
        reasons.push("Latest release blockers are environment-blocked only, so bounded reopen would waste remediation budget.");
    }
    else if (missingManifestCount > 0) {
        recommendedAction = "recontract";
        recommendationSource = "hard_rule";
        reasons.push("Required target manifest keys remain missing.");
    }
    else if (regressionCount > 0) {
        recommendedAction = "recontract";
        recommendationSource = "hard_rule";
        reasons.push("Previously closed checks regressed.");
    }
    else if (input.scopeDriftDetected) {
        recommendedAction = "recontract";
        recommendationSource = "hard_rule";
        reasons.push("Patch scope drifted beyond the active contract frame.");
    }
    else if (contradictionCount > 0) {
        recommendedAction = "recontract";
        recommendationSource = "hard_rule";
        reasons.push("Contradictory witness coverage requires a fresh contract boundary.");
    }
    else if (patchAuthorityState === "collapsed" ||
        dominantTriggerScore >= 0.68) {
        recommendedAction = "recontract";
        reasons.push(dominantTriggerCode === "plateau_without_progress" && repeatedPrototypeDeltaFailures >= 2
            ? "Prototype delta failed across consecutive browser rounds, so the product surface is plateauing even if proof signals still move."
            : dominantTriggerCode === "plateau_without_progress" &&
                repeatedSubjectiveThresholdFailures >= 2
                ? "Required browser subjective thresholds failed across consecutive rounds, so product quality is not improving enough to stay patch-only."
                : dominantTriggerCode === "plateau_without_progress" && plateauLimitReached
                    ? `Score improvement plateaued for ${input.projectedPlateauCount} consecutive rounds, which reached the bounded reopen threshold of ${input.plateauLimit}.`
                    : dominantTriggerCode === "repeated_same_failure_signature"
                        ? "The same unresolved failure signature repeated across attempts."
                        : dominantTriggerCode === "patch_entropy_spike"
                            ? "Patch request entropy spiked beyond a stable repair envelope."
                            : "Recent policy signals indicate patch authority has collapsed.");
    }
    else {
        reasons.push("Active contract frame is still credible, so remediation can stay patch-only.");
    }
    return {
        recommended_action: recommendedAction,
        reasons,
        trigger_codes: activeTriggerCodes,
        trigger_scores: triggerScores,
        dominant_trigger_code: dominantTriggerCode,
        patch_authority_state: patchAuthorityState,
        escalation_confidence: Number(dominantTriggerScore.toFixed(3)),
        recommendation_source: recommendationSource,
        repeated_failure_signature_count: repeatedFailureSignatureCount,
        repeated_failure_classification_count: repeatedFailureClassificationCount,
        unresolved_check_count: input.failureLineage.failing_check_ids.length,
        contradiction_count: contradictionCount,
        regression_count: regressionCount,
        missing_manifest_count: missingManifestCount,
        plateau_delta_window: plateauDeltaWindow,
        plateau_without_progress: plateauWithoutProgress,
        projected_plateau_count: input.projectedPlateauCount,
        plateau_limit: input.plateauLimit,
        plateau_limit_reached: plateauLimitReached,
        environment_blocked: environmentBlocked,
        scope_drift_detected: input.scopeDriftDetected
    };
};
export const applyFailureLineagePolicySnapshot = (input) => ({
    ...input.failureLineage,
    policy_snapshot: buildFailureLineagePolicySnapshot(input)
});
export const isPureEnvironmentBlockedLineage = (failureLineage) => Boolean(failureLineage &&
    failureLineage.failure_classification === "environment_blocked" &&
    failureLineage.environment_blocked_probe_ids.length > 0 &&
    failureLineage.missing_target_manifest_keys.length === 0 &&
    failureLineage.contradictory_witness_assertion_ids.length === 0 &&
    failureLineage.release_regression_ids.length === 0);
export const failureLineageArtifactPath = (roundDirectory) => join(roundDirectory, "failure-lineage.json");
export const loadFailureLineageArtifact = async (path) => {
    if (!path) {
        return undefined;
    }
    try {
        await access(path);
    }
    catch {
        return undefined;
    }
    return loadJson(path);
};
//# sourceMappingURL=failure-lineage.js.map