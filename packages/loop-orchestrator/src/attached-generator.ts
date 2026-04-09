import { loadJsonIfExists, writeJson, writeText } from "./file-system.js";
import type {
  AttachedGeneratorResponseArtifact,
  AttachedGeneratorTaskArtifact,
  ContractAgreementArtifact,
  GeneratorPlanArtifact,
  LoadedAdapterContract,
  PatchRequestArtifact,
  RoundArtifacts,
  RoundContractArtifact,
  TransportMode
} from "./types.js";

export const isBootstrapGeneratedAdapter = (
  loadedAdapter: LoadedAdapterContract | undefined
): boolean => {
  if (!loadedAdapter) {
    return false;
  }

  const applyChangeCommand =
    loadedAdapter.contract.capabilities.apply_change?.command ?? "";
  return (
    loadedAdapter.contract.adapter_id.startsWith("generated-") &&
    applyChangeCommand.includes(".generated/codex-adapter/scripts/apply-change")
  );
};

export const isAttachedGeneratorTransport = (
  transportMode: TransportMode
): transportMode is Extract<TransportMode, "current-thread" | "app-server"> =>
  transportMode === "current-thread" || transportMode === "app-server";

const promptText = (input: {
  targetRoot: string;
  task: AttachedGeneratorTaskArtifact;
  contract: RoundContractArtifact;
  agreement: ContractAgreementArtifact;
  generatorPlan: GeneratorPlanArtifact;
  previousPatchRequest?: PatchRequestArtifact;
}): string =>
  [
    "# Attached Generator Task",
    "",
    `Run id: ${input.task.run_id}`,
    `Round: ${input.task.round}`,
    `Transport: ${input.task.transport_mode}`,
    `Target root: ${input.targetRoot}`,
    `Task cwd: ${input.task.task_cwd}`,
    `Writable roots: ${input.task.writable_roots.join(", ")}`,
    `Network access: ${input.task.network_access ? "enabled" : "disabled"}`,
    `Completion timeout: ${input.task.completion_timeout_ms} ms`,
    "",
    "Keep the generator work on the same attached transport. Do not spawn nested `codex exec` calls.",
    "Apply the smallest coherent mutation that satisfies the active round contract and write the response JSON before finishing.",
    "",
    `ATTACHED_GENERATOR_RESPONSE_PATH: ${input.task.response_path}`,
    `ATTACHED_GENERATOR_TARGET_ROOT: ${input.targetRoot}`,
    "ATTACHED_GENERATOR_RESPONSE_SCHEMA: {\"status\":\"applied|noop|blocked\",\"summary\":\"string\",\"changed_files\":[\"relative/path\"],\"notes\":[\"string\"],\"generated_at\":\"ISO-8601\"}",
    "",
    "## Contract objective",
    input.contract.objective,
    "",
    "## Agreement must deliver",
    ...(input.agreement.generator_must_deliver.length > 0
      ? input.agreement.generator_must_deliver.map((item) => `- ${item}`)
      : ["- none"]),
    "",
    "## Generator intent",
    `- Implementation intent: ${input.generatorPlan.implementation_intent}`,
    `- Remediation strategy: ${input.generatorPlan.remediation_strategy}`,
    ...(input.generatorPlan.target_check_ids.length > 0
      ? [`- Target check ids: ${input.generatorPlan.target_check_ids.join(", ")}`]
      : []),
    "",
    "## Immediate must-fix work",
    ...(input.previousPatchRequest?.must_fix.length
      ? input.previousPatchRequest.must_fix.map(
          (item) => `- ${item.expected_change} (${item.why})`
        )
      : ["- none"]),
    "",
    "## Preserve signals",
    ...((input.generatorPlan.must_preserve ?? []).length > 0
      ? (input.generatorPlan.must_preserve ?? []).map((item) => `- ${item}`)
      : ["- none"]),
    "",
    "## Notes",
    ...(input.task.notes?.length ? input.task.notes.map((note) => `- ${note}`) : ["- none"])
  ].join("\n");

export const writeAttachedGeneratorTask = async (input: {
  runId: string;
  round: number;
  controllerMode: "attached";
  transportMode: Extract<TransportMode, "current-thread" | "app-server">;
  targetRoot: string;
  taskCwd: string;
  writableRoots: string[];
  networkAccess: boolean;
  completionTimeoutMs: number;
  transportProtocolPath?: string;
  artifacts: RoundArtifacts;
  contract: RoundContractArtifact;
  agreement: ContractAgreementArtifact;
  generatorPlan: GeneratorPlanArtifact;
  previousPatchRequest?: PatchRequestArtifact;
  notes?: string[];
}): Promise<AttachedGeneratorTaskArtifact> => {
  const createdAt = new Date().toISOString();
  const task: AttachedGeneratorTaskArtifact = {
    run_id: input.runId,
    round: input.round,
    controller_mode: input.controllerMode,
    transport_mode: input.transportMode,
    target_root: input.targetRoot,
    task_cwd: input.taskCwd,
    writable_roots: input.writableRoots,
    network_access: input.networkAccess,
    completion_timeout_ms: input.completionTimeoutMs,
    prompt_path: input.artifacts.attached_generator_prompt_path,
    response_path: input.artifacts.attached_generator_response_path,
    round_contract_path: input.artifacts.contract_json_path,
    generator_plan_path: input.artifacts.generator_plan_json_path,
    ...(input.previousPatchRequest
      ? { patch_request_path: input.artifacts.patch_request_json_path }
      : {}),
    ...(input.transportProtocolPath
      ? { transport_protocol_path: input.transportProtocolPath }
      : {}),
    summary: input.generatorPlan.implementation_intent,
    must_deliver: input.agreement.generator_must_deliver,
    must_fix:
      input.previousPatchRequest?.must_fix.map((item) => item.expected_change) ?? [],
    must_preserve: input.generatorPlan.must_preserve ?? [],
    ...(input.notes?.length ? { notes: input.notes } : {}),
    created_at: createdAt
  };

  await Promise.all([
    writeJson(input.artifacts.attached_generator_task_path, task),
    writeText(
      input.artifacts.attached_generator_prompt_path,
      promptText({
        targetRoot: input.targetRoot,
        task,
        contract: input.contract,
        agreement: input.agreement,
        generatorPlan: input.generatorPlan,
        previousPatchRequest: input.previousPatchRequest
      })
    )
  ]);

  return task;
};

export const readAttachedGeneratorResponse = async (
  path: string
): Promise<AttachedGeneratorResponseArtifact | undefined> => {
  const parsed = await loadJsonIfExists<AttachedGeneratorResponseArtifact>(path);
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }

  if (
    parsed.status !== "applied" &&
    parsed.status !== "noop" &&
    parsed.status !== "blocked"
  ) {
    return undefined;
  }

  if (typeof parsed.summary !== "string" || parsed.summary.trim().length === 0) {
    return undefined;
  }

  return parsed;
};
