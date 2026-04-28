import { loadJsonIfExists, writeJson, writeText } from "./file-system.js";
import type {
  AttachedGeneratorResponseArtifact,
  AttachedGeneratorTaskArtifact,
  BuildBriefArtifact,
  ContractAgreementArtifact,
  GeneratorPlanArtifact,
  LoadedAdapterContract,
  PatchRequestArtifact,
  RoundArtifacts,
  RoundContractArtifact,
  TransportMode,
  VerificationCoreProbe
} from "./types.js";

export const isBootstrapGeneratedAdapter = (
  loadedAdapter: LoadedAdapterContract | undefined
): boolean => {
  if (!loadedAdapter) {
    return false;
  }

  const applyChangeSpec = loadedAdapter.contract.capabilities.apply_change;
  const applyChangeCommand = applyChangeSpec?.command ?? "";
  const applyChangeArgs = applyChangeSpec?.args ?? [];
  return (
    loadedAdapter.contract.adapter_id.startsWith("generated-") &&
    (applyChangeCommand.includes(".generated/codex-adapter/scripts/apply-change") ||
      applyChangeArgs.some((arg) =>
        arg.includes(".generated/codex-adapter/scripts/apply-change")
      ))
  );
};

export const isAttachedGeneratorTransport = (
  transportMode: TransportMode
): transportMode is Extract<TransportMode, "current-thread" | "app-server"> =>
  transportMode === "current-thread" || transportMode === "app-server";

const releaseGateProbes = (
  probes: readonly VerificationCoreProbe[] | undefined
): VerificationCoreProbe[] =>
  (probes ?? []).filter((probe) => (probe.role ?? "supporting") === "release_gate");

const selectorRequirementsFromProbes = (
  probes: readonly VerificationCoreProbe[] | undefined
): NonNullable<
  AttachedGeneratorTaskArtifact["verification_requirements"]
>["required_selectors"] =>
  releaseGateProbes(probes)
    .filter((probe) => probe.mode === "browser_journey")
    .flatMap((probe) =>
      (probe.steps ?? [])
        .filter((step) => typeof step.selector === "string" && step.selector.trim())
        .map((step) => ({
          probe_id: probe.probe_id,
          label: probe.label,
          selector: step.selector!,
          action: step.action
        }))
    );

const apiRequirementsFromProbes = (
  probes: readonly VerificationCoreProbe[] | undefined
): NonNullable<
  AttachedGeneratorTaskArtifact["verification_requirements"]
>["api_probe_paths"] =>
  releaseGateProbes(probes)
    .filter((probe) => probe.mode === "http_json")
    .map((probe) => ({
      probe_id: probe.probe_id,
      path: probe.target_path ?? "",
      expected_value: probe.expected_value
    }))
    .filter((item) => item.path.length > 0);

const generatorDeliverablesForPrompt = (input: {
  task: AttachedGeneratorTaskArtifact;
  agreement: ContractAgreementArtifact;
}): string[] =>
  input.task.build_brief_snapshot
    ? [
        "Implement the captured core workflows inside the target root.",
        "Create or update run/check scripts to match the session contract.",
        "Make every required release-gate selector real, user-visible, and backed by behavior.",
        "Run or prepare the local product surface before claiming completion.",
        "Do not modify the harness core."
      ]
    : input.agreement.generator_must_deliver;

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
    `Checkpoint id: ${input.task.checkpoint_id}`,
    `Target root: ${input.targetRoot}`,
    `Task cwd: ${input.task.task_cwd}`,
    `Writable roots: ${input.task.writable_roots.join(", ")}`,
    `Network access: ${input.task.network_access ? "enabled" : "disabled"}`,
    `Completion timeout: ${input.task.completion_timeout_ms} ms`,
    "",
    "Keep the generator work on the same attached transport. Do not spawn nested `codex exec` calls.",
    "Apply the smallest coherent mutation that satisfies the active round contract and write the response JSON before finishing.",
    `Echo "checkpoint_id": "${input.task.checkpoint_id}" in the response JSON.`,
    "",
    `ATTACHED_GENERATOR_RESPONSE_PATH: ${input.task.response_path}`,
    `ATTACHED_GENERATOR_TARGET_ROOT: ${input.targetRoot}`,
    "ATTACHED_GENERATOR_RESPONSE_SCHEMA: {\"checkpoint_id\":\"string\",\"status\":\"applied|noop|blocked\",\"summary\":\"string\",\"changed_files\":[\"relative/path\"],\"notes\":[\"string\"],\"generated_at\":\"ISO-8601\"}",
    "",
    "## Product build brief",
    ...(input.task.build_brief_snapshot
      ? [
          `- Title: ${input.task.build_brief_snapshot.title}`,
          `- Summary: ${input.task.build_brief_snapshot.summary}`,
          `- Target users: ${input.task.build_brief_snapshot.target_users.join(", ") || "none"}`,
          "- Core workflows:",
          ...input.task.build_brief_snapshot.core_workflows.map(
            (workflow) => `  - ${workflow}`
          ),
          "- Success definition:",
          ...input.task.build_brief_snapshot.success_definition.map(
            (item) => `  - ${item}`
          )
        ]
      : ["- none"]),
    "",
    "## Required release-gate selectors",
    ...(input.task.verification_requirements?.required_selectors.length
      ? input.task.verification_requirements.required_selectors.map(
          (item) =>
            `- ${item.selector} (${item.action}, probe: ${item.probe_id}, ${item.label})`
        )
      : ["- none"]),
    "",
    "## Required API release-gate paths",
    ...(input.task.verification_requirements?.api_probe_paths.length
      ? input.task.verification_requirements.api_probe_paths.map(
          (item) =>
            `- ${item.path} => ${item.expected_value ?? "expected value"} (${item.probe_id})`
        )
      : ["- none"]),
    "",
    "## Product build hard rules",
    "- Work in the target root, not the harness core.",
    "- If this is a new project and no package.json exists, create one.",
    "- Created scripts must match the configured run_command and check_command when present.",
    "- Prefer dependency-light implementation unless the brief explicitly requires a framework.",
    "- Do not rely on npm install during the loop unless dependencies are already present.",
    "- Do not fake the release-gate selectors. They must correspond to visible or interactive product workflows.",
    "- Every required selector above must exist in the running app before claiming completion.",
    "",
    "## Prototype baseline protocol",
    ...(input.task.prototype_baseline_manifest_path || input.task.prototype_baseline_screenshot_path
      ? [
          `- Baseline manifest path: ${input.task.prototype_baseline_manifest_path ?? "n/a"}`,
          `- Baseline screenshot path: ${input.task.prototype_baseline_screenshot_path ?? "n/a"}`,
          `- Existing baseline source phase: ${input.task.prototype_baseline_source_phase ?? "none"}`,
          `- Existing baseline valid: ${input.task.prototype_baseline_valid === true ? "yes" : "no"}`,
          input.task.prototype_baseline_valid === true
            ? "- A valid initial prototype baseline already exists. Do not overwrite it with a post-mutation screenshot."
            : "- If the browser surface is already reachable before you edit files, capture the initial prototype baseline before mutating and persist it to the paths above with source_phase 'operator_provided_baseline'.",
          "- If the surface is not reachable before edits, leave the baseline absent. Do not mark any post-mutation screenshot as a valid initial baseline."
        ]
      : ["- none"]),
    "",
    "## Contract objective",
    input.contract.objective,
    "",
    "## Agreement must deliver",
    ...(generatorDeliverablesForPrompt({
      task: input.task,
      agreement: input.agreement
    }).length > 0
      ? generatorDeliverablesForPrompt({
          task: input.task,
          agreement: input.agreement
        }).map((item) => `- ${item}`)
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
  checkpointId?: string;
  checkpointSeq?: number;
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
  buildBrief?: BuildBriefArtifact;
  verificationProbes?: VerificationCoreProbe[];
  prototypeBaselineManifestPath?: string;
  prototypeBaselineScreenshotPath?: string;
  prototypeBaselineSourcePhase?: string;
  prototypeBaselineValid?: boolean;
  notes?: string[];
}): Promise<AttachedGeneratorTaskArtifact> => {
  const createdAt = new Date().toISOString();
  const requiredSelectors = selectorRequirementsFromProbes(input.verificationProbes);
  const apiProbePaths = apiRequirementsFromProbes(input.verificationProbes);
  const browserProbeIds = releaseGateProbes(input.verificationProbes)
    .filter((probe) => probe.mode === "browser_journey" || probe.mode === "browser")
    .map((probe) => probe.probe_id);
  const checkpointSeq = input.checkpointSeq ?? Date.now();
  const checkpointId =
    input.checkpointId ??
    [
      input.runId,
      `r${input.round}`,
      "pre_verification",
      "attached-generator",
      String(checkpointSeq)
    ].join(":");
  const task: AttachedGeneratorTaskArtifact = {
    run_id: input.runId,
    round: input.round,
    controller_mode: input.controllerMode,
    transport_mode: input.transportMode,
    checkpoint_id: checkpointId,
    checkpoint_seq: checkpointSeq,
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
    ...(input.buildBrief
      ? {
          build_brief_snapshot: {
            title: input.buildBrief.product.title,
            summary: input.buildBrief.product.summary,
            target_users: input.buildBrief.product.target_users,
            core_workflows: input.buildBrief.product.core_workflows,
            success_definition: input.buildBrief.product.success_definition
          }
        }
      : {}),
    verification_requirements: {
      required_selectors: requiredSelectors,
      browser_probe_ids: browserProbeIds,
      api_probe_paths: apiProbePaths
    },
    summary: input.generatorPlan.implementation_intent,
    must_deliver: input.agreement.generator_must_deliver,
    must_fix:
      input.previousPatchRequest?.must_fix.map((item) => item.expected_change) ?? [],
    must_preserve: input.generatorPlan.must_preserve ?? [],
    ...(input.prototypeBaselineManifestPath
      ? { prototype_baseline_manifest_path: input.prototypeBaselineManifestPath }
      : {}),
    ...(input.prototypeBaselineScreenshotPath
      ? { prototype_baseline_screenshot_path: input.prototypeBaselineScreenshotPath }
      : {}),
    ...(input.prototypeBaselineSourcePhase
      ? { prototype_baseline_source_phase: input.prototypeBaselineSourcePhase }
      : {}),
    ...(typeof input.prototypeBaselineValid === "boolean"
      ? { prototype_baseline_valid: input.prototypeBaselineValid }
      : {}),
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
  path: string,
  expectedCheckpointId?: string
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
  if (
    expectedCheckpointId &&
    parsed.checkpoint_id !== expectedCheckpointId
  ) {
    return undefined;
  }

  return parsed;
};
