import type { BuildBriefDeliveryLevel, TargetFamily } from "./types.js";

export type SessionProjectMode = "new" | "existing";

export type ProductIntakeFieldId =
  | "product_summary"
  | "target_users"
  | "core_workflows"
  | "references"
  | "finish_line";

export type ExecutionIntakeFieldId =
  | "project_mode"
  | "target_root"
  | "target_score"
  | "max_rounds"
  | "run_command"
  | "ready_url";

export type SessionIntakeFieldId = ProductIntakeFieldId | ExecutionIntakeFieldId;

export type DiscoveryPhase =
  | "product"
  | "execution"
  | "ready_for_prepare"
  | "prepared";

export type FrontDoorSessionStatus =
  | "not_product_build_request"
  | "ask_product_questions"
  | "ask_execution_questions"
  | "ready_for_prepare"
  | "prepared";

export interface PreparedRunReference {
  run_id: string;
  run_directory: string;
  prepared_at: string;
}

export interface SessionCustomQualityMetric {
  metric_id: string;
  label: string;
  description: string;
  minimum_score_out_of_ten: number;
  required?: boolean;
  weight?: number;
}

export interface SessionIntakeSnapshot {
  product_title?: string;
  product_summary?: string;
  target_users?: string[];
  core_features?: string[];
  reference_apps?: string[];
  finish_line?: string;
  target_family?: TargetFamily;
  goal_level?: BuildBriefDeliveryLevel;
  target_score?: number;
  max_rounds?: number;
  target_root?: string;
  project_mode?: SessionProjectMode;
  framework_hint?: string;
  package_manager?: string;
  run_command?: string;
  check_command?: string;
  ready_url?: string;
  app_url?: string;
  health_url?: string;
  api_base_url?: string;
  constraints?: string[];
  quality_bar?: string[];
  must_not_break?: string[];
  failure_expectations?: string[];
  continuity_boundaries?: string[];
  reference_signals?: string[];
  non_goals?: string[];
  probe_hints?: Record<string, string>;
  custom_quality_metrics?: SessionCustomQualityMetric[];
  notes?: string;
}

export interface FrontDoorSessionConflict {
  field: keyof SessionIntakeSnapshot;
  existing_value: unknown;
  candidate_value: unknown;
  source_turn: number;
}

export interface FrontDoorSessionArtifact {
  session_id: string;
  thread_id?: string;
  lane: "product_build";
  source_request: string;
  phase: DiscoveryPhase;
  intake: SessionIntakeSnapshot;
  missing_product_fields: ProductIntakeFieldId[];
  missing_execution_fields: ExecutionIntakeFieldId[];
  asked_question_ids: SessionIntakeFieldId[];
  last_question_ids: SessionIntakeFieldId[];
  last_question_batch: string[];
  defaults_accepted: string[];
  unresolved_conflicts: FrontDoorSessionConflict[];
  prepared_run?: PreparedRunReference;
  turn_count: number;
  created_at: string;
  updated_at: string;
}
