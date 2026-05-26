import { executeAdapterCapability } from "../adapter-runtime.js";
import { resolvedAdapterTargetRoot } from "../adapter-paths.js";
export const runAdapterCapabilities = async (input) => {
    if (!input.loadedAdapter) {
        return [];
    }
    const executions = [];
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
export const orderedAdapterExecutions = (capabilities, executions) => {
    const capabilityOrder = new Map(capabilities.map((capability, index) => [capability, index]));
    return [...new Map(executions.map((execution) => [execution.capability, execution])).values()]
        .sort((left, right) => (capabilityOrder.get(left.capability) ?? Number.MAX_SAFE_INTEGER) -
        (capabilityOrder.get(right.capability) ?? Number.MAX_SAFE_INTEGER));
};
//# sourceMappingURL=adapter-executions.js.map