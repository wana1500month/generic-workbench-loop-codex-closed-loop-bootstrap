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
