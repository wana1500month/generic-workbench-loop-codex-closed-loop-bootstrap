import type { ControllerMode, ControllerPhaseStatus, ControllerRoundPhase, LoopRunSummary, TransportMode } from "./types.js";
export declare const transportProtocolPathForRun: (runDirectory: string, transportMode: TransportMode) => string;
export declare const writeTransportProtocol: (input: {
    runDirectory: string;
    transportMode: TransportMode;
    summary: Pick<LoopRunSummary, "run_id" | "controller_mode" | "transport_mode" | "transport_state_path" | "resume_identity_path" | "runtime_round_phase_path">;
    controllerMode?: ControllerMode;
    activeRound?: number;
    activePhase?: ControllerRoundPhase;
    activeStatus?: ControllerPhaseStatus;
    latestPatchRequestPath?: string;
    latestRoundContractPath?: string;
    notes?: string[];
}) => Promise<string>;
//# sourceMappingURL=transport-protocol.d.ts.map