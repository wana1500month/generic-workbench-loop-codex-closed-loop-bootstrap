import { type IntakeGateResult } from "./intake-gate.js";
type HarnessIntentFieldId = "change_goal" | "current_gap" | "success_criteria";
type RunControlAction = "start" | "status" | "stop" | "resume";
type RunControlStartSurface = "codex" | "background" | "manual";
type RunControlDiagnosticFocus = "timeout_root_cause" | "restart_budget" | "ownership_mismatch" | "status_truth";
type RunControlIntentFieldId = "action" | "run_reference" | "background_preference" | "codex_ownership_preference";
type ResumeIntentFieldId = "run_reference" | "current_state" | "next_step";
type EvaluatorIntentFieldId = "calibration_focus" | "failure_examples" | "success_criteria";
type IntentFieldId = HarnessIntentFieldId | RunControlIntentFieldId | ResumeIntentFieldId | EvaluatorIntentFieldId;
export type LoopIntent = "product_build" | "harness_design" | "run_control" | "run_resume" | "evaluator_tuning" | "unknown";
export type LoopIntentStatus = "route_to_app_builder_loop" | "ask_harness_questions" | "ask_run_control_questions" | "ask_resume_questions" | "ask_evaluator_questions" | "ready_for_run_control" | "ready_for_handoff" | "unclassified";
export type LoopIntentPhase = "none" | "intent" | "handoff" | "prepare";
export type LoopIntentRoute = "app_builder_loop" | "harness_design" | "run_control" | "run_resume" | "evaluator_tuning" | "clarify";
export interface RunControlAutocontinuePlan {
    enabled: boolean;
    mode: "same-thread";
    worker: "loop-control";
    recovery_skill: "attached-loop";
}
export interface RunControlDispatchPlan {
    primary_command: string;
    follow_up_commands: string[];
    follow_up_skills: string[];
    autocontinue?: RunControlAutocontinuePlan;
}
export interface ProductBuildDispatchPlan {
    recommended_skill: "app-builder-loop";
    staged_intake_gate: "loop:intake";
    session_mode: "same-thread";
    next_step: "prepare" | "ask_questions";
}
export interface LoopIntentResult {
    intent: LoopIntent;
    status: LoopIntentStatus;
    phase: LoopIntentPhase;
    locale: "en" | "ko";
    confidence: number;
    route_target: LoopIntentRoute;
    questions: string[];
    missing_fields: IntentFieldId[];
    satisfied_fields: IntentFieldId[];
    rationale: string[];
    extracted_run_reference?: string;
    run_control_action?: RunControlAction;
    run_control_start_surface?: RunControlStartSurface;
    run_control_targets_all_runs?: boolean;
    run_control_diagnostic_focus?: RunControlDiagnosticFocus[];
    run_control_dispatch_plan?: RunControlDispatchPlan;
    run_control_primary_command?: string;
    run_control_follow_up_commands?: string[];
    run_control_follow_up_skills?: string[];
    recommended_skill?: "app-builder-loop";
    product_build_dispatch_plan?: ProductBuildDispatchPlan;
    intake?: IntakeGateResult;
    intake_status?: IntakeGateResult["status"];
    intake_phase?: IntakeGateResult["phase"];
    intake_missing_fields?: string[];
}
export declare const deriveRunControlDispatchPlan: (input: {
    action?: RunControlAction;
    runReference?: string;
    startSurface?: RunControlStartSurface;
    targetsAllRuns: boolean;
    diagnosticFocus: readonly RunControlDiagnosticFocus[];
}) => RunControlDispatchPlan | undefined;
export declare const evaluateLoopIntent: (request: string) => LoopIntentResult;
export declare const renderLoopIntentResponse: (result: LoopIntentResult) => string;
export {};
//# sourceMappingURL=intent-gate.d.ts.map