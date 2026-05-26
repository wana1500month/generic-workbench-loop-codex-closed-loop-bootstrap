import type { AdapterIntakeFieldId, ExecutionIntakeFieldId as ExecutionFieldId, ProductIntakeFieldId as ProductFieldId, SessionWorkflowCheck, VerificationSurface } from "./intake-schema.js";
import { type ProductBuildDetection } from "./product-build-signals.js";
import type { TargetFamily } from "./types.js";
type IntakeFieldId = ProductFieldId | ExecutionFieldId | AdapterIntakeFieldId;
type IntakeGateStatus = "not_product_build_request" | "ask_product_questions" | "ask_execution_questions" | "ask_adapter_questions" | "ready_for_prepare";
type IntakePhase = "none" | "product" | "execution" | "adapter" | "prepare";
export interface IntakeGateResult {
    status: IntakeGateStatus;
    phase: IntakePhase;
    locale: "en" | "ko";
    is_product_build_request: boolean;
    product_build_detection?: ProductBuildDetection;
    missing_fields: IntakeFieldId[];
    missing_product_fields: ProductFieldId[];
    missing_execution_fields: ExecutionFieldId[];
    missing_adapter_fields: AdapterIntakeFieldId[];
    satisfied_fields: IntakeFieldId[];
    questions: string[];
    internal_working_hypothesis?: Exclude<TargetFamily, "generic-core" | "editor-app">;
    extracted_summary?: string;
    extracted_project_mode?: "new" | "existing";
    extracted_target_root?: string;
    extracted_target_score?: number;
    extracted_max_rounds?: number;
    extracted_verification_surfaces?: VerificationSurface[];
    extracted_workflow_checks?: SessionWorkflowCheck[];
    preparation_summary?: string[];
    adapter_plan_preview?: string[];
    auto_prepare?: boolean;
    next_step?: "prepare";
}
export declare const inferProductTargetFamily: (request: string) => Exclude<TargetFamily, "generic-core" | "editor-app">;
export declare const evaluateIntakeRequest: (request: string) => IntakeGateResult;
export declare const renderIntakeGateResponse: (result: IntakeGateResult) => string;
export {};
//# sourceMappingURL=intake-gate.d.ts.map