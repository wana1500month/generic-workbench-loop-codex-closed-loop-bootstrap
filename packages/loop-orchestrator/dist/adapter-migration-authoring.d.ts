import type { AdapterMigrationAuthoringResponseArtifact, AdapterMigrationAuthoringTaskArtifact, AdapterMigrationProposal, LoadedAdapterContract, RoundArtifacts } from "./types.js";
export declare const writeAdapterMigrationAuthoringTask: (input: {
    runId: string;
    round: number;
    checkpointId?: string;
    checkpointSeq?: number;
    artifacts: RoundArtifacts;
    proposal: AdapterMigrationProposal;
    loadedAdapter: LoadedAdapterContract;
    transportProtocolPath?: string;
    notes?: string[];
}) => Promise<AdapterMigrationAuthoringTaskArtifact>;
export declare const readAdapterMigrationAuthoringResponse: (path: string, expectedCheckpointId?: string) => Promise<AdapterMigrationAuthoringResponseArtifact | undefined>;
//# sourceMappingURL=adapter-migration-authoring.d.ts.map