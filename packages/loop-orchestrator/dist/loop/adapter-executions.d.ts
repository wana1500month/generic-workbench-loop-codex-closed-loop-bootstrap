import type { AdapterCapabilityExecution, AdapterCapabilityName, LoadedAdapterContract } from "../types.js";
export declare const runAdapterCapabilities: (input: {
    loadedAdapter?: LoadedAdapterContract;
    capabilities: AdapterCapabilityName[];
    runId: string;
    round: number;
    runDirectory: string;
    runtimeDirectory: string;
    codexSessionRegistryPath: string;
    roundDirectory: string;
    ideaPath?: string;
    plannedScenarioPath?: string;
    planPath?: string;
    roundContractPath: string;
    contractReviewPath?: string;
    contractAgreementPath?: string;
    generatorPlanPath: string;
    previousPatchRequestPath?: string;
    previousTrajectoryDecisionPath?: string;
    extraEnv?: Record<string, string>;
    onCapabilityComplete?: (execution: AdapterCapabilityExecution) => Promise<void> | void;
}) => Promise<AdapterCapabilityExecution[]>;
export declare const orderedAdapterExecutions: (capabilities: readonly AdapterCapabilityName[], executions: readonly AdapterCapabilityExecution[]) => AdapterCapabilityExecution[];
//# sourceMappingURL=adapter-executions.d.ts.map