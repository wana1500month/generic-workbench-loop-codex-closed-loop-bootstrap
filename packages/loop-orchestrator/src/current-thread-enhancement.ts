import { readFile } from "node:fs/promises";
import { relative } from "node:path";

import { buildExecutorModePrompt } from "./codex-agent-manifest.js";
import { repoRoot, writeJson, writeText } from "./file-system.js";
import type { RuntimeStatePaths } from "./runtime-state.js";
import type {
  AdapterCapabilityExecution,
  ContractAgreementArtifact,
  ContractReviewArtifact,
  CoreVerificationProbeExecution,
  CurrentThreadEnhancementStage,
  CurrentThreadEnhancementTaskArtifact,
  EvalReport,
  ExecutorMode,
  GeneratorPlanArtifact,
  HarnessFocusArea,
  IdeaBrief,
  LoadedAdapterContract,
  LoopPlan,
  LoopRubric,
  LoopScenario,
  PatchRequestArtifact,
  RoundArtifacts,
  RoundContractArtifact,
  RoundVerdict,
  TargetManifest
} from "./types.js";

type CodexPlannerPatch = {
  scenario_title?: string;
  scenario_description?: string;
  user_goals?: string[];
  acceptance_highlights?: string[];
  planner_focus_areas?: HarnessFocusArea[];
  north_star?: string;
  attempt_strategy?: string;
  planner_notes?: string[];
  remediation_policy?: string[];
};

type CodexContractReviewPatch = {
  decision?: "accept" | "revise";
  concerns?: string[];
  required_changes?: string[];
  approved_checks?: string[];
  adapter_ready?: boolean;
  static_blockers?: string[];
};

type CodexGeneratorPlanPatch = {
  implementation_intent?: string;
  files_to_touch?: string[];
  expected_proof?: string[];
  risk_notes?: string[];
  out_of_scope?: string[];
  adapter_actions?: string[];
};

type CodexEvaluatorPatch = {
  overall_verdict?: RoundVerdict;
  strengths?: string[];
  blockers?: string[];
  next_actions?: string[];
};

type PreparedEnhancementPrompt = {
  prompt: string;
  warning?: string;
};

type AppliedEnhancementResult<T> = {
  value: T;
  runtimeWarnings: string[];
  usedResponse: boolean;
};

export type CurrentThreadEnhancementOutcome<T> =
  | {
      kind: "completed";
      value: T;
      runtimeWarnings: string[];
    }
  | {
      kind: "handoff";
      notes: string[];
      artifacts: Record<string, string>;
    };

const validFocusAreas = new Set<HarnessFocusArea>([
  "planner_clarity",
  "contract_testability",
  "artifact_handoff",
  "patch_authority",
  "qa_rigor",
  "runtime_portability"
]);

const verdictSeverity: Record<RoundVerdict, number> = {
  advance: 0,
  revise: 1,
  hold: 2
};

const rel = (path: string): string => relative(repoRoot, path);

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const trimString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const stringList = (value: unknown, limit = 12): string[] =>
  Array.isArray(value)
    ? unique(
        value
          .map((entry) => trimString(entry))
          .filter((entry): entry is string => Boolean(entry))
      ).slice(0, limit)
    : [];

const extractJsonText = (raw: string): string | undefined => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("```")) {
    const fenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    if (fenced.trim()) {
      return fenced.trim();
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
};

const parseJsonResponse = <T>(raw: string): T | undefined => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const candidate = extractJsonText(raw);
    if (!candidate) {
      return undefined;
    }

    try {
      return JSON.parse(candidate) as T;
    } catch {
      return undefined;
    }
  }
};

const strictestVerdict = (base: RoundVerdict, candidate?: RoundVerdict): RoundVerdict => {
  if (!candidate) {
    return base;
  }

  return verdictSeverity[candidate] > verdictSeverity[base] ? candidate : base;
};

const readTextIfExists = async (path: string): Promise<string | undefined> => {
  try {
    return await readFile(path, "utf8");
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return undefined;
    }
    throw error;
  }
};

const promptText = (input: {
  task: CurrentThreadEnhancementTaskArtifact;
  preparedPrompt: PreparedEnhancementPrompt;
}): string =>
  [
    "# Current-Thread Enhancement Task",
    "",
    `Run id: ${input.task.run_id}`,
    `Round: ${input.task.round ?? "bootstrap"}`,
    `Phase: ${input.task.phase}`,
    `Stage: ${input.task.stage}`,
    `Prompt path: ${rel(input.task.prompt_path)}`,
    `Response path: ${rel(input.task.response_path)}`,
    "",
    "Keep this work on the same current-thread operator surface.",
    "Do not call nested `codex exec` or `codex exec resume`.",
    `Write JSON only to ${rel(input.task.response_path)}.`,
    "If no changes are needed, write {}.",
    "",
    "## Summary",
    input.task.summary,
    "",
    "## Context paths",
    ...Object.entries(input.task.context_paths).map(
      ([label, path]) => `- ${label}: ${rel(path)}`
    ),
    "",
    "## Notes",
    ...(input.task.notes?.length ? input.task.notes.map((note) => `- ${note}`) : ["- none"]),
    "",
    "## Enhancement prompt",
    input.preparedPrompt.prompt
  ].join("\n");

const writeCurrentThreadEnhancementTask = async (input: {
  runId: string;
  round?: number;
  phase: "planning" | "negotiation" | "evaluation";
  stage: CurrentThreadEnhancementStage;
  taskPath: string;
  promptPath: string;
  responsePath: string;
  preparedPrompt: PreparedEnhancementPrompt;
  transportProtocolPath?: string;
  summary: string;
  contextPaths: Record<string, string>;
  notes?: string[];
}): Promise<CurrentThreadEnhancementTaskArtifact> => {
  const task: CurrentThreadEnhancementTaskArtifact = {
    run_id: input.runId,
    ...(input.round !== undefined ? { round: input.round } : {}),
    phase: input.phase,
    stage: input.stage,
    controller_mode: "attached",
    transport_mode: "current-thread",
    prompt_path: input.promptPath,
    response_path: input.responsePath,
    ...(input.transportProtocolPath
      ? { transport_protocol_path: input.transportProtocolPath }
      : {}),
    summary: input.summary,
    context_paths: input.contextPaths,
    ...(input.notes?.length ? { notes: input.notes } : {}),
    created_at: new Date().toISOString()
  };

  await Promise.all([
    writeJson(input.taskPath, task),
    writeText(
      input.promptPath,
      promptText({
        task,
        preparedPrompt: input.preparedPrompt
      })
    )
  ]);

  return task;
};

const buildPlannerEnhancementPrompt = async (input: {
  idea: IdeaBrief;
  rubric: LoopRubric;
  scenario: LoopScenario;
  plan: LoopPlan;
  executorMode: ExecutorMode;
}): Promise<PreparedEnhancementPrompt> => {
  const basePrompt = [
    "You are the planner for a generic Codex workbench with a closed-loop harness engine.",
    "Do not modify files or run commands. Read the input and return JSON only.",
    "Keep the response concise and specific.",
    "",
    "Return JSON with this shape:",
    "{",
    '  "scenario_title": "optional string",',
    '  "scenario_description": "optional string",',
    '  "user_goals": ["optional strings"],',
    '  "acceptance_highlights": ["optional strings"],',
    '  "planner_focus_areas": ["planner_clarity|contract_testability|artifact_handoff|patch_authority|qa_rigor|runtime_portability"],',
    '  "north_star": "optional string",',
    '  "attempt_strategy": "optional string",',
    '  "planner_notes": ["optional strings"],',
    '  "remediation_policy": ["optional strings"]',
    "}",
    "",
    "# Idea brief",
    JSON.stringify(input.idea, null, 2),
    "",
    "# Existing scenario",
    JSON.stringify(input.scenario, null, 2),
    "",
    "# Existing plan",
    JSON.stringify(input.plan, null, 2),
    "",
    "# Rubric",
    JSON.stringify(input.rubric, null, 2)
  ].join("\n");

  return buildExecutorModePrompt({
    executorMode: input.executorMode,
    role: "planner",
    prompt: basePrompt
  });
};

const applyPlannerEnhancementResponse = (input: {
  scenario: LoopScenario;
  plan: LoopPlan;
  responseText: string;
  warning?: string;
}): AppliedEnhancementResult<{ scenario: LoopScenario; plan: LoopPlan }> => {
  const parsed = parseJsonResponse<CodexPlannerPatch>(input.responseText);
  if (!parsed) {
    return {
      value: {
        scenario: input.scenario,
        plan: input.plan
      },
      runtimeWarnings: [
        ...(input.warning ? [input.warning] : []),
        "Current-thread planner enhancement response was not valid JSON; deterministic planner output remains active."
      ],
      usedResponse: false
    };
  }

  const focusAreas = Array.isArray(parsed.planner_focus_areas)
    ? unique(
        parsed.planner_focus_areas.filter(
          (focus): focus is HarnessFocusArea => validFocusAreas.has(focus)
        )
      )
    : [];

  return {
    value: {
      scenario: {
        ...input.scenario,
        ...(trimString(parsed.scenario_title) ? { title: trimString(parsed.scenario_title)! } : {}),
        ...(trimString(parsed.scenario_description)
          ? { description: trimString(parsed.scenario_description)! }
          : {}),
        ...(stringList(parsed.user_goals).length > 0
          ? { user_goals: stringList(parsed.user_goals) }
          : {}),
        ...(stringList(parsed.acceptance_highlights).length > 0
          ? { acceptance_highlights: stringList(parsed.acceptance_highlights) }
          : {})
      },
      plan: {
        ...input.plan,
        ...(trimString(parsed.north_star) ? { north_star: trimString(parsed.north_star)! } : {}),
        ...(trimString(parsed.attempt_strategy)
          ? { attempt_strategy: trimString(parsed.attempt_strategy)! }
          : {}),
        ...(focusAreas.length > 0 ? { planner_focus_areas: focusAreas } : {}),
        ...(stringList(parsed.planner_notes).length > 0
          ? {
              planner_notes: unique([
                ...stringList(parsed.planner_notes),
                ...input.plan.planner_notes
              ]).slice(0, 12)
            }
          : {}),
        ...(stringList(parsed.remediation_policy).length > 0
          ? {
              remediation_policy: unique([
                ...stringList(parsed.remediation_policy),
                ...input.plan.remediation_policy
              ]).slice(0, 12)
            }
          : {})
      }
    },
    runtimeWarnings: input.warning ? [input.warning] : [],
    usedResponse: true
  };
};

const buildContractReviewEnhancementPrompt = async (input: {
  contractArtifact: RoundContractArtifact;
  contractReviewArtifact: ContractReviewArtifact;
  loadedAdapter?: LoadedAdapterContract;
  executorMode: ExecutorMode;
}): Promise<PreparedEnhancementPrompt> => {
  const basePrompt = [
    "You are the evaluator reviewing a round contract for a generic Codex workbench harness.",
    "Do not modify files or run commands. Return JSON only.",
    "Be conservative. Reject unclear or untestable contracts.",
    "",
    "Return JSON with this shape:",
    "{",
    '  "decision": "accept|revise",',
    '  "concerns": ["optional strings"],',
    '  "required_changes": ["optional strings"],',
    '  "approved_checks": ["optional check ids from the contract"],',
    '  "adapter_ready": true,',
    '  "static_blockers": ["optional strings"]',
    "}",
    "",
    "# Contract artifact",
    JSON.stringify(input.contractArtifact, null, 2),
    "",
    "# Current deterministic review",
    JSON.stringify(input.contractReviewArtifact, null, 2),
    "",
    "# Adapter summary",
    JSON.stringify(
      input.loadedAdapter
        ? {
            adapter_id: input.loadedAdapter.contract.adapter_id,
            verifier_id: input.loadedAdapter.contract.verification_provider?.provider_id,
            target_root: input.loadedAdapter.contract.target_root,
            target_family: input.loadedAdapter.verification_profile?.profile.target_family,
            validation_lane: input.loadedAdapter.verification_profile?.profile.validation_lane
          }
        : { adapter_attached: false },
      null,
      2
    )
  ].join("\n");

  return buildExecutorModePrompt({
    executorMode: input.executorMode,
    role: "evaluator",
    prompt: basePrompt
  });
};

const applyContractReviewEnhancementResponse = (input: {
  contractArtifact: RoundContractArtifact;
  contractReviewArtifact: ContractReviewArtifact;
  responseText: string;
  warning?: string;
}): AppliedEnhancementResult<ContractReviewArtifact> => {
  const parsed = parseJsonResponse<CodexContractReviewPatch>(input.responseText);
  if (!parsed) {
    return {
      value: input.contractReviewArtifact,
      runtimeWarnings: [
        ...(input.warning ? [input.warning] : []),
        "Current-thread contract-review enhancement response was not valid JSON; deterministic contract review remains active."
      ],
      usedResponse: false
    };
  }

  const approvedChecks = stringList(parsed.approved_checks).filter((checkId) =>
    input.contractArtifact.acceptance_checks.includes(checkId)
  );
  const concerns = unique([
    ...input.contractReviewArtifact.concerns,
    ...stringList(parsed.concerns)
  ]).slice(0, 12);
  const requiredChanges = unique([
    ...input.contractReviewArtifact.required_changes,
    ...stringList(parsed.required_changes)
  ]).slice(0, 12);
  const staticBlockers = unique([
    ...input.contractReviewArtifact.static_blockers,
    ...stringList(parsed.static_blockers)
  ]).slice(0, 12);
  const mergedDecision =
    requiredChanges.length > 0 ||
    staticBlockers.length > 0 ||
    parsed.decision === "revise" ||
    input.contractReviewArtifact.decision === "revise"
      ? "revise"
      : "accept";

  return {
    value: {
      ...input.contractReviewArtifact,
      decision: mergedDecision,
      concerns,
      required_changes: requiredChanges,
      approved_checks:
        approvedChecks.length > 0
          ? approvedChecks
          : input.contractReviewArtifact.approved_checks,
      adapter_ready:
        input.contractReviewArtifact.adapter_ready &&
        (typeof parsed.adapter_ready === "boolean" ? parsed.adapter_ready : true),
      static_blockers: staticBlockers
    },
    runtimeWarnings: input.warning ? [input.warning] : [],
    usedResponse: true
  };
};

const buildGeneratorPlanEnhancementPrompt = async (input: {
  idea: IdeaBrief;
  contractArtifact: RoundContractArtifact;
  contractAgreementArtifact: ContractAgreementArtifact;
  generatorPlanArtifact: GeneratorPlanArtifact;
  previousPatchRequest?: PatchRequestArtifact;
  executorMode: ExecutorMode;
}): Promise<PreparedEnhancementPrompt> => {
  const basePrompt = [
    "You are the generator planner for a generic Codex workbench harness.",
    "Do not edit files or run commands. Return JSON only.",
    "Focus on the smallest coherent implementation plan for the current round.",
    "",
    "Return JSON with this shape:",
    "{",
    '  "implementation_intent": "optional string",',
    '  "files_to_touch": ["optional strings"],',
    '  "expected_proof": ["optional strings"],',
    '  "risk_notes": ["optional strings"],',
    '  "out_of_scope": ["optional strings"],',
    '  "adapter_actions": ["optional strings"]',
    "}",
    "",
    "# Idea brief",
    JSON.stringify(input.idea, null, 2),
    "",
    "# Round contract",
    JSON.stringify(input.contractArtifact, null, 2),
    "",
    "# Contract agreement",
    JSON.stringify(input.contractAgreementArtifact, null, 2),
    "",
    "# Current generator plan",
    JSON.stringify(input.generatorPlanArtifact, null, 2),
    "",
    "# Previous patch request",
    JSON.stringify(input.previousPatchRequest ?? null, null, 2)
  ].join("\n");

  return buildExecutorModePrompt({
    executorMode: input.executorMode,
    role: "generator",
    prompt: basePrompt
  });
};

const applyGeneratorPlanEnhancementResponse = (input: {
  generatorPlanArtifact: GeneratorPlanArtifact;
  responseText: string;
  warning?: string;
}): AppliedEnhancementResult<GeneratorPlanArtifact> => {
  const parsed = parseJsonResponse<CodexGeneratorPlanPatch>(input.responseText);
  if (!parsed) {
    return {
      value: input.generatorPlanArtifact,
      runtimeWarnings: [
        ...(input.warning ? [input.warning] : []),
        "Current-thread generator-plan enhancement response was not valid JSON; deterministic generator plan remains active."
      ],
      usedResponse: false
    };
  }

  return {
    value: {
      ...input.generatorPlanArtifact,
      ...(trimString(parsed.implementation_intent)
        ? { implementation_intent: trimString(parsed.implementation_intent)! }
        : {}),
      files_to_touch: unique([
        ...input.generatorPlanArtifact.files_to_touch,
        ...stringList(parsed.files_to_touch, 20)
      ]).slice(0, 20),
      expected_proof: unique([
        ...input.generatorPlanArtifact.expected_proof,
        ...stringList(parsed.expected_proof, 20)
      ]).slice(0, 20),
      risk_notes: unique([
        ...stringList(parsed.risk_notes, 12),
        ...input.generatorPlanArtifact.risk_notes
      ]).slice(0, 12),
      out_of_scope: unique([
        ...input.generatorPlanArtifact.out_of_scope,
        ...stringList(parsed.out_of_scope, 12)
      ]).slice(0, 12),
      adapter_actions: unique([
        ...input.generatorPlanArtifact.adapter_actions,
        ...stringList(parsed.adapter_actions, 12)
      ]).slice(0, 12)
    },
    runtimeWarnings: input.warning ? [input.warning] : [],
    usedResponse: true
  };
};

const buildEvalEnhancementPrompt = async (input: {
  idea: IdeaBrief;
  contractArtifact: RoundContractArtifact;
  generatorPlanArtifact: GeneratorPlanArtifact;
  evalReport: EvalReport;
  adapterExecutions: AdapterCapabilityExecution[];
  coreProbeResults: CoreVerificationProbeExecution[];
  targetManifest?: TargetManifest;
  executorMode: ExecutorMode;
}): Promise<PreparedEnhancementPrompt> => {
  const basePrompt = [
    "You are the evaluator for a generic Codex workbench harness.",
    "Do not modify files or run commands. Return JSON only.",
    "Be conservative. If uncertain, prefer revise over advance and hold over revise when the evidence looks fundamentally blocked.",
    "",
    "Return JSON with this shape:",
    "{",
    '  "overall_verdict": "advance|revise|hold",',
    '  "strengths": ["optional strings"],',
    '  "blockers": ["optional strings"],',
    '  "next_actions": ["optional strings"]',
    "}",
    "",
    "# Idea brief",
    JSON.stringify(
      {
        title: input.idea.title,
        summary: input.idea.summary,
        user_goals: input.idea.user_goals,
        constraints: input.idea.constraints,
        quality_bar: input.idea.quality_bar
      },
      null,
      2
    ),
    "",
    "# Round contract",
    JSON.stringify(input.contractArtifact, null, 2),
    "",
    "# Generator plan",
    JSON.stringify(input.generatorPlanArtifact, null, 2),
    "",
    "# Deterministic eval report",
    JSON.stringify(
      {
        total_score: input.evalReport.total_score,
        control_plane_score: input.evalReport.control_plane_score,
        proof_score: input.evalReport.proof_score,
        release_score: input.evalReport.release_score,
        overall_verdict: input.evalReport.overall_verdict,
        blockers: input.evalReport.blockers,
        next_actions: input.evalReport.next_actions,
        threshold_gap_details: input.evalReport.threshold_gap_details,
        unresolved_check_ids: input.evalReport.unresolved_check_ids
      },
      null,
      2
    ),
    "",
    "# Adapter execution summary",
    JSON.stringify(
      input.adapterExecutions.map((execution) => ({
        capability: execution.capability,
        ok: execution.result.ok,
        provider_role: execution.provider_role,
        summary: execution.result.summary,
        findings: execution.result.findings,
        verified_evidence_paths: execution.verified_evidence_paths,
        criteria_results: execution.verified_criteria_results.map((criterion) => ({
          criterion_id: criterion.criterion_id,
          status: criterion.status,
          summary: criterion.summary
        }))
      })),
      null,
      2
    ),
    "",
    "# Core probe summary",
    JSON.stringify(
      input.coreProbeResults.map((probe) => ({
        probe_id: probe.probe_id,
        ok: probe.ok,
        role: probe.role,
        mode: probe.mode,
        summary: probe.summary,
        observed_value: probe.observed_value,
        evidence_paths: probe.evidence_paths
      })),
      null,
      2
    ),
    "",
    "# Target manifest",
    JSON.stringify(input.targetManifest ?? null, null, 2)
  ].join("\n");

  return buildExecutorModePrompt({
    executorMode: input.executorMode,
    role: "evaluator",
    prompt: basePrompt
  });
};

const applyEvalEnhancementResponse = (input: {
  evalReport: EvalReport;
  responseText: string;
  warning?: string;
}): AppliedEnhancementResult<EvalReport> => {
  const parsed = parseJsonResponse<CodexEvaluatorPatch>(input.responseText);
  if (!parsed) {
    return {
      value: input.evalReport,
      runtimeWarnings: [
        ...(input.warning ? [input.warning] : []),
        "Current-thread evaluator enhancement response was not valid JSON; deterministic evaluator report remains active."
      ],
      usedResponse: false
    };
  }

  const mergedVerdict = strictestVerdict(
    input.evalReport.overall_verdict,
    parsed.overall_verdict
  );
  const thresholdResults =
    mergedVerdict === input.evalReport.overall_verdict
      ? input.evalReport.threshold_results
      : {
          ...input.evalReport.threshold_results,
          contract_completed: false,
          target_reached_eligible: false
        };

  return {
    value: {
      ...input.evalReport,
      overall_verdict: mergedVerdict,
      strengths: unique([
        ...input.evalReport.strengths,
        ...stringList(parsed.strengths, 10)
      ]).slice(0, 10),
      blockers: unique([
        ...input.evalReport.blockers,
        ...stringList(parsed.blockers, 10)
      ]).slice(0, 10),
      next_actions: unique([
        ...stringList(parsed.next_actions, 10),
        ...input.evalReport.next_actions
      ]).slice(0, 10),
      threshold_results: thresholdResults
    },
    runtimeWarnings: input.warning ? [input.warning] : [],
    usedResponse: true
  };
};

const handoffNotesFor = (input: {
  round?: number;
  stageLabel: string;
  promptPath: string;
  responsePath: string;
  invalidResponse: boolean;
}): string[] =>
  input.invalidResponse
    ? [
        `Current-thread ${input.stageLabel} response is invalid${input.round !== undefined ? ` for round ${input.round}` : ""}.`,
        `Rewrite ${input.responsePath} with JSON only after reviewing ${input.promptPath} on the current Codex thread.`,
        `Resume the run after updating ${input.responsePath}.`
      ]
    : [
        `Current-thread ${input.stageLabel} is paused${input.round !== undefined ? ` for round ${input.round}` : ""}.`,
        `Complete ${input.promptPath} on the current Codex thread.`,
        `Write ${input.responsePath}, then resume the run.`
      ];

export const enhancePlanWithCurrentThread = async (input: {
  runId: string;
  transportProtocolPath?: string;
  runtimePaths: RuntimeStatePaths;
  plannedScenarioPath: string;
  planPath: string;
  idea: IdeaBrief;
  rubric: LoopRubric;
  scenario: LoopScenario;
  plan: LoopPlan;
  executorMode: ExecutorMode;
}): Promise<CurrentThreadEnhancementOutcome<{ scenario: LoopScenario; plan: LoopPlan }>> => {
  const preparedPrompt = await buildPlannerEnhancementPrompt({
    idea: input.idea,
    rubric: input.rubric,
    scenario: input.scenario,
    plan: input.plan,
    executorMode: input.executorMode
  });
  await Promise.all([
    writeJson(input.plannedScenarioPath, input.scenario),
    writeJson(input.planPath, input.plan)
  ]);
  const rawResponse = await readTextIfExists(input.runtimePaths.plannerEnhancementResponsePath);
  if (rawResponse !== undefined) {
    const applied = applyPlannerEnhancementResponse({
      scenario: input.scenario,
      plan: input.plan,
      responseText: rawResponse,
      warning: preparedPrompt.warning
    });
    if (applied.usedResponse) {
      return {
        kind: "completed",
        value: applied.value,
        runtimeWarnings: [
          ...applied.runtimeWarnings,
          `Current-thread planner enhancement completed from ${input.runtimePaths.plannerEnhancementResponsePath}.`
        ]
      };
    }
  }

  const invalidResponse = rawResponse !== undefined;
  const notes = handoffNotesFor({
    stageLabel: "planner enhancement",
    promptPath: rel(input.runtimePaths.plannerEnhancementPromptPath),
    responsePath: rel(input.runtimePaths.plannerEnhancementResponsePath),
    invalidResponse
  });
  await writeCurrentThreadEnhancementTask({
    runId: input.runId,
    phase: "planning",
    stage: "planner",
    taskPath: input.runtimePaths.plannerEnhancementTaskPath,
    promptPath: input.runtimePaths.plannerEnhancementPromptPath,
    responsePath: input.runtimePaths.plannerEnhancementResponsePath,
    preparedPrompt,
    transportProtocolPath: input.transportProtocolPath,
    summary: "Review the planner scenario and plan, then write a JSON patch response.",
    contextPaths: {
      planned_scenario_path: input.plannedScenarioPath,
      plan_path: input.planPath
    },
    notes
  });
  return {
    kind: "handoff",
    notes,
    artifacts: {
      planner_enhancement_task_path: input.runtimePaths.plannerEnhancementTaskPath,
      planner_enhancement_prompt_path: input.runtimePaths.plannerEnhancementPromptPath,
      planner_enhancement_response_path: input.runtimePaths.plannerEnhancementResponsePath
    }
  };
};

export const enhanceContractReviewWithCurrentThread = async (input: {
  runId: string;
  round: number;
  transportProtocolPath?: string;
  artifacts: RoundArtifacts;
  contractArtifact: RoundContractArtifact;
  contractReviewArtifact: ContractReviewArtifact;
  loadedAdapter?: LoadedAdapterContract;
  executorMode: ExecutorMode;
}): Promise<CurrentThreadEnhancementOutcome<ContractReviewArtifact>> => {
  const preparedPrompt = await buildContractReviewEnhancementPrompt({
    contractArtifact: input.contractArtifact,
    contractReviewArtifact: input.contractReviewArtifact,
    loadedAdapter: input.loadedAdapter,
    executorMode: input.executorMode
  });
  const rawResponse = await readTextIfExists(
    input.artifacts.contract_review_enhancement_response_path
  );
  if (rawResponse !== undefined) {
    const applied = applyContractReviewEnhancementResponse({
      contractArtifact: input.contractArtifact,
      contractReviewArtifact: input.contractReviewArtifact,
      responseText: rawResponse,
      warning: preparedPrompt.warning
    });
    if (applied.usedResponse) {
      return {
        kind: "completed",
        value: applied.value,
        runtimeWarnings: [
          ...applied.runtimeWarnings,
          `Current-thread contract-review enhancement completed for round ${input.round} from ${input.artifacts.contract_review_enhancement_response_path}.`
        ]
      };
    }
  }

  const invalidResponse = rawResponse !== undefined;
  const notes = handoffNotesFor({
    round: input.round,
    stageLabel: "contract-review enhancement",
    promptPath: rel(input.artifacts.contract_review_enhancement_prompt_path),
    responsePath: rel(input.artifacts.contract_review_enhancement_response_path),
    invalidResponse
  });
  await writeCurrentThreadEnhancementTask({
    runId: input.runId,
    round: input.round,
    phase: "negotiation",
    stage: "contract-review",
    taskPath: input.artifacts.contract_review_enhancement_task_path,
    promptPath: input.artifacts.contract_review_enhancement_prompt_path,
    responsePath: input.artifacts.contract_review_enhancement_response_path,
    preparedPrompt,
    transportProtocolPath: input.transportProtocolPath,
    summary: "Review the round contract and write a JSON patch response for the contract review.",
    contextPaths: {
      round_contract_path: input.artifacts.contract_json_path,
      contract_review_path: input.artifacts.contract_review_json_path
    },
    notes
  });
  return {
    kind: "handoff",
    notes,
    artifacts: {
      contract_review_enhancement_task_path:
        input.artifacts.contract_review_enhancement_task_path,
      contract_review_enhancement_prompt_path:
        input.artifacts.contract_review_enhancement_prompt_path,
      contract_review_enhancement_response_path:
        input.artifacts.contract_review_enhancement_response_path
    }
  };
};

export const enhanceGeneratorPlanWithCurrentThread = async (input: {
  runId: string;
  round: number;
  transportProtocolPath?: string;
  artifacts: RoundArtifacts;
  idea: IdeaBrief;
  contractArtifact: RoundContractArtifact;
  contractAgreementArtifact: ContractAgreementArtifact;
  generatorPlanArtifact: GeneratorPlanArtifact;
  previousPatchRequest?: PatchRequestArtifact;
  executorMode: ExecutorMode;
}): Promise<CurrentThreadEnhancementOutcome<GeneratorPlanArtifact>> => {
  const preparedPrompt = await buildGeneratorPlanEnhancementPrompt({
    idea: input.idea,
    contractArtifact: input.contractArtifact,
    contractAgreementArtifact: input.contractAgreementArtifact,
    generatorPlanArtifact: input.generatorPlanArtifact,
    previousPatchRequest: input.previousPatchRequest,
    executorMode: input.executorMode
  });
  const rawResponse = await readTextIfExists(
    input.artifacts.generator_plan_enhancement_response_path
  );
  if (rawResponse !== undefined) {
    const applied = applyGeneratorPlanEnhancementResponse({
      generatorPlanArtifact: input.generatorPlanArtifact,
      responseText: rawResponse,
      warning: preparedPrompt.warning
    });
    if (applied.usedResponse) {
      return {
        kind: "completed",
        value: applied.value,
        runtimeWarnings: [
          ...applied.runtimeWarnings,
          `Current-thread generator-plan enhancement completed for round ${input.round} from ${input.artifacts.generator_plan_enhancement_response_path}.`
        ]
      };
    }
  }

  const invalidResponse = rawResponse !== undefined;
  const notes = handoffNotesFor({
    round: input.round,
    stageLabel: "generator-plan enhancement",
    promptPath: rel(input.artifacts.generator_plan_enhancement_prompt_path),
    responsePath: rel(input.artifacts.generator_plan_enhancement_response_path),
    invalidResponse
  });
  await writeCurrentThreadEnhancementTask({
    runId: input.runId,
    round: input.round,
    phase: "negotiation",
    stage: "generator-plan",
    taskPath: input.artifacts.generator_plan_enhancement_task_path,
    promptPath: input.artifacts.generator_plan_enhancement_prompt_path,
    responsePath: input.artifacts.generator_plan_enhancement_response_path,
    preparedPrompt,
    transportProtocolPath: input.transportProtocolPath,
    summary: "Review the generator plan and write a JSON patch response for the current round.",
    contextPaths: {
      round_contract_path: input.artifacts.contract_json_path,
      contract_agreement_path: input.artifacts.contract_agreement_json_path,
      generator_plan_path: input.artifacts.generator_plan_json_path
    },
    notes
  });
  return {
    kind: "handoff",
    notes,
    artifacts: {
      generator_plan_enhancement_task_path:
        input.artifacts.generator_plan_enhancement_task_path,
      generator_plan_enhancement_prompt_path:
        input.artifacts.generator_plan_enhancement_prompt_path,
      generator_plan_enhancement_response_path:
        input.artifacts.generator_plan_enhancement_response_path
    }
  };
};

export const enhanceEvalReportWithCurrentThread = async (input: {
  runId: string;
  round: number;
  transportProtocolPath?: string;
  artifacts: RoundArtifacts;
  idea: IdeaBrief;
  contractArtifact: RoundContractArtifact;
  generatorPlanArtifact: GeneratorPlanArtifact;
  evalReport: EvalReport;
  adapterExecutions: AdapterCapabilityExecution[];
  coreProbeResults: CoreVerificationProbeExecution[];
  targetManifest?: TargetManifest;
  executorMode: ExecutorMode;
}): Promise<CurrentThreadEnhancementOutcome<EvalReport>> => {
  const preparedPrompt = await buildEvalEnhancementPrompt({
    idea: input.idea,
    contractArtifact: input.contractArtifact,
    generatorPlanArtifact: input.generatorPlanArtifact,
    evalReport: input.evalReport,
    adapterExecutions: input.adapterExecutions,
    coreProbeResults: input.coreProbeResults,
    targetManifest: input.targetManifest,
    executorMode: input.executorMode
  });
  const rawResponse = await readTextIfExists(input.artifacts.eval_enhancement_response_path);
  if (rawResponse !== undefined) {
    const applied = applyEvalEnhancementResponse({
      evalReport: input.evalReport,
      responseText: rawResponse,
      warning: preparedPrompt.warning
    });
    if (applied.usedResponse) {
      return {
        kind: "completed",
        value: applied.value,
        runtimeWarnings: [
          ...applied.runtimeWarnings,
          `Current-thread evaluator enhancement completed for round ${input.round} from ${input.artifacts.eval_enhancement_response_path}.`
        ]
      };
    }
  }

  const invalidResponse = rawResponse !== undefined;
  const notes = handoffNotesFor({
    round: input.round,
    stageLabel: "evaluator enhancement",
    promptPath: rel(input.artifacts.eval_enhancement_prompt_path),
    responsePath: rel(input.artifacts.eval_enhancement_response_path),
    invalidResponse
  });
  await writeCurrentThreadEnhancementTask({
    runId: input.runId,
    round: input.round,
    phase: "evaluation",
    stage: "evaluator",
    taskPath: input.artifacts.eval_enhancement_task_path,
    promptPath: input.artifacts.eval_enhancement_prompt_path,
    responsePath: input.artifacts.eval_enhancement_response_path,
    preparedPrompt,
    transportProtocolPath: input.transportProtocolPath,
    summary: "Review the deterministic eval report and write a JSON patch response for the round verdict.",
    contextPaths: {
      round_contract_path: input.artifacts.contract_json_path,
      generator_plan_path: input.artifacts.generator_plan_json_path,
      eval_report_path: input.artifacts.eval_report_path
    },
    notes
  });
  return {
    kind: "handoff",
    notes,
    artifacts: {
      eval_enhancement_task_path: input.artifacts.eval_enhancement_task_path,
      eval_enhancement_prompt_path: input.artifacts.eval_enhancement_prompt_path,
      eval_enhancement_response_path: input.artifacts.eval_enhancement_response_path
    }
  };
};
