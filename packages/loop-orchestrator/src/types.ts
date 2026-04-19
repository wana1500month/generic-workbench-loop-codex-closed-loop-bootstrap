export type HarnessFocusArea =
  | "planner_clarity"
  | "contract_testability"
  | "artifact_handoff"
  | "patch_authority"
  | "qa_rigor"
  | "runtime_portability";

export type RewriteScope = "incremental" | "structural" | "integration";
export type AttemptKind = "initial_build" | "remediation";
export type NegotiationMode = "full_negotiation" | "patch_only" | "recontract";
export type ContinuationAuthority = "planner_contract" | "patch_request";
export type RecontractReason =
  | "missing_active_contract_frame"
  | "no_actionable_patch_ids"
  | "adapter_contract_drift"
  | "adapter_runtime_drift"
  | "repeated_same_failure_signature"
  | "release_gate_regression"
  | "scope_drift"
  | "manifest_contract_broken"
  | "plateau_without_progress"
  | "contradictory_evidence"
  | "patch_entropy_spike";

export type RoundVerdict = "advance" | "revise" | "hold";
export type RoundCheckStatus = "pass" | "fail" | "not_applicable";
export type RunStopReason =
  | "target_reached"
  | "contract_completed"
  | "environment_blocked"
  | "adapter_contract_invalid"
  | "adapter_migration_rejected"
  | "new_run_required"
  | "awaiting_codex_checkpoint"
  | "awaiting_current_thread_handoff"
  | "awaiting_manual_generator"
  | "awaiting_human_input"
  | "awaiting_external_condition"
  | "plateau_limit_reached"
  | "max_rounds_reached";
export type RoundStopReason = RunStopReason | "continue";
export type RuntimeEventCode =
  | "run.resumed_from_history"
  | "resume.recovered_round_checkpoint"
  | "resume.repaired_interrupted_round"
  | "resume.partial_init_rebuild"
  | "resume.migration_override"
  | "adapter.migration_applied"
  | "adapter.migration_accepted"
  | "adapter.migration_rejected"
  | "adapter.migration_new_run_requested"
  | "resume.noop_terminal"
  | "resume.reopened_terminal"
  | "resume.continued"
  | "validation.environment_lane_hint";
export type ValidationLane =
  | "deterministic_semantic"
  | "environment_integration";
export type ExecutorMode = "harness" | "subagents-experimental";
export type ControllerMode = "attached" | "detached";
export type TransportMode = "codex-exec" | "current-thread" | "app-server";
export type OperatorLaunchOrigin =
  | "codex-app-thread"
  | "codex-automation"
  | "shell"
  | "supervisor"
  | "embedded-client";
export type OperatorSurfaceOwner =
  | "stock-codex-thread"
  | "embedded-app-server"
  | "external-controller";
export type ThreadBindingState = "bound" | "assumed" | "unbound";
export type OperatorEntrypoint =
  | "skill"
  | "plugin"
  | "shell"
  | "supervisor"
  | "automation"
  | "cli";
export type OperatorAppVisibility =
  | "visible-in-stock-app"
  | "not-visible-in-stock-app"
  | "embedded-only";
export type OperatorHandoffState =
  | "none"
  | "local"
  | "worktree"
  | "automation"
  | "manual"
  | "headless";
export type OperatorAttentionRequired = "none" | "codex" | "human" | "external";
export type CurrentThreadCheckpointKind =
  | "planner"
  | "contract-review"
  | "generator-plan"
  | "evaluator"
  | "attached-generator"
  | "adapter-migration-authoring"
  | "adapter-migration-approval";
export type OperatorWorkerSkill = "loop-control";
export type OperatorRecoverySkill = "attached-loop" | "run-resume";
export type OperatorResumeSkill = OperatorRecoverySkill;
export type OperatorRecommendedSkill =
  | OperatorWorkerSkill
  | OperatorRecoverySkill;
export type CurrentThreadAutoContinueState =
  | "codex_checkpoint"
  | "human_stop"
  | "external_stop"
  | "terminal";
export type OperatorPresentationMode =
  | "foreground-thread"
  | "manual-protocol"
  | "background-automation"
  | "headless";
export type OperatorWorkspaceSurface = "local" | "worktree";
export type ExecutionState =
  | "running"
  | "paused"
  | "stalled"
  | "failed"
  | "completed";
export type UiBindingMode =
  | "embedded-app-server"
  | "stock-current-thread"
  | "none";
export type ControllerRoundPhase =
  | "planning"
  | "negotiation"
  | "pre_verification"
  | "core_probes"
  | "post_verification"
  | "evaluation"
  | "round_commit"
  | "run_finalize";
export type ControllerPhaseStatus =
  | "in_progress"
  | "completed"
  | "stalled"
  | "awaiting_codex_work"
  | "awaiting_human_input"
  | "awaiting_external_condition"
  | "awaiting_input";
export type ProbeFailureClassification = "environment_blocked" | "probe_error";
export type FailureLineagePolicyAction = "patch_only" | "recontract" | "stop";
export type FailureLineageTriggerCode =
  | "environment_blocked"
  | "manifest_contract_broken"
  | "release_gate_regression"
  | "scope_drift"
  | "contradiction_detected"
  | "repeated_same_failure_signature"
  | "plateau_without_progress"
  | "patch_entropy_spike"
  | "stable_patch_authority";
export type FailureLineageClassification =
  | "none"
  | "product_defect"
  | "environment_blocked"
  | "mixed";
export type PatchAuthorityState = "healthy" | "strained" | "collapsed";
export type FailureLineagePolicySource = "hard_rule" | "weighted_policy";
export type AdapterDriftKind = "contract" | "runtime";
export type AdapterDriftSignal =
  | "static_contract_blockers"
  | "missing_target_manifest_keys";
export type AdapterOrigin = "generated_local" | "external_contract";
export type AdapterMigrationClass =
  | "runtime_surface_patch"
  | "kernel_wiring_patch"
  | "boundary_break";
export type AdapterMigrationApplyMode =
  | "same_run_in_place"
  | "proposal_only"
  | "new_run_required";
export type AdapterMigrationDecision =
  | "accept"
  | "reject"
  | "open_new_run";
export type PatchRequestNextAction = RoundVerdict | "complete" | "recontract_adapter";
export type LifecycleDecisionSource =
  | "initial_round"
  | "missing_active_contract_frame"
  | "no_actionable_patch_ids"
  | "hard_rule"
  | "policy_snapshot"
  | "default_patch_authority"
  | "trajectory_policy";

export type AdapterCapabilityName =
  | "prepare_target"
  | "apply_change"
  | "run_target"
  | "capture_evidence"
  | "run_checks"
  | "grade_round";

export type ProofCapabilityName =
  | "capture_evidence"
  | "run_checks"
  | "grade_round";

export type VerificationCriterionOperator =
  | "equals"
  | "contains"
  | "regex"
  | "number_gte"
  | "number_lte";
export type QualityFindingSeverity = "critical" | "high" | "medium" | "low";
export type QualityFindingCategory =
  | "workflow_completeness"
  | "interaction_clarity"
  | "error_recovery"
  | "persistence"
  | "consistency"
  | "reference_fit"
  | "proof_signal"
  | "subjective_quality";
export type RemediationStrategy = "tighten" | "refine" | "pivot";
export type TrajectoryMode =
  | "tighten"
  | "refine"
  | "pivot"
  | "parallel_pivot";
export type TrajectoryRestartFrom =
  | "current_head"
  | "last_stable"
  | "best_passing";
export type TrajectoryDecisionSource =
  | "quality_critique"
  | "failure_policy"
  | "terminal_complete";

export type LiveVerificationMode = "browser" | "api" | "db" | "shell";
export type CoreVerificationProbeMode =
  | "browser_journey"
  | "browser"
  | "http_json"
  | "http"
  | "file_contains"
  | "json_value"
  | "shell_command";
export type CoreVerificationProbeRole = "supporting" | "release_gate";
export type CoreVerificationProbeScope = "target_root";
export type TargetManifestKey = "health_url" | "app_url" | "api_base_url";
export type ProbeSemanticLevel = "liveness" | "feature" | "workflow";

export type TargetSurface = "browser" | "api";
export type VerificationAssertionTag =
  | "browser"
  | "api"
  | "persistence"
  | "error_path"
  | "auth"
  | "consistency"
  | "workflow_multi_step"
  | "latency_budget"
  | "undo_redo"
  | "grounded_tool_use";
export type TargetFamily =
  | "generic-core"
  | "api-service"
  | "crud-api"
  | "chat-agent"
  | "browser-app"
  | "browser-editor"
  | "editor-app"
  | "fullstack-app"
  | "dashboard";
export type BrowserJourneyStepAction =
  | "goto"
  | "click"
  | "fill"
  | "press"
  | "reload"
  | "wait_for"
  | "assert_visible"
  | "assert_not_visible"
  | "assert_text"
  | "assert_value"
  | "assert_url";

export interface BrowserJourneyStep {
  action: BrowserJourneyStepAction;
  selector?: string;
  value?: string;
  timeout_ms?: number;
}

export interface RubricScoreDimension {
  dimension_id: string;
  label: string;
  description?: string;
  weight?: number;
  minimum_score: number;
  check_ids?: string[];
  requires_adapter?: boolean;
  requires_target_surfaces?: TargetSurface[];
  required_core_probe_modes?: CoreVerificationProbeMode[];
  skip_in_negotiation_modes?: NegotiationMode[];
  blocks_target_signal?: boolean;
}

export interface EvalScoreDimension {
  dimension_id: string;
  label: string;
  description?: string;
  weight: number;
  minimum_score: number;
  applicable: boolean;
  passed: boolean;
  score: number;
  contributing_check_ids: string[];
  contributing_probe_ids: string[];
  detail: string;
}

export interface IdeaBrief {
  title: string;
  summary: string;
  user_goals: string[];
  constraints: string[];
  quality_bar: string[];
  source_path: string;
  raw_markdown: string;
}

export interface LoopScenario {
  scenario_id: string;
  title: string;
  description: string;
  user_goals: string[];
  acceptance_highlights: string[];
  idea_source_path?: string;
  planner_notes?: string[];
}

export interface LoopRubric {
  rubric_id: string;
  evaluator_profile_path?: string;
  target_total_score: number;
  minimum_control_plane_score: number;
  minimum_proof_score: number;
  target_signal_requires_adapter: boolean;
  target_signal_requires_grade_score: boolean;
  stop_after_plateau_rounds: number;
  max_remediation_rounds: number;
  required_artifacts: string[];
  quality_dimensions: string[];
  score_dimensions?: RubricScoreDimension[];
}

export interface LoopRoundDirective {
  round_id: string;
  attempt_kind: AttemptKind;
  label: string;
  objective: string;
  focus_areas: HarnessFocusArea[];
  rewrite_scope: RewriteScope;
  acceptance_checks: string[];
}

export interface LoopImprovementContract {
  contract_id: string;
  attempt_kind: AttemptKind;
  objective: string;
  rewrite_scope: RewriteScope;
  focus_areas: HarnessFocusArea[];
  acceptance_checks: string[];
  notes: string[];
  carry_over_patch_ids?: string[];
  carry_over_check_ids?: string[];
}

export interface AttemptLifecycleDecision {
  negotiation_mode: NegotiationMode;
  continuation_authority: ContinuationAuthority;
  persist_contract_review: boolean;
  persist_contract_agreement: boolean;
  reopen_contract: boolean;
  decision_source: LifecycleDecisionSource;
  reason: string;
  recontract_reason?: RecontractReason;
  trajectory: TrajectoryDirective;
}

export interface FailureLineage {
  failing_check_ids: string[];
  failing_assertion_ids: string[];
  failing_probe_ids: string[];
  missing_target_manifest_keys: string[];
  contradictory_witness_assertion_ids: string[];
  release_regression_ids: string[];
  environment_blocked_probe_ids: string[];
  failure_classification?: FailureLineageClassification;
  unresolved_signature?: string;
  policy_snapshot?: FailureLineagePolicySnapshot;
}

export interface FailureLineagePolicySnapshot {
  recommended_action: FailureLineagePolicyAction;
  reasons: string[];
  trigger_codes: FailureLineageTriggerCode[];
  trigger_scores: Partial<Record<FailureLineageTriggerCode, number>>;
  dominant_trigger_code: FailureLineageTriggerCode;
  patch_authority_state: PatchAuthorityState;
  escalation_confidence: number;
  recommendation_source: FailureLineagePolicySource;
  repeated_failure_signature_count: number;
  repeated_failure_classification_count: number;
  unresolved_check_count: number;
  contradiction_count: number;
  regression_count: number;
  missing_manifest_count: number;
  plateau_delta_window: number[];
  plateau_without_progress: boolean;
  projected_plateau_count: number;
  plateau_limit: number;
  plateau_limit_reached: boolean;
  environment_blocked: boolean;
  scope_drift_detected: boolean;
}

export interface AdapterDriftReport {
  report_id: string;
  contract_id: string;
  round: number;
  kind: AdapterDriftKind;
  signals: AdapterDriftSignal[];
  recommended_action: "recontract_adapter";
  recontract_reason: RecontractReason;
  summary: string;
  reasons: string[];
  static_blockers: string[];
  missing_target_manifest_keys: string[];
  suggested_updates: string[];
}

export interface AdapterMigrationIdentityState {
  resume_identity_version: number;
  adapter_attached: boolean;
  evaluator_bundle_attached: boolean;
  adapter_contract_path?: string;
  adapter_contract_sha256?: string;
  evaluator_profile_path?: string;
  evaluator_bundle_sha256?: string;
  rubric_sha256?: string;
  executor_mode?: ExecutorMode;
  transport_mode?: TransportMode;
  target_family?: TargetFamily;
  validation_lane?: ValidationLane;
}

export interface AdapterMigrationIdentitySnapshot {
  adapter_contract_path?: string;
  adapter_contract_sha256?: string;
  target_root?: string;
  adapter_id?: string;
  provider_id?: string;
}

export interface AdapterMigrationProposal {
  proposal_id: string;
  run_id: string;
  round: number;
  source_adapter_drift_report_path: string;
  adapter_origin: AdapterOrigin;
  migration_class: AdapterMigrationClass;
  apply_mode: AdapterMigrationApplyMode;
  same_run_eligible: boolean;
  autoapply_eligible: boolean;
  requires_operator_acceptance: boolean;
  force_new_run: boolean;
  current_identity: AdapterMigrationIdentitySnapshot;
  proposed_identity: AdapterMigrationIdentitySnapshot;
  expected_post_apply_identity: AdapterMigrationIdentitySnapshot;
  affected_files: string[];
  affected_capabilities: AdapterCapabilityName[];
  reasons: string[];
  summary: string;
  suggested_updates: string[];
  proposed_runtime_config_patch?: Record<string, unknown>;
  proposed_contract_patch?: Record<string, unknown>;
  patch_bundle_path?: string;
}

export interface AdapterMigrationApplied {
  proposal_id: string;
  applied_at: string;
  apply_mode: AdapterMigrationApplyMode;
  changed_files: string[];
  backup_directory: string;
  old_identity: AdapterMigrationIdentityState;
  new_identity: AdapterMigrationIdentityState;
  same_run_authorized: boolean;
}

export interface AdapterMigrationResponse {
  proposal_id: string;
  decision: AdapterMigrationDecision;
  note?: string;
}

export interface RemediationHistory {
  repeated_unresolved_signature_count: number;
  repeated_failure_classification_count: number;
  unresolved_signature?: string;
  failing_assertion_ids: string[];
  failing_release_gate_probe_ids: string[];
  target_manifest_keys_missing: string[];
  regression_check_ids: string[];
  contradiction_count: number;
  environment_blocked: boolean;
  score_deltas: number[];
  patch_entropy: number;
  scope_drift_detected: boolean;
  patch_authority_state?: PatchAuthorityState;
  policy_snapshot?: FailureLineagePolicySnapshot;
}

export interface AdapterCommandSpec {
  command: string;
  args?: string[];
  cwd?: string;
  timeout_ms?: number;
  shell?: "powershell" | "sh" | "bash" | "cmd";
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
  capabilities: Partial<Record<AdapterCapabilityName, AdapterCommandSpec>>;
  verification_provider?: VerificationProviderSpec;
  // Deprecated: the harness no longer loads adapter-authored profiles.
  // Keep this field only so older adapters remain schema-compatible.
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
  started_at: string;
  finished_at: string;
  duration_ms: number;
  stdout_path: string;
  stdout_sha256: string;
  stderr_path: string;
  stderr_sha256: string;
  result_sha256: string;
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
  metadata?: Record<
    string,
    string | number | boolean | null | ReadonlyArray<string | number | boolean>
  >;
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

export interface RoundCheckResult {
  check_id: string;
  status: RoundCheckStatus;
  detail: string;
}

export interface ReleaseThresholdResults {
  contract_completed: boolean;
  minimum_control_plane_score_met: boolean;
  minimum_proof_score_met: boolean;
  minimum_release_score_met: boolean;
  adapter_required_met: boolean;
  grade_score_required_met: boolean;
  core_probe_required_met: boolean;
  dimension_thresholds_met: boolean;
  target_reached_eligible: boolean;
}

export interface EvalReport {
  generated_at: string;
  round: number;
  total_score: number;
  control_plane_score: number;
  proof_score: number;
  release_score: number;
  overall_verdict: RoundVerdict;
  strengths: string[];
  blockers: string[];
  next_actions: string[];
  evidence_paths: string[];
  threshold_gap_details: string[];
  check_results: RoundCheckResult[];
  resolved_check_ids: string[];
  unresolved_check_ids: string[];
  adapter_attached: boolean;
  threshold_results: ReleaseThresholdResults;
  dimension_scores: EvalScoreDimension[];
  adapter_results: AdapterCapabilityExecution[];
  core_probe_results: CoreVerificationProbeExecution[];
}

export interface QualityFinding {
  finding_id: string;
  category: QualityFindingCategory;
  severity: QualityFindingSeverity;
  summary: string;
  expected_change: string;
  evidence: string[];
  preserve: string[];
  pivot_or_refine: RemediationStrategy;
  target_check_ids: string[];
  probe_id?: string;
  dimension_id?: string;
  axis_id?: string;
}

export interface TrajectoryDirective {
  mode: TrajectoryMode;
  restart_from: TrajectoryRestartFrom;
  preserve_signals: string[];
  discardable_surface: string[];
  novelty_target: number;
  reason: string;
}

export interface QualityCritiqueArtifact {
  critique_id: string;
  contract_id: string;
  round: number;
  remediation_strategy: RemediationStrategy;
  quality_focus: string[];
  preserve_signals: string[];
  findings: QualityFinding[];
  notes: string[];
}

export interface TrajectoryDecisionArtifact extends TrajectoryDirective {
  trajectory_id: string;
  contract_id: string;
  round: number;
  decision_source: TrajectoryDecisionSource;
  selected_round?: number;
  frontier: {
    current_head: number;
    last_stable?: number;
    best_passing?: number;
  };
  anchor_reason: string;
}

export interface RoundArtifacts {
  round_directory: string;
  runtime_directory: string;
  contract_json_path: string;
  contract_md_path: string;
  contract_review_json_path: string;
  contract_review_md_path: string;
  contract_agreement_json_path: string;
  contract_agreement_md_path: string;
  generator_plan_json_path: string;
  generator_plan_md_path: string;
  evaluator_verdict_json_path: string;
  evaluator_verdict_md_path: string;
  patch_request_json_path: string;
  patch_request_md_path: string;
  quality_critique_json_path: string;
  quality_critique_md_path: string;
  trajectory_decision_json_path: string;
  trajectory_decision_md_path: string;
  round_result_json_path: string;
  eval_report_path: string;
  failure_lineage_path: string;
  adapter_drift_report_json_path: string;
  adapter_drift_report_md_path: string;
  adapter_migration_proposal_json_path: string;
  adapter_migration_proposal_md_path: string;
  adapter_migration_approval_prompt_path: string;
  adapter_migration_response_json_path: string;
  adapter_migration_response_md_path: string;
  adapter_migration_patch_path: string;
  adapter_migration_instructions_path: string;
  adapter_migration_applied_json_path: string;
  adapter_migration_applied_md_path: string;
  adapter_migration_authoring_task_path: string;
  adapter_migration_authoring_prompt_path: string;
  adapter_migration_authoring_response_path: string;
  target_manifest_path: string;
  core_probe_results_path: string;
  pre_verification_executions_path: string;
  post_verification_executions_path: string;
  adapter_executions_path: string;
  negotiation_state_path: string;
  contract_review_enhancement_task_path: string;
  contract_review_enhancement_prompt_path: string;
  contract_review_enhancement_response_path: string;
  generator_plan_enhancement_task_path: string;
  generator_plan_enhancement_prompt_path: string;
  generator_plan_enhancement_response_path: string;
  eval_enhancement_task_path: string;
  eval_enhancement_prompt_path: string;
  eval_enhancement_response_path: string;
  attached_generator_task_path: string;
  attached_generator_prompt_path: string;
  attached_generator_response_path: string;
  planner_context_path: string;
  generator_brief_path: string;
  qa_review_path: string;
  controller_decision_path: string;
  adapter_directory: string;
}

export interface AttachedGeneratorTaskArtifact {
  run_id: string;
  round: number;
  controller_mode: ControllerMode;
  transport_mode: Extract<TransportMode, "current-thread" | "app-server">;
  checkpoint_id: string;
  checkpoint_seq: number;
  target_root: string;
  task_cwd: string;
  writable_roots: string[];
  network_access: boolean;
  completion_timeout_ms: number;
  prompt_path: string;
  response_path: string;
  round_contract_path: string;
  generator_plan_path: string;
  patch_request_path?: string;
  transport_protocol_path?: string;
  summary: string;
  must_deliver: string[];
  must_fix: string[];
  must_preserve: string[];
  prototype_baseline_manifest_path?: string;
  prototype_baseline_screenshot_path?: string;
  prototype_baseline_source_phase?: string;
  prototype_baseline_valid?: boolean;
  notes?: string[];
  created_at: string;
}

export interface AdapterMigrationAuthoringTaskArtifact {
  run_id: string;
  round: number;
  controller_mode: "attached";
  transport_mode: "current-thread";
  authoring_mode: "same_run_apply" | "proposal_bundle";
  checkpoint_id: string;
  checkpoint_seq: number;
  prompt_path: string;
  response_path: string;
  proposal_path: string;
  patch_path: string;
  instructions_path: string;
  adapter_contract_path: string;
  target_root: string;
  writable_roots: string[];
  transport_protocol_path?: string;
  summary: string;
  expected_post_apply_identity: AdapterMigrationIdentitySnapshot;
  allowed_paths: string[];
  notes?: string[];
  created_at: string;
}

export interface AdapterMigrationAuthoringResponseArtifact {
  checkpoint_id?: string;
  status: "authored" | "blocked" | "noop";
  summary: string;
  patch_bundle_path?: string;
  changed_files?: string[];
  notes?: string[];
  generated_at: string;
}

export type CurrentThreadEnhancementStage =
  | "planner"
  | "contract-review"
  | "generator-plan"
  | "evaluator";

export interface CurrentThreadEnhancementTaskArtifact {
  run_id: string;
  round?: number;
  phase: ControllerRoundPhase;
  stage: CurrentThreadEnhancementStage;
  controller_mode: "attached";
  transport_mode: "current-thread";
  checkpoint_id: string;
  checkpoint_seq: number;
  prompt_path: string;
  response_path: string;
  transport_protocol_path?: string;
  summary: string;
  context_paths: Record<string, string>;
  notes?: string[];
  created_at: string;
}

export interface AttachedGeneratorResponseArtifact {
  checkpoint_id?: string;
  status: "applied" | "noop" | "blocked";
  summary: string;
  changed_files?: string[];
  notes?: string[];
  evidence_paths?: string[];
  generated_at: string;
}

export interface CurrentThreadAutoContinueContract {
  state: CurrentThreadAutoContinueState;
  run_id: string;
  run_directory: string;
  worker: OperatorWorkerSkill;
  recovery_skill: Extract<OperatorRecoverySkill, "attached-loop">;
  checkpoint_id?: string;
  checkpoint_seq?: number;
  checkpoint_kind?: CurrentThreadCheckpointKind;
  attention_required?: OperatorAttentionRequired;
  active_prompt_path?: string;
  active_response_path?: string;
  recommended_skill?: OperatorRecommendedSkill;
  resume_command?: string;
  stop_reason?: RunStopReason;
  user_visible_pause?: boolean;
  hop_limit?: number;
  hop_index?: number;
  repeated_checkpoint_count?: number;
  guard_reason?:
    | "hop_limit_reached"
    | "checkpoint_loop_detected"
    | "checkpoint_no_progress"
    | "stale_checkpoint_response";
  notes?: string[];
}

export interface RoundContractArtifact {
  contract_id: string;
  round: number;
  attempt_kind: AttemptKind;
  negotiation_mode: NegotiationMode;
  recontract_mode?: boolean;
  adapter_only_paths?: string[];
  continuation_authority: ContinuationAuthority;
  recontract_reason?: RecontractReason;
  objective: string;
  rewrite_scope: RewriteScope;
  focus_areas: HarnessFocusArea[];
  acceptance_checks: string[];
  release_gate_check_ids: string[];
  browser_release_gate_probe_ids: string[];
  api_release_gate_probe_ids: string[];
  required_live_verification_modes: LiveVerificationMode[];
  proof_plan: string[];
  pivot_triggers: string[];
  success_thresholds: {
    target_total_score: number;
    minimum_control_plane_score: number;
    minimum_proof_score: number;
  };
  required_artifacts: string[];
  non_goals: string[];
  carry_over_context: string[];
  carry_over_patch_ids: string[];
  carry_over_check_ids: string[];
  trajectory: TrajectoryDirective;
  adapter_expectations: string[];
}

export interface ContractReviewArtifact {
  contract_id: string;
  review_id: string;
  decision: "accept" | "revise";
  concerns: string[];
  required_changes: string[];
  approved_checks: string[];
  adapter_ready: boolean;
  static_blockers: string[];
}

export interface ContractAgreementArtifact {
  contract_id: string;
  agreement_id: string;
  status: "agreed" | "blocked";
  objective: string;
  acceptance_checks: string[];
  generator_must_deliver: string[];
  evaluator_must_verify: string[];
  carry_over_context: string[];
}

export interface ActiveContractFrame {
  source_round: number;
  contract_id: string;
  objective: string;
  focus_areas: HarnessFocusArea[];
  rewrite_scope: RewriteScope;
  acceptance_checks: string[];
  agreement: ContractAgreementArtifact;
}

export interface GeneratorPlanArtifact {
  contract_id: string;
  agreement_id: string;
  generator_plan_id: string;
  implementation_intent: string;
  remediation_strategy?: RemediationStrategy;
  trajectory: TrajectoryDirective;
  target_check_ids: string[];
  quality_focus?: string[];
  must_preserve?: string[];
  files_to_touch: string[];
  expected_proof: string[];
  risk_notes: string[];
  out_of_scope: string[];
  adapter_actions: string[];
}


export interface EvaluatorVerdictArtifact {
  contract_id: string;
  verdict_id: string;
  overall_verdict: RoundVerdict;
  findings: string[];
  release_blockers: string[];
  contract_completed: boolean;
}

export interface PatchRequestItem {
  id: string;
  why: string;
  expected_change: string;
  target_check_ids: string[];
  source_round: number;
}

export interface PatchRequestArtifact {
  request_id: string;
  derived_from_verdict_id: string;
  next_action: PatchRequestNextAction;
  priority: "blocking" | "important" | "polish";
  remediation_strategy?: RemediationStrategy;
  must_fix: PatchRequestItem[];
  quality_findings?: QualityFinding[];
  environment_blockers?: string[];
  adapter_drift_kind?: AdapterDriftKind;
  adapter_drift_signals?: AdapterDriftSignal[];
  adapter_drift_summary?: string;
  preserve_signals?: string[];
  must_preserve: string[];
  forbidden_scope_expansion: string[];
  promotion_rule: string;
}

export interface RoundResultArtifact {
  round: number;
  contract_id: string;
  agreement_id: string;
  generator_plan_id: string;
  verdict_id: string;
  request_id: string;
  quality_critique_id?: string;
  total_score: number;
  control_plane_score: number;
  proof_score: number;
  release_score: number;
  overall_verdict: RoundVerdict;
  selected_for_run: boolean;
  status: "advanced" | "revised" | "blocked";
  eval_report_path: string;
  evidence_paths: string[];
  check_pass_rate: number;
  previous_patch_request_addressed: boolean;
  previous_patch_request_resolved: boolean;
  resolved_check_ids: string[];
  unresolved_check_ids: string[];
  threshold_results: ReleaseThresholdResults;
}

export interface RoundSummary {
  round: number;
  attempt_kind: AttemptKind;
  negotiation_mode: NegotiationMode;
  continuation_authority: ContinuationAuthority;
  decision_source: LifecycleDecisionSource;
  controller_mode?: ControllerMode;
  transport_mode?: TransportMode;
  recontract_reason?: RecontractReason;
  label: string;
  controller_reason: string;
  trajectory: TrajectoryDirective;
  objective: string;
  target_family?: TargetFamily;
  validation_lane?: ValidationLane;
  round_stop_reason?: RoundStopReason;
  total_score: number;
  control_plane_score: number;
  proof_score: number;
  release_score: number;
  overall_verdict: RoundVerdict;
  check_pass_rate: number;
  contract_path: string;
  contract_review_path?: string;
  contract_agreement_path?: string;
  generator_plan_path: string;
  evaluator_verdict_path: string;
  patch_request_path: string;
  quality_critique_path?: string;
  trajectory_decision_path: string;
  eval_report_path: string;
  failure_lineage_path?: string;
  adapter_drift_report_path?: string;
  adapter_migration_proposal_path?: string;
  adapter_migration_applied_path?: string;
  planner_context_path: string;
  generator_brief_path: string;
  qa_review_path: string;
  controller_decision_path: string;
  evidence_paths: string[];
  previous_patch_request_addressed: boolean;
  previous_patch_request_resolved: boolean;
  resolved_check_ids: string[];
  unresolved_check_ids: string[];
  threshold_results: ReleaseThresholdResults;
  dimension_scores: EvalScoreDimension[];
  failure_lineage?: FailureLineage;
}

export interface LoopPlan {
  scenario_id: string;
  rubric_id: string;
  target_total_score: number;
  minimum_control_plane_score: number;
  minimum_proof_score: number;
  target_signal_requires_adapter: boolean;
  target_signal_requires_grade_score: boolean;
  stop_after_plateau_rounds: number;
  max_remediation_rounds: number;
  max_rounds: number;
  north_star: string;
  attempt_strategy: string;
  planner_focus_areas: HarnessFocusArea[];
  planner_acceptance_checks: string[];
  remediation_policy: string[];
  planner_notes: string[];
  idea_title?: string;
  idea_source_path?: string;
}

export type BuildBriefSurface =
  | "web"
  | "mobile"
  | "desktop"
  | "api"
  | "dashboard"
  | "editor"
  | "agent";
export type BuildBriefAuthMode = "required" | "optional" | "none" | "unknown";
export type BuildBriefDataMode =
  | "mock"
  | "seeded"
  | "real"
  | "hybrid"
  | "unknown";
export type BuildBriefDeliveryLevel =
  | "prototype"
  | "mvp"
  | "usable"
  | "production-like"
  | "custom";
export type BuildBriefExecutionPreference =
  | "speed"
  | "balanced"
  | "correctness";
export type SessionRunMode = "foreground_same_thread";
export type SessionLoopStatus =
  | "asking"
  | "preparing"
  | "ready_to_start"
  | "running"
  | "needs_steering"
  | "blocked_externally"
  | "ready_for_review"
  | "done";
export type SessionReadiness =
  | "needs_input"
  | "ready_to_run"
  | "running"
  | "blocked"
  | "ready_for_review"
  | "complete";
export type SessionAttention = "codex" | "human" | "external" | "review" | "none";
export type SessionAttentionKind =
  | "none"
  | "steering"
  | "review"
  | "external_block"
  | "decision";
export type SessionBindingSurface =
  | "current-thread"
  | "app-server"
  | "manual-protocol";
export type SessionBindingState = "bound" | "unbound" | "degraded";
export type SessionReviewBoundary =
  | "diff_ready"
  | "milestone_scope_complete"
  | "risk_gate"
  | "release_candidate";
export type SessionApprovalBoundary =
  | "scope_change"
  | "destructive_change"
  | "external_access"
  | "deploy"
  | "new_run_required";
export type SessionSteeringTrigger =
  | "product_ambiguity"
  | "priority_conflict"
  | "blocked_external"
  | "review_feedback"
  | "risk_gate_failure";

export interface BuildBriefArtifact {
  brief_id: string;
  source_request: string;
  created_at: string;
  updated_at: string;
  product: {
    title: string;
    summary: string;
    target_users: string[];
    core_workflows: string[];
    success_definition: string[];
    references: string[];
  };
  surface: {
    primary_surface: BuildBriefSurface;
    secondary_surfaces?: BuildBriefSurface[];
    auth_mode: BuildBriefAuthMode;
  };
  delivery: {
    level: BuildBriefDeliveryLevel;
    execution_preference: BuildBriefExecutionPreference;
  };
  execution_context: {
    project_mode: "new" | "existing";
    target_root: string;
    workspace_mode_preference: OperatorWorkspaceSurface;
    run_command?: string;
    check_command?: string;
    target_manifest_hints?: Partial<Record<TargetManifestKey, string>>;
  };
  constraints: {
    stack_preferences: string[];
    data_mode: BuildBriefDataMode;
    integrations: string[];
    non_goals: string[];
    repo_constraints: string[];
  };
  defaults_accepted: string[];
  unresolved_questions: string[];
  operator_status_vocabulary: SessionLoopStatus[];
}

export interface SessionRunContractArtifact {
  contract_id: string;
  brief_id: string;
  created_at: string;
  updated_at: string;
  run_mode: SessionRunMode;
  current_thread_required: boolean;
  start_gate: {
    required: boolean;
    authorized: boolean;
    authorized_at: string | null;
    authorized_by: string | null;
  };
  workspace_mode: OperatorWorkspaceSurface;
  objective: string;
  non_goals: string[];
  discovery_policy: {
    max_questions_per_turn: number;
    ask_only_missing_high_impact_questions: boolean;
    prefer_defaults_over_low_value_questions: boolean;
  };
  execution_controls: {
    project_mode: "new" | "existing";
    target_root: string;
    target_score: number;
    max_rounds: number;
    run_command?: string;
    check_command?: string;
    target_manifest_hints?: Partial<Record<TargetManifestKey, string>>;
  };
  validation_strategy: {
    iteration_mode: "patch_oriented";
    evaluator_mode: "risk_triggered";
    review_surface: "codex_review_pane";
  };
  review_boundaries: SessionReviewBoundary[];
  approval_boundaries: SessionApprovalBoundary[];
  steering_triggers: SessionSteeringTrigger[];
  required_prepare_artifacts: string[];
  derived_attempt_artifacts: string[];
  operator_surface_path: string;
  open_questions_path: string;
  execution_plan_path: string;
  stop_rule: {
    done_when: string[];
    stop_on: string[];
  };
}

export interface SessionActiveCheckpointArtifact {
  checkpoint_id?: string;
  kind: CurrentThreadCheckpointKind;
  skill: OperatorRecommendedSkill;
  prompt_path?: string;
  response_path?: string;
}

export interface SessionBindingArtifact {
  surface: SessionBindingSurface;
  binding_state: SessionBindingState;
  thread_id?: string;
  turn_id?: string;
}

export interface SessionStatusArtifact {
  run_id: string;
  updated_at: string;
  session_status: SessionLoopStatus;
  readiness: SessionReadiness;
  next_attention: SessionAttention;
  attention_kind: SessionAttentionKind;
  objective: string;
  workspace_mode: OperatorWorkspaceSurface;
  current_thread_required: boolean;
  deferred_question_count: number;
  steering_note_count: number;
  review_feedback_count: number;
  external_blocker_count: number;
  session_binding: SessionBindingArtifact;
  active_checkpoint?: SessionActiveCheckpointArtifact;
  latest_round?: number;
  latest_stop_reason?: string;
  artifacts: {
    build_brief_path: string;
    run_contract_path: string;
    open_questions_path: string;
    operator_surface_path: string;
    session_status_events_path: string;
    session_stream_path: string;
    execution_plan_path: string;
  };
}

export interface SessionStatusEventArtifact {
  event_id: string;
  run_id: string;
  sequence: number;
  created_at: string;
  event_type: "session_initialized" | "session_changed";
  session_status_path: string;
  changed_fields: string[];
  session: SessionStatusArtifact;
}

export interface SessionStreamContractArtifact {
  contract_id: string;
  run_id: string;
  updated_at: string;
  transport_mode: TransportMode;
  preferred_delivery: "file_tail_jsonl" | "app_server_notification_jsonl";
  snapshot_path: string;
  source_events_path: string;
  app_server_events_path?: string;
  event_type: "harness/session.changed";
  latest_source_sequence?: number;
  latest_session?: OperatorSurfaceSessionProjection;
  widget: {
    kind: "session_status";
    title: string;
    primary_fields: Array<
      | "session_status"
      | "readiness"
      | "next_attention"
      | "attention_kind"
      | "objective"
    >;
    count_fields: Array<
      | "deferred_question_count"
      | "steering_note_count"
      | "review_feedback_count"
      | "external_blocker_count"
    >;
  };
}

export interface OperatorSurfaceSessionProjection {
  objective: string;
  session_status: SessionLoopStatus;
  readiness: SessionReadiness;
  next_attention: SessionAttention;
  attention_kind: SessionAttentionKind;
  deferred_question_count: number;
  steering_note_count: number;
  review_feedback_count: number;
  external_blocker_count: number;
  session_binding: SessionBindingArtifact;
  active_checkpoint?: SessionActiveCheckpointArtifact;
  latest_round?: number;
  latest_stop_reason?: string;
}

export interface LoopRunSummary {
  run_id: string;
  round_count: number;
  scenario_id: string;
  rubric_id: string;
  controller_mode?: ControllerMode;
  transport_mode?: TransportMode;
  executor_mode?: ExecutorMode;
  target_family?: TargetFamily;
  validation_lane?: ValidationLane;
  evaluator_profile_path?: string;
  adapter_contract_sha256?: string;
  evaluator_bundle_sha256?: string;
  rubric_sha256?: string;
  total_score: number;
  control_plane_score: number;
  proof_score: number;
  release_score: number;
  planner_brief_path?: string;
  idea_path?: string;
  feature_list_path?: string;
  progress_path?: string;
  progress_log_path?: string;
  done_when_path?: string;
  init_script_path?: string;
  planned_scenario_path?: string;
  plan_path?: string;
  codex_handoff_path?: string;
  adapter_contract_path?: string;
  adapter_id?: string;
  verification_provider_id?: string;
  adapter_attached?: boolean;
  codex_session_registry_path?: string;
  resume_identity_path?: string;
  runtime_live_state_path?: string;
  runtime_round_phase_path?: string;
  controller_lease_path?: string;
  transport_state_path?: string;
  transport_protocol_path?: string;
  operator_surface_path?: string;
  session_status_path?: string;
  session_status_events_path?: string;
  session_stream_path?: string;
  adapter_migration_applied_path?: string;
  stop_reason?: RunStopReason;
  selection_basis?: "terminal_round";
  best_round?: number;
  terminal_round?: number;
  threshold_results?: ReleaseThresholdResults;
  dimension_scores?: EvalScoreDimension[];
  best_scoring_total_score?: number;
  best_scoring_control_plane_score?: number;
  best_scoring_proof_score?: number;
  best_scoring_release_score?: number;
  best_scoring_threshold_results?: ReleaseThresholdResults;
  round_history?: RoundSummary[];
  runtime_warnings?: string[];
  runtime_events?: RuntimeEvent[];
  bundle_migrated?: boolean;
  previous_bundle_fingerprint?: string;
  new_bundle_fingerprint?: string;
  resume_migration_path?: string;
  resume_decision_path?: string;
  resumed_from_run_id?: string;
}

export interface RuntimeEvent {
  code: RuntimeEventCode;
  message: string;
  created_at: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface RuntimeRoundPhaseArtifact {
  run_id: string;
  round: number;
  controller_mode: ControllerMode;
  transport_mode: TransportMode;
  executor_mode?: ExecutorMode;
  phase: ControllerRoundPhase;
  status: ControllerPhaseStatus;
  updated_at: string;
  heartbeat_at: string;
  last_progress_at?: string;
  last_progress_note?: string;
  phase_timeout_ms?: number;
  stall_threshold_ms?: number;
  owner_pid?: number;
  phase_started_at?: string;
  phase_completed_at?: string;
  session?: {
    thread_id?: string;
  };
  artifacts?: Record<string, string>;
  notes?: string[];
}

export interface ControllerLeaseArtifact {
  run_id: string;
  controller_mode: ControllerMode;
  transport_mode: TransportMode;
  executor_mode?: ExecutorMode;
  status: "running" | "paused" | "stalled" | "stopped" | "failed";
  updated_at: string;
  heartbeat_at: string;
  last_progress_at?: string;
  owner_pid?: number;
  round?: number;
  phase?: ControllerRoundPhase;
  phase_status?: ControllerPhaseStatus;
  summary_path?: string;
  live_state_path?: string;
}

export interface RuntimeLiveStateArtifact {
  run_id: string;
  controller_mode: ControllerMode;
  transport_mode: TransportMode;
  executor_mode?: ExecutorMode;
  updated_at: string;
  heartbeat_at: string;
  execution_state: ExecutionState;
  last_progress_at?: string;
  last_progress_note?: string;
  phase_timeout_ms?: number;
  stall_threshold_ms?: number;
  round_count: number;
  active_round?: number;
  active_phase?: ControllerRoundPhase;
  active_phase_status?: ControllerPhaseStatus;
  latest_round_summary_path?: string;
  latest_eval_report_path?: string;
  best_round?: number;
  best_total_score?: number;
  stop_reason?: RunStopReason;
  summary_path?: string;
  round_phase_path?: string;
  controller_lease_path?: string;
  notes?: string[];
}

export interface OperatorSurfaceArtifact {
  run_id: string;
  controller_mode: ControllerMode;
  transport_mode: TransportMode;
  presentation_mode: OperatorPresentationMode;
  launch_origin: OperatorLaunchOrigin;
  surface_owner: OperatorSurfaceOwner;
  thread_binding_state: ThreadBindingState;
  entrypoint: OperatorEntrypoint;
  app_visibility: OperatorAppVisibility;
  workspace_surface: OperatorWorkspaceSurface;
  handoff_state: OperatorHandoffState;
  resume_skill: OperatorResumeSkill;
  worker_skill?: OperatorWorkerSkill;
  recovery_skill?: OperatorRecoverySkill;
  requires_codex_app: boolean;
  updated_at: string;
  execution_state: ExecutionState | "configured";
  round?: number;
  phase?: ControllerRoundPhase;
  phase_status?: ControllerPhaseStatus;
  attention_required?: OperatorAttentionRequired;
  checkpoint_kind?: CurrentThreadCheckpointKind;
  checkpoint_id?: string;
  checkpoint_seq?: number;
  auto_resume_eligible?: boolean;
  user_visible_pause?: boolean;
  decision_options?: AdapterMigrationDecision[];
  summary_path?: string;
  transport_state_path?: string;
  transport_protocol_path?: string;
  session_status_path?: string;
  session_status_events_path?: string;
  session_stream_path?: string;
  next_action?: string;
  active_prompt_path?: string;
  active_response_path?: string;
  dashboard_path?: string;
  thread_id?: string;
  thread_name?: string;
  worktree_id?: string;
  worktree_path?: string;
  recommended_skill?: OperatorRecommendedSkill;
  recommended_command?: string;
  resume_command?: string;
  session?: OperatorSurfaceSessionProjection;
  notes?: string[];
}

export interface TransportStateArtifact {
  run_id: string;
  controller_mode: ControllerMode;
  transport_mode: TransportMode;
  presentation_mode?: OperatorPresentationMode;
  launch_origin?: OperatorLaunchOrigin;
  surface_owner?: OperatorSurfaceOwner;
  thread_binding_state?: ThreadBindingState;
  entrypoint?: OperatorEntrypoint;
  app_visibility?: OperatorAppVisibility;
  executor_mode?: ExecutorMode;
  updated_at: string;
  status:
    | "configured"
    | "live"
    | "idle"
    | "completed"
    | "interrupted"
    | "blocked"
    | "closed";
  summary_path?: string;
  protocol_path?: string;
  ui_binding_mode?: UiBindingMode;
  ui_surface?: {
    thread_name?: string;
    dashboard_path?: string;
    session_status_path?: string;
    session_status_events_path?: string;
    session_stream_path?: string;
    session?: OperatorSurfaceSessionProjection;
  };
  notes?: string[];
  last_error?: string;
  app_server?: {
    implemented: boolean;
    transport: "stdio";
    initialized: boolean;
    command: string;
    args: string[];
    server_pid?: number;
    thread_id?: string;
    thread_name?: string;
    thread_lifecycle:
      | "not_started"
      | "subscribed"
      | "unsubscribed"
      | "closed"
      | "archived"
      | "error";
    thread_runtime_status?: "notLoaded" | "idle" | "active" | "systemError";
    thread_active_flags?: string[];
    turn_id?: string;
    turn_status:
      | "not_started"
      | "inProgress"
      | "completed"
      | "interrupted"
      | "failed"
      | "error";
    last_request_method?: string;
    last_event_method?: string;
    last_event_at?: string;
    event_cursor?: number;
    requests_path?: string;
    events_path?: string;
    required_methods: string[];
    expected_event_types: string[];
  };
}

export interface SupervisorStateArtifact {
  status:
    | "launching"
    | "watching"
    | "restarting"
    | "paused"
    | "completed"
    | "failed"
    | "detached";
  launched_at: string;
  updated_at: string;
  owner_pid: number;
  controller_mode?: ControllerMode;
  transport_mode?: TransportMode;
  run_id?: string;
  run_directory?: string;
  resume_run_path?: string;
  child_pid?: number;
  restart_count: number;
  max_restarts: number;
  execution_state?: ExecutionState;
  heartbeat_age_ms?: number;
  progress_age_ms?: number;
  last_exit_code?: number;
  last_error?: string;
  log_path?: string;
  summary_path?: string;
  stop_reason?: RunStopReason;
}

export interface ResumeDecisionArtifact {
  run_id: string;
  decided_at: string;
  decision: "continue" | "noop_terminal" | "reopened_terminal";
  previous_stop_reason?: RunStopReason;
  force_reopen_terminal: boolean;
  allow_resume_migration: boolean;
  mismatches: string[];
  runtime_event_codes: RuntimeEventCode[];
}

export interface PlannerStageResult {
  planned_scenario_path: string;
  plan_path: string;
  planner_brief_path: string;
  idea: IdeaBrief;
  scenario: LoopScenario;
  plan: LoopPlan;
  rubric: LoopRubric;
}

export interface ClosedLoopResult {
  plan: LoopPlan;
  summary: LoopRunSummary;
  runDirectory: string;
  plannedScenarioPath?: string;
}

export interface SingleRoundResult {
  summary: LoopRunSummary;
  runDirectory: string;
  roundDirectory: string;
}
