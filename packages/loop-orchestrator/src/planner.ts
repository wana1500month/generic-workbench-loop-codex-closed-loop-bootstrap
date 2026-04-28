import type {
  HarnessFocusArea,
  IdeaBrief,
  LoopImprovementContract,
  LoopPlan,
  LoopRoundDirective,
  LoopRubric,
  LoopScenario,
  PatchRequestArtifact,
  RewriteScope
} from "./types.js";

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const normalizedIdeaText = (idea: IdeaBrief): string =>
  [
    idea.title,
    idea.summary,
    ...idea.user_goals,
    ...idea.constraints,
    ...idea.quality_bar
  ]
    .join(" ")
    .toLowerCase();

const maxPlannerFocusAreas = 3;

const focusAreaPriority: HarnessFocusArea[] = [
  "planner_clarity",
  "contract_testability",
  "artifact_handoff",
  "patch_authority",
  "qa_rigor",
  "runtime_portability"
];

const focusAreaSignals: Array<{
  focusArea: HarnessFocusArea;
  baseScore: number;
  patterns: RegExp[];
}> = [
  {
    focusArea: "planner_clarity",
    baseScore: 3,
    patterns: [/spec|plan|clarity|scope|goal|intent|roadmap/, /product|workflow|ux|feature/]
  },
  {
    focusArea: "contract_testability",
    baseScore: 3,
    patterns: [/contract|done|test|verify|acceptance|proof/, /score|threshold|criteria|must pass/]
  },
  {
    focusArea: "artifact_handoff",
    baseScore: 2,
    patterns: [/file|handoff|resume|artifact|context/, /history|state|persist|registry/]
  },
  {
    focusArea: "patch_authority",
    baseScore: 1,
    patterns: [/patch|feedback|revise|next attempt|next round|controller/, /remediation|fix|reopen/]
  },
  {
    focusArea: "qa_rigor",
    baseScore: 1,
    patterns: [/qa|review|skeptical|judge|evaluator/, /quality|bug|verify|regression/]
  },
  {
    focusArea: "runtime_portability",
    baseScore: 1,
    patterns: [/adapter|surface|portable|generic|boundary/, /browser|api|fullstack|runtime|environment/]
  }
];

const rankFocusAreas = (idea: IdeaBrief): HarnessFocusArea[] => {
  const text = normalizedIdeaText(idea);
  return focusAreaSignals
    .map(({ focusArea, baseScore, patterns }) => ({
      focusArea,
      score:
        baseScore +
        patterns.reduce(
          (total, pattern) => total + (pattern.test(text) ? 2 : 0),
          0
        )
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return (
        focusAreaPriority.indexOf(left.focusArea) -
        focusAreaPriority.indexOf(right.focusArea)
      );
    })
    .slice(0, maxPlannerFocusAreas)
    .map((entry) => entry.focusArea);
};

const checksForFocusAreas = (focusAreas: readonly HarnessFocusArea[]): string[] =>
  unique(
    focusAreas.flatMap((focus) => {
      switch (focus) {
        case "planner_clarity":
          return ["planner_brief_written", "plan_written"];
        case "contract_testability":
          return [
            "round_contract_written",
            "round_contract_is_testable",
            "contract_review_written",
            "contract_review_quality",
            "contract_agreement_written",
            "agreement_matches_review",
            "round_contract_scopes_release_qa",
            "generator_plan_written"
          ];
        case "artifact_handoff":
          return [
            "planner_context_surface_reserved",
            "generator_brief_surface_reserved",
            "qa_review_surface_reserved",
            "handoff_is_resumable"
          ];
        case "patch_authority":
          return [
            "evaluator_verdict_surface_reserved",
            "patch_request_surface_reserved"
          ];
        case "qa_rigor":
          return [
            "eval_report_surface_reserved",
            "controller_decision_surface_reserved",
            "release_blockers_recorded"
          ];
        case "runtime_portability":
          return [
            "adapter_boundary_documented",
            "adapter_runtime_present",
            "adapter_example_written",
            "adapter_claims_are_honest",
            "proof_provenance_is_attested",
            "live_verification_present",
            "proof_boundary_is_independent",
            "adapter_evidence_is_meaningful",
            "adapter_criteria_are_grounded",
            "adapter_criteria_match_profile"
          ];
        default:
          return [];
      }
    })
  );

export const buildScenarioFromIdea = (idea: IdeaBrief): LoopScenario => ({
  scenario_id: slugify(idea.title) || "generic-harness-core",
  title: idea.title,
  description: idea.summary,
  user_goals:
    idea.user_goals.length > 0
      ? idea.user_goals
      : ["Keep the repository focused on harness behavior rather than a bundled product surface."],
  acceptance_highlights:
    idea.quality_bar.length > 0
      ? idea.quality_bar
      : ["The harness should be understandable from files alone."],
  idea_source_path: idea.source_path,
  planner_notes: unique([
    `Idea source: ${idea.source_path}.`,
    ...idea.constraints.map((constraint) => `Constraint: ${constraint}`)
  ]).slice(0, 8)
});

export const buildAttemptDirective = (input: {
  scenario: LoopScenario;
  plan: LoopPlan;
  round: number;
  previousPatchRequest?: PatchRequestArtifact;
}): LoopRoundDirective => {
  const carryOverCheckIds = unique(
    input.previousPatchRequest?.must_fix.flatMap((item) => item.target_check_ids) ?? []
  );
  const thresholdOnly =
    carryOverCheckIds.length > 0 &&
    carryOverCheckIds.every((checkId) => checkId === "target_signal_thresholds_met");
  const remediationAttempt = input.round > 1 || carryOverCheckIds.length > 0;
  const isProductBuild = input.plan.plan_kind === "product_build";
  const productTitle = input.plan.product_title ?? input.scenario.title;
  const initialObjective = isProductBuild
    ? `Build the first version of ${productTitle} against runtime/build-brief.json, run the local product surface, and satisfy the release-gate workflow probes.`
    : "Build against the planner spec in one long pass, then let the evaluator decide whether remediation is needed.";
  const remediationObjective = thresholdOnly
    ? isProductBuild
      ? "Strengthen product runtime proof, browser workflow evidence, and release quality until product thresholds pass."
      : "Strengthen target proof, live verification, and release quality until target thresholds pass."
    : `Resolve evaluator feedback from the previous attempt: ${carryOverCheckIds.join(", ")}.`;

  return {
    round_id: `${input.scenario.scenario_id}-attempt-${String(input.round).padStart(2, "0")}`,
    attempt_kind: remediationAttempt ? "remediation" : "initial_build",
    label: remediationAttempt ? `remediation attempt ${input.round - 1}` : "initial build attempt",
    objective:
      carryOverCheckIds.length > 0
        ? remediationObjective
        : initialObjective,
    focus_areas: input.plan.planner_focus_areas,
    rewrite_scope: remediationAttempt ? "incremental" : "integration",
    acceptance_checks:
      carryOverCheckIds.length > 0 ? carryOverCheckIds : input.plan.planner_acceptance_checks
  };
};

export const buildLoopPlan = (input: {
  scenario: LoopScenario;
  rubric: LoopRubric;
  maxRounds: number;
  idea: IdeaBrief;
  planKind?: "harness" | "product_build";
}): LoopPlan => {
  const focusAreas = rankFocusAreas(input.idea);
  const isProductBuild = input.planKind === "product_build";
  const productBuildChecks = [
    "build_brief_matches_user_intake",
    "target_root_created_or_updated",
    "core_workflows_have_user_visible_paths",
    "local_runtime_starts",
    "browser_journey_evidence_present",
    "no_scope_drift_from_build_brief"
  ];
  const plannerAcceptanceChecks = isProductBuild
    ? productBuildChecks
    : checksForFocusAreas(focusAreas);

  return {
    plan_kind: isProductBuild ? "product_build" : "harness",
    scenario_id: input.scenario.scenario_id,
    rubric_id: input.rubric.rubric_id,
    target_total_score: input.rubric.target_total_score,
    minimum_control_plane_score: input.rubric.minimum_control_plane_score,
    minimum_proof_score: input.rubric.minimum_proof_score,
    target_signal_requires_adapter: input.rubric.target_signal_requires_adapter,
    target_signal_requires_grade_score: input.rubric.target_signal_requires_grade_score,
    stop_after_plateau_rounds: input.rubric.stop_after_plateau_rounds,
    max_remediation_rounds: input.rubric.max_remediation_rounds,
    max_rounds: input.maxRounds,
    north_star: isProductBuild
      ? `Ship the requested first-version product, ${input.idea.title}, with honest runtime evidence for the captured core workflows.`
      : "Keep this repository focused on reusable harness mechanics: planner-owned spec expansion, evaluator-driven remediation, skeptical proof gates, external adapter boundaries, and file-based handoff.",
    attempt_strategy: isProductBuild
      ? "Build the first version against the normalized build brief, run the local product surface, collect workflow evidence, then remediate only against failed proof gates."
      : "Run the planner once, let the generator take a long build attempt against that spec, then allow the evaluator to reopen remediation attempts only when thresholds or skeptical checks fail.",
    planner_focus_areas: focusAreas,
    planner_acceptance_checks: plannerAcceptanceChecks,
    remediation_policy: [
      "Do not pre-split the build into feature sprints.",
      "Use patch-request.json plus QA feedback to drive remediation attempts instead of re-planning the whole build contract.",
      "Stop early as soon as contract completion or target_reached can be claimed honestly."
    ],
    planner_notes: isProductBuild
      ? unique([
          `Product title: ${input.idea.title}.`,
          "Do not optimize the harness itself during this product build.",
          "Keep the build scoped to the captured target root.",
          "Every claimed workflow must have runtime or browser evidence.",
          "Use the build brief and run contract as the source of truth."
        ]).slice(0, 10)
      : unique([
          "Do not bundle a sample product surface into the harness repository.",
          "Prefer protocol clarity over fake end-to-end completeness.",
          "Keep patch requests authoritative enough to drive the next build attempt.",
          "Treat external adapters as capability providers, not as source code to absorb into this repo."
        ]).slice(0, 10),
    ...(isProductBuild
      ? {
          product_title: input.idea.title,
          session_objective: `Ship ${input.idea.title} with runtime evidence for the captured workflows.`
        }
      : {}),
    idea_title: input.idea.title,
    idea_source_path: input.idea.source_path
  };
};

export const buildRoundContract = (input: {
  scenario: LoopScenario;
  directive: LoopRoundDirective;
  round: number;
  previousPatchRequest?: PatchRequestArtifact;
}): LoopImprovementContract => {
  const carryOverPatchIds = input.previousPatchRequest?.must_fix.map((item) => item.id) ?? [];
  const carryOverCheckIds = unique(
    input.previousPatchRequest?.must_fix.flatMap((item) => item.target_check_ids) ?? []
  );

  return {
    contract_id: `${input.scenario.scenario_id}-contract-round-${String(input.round).padStart(2, "0")}`,
    attempt_kind: input.directive.attempt_kind,
    objective: input.directive.objective,
    rewrite_scope: input.directive.rewrite_scope,
    focus_areas: input.directive.focus_areas,
    acceptance_checks: unique([
      ...input.directive.acceptance_checks,
      ...carryOverCheckIds
    ]),
    notes: unique([
      `Build attempt ${input.round} contract for scenario ${input.scenario.scenario_id}.`,
      carryOverPatchIds.length > 0
        ? `Inherited patch request ids: ${carryOverPatchIds.join(", ")}.`
        : "No previous patch request was available.",
      input.directive.attempt_kind === "remediation"
        ? "Use the previous patch request and latest QA feedback as the primary remediation brief."
        : "Use the planner-owned contract as the primary brief for the long initial build attempt.",
      "Contract should remain executable from files alone.",
      "Do not decompose this run into fixed feature sprints."
    ]).slice(0, 8),
    carry_over_patch_ids: carryOverPatchIds,
    carry_over_check_ids: carryOverCheckIds
  };
};
