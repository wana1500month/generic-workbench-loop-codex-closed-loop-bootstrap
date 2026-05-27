import type { ControllerRoundPhase, CurrentThreadCheckpointKind } from "../types.js";
export interface ActiveArtifactPaths {
    activePromptPath?: string;
    activeResponsePath?: string;
}
export interface ActiveCheckpointMetadata {
    checkpointId?: string;
    checkpointSeq?: number;
}
export declare const activeArtifactPathsFor: (artifacts?: Record<string, string>) => ActiveArtifactPaths;
export declare const activeCheckpointMetadataFor: (input: {
    artifacts?: Record<string, string>;
    runId: string;
    fallback?: {
        round: number;
        phase: ControllerRoundPhase;
        checkpointKind: CurrentThreadCheckpointKind;
    };
}) => Promise<ActiveCheckpointMetadata>;
//# sourceMappingURL=active-checkpoint.d.ts.map