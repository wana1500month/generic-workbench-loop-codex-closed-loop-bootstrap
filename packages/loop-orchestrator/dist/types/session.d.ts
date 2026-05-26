import type { CurrentThreadCheckpointKind, OperatorForegroundOwner, OperatorRecommendedSkill, OperatorUiVisibility, OperatorWorkspaceSurface, TargetFamily, TargetManifestKey, TransportMode, ValidationLane } from "./controller.js";
export type BuildBriefSurface = "web" | "mobile" | "desktop" | "api" | "dashboard" | "editor" | "agent";
export type BuildBriefAuthMode = "required" | "optional" | "none" | "unknown";
export type BuildBriefDataMode = "mock" | "seeded" | "real" | "hybrid" | "unknown";
export type BuildBriefDeliveryLevel = "prototype" | "mvp" | "usable" | "production-like" | "custom";
export type BuildBriefExecutionPreference = "speed" | "balanced" | "correctness";
export type SessionRunMode = "foreground_same_thread";
export type SessionLoopStatus = "asking" | "preparing" | "prepared_with_blockers" | "ready_to_start" | "running" | "needs_steering" | "blocked_externally" | "ready_for_review" | "done";
export type SessionReadiness = "needs_input" | "ready_to_run" | "running" | "blocked" | "ready_for_review" | "complete";
export type SessionAttention = "codex" | "human" | "external" | "review" | "none";
export type SessionAttentionKind = "none" | "steering" | "review" | "external_block" | "decision";
export type SessionBindingSurface = "current-thread" | "app-server" | "manual-protocol";
export type SessionBindingState = "bound" | "unbound" | "degraded";
export type SessionReviewBoundary = "diff_ready" | "milestone_scope_complete" | "risk_gate" | "release_candidate";
export type SessionApprovalBoundary = "scope_change" | "destructive_change" | "external_access" | "deploy" | "new_run_required";
export type SessionSteeringTrigger = "product_ambiguity" | "priority_conflict" | "blocked_external" | "review_feedback" | "risk_gate_failure";
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
    discovery_source?: {
        front_door_session_path: string;
        turn_count: number;
        session_id?: string;
        thread_id?: string;
    };
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
        validation_bundle?: {
            target_family: TargetFamily;
            validation_lane?: ValidationLane;
            adapter_contract_path?: string;
            rubric_path?: string;
            evaluator_profile_path?: string;
        };
    };
    continuation_policy?: {
        mode: "patch_first";
        recontract_only_on: string[];
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
    ui_visibility: OperatorUiVisibility;
    foreground_owner: OperatorForegroundOwner;
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
        primary_fields: Array<"session_status" | "readiness" | "next_attention" | "attention_kind" | "objective">;
        count_fields: Array<"deferred_question_count" | "steering_note_count" | "review_feedback_count" | "external_blocker_count">;
    };
}
export interface OperatorSurfaceSessionProjection {
    objective: string;
    session_status: SessionLoopStatus;
    readiness: SessionReadiness;
    next_attention: SessionAttention;
    attention_kind: SessionAttentionKind;
    ui_visibility: OperatorUiVisibility;
    foreground_owner: OperatorForegroundOwner;
    deferred_question_count: number;
    steering_note_count: number;
    review_feedback_count: number;
    external_blocker_count: number;
    session_binding: SessionBindingArtifact;
    active_checkpoint?: SessionActiveCheckpointArtifact;
    latest_round?: number;
    latest_stop_reason?: string;
}
//# sourceMappingURL=session.d.ts.map