import { access } from "node:fs/promises";
import { join } from "node:path";
import { loadJson, sha256ForPath } from "./file-system.js";
export const resumeIdentityVersion = 4;
const normalized = (value) => value?.trim() || undefined;
const normalizedComparisonValue = (value) => {
    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }
    if (typeof value === "number") {
        return String(value);
    }
    return normalized(value) ?? "none";
};
export const resumeIdentityArtifactPath = (runDirectory) => join(runDirectory, "resume-identity.json");
export const loadResumeIdentityArtifact = async (runDirectory) => {
    const artifactPath = resumeIdentityArtifactPath(runDirectory);
    try {
        await access(artifactPath);
    }
    catch {
        return undefined;
    }
    return loadJson(artifactPath);
};
export const buildResumeIdentityState = async (input) => {
    const [adapterContractSha, evaluatorBundleSha, rubricSha] = await Promise.all([
        sha256ForPath(input.adapterContractPath),
        sha256ForPath(input.evaluatorProfilePath),
        sha256ForPath(input.rubricPath)
    ]);
    return {
        resume_identity_version: resumeIdentityVersion,
        adapter_attached: Boolean(normalized(input.adapterContractPath) || adapterContractSha),
        evaluator_bundle_attached: Boolean(normalized(input.evaluatorProfilePath) || evaluatorBundleSha),
        ...(normalized(input.adapterContractPath)
            ? { adapter_contract_path: normalized(input.adapterContractPath) }
            : {}),
        ...(adapterContractSha ? { adapter_contract_sha256: adapterContractSha } : {}),
        ...(normalized(input.evaluatorProfilePath)
            ? { evaluator_profile_path: normalized(input.evaluatorProfilePath) }
            : {}),
        ...(evaluatorBundleSha ? { evaluator_bundle_sha256: evaluatorBundleSha } : {}),
        ...(rubricSha ? { rubric_sha256: rubricSha } : {}),
        ...(input.executorMode ? { executor_mode: input.executorMode } : {}),
        ...(input.transportMode ? { transport_mode: input.transportMode } : {}),
        ...(input.targetFamily ? { target_family: input.targetFamily } : {}),
        ...(input.validationLane ? { validation_lane: input.validationLane } : {})
    };
};
export const resumeIdentityFingerprint = (identity) => JSON.stringify({
    resume_identity_version: identity.resume_identity_version,
    adapter_attached: identity.adapter_attached,
    evaluator_bundle_attached: identity.evaluator_bundle_attached,
    adapter_contract_path: identity.adapter_contract_path ?? null,
    adapter_contract_sha256: identity.adapter_contract_sha256 ?? null,
    evaluator_profile_path: identity.evaluator_profile_path ?? null,
    evaluator_bundle_sha256: identity.evaluator_bundle_sha256 ?? null,
    rubric_sha256: identity.rubric_sha256 ?? null,
    executor_mode: identity.executor_mode ?? null,
    transport_mode: identity.transport_mode ?? null,
    target_family: identity.target_family ?? null,
    validation_lane: identity.validation_lane ?? null
});
export const summaryResumeIdentity = (summary) => ({
    resume_identity_version: 1,
    adapter_attached: summary?.adapter_attached ??
        Boolean(summary?.adapter_contract_path || summary?.adapter_contract_sha256),
    evaluator_bundle_attached: Boolean(summary?.evaluator_profile_path || summary?.evaluator_bundle_sha256),
    ...(summary?.adapter_contract_path
        ? { adapter_contract_path: summary.adapter_contract_path }
        : {}),
    ...(summary?.adapter_contract_sha256
        ? { adapter_contract_sha256: summary.adapter_contract_sha256 }
        : {}),
    ...(summary?.evaluator_profile_path
        ? { evaluator_profile_path: summary.evaluator_profile_path }
        : {}),
    ...(summary?.evaluator_bundle_sha256
        ? { evaluator_bundle_sha256: summary.evaluator_bundle_sha256 }
        : {}),
    ...(summary?.rubric_sha256 ? { rubric_sha256: summary.rubric_sha256 } : {}),
    ...(summary?.executor_mode ? { executor_mode: summary.executor_mode } : {}),
    ...(summary?.transport_mode ? { transport_mode: summary.transport_mode } : {}),
    ...(summary?.target_family ? { target_family: summary.target_family } : {}),
    ...(summary?.validation_lane ? { validation_lane: summary.validation_lane } : {})
});
export const compareResumeIdentity = (input) => {
    const mismatches = [];
    const compareField = (label, currentValue, previousValue, options) => {
        const previousIsLegacy = input.previous.resume_identity_version < resumeIdentityVersion;
        if (previousIsLegacy &&
            options?.requirePreviousPresenceInLegacyMode &&
            previousValue === undefined) {
            return;
        }
        const currentNormalized = normalizedComparisonValue(currentValue);
        const previousNormalized = normalizedComparisonValue(previousValue);
        if (currentNormalized !== previousNormalized) {
            mismatches.push(`${label} changed from '${previousNormalized}' to '${currentNormalized}'.`);
        }
    };
    compareField("adapter attached", input.current.adapter_attached, input.previous.adapter_attached);
    compareField("adapter contract path", input.current.adapter_contract_path, input.previous.adapter_contract_path);
    compareField("adapter contract fingerprint", input.current.adapter_contract_sha256, input.previous.adapter_contract_sha256);
    compareField("evaluator bundle attached", input.current.evaluator_bundle_attached, input.previous.evaluator_bundle_attached);
    compareField("evaluator bundle path", input.current.evaluator_profile_path, input.previous.evaluator_profile_path);
    compareField("evaluator bundle fingerprint", input.current.evaluator_bundle_sha256, input.previous.evaluator_bundle_sha256);
    compareField("rubric fingerprint", input.current.rubric_sha256, input.previous.rubric_sha256);
    compareField("executor mode", input.current.executor_mode, input.previous.executor_mode, { requirePreviousPresenceInLegacyMode: true });
    compareField("transport mode", input.current.transport_mode, input.previous.transport_mode, { requirePreviousPresenceInLegacyMode: true });
    compareField("target family", input.current.target_family, input.previous.target_family, { requirePreviousPresenceInLegacyMode: true });
    compareField("validation lane", input.current.validation_lane, input.previous.validation_lane, { requirePreviousPresenceInLegacyMode: true });
    return mismatches;
};
//# sourceMappingURL=resume-identity.js.map