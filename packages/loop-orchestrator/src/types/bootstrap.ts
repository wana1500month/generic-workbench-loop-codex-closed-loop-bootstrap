import type { HarnessFocusArea, ValidationLane } from "./controller.js";
import type { LoopRubric } from "./evaluator.js";

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

export interface PlannerStageResult {
  planned_scenario_path: string;
  plan_path: string;
  planner_brief_path: string;
  idea: IdeaBrief;
  scenario: LoopScenario;
  plan: LoopPlan;
  rubric: LoopRubric;
}
