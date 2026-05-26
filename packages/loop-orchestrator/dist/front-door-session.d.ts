import type { DiscoveryPhase, FrontDoorSessionArtifact, FrontDoorSessionStatus, AdapterIntakeFieldId, ProductIntakeFieldId, ExecutionIntakeFieldId, SessionIntakeFieldId, SessionIntakeSnapshot } from "./intake-schema.js";
type SessionLocale = "en" | "ko";
export interface FrontDoorSessionTurnResult {
    status: FrontDoorSessionStatus;
    phase: DiscoveryPhase | "none";
    locale: SessionLocale;
    session_id?: string;
    thread_id?: string;
    front_door_session_path?: string;
    front_door_session_events_path?: string;
    questions: string[];
    missing_product_fields: ProductIntakeFieldId[];
    missing_execution_fields: ExecutionIntakeFieldId[];
    missing_adapter_fields: AdapterIntakeFieldId[];
    asked_question_ids: SessionIntakeFieldId[];
    last_question_ids: SessionIntakeFieldId[];
    intake: SessionIntakeSnapshot;
    defaults_accepted: string[];
    unresolved_conflicts: FrontDoorSessionArtifact["unresolved_conflicts"];
    turn_count: number;
    preparation_summary?: string[];
    adapter_plan_preview?: string[];
}
export declare const getFrontDoorSessionStatus: (threadId: string) => Promise<FrontDoorSessionTurnResult | undefined>;
export declare const runFrontDoorDiscoveryTurn: (input: {
    threadId: string;
    message: string;
    now?: string;
}) => Promise<FrontDoorSessionTurnResult>;
export {};
//# sourceMappingURL=front-door-session.d.ts.map