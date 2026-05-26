import type { AdapterDriftReport, AdapterMigrationApplied, AdapterMigrationDecision, AdapterMigrationIdentityState, AdapterMigrationProposal, AdapterMigrationResponse, AdapterOrigin, LoadedAdapterContract, LoopRunSummary } from "./types.js";
export declare const generatedAdapterRuntimeConfigPath: (adapterContractPath: string) => string;
export declare const detectAdapterOrigin: (loadedAdapter: LoadedAdapterContract | undefined) => AdapterOrigin;
export declare const decisionOptionsForAdapterMigrationProposal: (proposal: AdapterMigrationProposal) => AdapterMigrationDecision[];
export declare const approvalSemanticsForAdapterMigrationProposal: (proposal: AdapterMigrationProposal) => Record<AdapterMigrationDecision, string>;
export declare const buildAdapterMigrationProposal: (input: {
    runId: string;
    round: number;
    sourceAdapterDriftReportPath: string;
    loadedAdapter: LoadedAdapterContract;
    adapterDriftReport: AdapterDriftReport;
}) => Promise<AdapterMigrationProposal>;
export declare const applyGeneratedLocalAdapterMigration: (input: {
    proposal: AdapterMigrationProposal;
    loadedAdapter: LoadedAdapterContract;
    runtimeDirectory: string;
}) => Promise<{
    changedFiles: string[];
    backupDirectory: string;
}>;
export declare const loadAdapterMigrationResponse: (path: string) => Promise<AdapterMigrationResponse | undefined>;
export declare const loadAuthorizedAdapterMigration: (summary?: LoopRunSummary) => Promise<AdapterMigrationApplied | undefined>;
export declare const isAuthorizedAdapterMigration: (input: {
    applied?: AdapterMigrationApplied;
    previousIdentity: AdapterMigrationIdentityState;
    currentIdentity: AdapterMigrationIdentityState;
}) => boolean;
//# sourceMappingURL=adapter-migration.d.ts.map