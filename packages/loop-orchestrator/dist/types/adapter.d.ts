import type { AdapterCapabilityName, BrowserJourneyStep, CoreVerificationProbeMode, CoreVerificationProbeRole, CoreVerificationProbeScope, LiveVerificationMode, ProbeFailureClassification, ProbeSemanticLevel, ProofCapabilityName, RoundVerdict, TargetFamily, TargetManifestKey, TargetSurface, ValidationLane, VerificationAssertionTag, VerificationCriterionOperator } from "./controller.js";
export interface AdapterCommandSpec {
    command: string;
    args?: string[];
    cwd?: string;
    timeout_ms?: number;
    shell?: "powershell" | "sh" | "bash" | "cmd";
    execution_policy?: AdapterExecutionPolicy;
}
export type AdapterTrustMode = "trusted" | "sandboxed";
export type AdapterSandboxProvider = "none" | "bubblewrap" | "firejail" | "container" | "custom-wrapper";
export interface AdapterExecutionPolicy {
    trust_mode?: AdapterTrustMode;
    sandbox_provider?: AdapterSandboxProvider;
    network_access?: boolean;
    isolated_home?: boolean;
    writable_roots?: string[];
}
export interface ResolvedAdapterExecutionPolicy {
    trust_mode: AdapterTrustMode;
    sandbox_provider: AdapterSandboxProvider;
    network_access: boolean;
    isolated_home: boolean;
    writable_roots: string[];
    fail_closed: boolean;
}
export interface VerificationProviderSpec {
    provider_id: string;
    capabilities: Partial<Record<ProofCapabilityName, AdapterCommandSpec>>;
    notes?: string[];
}
export interface VerificationCriterion {
    criterion_id: string;
    capability: Extract<AdapterCapabilityName, "run_checks" | "grade_round">;
    summary: string;
    operator: VerificationCriterionOperator;
    expected_value: string;
    assertion_id?: string;
    quality_axis_id?: string;
    hard?: boolean;
}
export interface QualityContractAxis {
    axis_id: string;
    label: string;
    description: string;
    desired_outcome?: string;
    preserve_signals?: string[];
    reference_signals?: string[];
    scoring_mode?: "binary_release_gate" | "subjective_out_of_ten";
    minimum_score_out_of_ten?: number;
}
export interface QualityContract {
    primary_goal: string;
    quality_axes: QualityContractAxis[];
    preserve_signals?: string[];
    reference_signals?: string[];
    critique_style?: "deterministic_release_gate";
}
export interface VerificationSubjectiveMetric {
    metric_id: string;
    label: string;
    description: string;
    minimum_score_out_of_ten: number;
    quality_axis_id?: string;
    required?: boolean;
    weight?: number;
}
export interface VerificationCoreProbe {
    probe_id: string;
    label: string;
    mode: CoreVerificationProbeMode;
    role?: CoreVerificationProbeRole;
    assertion_id?: string;
    assertion_tags?: VerificationAssertionTag[];
    quality_axis_id?: string;
    semantic_level?: ProbeSemanticLevel;
    target?: string;
    target_manifest_key?: TargetManifestKey;
    target_path?: string;
    scope?: CoreVerificationProbeScope;
    expected_value?: string;
    expected_status?: number;
    json_path?: string;
    steps?: BrowserJourneyStep[];
    cwd?: string;
    args?: string[];
    shell?: AdapterCommandSpec["shell"];
    browser_executable?: string;
    expected_exit_code?: number;
    timeout_ms?: number;
    required?: boolean;
}
export interface VerificationProofScoreWeights {
    proof_pass_rate?: number;
    criterion_pass_rate?: number;
    threshold_verdict?: number;
    external_grade?: number;
}
export interface VerificationReleaseScoreWeights {
    control_plane_score?: number;
    proof_score?: number;
}
export interface VerificationScorePolicy {
    proof_weights?: VerificationProofScoreWeights;
    release_weights?: VerificationReleaseScoreWeights;
}
export interface VerificationProfile {
    profile_id: string;
    label: string;
    bundle_label?: string;
    target_family?: TargetFamily;
    validation_lane?: ValidationLane;
    criteria: VerificationCriterion[];
    expected_target_surfaces?: TargetSurface[];
    required_live_verification_modes?: LiveVerificationMode[];
    core_probes?: VerificationCoreProbe[];
    target_reached_requires_core_probes?: boolean;
    minimum_feature_release_assertions?: number;
    minimum_assertion_tag_counts?: Partial<Record<VerificationAssertionTag, number>>;
    score_policy?: VerificationScorePolicy;
    quality_contract?: QualityContract;
    subjective_metrics?: VerificationSubjectiveMetric[];
    notes?: string[];
}
export interface LoadedVerificationProfile {
    profile_path: string;
    profile: VerificationProfile;
}
export interface TargetManifest {
    health_url?: string;
    app_url?: string;
    api_base_url?: string;
}
export interface ExternalAdapterContract {
    adapter_id: string;
    label: string;
    contract_version: "1";
    target_root: string;
    execution_policy?: AdapterExecutionPolicy;
    capabilities: Partial<Record<AdapterCapabilityName, AdapterCommandSpec>>;
    verification_provider?: VerificationProviderSpec;
    verification_profile_path?: string;
    notes?: string[];
}
export interface LoadedAdapterContract {
    base_directory: string;
    contract_path: string;
    contract: ExternalAdapterContract;
    verification_profile?: LoadedVerificationProfile;
    verification_profile_source?: "core" | "adapter";
    runtime_warnings?: string[];
}
export interface AdapterCapabilityPacket {
    adapter_id: string;
    capability: AdapterCapabilityName;
    execution_id?: string;
    run_id: string;
    round: number;
    run_directory: string;
    round_directory: string;
    runtime_directory?: string;
    codex_session_registry_path?: string;
    target_root: string;
    idea_path?: string;
    planned_scenario_path?: string;
    plan_path?: string;
    round_contract_path: string;
    contract_review_path?: string;
    contract_agreement_path?: string;
    generator_plan_path: string;
    patch_request_path?: string;
    trajectory_decision_path?: string;
    eval_report_path?: string;
}
export interface AdapterEvidenceItem {
    path: string;
    kind?: string;
    description?: string;
    supports_check_ids?: string[];
    supports_criterion_ids?: string[];
    derived_from_capabilities?: AdapterCapabilityName[];
    derived_from_evidence_paths?: string[];
}
export interface VerifiedAdapterEvidenceItem {
    path: string;
    size_bytes: number;
    sha256: string;
    produced_by_capability: AdapterCapabilityName;
    kind?: string;
    description?: string;
    supports_check_ids: string[];
    supports_criterion_ids: string[];
    derived_from_capabilities: AdapterCapabilityName[];
    derived_from_evidence_paths: string[];
    content_summary: string;
    witness?: VerificationWitness;
}
export interface VerificationWitnessStep {
    action: string;
    outcome: "pass" | "fail" | "info";
    artifact_paths: string[];
}
export interface VerificationWitness {
    witness_id: string;
    provider_id: string;
    provider_role: "verifier";
    capability: ProofCapabilityName;
    mode: LiveVerificationMode;
    target_root: string;
    target_reference: string;
    interaction_log_path: string;
    assertion_ids: string[];
    steps: VerificationWitnessStep[];
}
export interface AdapterExecutionAttestation {
    command: string;
    args?: string[];
    command_sha256: string;
    cwd: string;
    shell: "powershell" | "sh" | "bash" | "cmd" | "system";
    timeout_ms: number;
    execution_policy: ResolvedAdapterExecutionPolicy;
    started_at: string;
    finished_at: string;
    duration_ms: number;
    stdout_path: string;
    stdout_sha256: string;
    stderr_path: string;
    stderr_sha256: string;
    result_sha256: string;
    redaction: {
        policy_version: string;
        stdout_redacted: boolean;
        stdout_redaction_count: number;
        stderr_redacted: boolean;
        stderr_redaction_count: number;
        result_redacted: boolean;
        result_redaction_count: number;
    };
}
export interface AdapterCapabilityAttemptArtifact {
    capability: AdapterCapabilityName;
    execution_id: string;
    status: "running" | "completed" | "timed_out" | "failed";
    started_at: string;
    updated_at: string;
    timeout_ms: number;
    packet_path: string;
    result_path: string;
    stdout_path: string;
    stderr_path: string;
    command: string;
    args?: string[];
    shell?: AdapterCommandSpec["shell"];
    timed_out_at?: string;
    finished_at?: string;
    exit_code?: number | null;
}
export interface CoreProbeAttestation {
    started_at: string;
    finished_at: string;
    duration_ms: number;
    target: string;
    result_sha256: string;
    evidence_sha256: Record<string, string>;
}
export interface CoreVerificationProbeExecution {
    probe_id: string;
    label: string;
    mode: CoreVerificationProbeMode;
    role: CoreVerificationProbeRole;
    assertion_id?: string;
    assertion_tags?: VerificationAssertionTag[];
    quality_axis_id?: string;
    semantic_level: ProbeSemanticLevel;
    required: boolean;
    ok: boolean;
    summary: string;
    target: string;
    evidence_paths: string[];
    observed_value?: string;
    failure_classification?: ProbeFailureClassification;
    attestation: CoreProbeAttestation;
}
export interface AdapterCriterionResult {
    criterion_id: string;
    status: "pass" | "fail";
    summary: string;
    evidence_paths: string[];
    hard?: boolean;
    threshold?: string;
    observed_value?: string;
}
export interface SubjectiveMetricResult {
    metric_id: string;
    label: string;
    score_out_of_ten: number;
    minimum_score_out_of_ten: number;
    status: "pass" | "fail";
    rationale: string;
    recommended_changes: string[];
    evidence_paths: string[];
    violations?: string[];
    evidence_quality?: {
        has_required_evidence?: boolean;
        evidence_type?: string;
    };
    quality_axis_id?: string;
    required?: boolean;
}
export interface VerifiedAdapterCriterionResult {
    criterion_id: string;
    status: "pass" | "fail";
    summary: string;
    evidence_paths: string[];
    hard: boolean;
    threshold?: string;
    observed_value?: string;
}
export interface AdapterCapabilityResult {
    capability: AdapterCapabilityName;
    ok: boolean;
    summary: string;
    findings: string[];
    evidence_paths: string[];
    evidence_items?: AdapterEvidenceItem[];
    target_manifest?: TargetManifest;
    criteria_results?: AdapterCriterionResult[];
    threshold_verdict?: "pass" | "fail";
    blocking_criterion_ids?: string[];
    metadata?: Record<string, string | number | boolean | null | ReadonlyArray<string | number | boolean>>;
    score?: number;
    overall_verdict?: RoundVerdict;
    subjective_metric_results?: SubjectiveMetricResult[];
}
export interface AdapterCapabilityExecution {
    capability: AdapterCapabilityName;
    provider_id: string;
    provider_role: "executor" | "verifier";
    packet_path: string;
    result_path: string;
    result: AdapterCapabilityResult;
    verified_evidence: VerifiedAdapterEvidenceItem[];
    verified_criteria_results: VerifiedAdapterCriterionResult[];
    verified_evidence_paths: string[];
    validation_errors: string[];
    attestation?: AdapterExecutionAttestation;
}
//# sourceMappingURL=adapter.d.ts.map