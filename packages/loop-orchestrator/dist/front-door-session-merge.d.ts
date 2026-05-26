import { type IntakeGateResult } from "./intake-gate.js";
import type { FrontDoorSessionArtifact, FrontDoorSessionConflict, SessionIntakeFieldId, SessionIntakeSnapshot } from "./intake-schema.js";
export declare const buildDiscoveryAggregateRequest: (input: {
    sourceRequest: string;
    intake: SessionIntakeSnapshot;
    latestMessage?: string;
}) => string;
export interface MergeFrontDoorSessionTurnResult {
    intake: SessionIntakeSnapshot;
    unresolvedConflicts: FrontDoorSessionConflict[];
    defaultsAccepted: string[];
}
export declare const mergeFrontDoorSessionTurn: (input: {
    existingSession?: FrontDoorSessionArtifact;
    sourceRequest: string;
    message: string;
    intakeResult: IntakeGateResult;
    turnCount: number;
}) => MergeFrontDoorSessionTurnResult;
export declare const questionIdsForIntakeResult: (intakeResult: IntakeGateResult) => SessionIntakeFieldId[];
//# sourceMappingURL=front-door-session-merge.d.ts.map