import type {
  AdapterDriftKind,
  AdapterDriftSignal,
  AttemptKind,
  ContinuationAuthority,
  ControllerMode,
  FailureLineage,
  HarnessFocusArea,
  LifecycleDecisionSource,
  NegotiationMode,
  PatchRequestNextAction,
  QualityFinding,
  RecontractReason,
  RemediationStrategy,
  RewriteScope,
  RoundCheckStatus,
  RoundStopReason,
  RoundVerdict,
  TargetFamily,
  TargetSurface,
  TransportMode,
  TrajectoryDirective,
  ValidationLane,
  CoreVerificationProbeMode,
  LiveVerificationMode
} from "./controller.js";
import type {
  AdapterCapabilityExecution,
  CoreVerificationProbeExecution
} from "./adapter.js";

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

export interface CarryForwardGateArtifact {
  schema_version: string;
  artifact_type: "carry_forward_gate";
  generated_at: string;
  round: number;
  previous_patch_target_check_ids: string[];
  actionable_target_check_ids: string[];
  addressed: boolean;
  resolved: boolean;
  resolution_source: "carry_forward_gate";
  target_results: RoundCheckResult[];
  missing_target_check_ids: string[];
  notes: string[];
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
  scorecard_json_path: string;
  scorecard_md_path: string;
  carry_forward_gate_path: string;
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

export interface RoundContractArtifact {
  schema_version: string;
  artifact_type: "round_contract";
  run_id: string;
  created_at: string;
  producer: "loop-orchestrator";
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
  scorecard_path?: string;
  evidence_paths: string[];
  check_pass_rate: number;
  previous_patch_request_addressed: boolean;
  previous_patch_request_resolved: boolean;
  carry_forward_gate_path?: string;
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
  scorecard_path?: string;
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
  carry_forward_gate_path?: string;
  resolved_check_ids: string[];
  unresolved_check_ids: string[];
  threshold_results: ReleaseThresholdResults;
  dimension_scores: EvalScoreDimension[];
  failure_lineage?: FailureLineage;
}
