import { join } from "node:path";

import type { AppServerTransportController } from "./app-server-runtime.js";
import { resolvedAdapterTargetRoot } from "./adapter-paths.js";
import type {
  CodexCommandResult,
  CodexJsonSchema
} from "./codex-runtime.js";
import {
  buildExecutorModePrompt,
  experimentalExecutorRuntimeWarning
} from "./codex-agent-manifest.js";
import { runCodexCommand } from "./codex-runtime.js";
import { repoRoot } from "./file-system.js";
import type {
  AdapterCapabilityExecution,
  ContractAgreementArtifact,
  ContractReviewArtifact,
  CoreVerificationProbeExecution,
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

export type EnhancementResult<T> = {
  value: T;
  runtimeWarnings: string[];
};

type CodexStageName =
  | "planner"
  | "contract-review"
  | "generator-plan"
  | "evaluator";

const validFocusAreas = new Set<HarnessFocusArea>([
  "planner_clarity",
  "contract_testability",
  "artifact_handoff",
  "patch_authority",
  "qa_rigor",
  "runtime_portability"
]);

const stageDisableEnv: Record<CodexStageName, string> = {
  planner: "HARNESS_DISABLE_CODEX_PLANNER",
  "contract-review": "HARNESS_DISABLE_CODEX_CONTRACT_REVIEW",
  "generator-plan": "HARNESS_DISABLE_CODEX_GENERATOR_PLAN",
  evaluator: "HARNESS_DISABLE_CODEX_EVALUATOR"
};

const roundEnhancementSkillPath = join(
  repoRoot,
  ".agents",
  "skills",
  "round-enhancement",
  "SKILL.md"
);

const roundEnhancementSkillItem = () =>
  ({
    type: "skill",
    name: "round-enhancement",
    path: roundEnhancementSkillPath
  }) satisfies Record<string, unknown>;

const verdictSeverity: Record<RoundVerdict, number> = {
  advance: 0,
  revise: 1,
  hold: 2
};

const plannerSchema: CodexJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    scenario_title: { type: "string" },
    scenario_description: { type: "string" },
    user_goals: { type: "array", items: { type: "string" } },
    acceptance_highlights: { type: "array", items: { type: "string" } },
    planner_focus_areas: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "planner_clarity",
          "contract_testability",
          "artifact_handoff",
          "patch_authority",
          "qa_rigor",
          "runtime_portability"
        ]
      }
    },
    north_star: { type: "string" },
    attempt_strategy: { type: "string" },
    planner_notes: { type: "array", items: { type: "string" } },
    remediation_policy: { type: "array", items: { type: "string" } }
  },
  required: []
};

const contractReviewSchema: CodexJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision: { type: "string", enum: ["accept", "revise"] },
    concerns: { type: "array", items: { type: "string" } },
    required_changes: { type: "array", items: { type: "string" } },
    approved_checks: { type: "array", items: { type: "string" } },
    adapter_ready: { type: "boolean" },
    static_blockers: { type: "array", items: { type: "string" } }
  },
  required: []
};

const generatorPlanSchema: CodexJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    implementation_intent: { type: "string" },
    files_to_touch: { type: "array", items: { type: "string" } },
    expected_proof: { type: "array", items: { type: "string" } },
    risk_notes: { type: "array", items: { type: "string" } },
    out_of_scope: { type: "array", items: { type: "string" } },
    adapter_actions: { type: "array", items: { type: "string" } }
  },
  required: []
};

const evaluatorSchema: CodexJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    overall_verdict: { type: "string", enum: ["advance", "revise", "hold"] },
    strengths: { type: "array", items: { type: "string" } },
    blockers: { type: "array", items: { type: "string" } },
    next_actions: { type: "array", items: { type: "string" } }
  },
  required: []
};

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

const agentFailureWarning = (agentName: string, details: string): string =>
  `Codex ${agentName} agent fallback: ${details}`;

const disabledStageWarning = (stage: CodexStageName): string =>
  `${stage} agent execution disabled by ${stageDisableEnv[stage]}=1.`;

const strictestVerdict = (base: RoundVerdict, candidate?: RoundVerdict): RoundVerdict => {
  if (!candidate) {
    return base;
  }

  return verdictSeverity[candidate] > verdictSeverity[base] ? candidate : base;
};

const failureDetails = (execution: CodexCommandResult): string =>
  execution.error ?? trimString(execution.stderr) ?? `exit code ${execution.code}`;

const maybeDisabledStage = <T>(
  stage: CodexStageName,
  fallbackValue: T
): EnhancementResult<T> | undefined =>
  process.env[stageDisableEnv[stage]] === "1"
    ? {
        value: fallbackValue,
        runtimeWarnings: [agentFailureWarning(stage, disabledStageWarning(stage))]
      }
    : undefined;

const skillPrompt = (skillName: string, prompt: string): string =>
  [`Use $${skillName}.`, "", prompt].join("\n");

const appServerFailureWarning = (agentName: string, details: string): string =>
  `App Server ${agentName} enhancement fallback: ${details}`;

export const enhancePlanWithCodex = async (input: {
  runDirectory: string;
  idea: IdeaBrief;
  rubric: LoopRubric;
  scenario: LoopScenario;
  plan: LoopPlan;
  executorMode: ExecutorMode;
}): Promise<EnhancementResult<{ scenario: LoopScenario; plan: LoopPlan }>> => {
  const artifactDirectory = join(input.runDirectory, "codex-agents");
  const disabledStage = maybeDisabledStage("planner", {
    scenario: input.scenario,
    plan: input.plan
  });
  if (disabledStage) {
    return disabledStage;
  }

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
  const preparedPrompt = await buildExecutorModePrompt({
    executorMode: input.executorMode,
    role: "planner",
    prompt: basePrompt
  });

  const execution = await runCodexCommand({
    name: "planner",
    prompt: preparedPrompt.prompt,
    cwd: repoRoot,
    artifactDirectory,
    profile: "readonly_agent",
    addDirs: [input.runDirectory],
    outputSchema: plannerSchema,
    sandboxMode: "read-only",
    metadata: {
      role: "planner",
      stage: "plan_enhancement",
      executor_mode: input.executorMode,
      ...(preparedPrompt.manifestPath
        ? { agent_manifest_path: preparedPrompt.manifestPath }
        : {})
    }
  });

  if (execution.code !== 0 || execution.error || !execution.responseText) {
    return {
      value: { scenario: input.scenario, plan: input.plan },
      runtimeWarnings: [
        ...(preparedPrompt.warning ? [preparedPrompt.warning] : []),
        agentFailureWarning(
          "planner",
          failureDetails(execution)
        )
      ]
    };
  }

  const parsed = parseJsonResponse<CodexPlannerPatch>(execution.responseText);
  if (!parsed) {
    return {
      value: { scenario: input.scenario, plan: input.plan },
      runtimeWarnings: [
        ...(preparedPrompt.warning ? [preparedPrompt.warning] : []),
        agentFailureWarning("planner", "response was not valid JSON; using deterministic planner output.")
      ]
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
    runtimeWarnings: preparedPrompt.warning ? [preparedPrompt.warning] : []
  };
};

export const enhanceContractReviewWithCodex = async (input: {
  roundDirectory: string;
  contractArtifact: RoundContractArtifact;
  contractReviewArtifact: ContractReviewArtifact;
  loadedAdapter?: LoadedAdapterContract;
  executorMode: ExecutorMode;
}): Promise<EnhancementResult<ContractReviewArtifact>> => {
  const artifactDirectory = join(input.roundDirectory, "codex-agents");
  const disabledStage = maybeDisabledStage(
    "contract-review",
    input.contractReviewArtifact
  );
  if (disabledStage) {
    return disabledStage;
  }

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
            target_root: resolvedAdapterTargetRoot(input.loadedAdapter),
            target_family: input.loadedAdapter.verification_profile?.profile.target_family,
            validation_lane: input.loadedAdapter.verification_profile?.profile.validation_lane
          }
        : { adapter_attached: false },
      null,
      2
    )
  ].join("\n");
  const preparedPrompt = await buildExecutorModePrompt({
    executorMode: input.executorMode,
    role: "evaluator",
    prompt: basePrompt
  });

  const execution = await runCodexCommand({
    name: "contract-review",
    prompt: preparedPrompt.prompt,
    cwd: repoRoot,
    artifactDirectory,
    profile: "readonly_agent",
    addDirs: [input.roundDirectory],
    outputSchema: contractReviewSchema,
    sandboxMode: "read-only",
    metadata: {
      role: "evaluator",
      stage: "contract_review",
      executor_mode: input.executorMode,
      ...(preparedPrompt.manifestPath
        ? { agent_manifest_path: preparedPrompt.manifestPath }
        : {})
    }
  });

  if (execution.code !== 0 || execution.error || !execution.responseText) {
    return {
      value: input.contractReviewArtifact,
      runtimeWarnings: [
        ...(preparedPrompt.warning ? [preparedPrompt.warning] : []),
        agentFailureWarning(
          "contract-review",
          failureDetails(execution)
        )
      ]
    };
  }

  const parsed = parseJsonResponse<CodexContractReviewPatch>(execution.responseText);
  if (!parsed) {
    return {
      value: input.contractReviewArtifact,
      runtimeWarnings: [
        ...(preparedPrompt.warning ? [preparedPrompt.warning] : []),
        agentFailureWarning(
          "contract-review",
          "response was not valid JSON; using deterministic contract review."
        )
      ]
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
    runtimeWarnings: preparedPrompt.warning ? [preparedPrompt.warning] : []
  };
};

export const enhanceGeneratorPlanWithCodex = async (input: {
  roundDirectory: string;
  idea: IdeaBrief;
  contractArtifact: RoundContractArtifact;
  contractAgreementArtifact: ContractAgreementArtifact;
  generatorPlanArtifact: GeneratorPlanArtifact;
  previousPatchRequest?: PatchRequestArtifact;
  executorMode: ExecutorMode;
}): Promise<EnhancementResult<GeneratorPlanArtifact>> => {
  const artifactDirectory = join(input.roundDirectory, "codex-agents");
  const disabledStage = maybeDisabledStage(
    "generator-plan",
    input.generatorPlanArtifact
  );
  if (disabledStage) {
    return disabledStage;
  }

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
  const preparedPrompt = await buildExecutorModePrompt({
    executorMode: input.executorMode,
    role: "generator",
    prompt: basePrompt
  });

  const execution = await runCodexCommand({
    name: "generator-plan",
    prompt: preparedPrompt.prompt,
    cwd: repoRoot,
    artifactDirectory,
    profile: "readonly_agent",
    addDirs: [input.roundDirectory],
    outputSchema: generatorPlanSchema,
    sandboxMode: "read-only",
    metadata: {
      role: "generator",
      stage: "generator_plan",
      executor_mode: input.executorMode,
      ...(preparedPrompt.manifestPath
        ? { agent_manifest_path: preparedPrompt.manifestPath }
        : {})
    }
  });

  if (execution.code !== 0 || execution.error || !execution.responseText) {
    return {
      value: input.generatorPlanArtifact,
      runtimeWarnings: [
        ...(preparedPrompt.warning ? [preparedPrompt.warning] : []),
        agentFailureWarning(
          "generator-plan",
          failureDetails(execution)
        )
      ]
    };
  }

  const parsed = parseJsonResponse<CodexGeneratorPlanPatch>(execution.responseText);
  if (!parsed) {
    return {
      value: input.generatorPlanArtifact,
      runtimeWarnings: [
        ...(preparedPrompt.warning ? [preparedPrompt.warning] : []),
        agentFailureWarning(
          "generator-plan",
          "response was not valid JSON; using deterministic generator plan."
        )
      ]
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
    runtimeWarnings: preparedPrompt.warning ? [preparedPrompt.warning] : []
  };
};

export const enhanceEvalReportWithCodex = async (input: {
  roundDirectory: string;
  idea: IdeaBrief;
  contractArtifact: RoundContractArtifact;
  generatorPlanArtifact: GeneratorPlanArtifact;
  evalReport: EvalReport;
  adapterExecutions: AdapterCapabilityExecution[];
  coreProbeResults: CoreVerificationProbeExecution[];
  targetManifest?: TargetManifest;
  executorMode: ExecutorMode;
}): Promise<EnhancementResult<EvalReport>> => {
  const artifactDirectory = join(input.roundDirectory, "codex-agents");
  const disabledStage = maybeDisabledStage("evaluator", input.evalReport);
  if (disabledStage) {
    return disabledStage;
  }

  const basePrompt = [
    "You are a fresh independent evaluator for a generic Codex workbench harness.",
    "Do not modify files or run commands. Return JSON only.",
    "Blind mode is mandatory: judge only the current round inputs in this prompt.",
    "Do not use, request, infer, or compare against any previous round evaluator response, scorecard, eval_report, patch_request, or quality_critique.",
    "Do not consider earlier round scores, verdicts, unresolved ids, or quality judgments when choosing this round verdict.",
    "Previous patch-request resolution is computed separately by carry_forward_gate, not by evaluator scoring.",
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
  const preparedPrompt = await buildExecutorModePrompt({
    executorMode: input.executorMode,
    role: "evaluator",
    prompt: basePrompt
  });

  const execution = await runCodexCommand({
    name: "evaluator",
    prompt: preparedPrompt.prompt,
    cwd: repoRoot,
    artifactDirectory,
    profile: "readonly_agent",
    addDirs: [input.roundDirectory],
    outputSchema: evaluatorSchema,
    sandboxMode: "read-only",
    allowCurrentThreadReadOnlyJudge: true,
    configOverrides: {
      approval_policy: "never",
      sandbox_mode: "read-only",
      "sandbox_read_only.network_access": false
    },
    metadata: {
      role: "judge",
      stage: "fresh_independent_eval_report_review",
      evaluator_mode: "per_round_blind",
      resolution_policy: "carry_forward_gate_separated",
      executor_mode: input.executorMode,
      ...(preparedPrompt.manifestPath
        ? { agent_manifest_path: preparedPrompt.manifestPath }
        : {})
    }
  });

  if (execution.code !== 0 || execution.error || !execution.responseText) {
    return {
      value: input.evalReport,
      runtimeWarnings: [
        ...(preparedPrompt.warning ? [preparedPrompt.warning] : []),
        agentFailureWarning(
          "evaluator",
          failureDetails(execution)
        )
      ]
    };
  }

  const parsed = parseJsonResponse<CodexEvaluatorPatch>(execution.responseText);
  if (!parsed) {
    return {
      value: input.evalReport,
      runtimeWarnings: [
        ...(preparedPrompt.warning ? [preparedPrompt.warning] : []),
        agentFailureWarning(
          "evaluator",
          "response was not valid JSON; using deterministic evaluator report."
        )
      ]
    };
  }

  const mergedVerdict = strictestVerdict(input.evalReport.overall_verdict, parsed.overall_verdict);
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
    runtimeWarnings: preparedPrompt.warning ? [preparedPrompt.warning] : []
  };
};

export const enhancePlanWithAppServer = async (input: {
  transport: AppServerTransportController;
  runDirectory: string;
  idea: IdeaBrief;
  rubric: LoopRubric;
  scenario: LoopScenario;
  plan: LoopPlan;
  executorMode: ExecutorMode;
}): Promise<EnhancementResult<{ scenario: LoopScenario; plan: LoopPlan }>> => {
  const disabledStage = maybeDisabledStage("planner", {
    scenario: input.scenario,
    plan: input.plan
  });
  if (disabledStage) {
    return disabledStage;
  }

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
  const preparedPrompt = await buildExecutorModePrompt({
    executorMode: input.executorMode,
    role: "planner",
    prompt: basePrompt
  });

  let execution;
  try {
    execution = await input.transport.runTask({
      round: 0,
      phase: "negotiation",
      taskLabel: "planner enhancement",
      prompt: skillPrompt("round-enhancement", preparedPrompt.prompt),
      taskCwd: repoRoot,
      sandboxMode: "readOnly",
      approvalPolicy: "never",
      outputSchema: plannerSchema,
      inputItems: [
        {
          type: "text",
          text: skillPrompt("round-enhancement", preparedPrompt.prompt)
        },
        roundEnhancementSkillItem()
      ]
    });
  } catch (error) {
    return {
      value: { scenario: input.scenario, plan: input.plan },
      runtimeWarnings: [
        ...(preparedPrompt.warning ? [preparedPrompt.warning] : []),
        appServerFailureWarning(
          "planner",
          error instanceof Error
            ? `${error.message}; using deterministic planner output.`
            : "App Server planner enhancement failed; using deterministic planner output."
        )
      ]
    };
  }
  if (execution.status !== "completed" || !execution.responseText) {
    return {
      value: { scenario: input.scenario, plan: input.plan },
      runtimeWarnings: [
        ...(preparedPrompt.warning ? [preparedPrompt.warning] : []),
        appServerFailureWarning(
          "planner",
          execution.status === "completed"
            ? "empty structured response; using deterministic planner output."
            : `turn ended with status '${execution.status}'.`
        )
      ]
    };
  }

  const parsed = parseJsonResponse<CodexPlannerPatch>(execution.responseText);
  if (!parsed) {
    return {
      value: { scenario: input.scenario, plan: input.plan },
      runtimeWarnings: [
        ...(preparedPrompt.warning ? [preparedPrompt.warning] : []),
        appServerFailureWarning(
          "planner",
          "response was not valid JSON; using deterministic planner output."
        )
      ]
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
    runtimeWarnings: preparedPrompt.warning ? [preparedPrompt.warning] : []
  };
};

export const enhanceContractReviewWithAppServer = async (input: {
  transport: AppServerTransportController;
  round: number;
  contractArtifact: RoundContractArtifact;
  contractReviewArtifact: ContractReviewArtifact;
  loadedAdapter?: LoadedAdapterContract;
  executorMode: ExecutorMode;
}): Promise<EnhancementResult<ContractReviewArtifact>> => {
  const disabledStage = maybeDisabledStage("contract-review", input.contractReviewArtifact);
  if (disabledStage) {
    return disabledStage;
  }

  const basePrompt = [
    "You are the evaluator reviewing a round contract for a generic Codex workbench harness.",
    "Return JSON only.",
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
            target_root: resolvedAdapterTargetRoot(input.loadedAdapter),
            target_family: input.loadedAdapter.verification_profile?.profile.target_family,
            validation_lane: input.loadedAdapter.verification_profile?.profile.validation_lane
          }
        : { adapter_attached: false },
      null,
      2
    )
  ].join("\n");
  const preparedPrompt = await buildExecutorModePrompt({
    executorMode: input.executorMode,
    role: "evaluator",
    prompt: basePrompt
  });

  let execution;
  try {
    execution = await input.transport.runReview({
      round: input.round,
      phase: "negotiation",
      reviewLabel: `round-${String(input.round).padStart(3, "0")} contract review`,
      instructions: preparedPrompt.prompt
    });
  } catch (error) {
    return {
      value: input.contractReviewArtifact,
      runtimeWarnings: [
        ...(preparedPrompt.warning ? [preparedPrompt.warning] : []),
        appServerFailureWarning(
          "contract-review",
          error instanceof Error
            ? `${error.message}; using deterministic contract review.`
            : "App Server contract-review failed; using deterministic contract review."
        )
      ]
    };
  }
  if (execution.status !== "completed" || !execution.reviewText) {
    return {
      value: input.contractReviewArtifact,
      runtimeWarnings: [
        ...(preparedPrompt.warning ? [preparedPrompt.warning] : []),
        appServerFailureWarning(
          "contract-review",
          execution.status === "completed"
            ? "empty review output; using deterministic contract review."
            : `review turn ended with status '${execution.status}'.`
        )
      ]
    };
  }

  const parsed = parseJsonResponse<CodexContractReviewPatch>(execution.reviewText);
  if (!parsed) {
    return {
      value: input.contractReviewArtifact,
      runtimeWarnings: [
        ...(preparedPrompt.warning ? [preparedPrompt.warning] : []),
        appServerFailureWarning(
          "contract-review",
          "review output was not valid JSON; using deterministic contract review."
        )
      ]
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
    runtimeWarnings: preparedPrompt.warning ? [preparedPrompt.warning] : []
  };
};

export const enhanceGeneratorPlanWithAppServer = async (input: {
  transport: AppServerTransportController;
  round: number;
  idea: IdeaBrief;
  contractArtifact: RoundContractArtifact;
  contractAgreementArtifact: ContractAgreementArtifact;
  generatorPlanArtifact: GeneratorPlanArtifact;
  previousPatchRequest?: PatchRequestArtifact;
  executorMode: ExecutorMode;
}): Promise<EnhancementResult<GeneratorPlanArtifact>> => {
  const disabledStage = maybeDisabledStage("generator-plan", input.generatorPlanArtifact);
  if (disabledStage) {
    return disabledStage;
  }

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
  const preparedPrompt = await buildExecutorModePrompt({
    executorMode: input.executorMode,
    role: "generator",
    prompt: basePrompt
  });

  let execution;
  try {
    execution = await input.transport.runTask({
      round: input.round,
      phase: "negotiation",
      taskLabel: "generator-plan enhancement",
      prompt: skillPrompt("round-enhancement", preparedPrompt.prompt),
      taskCwd: repoRoot,
      sandboxMode: "readOnly",
      approvalPolicy: "never",
      outputSchema: generatorPlanSchema,
      inputItems: [
        {
          type: "text",
          text: skillPrompt("round-enhancement", preparedPrompt.prompt)
        },
        roundEnhancementSkillItem()
      ]
    });
  } catch (error) {
    return {
      value: input.generatorPlanArtifact,
      runtimeWarnings: [
        ...(preparedPrompt.warning ? [preparedPrompt.warning] : []),
        appServerFailureWarning(
          "generator-plan",
          error instanceof Error
            ? `${error.message}; using deterministic generator plan.`
            : "App Server generator-plan enhancement failed; using deterministic generator plan."
        )
      ]
    };
  }
  if (execution.status !== "completed" || !execution.responseText) {
    return {
      value: input.generatorPlanArtifact,
      runtimeWarnings: [
        ...(preparedPrompt.warning ? [preparedPrompt.warning] : []),
        appServerFailureWarning(
          "generator-plan",
          execution.status === "completed"
            ? "empty structured response; using deterministic generator plan."
            : `turn ended with status '${execution.status}'.`
        )
      ]
    };
  }

  const parsed = parseJsonResponse<CodexGeneratorPlanPatch>(execution.responseText);
  if (!parsed) {
    return {
      value: input.generatorPlanArtifact,
      runtimeWarnings: [
        ...(preparedPrompt.warning ? [preparedPrompt.warning] : []),
        appServerFailureWarning(
          "generator-plan",
          "response was not valid JSON; using deterministic generator plan."
        )
      ]
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
    runtimeWarnings: preparedPrompt.warning ? [preparedPrompt.warning] : []
  };
};

export const enhanceEvalReportWithAppServer = async (input: {
  transport: AppServerTransportController;
  round: number;
  idea: IdeaBrief;
  contractArtifact: RoundContractArtifact;
  generatorPlanArtifact: GeneratorPlanArtifact;
  evalReport: EvalReport;
  adapterExecutions: AdapterCapabilityExecution[];
  coreProbeResults: CoreVerificationProbeExecution[];
  targetManifest?: TargetManifest;
  executorMode: ExecutorMode;
}): Promise<EnhancementResult<EvalReport>> => {
  const disabledStage = maybeDisabledStage("evaluator", input.evalReport);
  if (disabledStage) {
    return disabledStage;
  }

  const basePrompt = [
    "You are a fresh independent evaluator for a generic Codex workbench harness.",
    "Return JSON only.",
    "Blind mode is mandatory: judge only the current round inputs in this prompt.",
    "Do not use, request, infer, or compare against any previous round evaluator response, scorecard, eval_report, patch_request, or quality_critique.",
    "Do not consider earlier round scores, verdicts, unresolved ids, or quality judgments when choosing this round verdict.",
    "Previous patch-request resolution is computed separately by carry_forward_gate, not by evaluator scoring.",
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
  const preparedPrompt = await buildExecutorModePrompt({
    executorMode: input.executorMode,
    role: "evaluator",
    prompt: basePrompt
  });

  let execution;
  try {
    execution = await input.transport.runReview({
      round: input.round,
      phase: "evaluation",
      reviewLabel: `round-${String(input.round).padStart(3, "0")} eval review`,
      instructions: preparedPrompt.prompt
    });
  } catch (error) {
    return {
      value: input.evalReport,
      runtimeWarnings: [
        ...(preparedPrompt.warning ? [preparedPrompt.warning] : []),
        appServerFailureWarning(
          "evaluator",
          error instanceof Error
            ? `${error.message}; using deterministic evaluator report.`
            : "App Server evaluator review failed; using deterministic evaluator report."
        )
      ]
    };
  }
  if (execution.status !== "completed" || !execution.reviewText) {
    return {
      value: input.evalReport,
      runtimeWarnings: [
        ...(preparedPrompt.warning ? [preparedPrompt.warning] : []),
        appServerFailureWarning(
          "evaluator",
          execution.status === "completed"
            ? "empty review output; using deterministic evaluator report."
            : `review turn ended with status '${execution.status}'.`
        )
      ]
    };
  }

  const parsed = parseJsonResponse<CodexEvaluatorPatch>(execution.reviewText);
  if (!parsed) {
    return {
      value: input.evalReport,
      runtimeWarnings: [
        ...(preparedPrompt.warning ? [preparedPrompt.warning] : []),
        appServerFailureWarning(
          "evaluator",
          "review output was not valid JSON; using deterministic evaluator report."
        )
      ]
    };
  }

  const mergedVerdict = strictestVerdict(input.evalReport.overall_verdict, parsed.overall_verdict);
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
    runtimeWarnings: preparedPrompt.warning ? [preparedPrompt.warning] : []
  };
};

export { experimentalExecutorRuntimeWarning };
