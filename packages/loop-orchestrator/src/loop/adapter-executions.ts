import { resolve } from "node:path";

import { executeAdapterCapability } from "../adapter-runtime.js";
import { resolvedAdapterTargetRoot } from "../adapter-paths.js";
import type {
  AdapterCapabilityExecution,
  AdapterCapabilityName,
  LoadedAdapterContract
} from "../types.js";

export const runAdapterCapabilities = async (input: {
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
  onCapabilityComplete?: (
    execution: AdapterCapabilityExecution
  ) => Promise<void> | void;
}): Promise<AdapterCapabilityExecution[]> => {
  if (!input.loadedAdapter) {
    return [];
  }

  const executions: AdapterCapabilityExecution[] = [];
  for (const capability of input.capabilities) {
    const execution = await executeAdapterCapability({
      loadedAdapter: input.loadedAdapter,
      capability,
      roundDirectory: input.roundDirectory,
      extraEnv: input.extraEnv,
      packet: {
        adapter_id: input.loadedAdapter.contract.adapter_id,
        capability,
        run_id: input.runId,
        round: input.round,
        run_directory: input.runDirectory,
        round_directory: input.roundDirectory,
        runtime_directory: input.runtimeDirectory,
        codex_session_registry_path: input.codexSessionRegistryPath,
        target_root: resolvedAdapterTargetRoot(input.loadedAdapter),
        idea_path: input.ideaPath,
        planned_scenario_path: input.plannedScenarioPath,
        plan_path: input.planPath,
        round_contract_path: input.roundContractPath,
        contract_review_path: input.contractReviewPath,
        contract_agreement_path: input.contractAgreementPath,
        generator_plan_path: input.generatorPlanPath,
        patch_request_path: input.previousPatchRequestPath,
        trajectory_decision_path: input.previousTrajectoryDecisionPath
      }
    });
    executions.push(execution);
    await input.onCapabilityComplete?.(execution);
  }

  return executions;
};

export const orderedAdapterExecutions = (
  capabilities: readonly AdapterCapabilityName[],
  executions: readonly AdapterCapabilityExecution[]
): AdapterCapabilityExecution[] => {
  const capabilityOrder = new Map(
    capabilities.map((capability, index) => [capability, index] as const)
  );
  return [...new Map(executions.map((execution) => [execution.capability, execution] as const)).values()]
    .sort(
      (left, right) =>
        (capabilityOrder.get(left.capability) ?? Number.MAX_SAFE_INTEGER) -
        (capabilityOrder.get(right.capability) ?? Number.MAX_SAFE_INTEGER)
    );
};
