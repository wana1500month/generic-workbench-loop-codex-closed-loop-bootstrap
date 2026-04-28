import type {
  AdapterMigrationIdentitySnapshot,
  AdapterMigrationDecision,
  ControllerMode,
  ControllerPhaseStatus,
  ControllerRoundPhase,
  CurrentThreadAutoContinueState,
  CurrentThreadCheckpointKind,
  ExecutionState,
  ExecutorMode,
  OperatorAppVisibility,
  OperatorAttentionRequired,
  OperatorEntrypoint,
  OperatorForegroundOwner,
  OperatorHandoffState,
  OperatorLaunchOrigin,
  OperatorPresentationMode,
  OperatorRecoverySkill,
  OperatorRecommendedSkill,
  OperatorResumeSkill,
  OperatorSurfaceOwner,
  OperatorUiVisibility,
  OperatorWorkerSkill,
  OperatorWorkspaceSurface,
  RunStopReason,
  RuntimeEventCode,
  TargetFamily,
  ThreadBindingState,
  TransportMode,
  UiBindingMode,
  ValidationLane
} from "./controller.js";
import type {
  EvalScoreDimension,
  ReleaseThresholdResults,
  RoundSummary
} from "./evaluator.js";
import type { LoopPlan } from "./bootstrap.js";
import type { OperatorSurfaceSessionProjection } from "./session.js";

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
  build_brief_snapshot?: {
    title: string;
    summary: string;
    target_users: string[];
    core_workflows: string[];
    success_definition: string[];
  };
  verification_requirements?: {
    required_selectors: Array<{
      probe_id: string;
      label: string;
      selector: string;
      action: string;
    }>;
    browser_probe_ids: string[];
    api_probe_paths: Array<{
      probe_id: string;
      path: string;
      expected_value?: string;
    }>;
  };
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
  ui_visibility: OperatorUiVisibility;
  foreground_owner: OperatorForegroundOwner;
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
  ui_visibility: OperatorUiVisibility;
  foreground_owner: OperatorForegroundOwner;
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
  adapter_plan_path?: string;
  adapter_contract_path?: string;
  evaluator_profile_path?: string;
  adapter_review_task_path?: string;
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
