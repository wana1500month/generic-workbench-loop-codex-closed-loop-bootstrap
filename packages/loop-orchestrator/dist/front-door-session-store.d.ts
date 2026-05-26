import type { FrontDoorSessionArtifact } from "./intake-schema.js";
export interface FrontDoorSessionPaths {
    directory: string;
    session_id: string;
    session_path: string;
    events_path: string;
}
export interface FrontDoorSessionEvent {
    type: "session_created" | "session_updated" | "session_status" | "session_prepared";
    session_id: string;
    thread_id?: string;
    turn_count: number;
    status: string;
    phase: string;
    message?: string;
    run_id?: string;
    run_directory?: string;
    updated_at: string;
}
export declare const frontDoorSessionsDirectory: () => string;
export declare const frontDoorSessionPathsForThread: (threadId: string) => FrontDoorSessionPaths;
export declare const loadFrontDoorSessionArtifact: (threadId: string) => Promise<FrontDoorSessionArtifact | undefined>;
export declare const writeFrontDoorSessionArtifact: (threadId: string, artifact: FrontDoorSessionArtifact) => Promise<FrontDoorSessionPaths>;
export declare const appendFrontDoorSessionEvent: (threadId: string, event: FrontDoorSessionEvent) => Promise<void>;
//# sourceMappingURL=front-door-session-store.d.ts.map