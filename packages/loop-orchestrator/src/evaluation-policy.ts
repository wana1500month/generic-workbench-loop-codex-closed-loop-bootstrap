import { basename, join, resolve } from "node:path";

import { loadJsonIfExists, writeJson, writeText } from "./file-system.js";
import type {
  SessionCustomQualityMetric,
  SessionIntakeSnapshot,
  VerificationSurface
} from "./intake-schema.js";
import type { EvalReport, EvalScoreDimension, TargetFamily } from "./types.js";

export type EvaluationStrictnessLevel = 1 | 2 | 3 | 4 | 5;

export type ProjectKind =
  | "browser_ui"
  | "mobile_ui"
  | "api_service"
  | "cli_tool"
  | "library_package"
  | "data_pipeline"
  | "agent_workflow"
  | "document_artifact"
  | "automation"
  | "generic";

export type EvidenceSurface =
  | "browser"
  | "screenshot"
  | "api"
  | "cli"
  | "test"
  | "file"
  | "db"
  | "shell"
  | "agent_conversation"
  | "document"
  | "package_import"
  | "manual_review";

export type EvaluationPassMode =
  | "total_score"
  | "all_required_dimensions";

export interface EvaluationEvidenceCap {
  cap_id: string;
  applies_to: string;
  maximum_score: number;
  condition: string;
  rationale: string;
}

export interface EvaluationDimensionPolicy {
  dimension_id: string;
  label: string;
  description: string;
  scale: 10 | 100;
  minimum_score: number;
  required: boolean;
  weight: number;
  evidence_surface: EvidenceSurface;
  evidence_required: boolean;
  source: "core" | "custom";
}

export interface EvaluationPolicy {
  schema_version: "2026-05-26";
  generated_at: string;
  strictness_level: EvaluationStrictnessLevel;
  strictness_label: string;
  project_kind: ProjectKind;
  evidence_surfaces: EvidenceSurface[];
  target_total_score: number;
  pass_mode: EvaluationPassMode;
  dimensions: EvaluationDimensionPolicy[];
  evidence_caps: EvaluationEvidenceCap[];
}

export interface ScorecardDimensionScore {
  dimension_id: string;
  label: string;
  description?: string;
  score: number;
  scale: 10 | 100;
  normalized_score: number;
  minimum_score: number;
  required: boolean;
  weight: number;
  evidence_surface: EvidenceSurface;
  evidence_required: boolean;
  status: "pass" | "fail" | "not_applicable";
  evidence: string[];
  detail: string;
}

export interface ScorecardBlockingReason {
  dimension_id: string;
  score: number;
  minimum_score: number;
  reason: string;
}

export interface RoundScorecard {
  schema_version: "2026-05-26";
  generated_at: string;
  round: number;
  target_reached: boolean;
  total_score: number;
  target_total_score: number;
  strictness_level: EvaluationStrictnessLevel;
  pass_mode: EvaluationPassMode;
  blocking_reasons: ScorecardBlockingReason[];
  dimension_scores: ScorecardDimensionScore[];
  next_round_focus: string[];
}

const strictnessPresets: Record<
  EvaluationStrictnessLevel,
  {
    label: string;
    targetTotalScore: number;
    requiredCustomMinimum: number;
  }
> = {
  1: {
    label: "loose_prototype",
    targetTotalScore: 0.8,
    requiredCustomMinimum: 7
  },
  2: {
    label: "standard_mvp",
    targetTotalScore: 0.85,
    requiredCustomMinimum: 8
  },
  3: {
    label: "product_level",
    targetTotalScore: 0.9,
    requiredCustomMinimum: 8.5
  },
  4: {
    label: "strict_product",
    targetTotalScore: 0.93,
    requiredCustomMinimum: 9
  },
  5: {
    label: "release_review",
    targetTotalScore: 0.95,
    requiredCustomMinimum: 9.3
  }
};

const roundScore = (value: number): number => Number(value.toFixed(3));

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const normalizeStrictnessLevel = (
  value: unknown
): EvaluationStrictnessLevel | undefined => {
  if (value === 1 || value === 2 || value === 3 || value === 4 || value === 5) {
    return value;
  }
  return undefined;
};

export const defaultTargetScoreForStrictness = (
  strictnessLevel: EvaluationStrictnessLevel
): number => strictnessPresets[strictnessLevel].targetTotalScore;

export const defaultCustomMetricMinimumForStrictness = (
  strictnessLevel: EvaluationStrictnessLevel
): number => strictnessPresets[strictnessLevel].requiredCustomMinimum;

const visualMetricPattern =
  /design|visual|clean|layout|spacing|text|copy|app[- ]?like|ui|mobile|screen|interface|화면|디자인|깔끔|텍스트|문구|앱스러|여백|정렬|모바일/u;

const metricEvidenceSurface = (
  metric: SessionCustomQualityMetric
): EvidenceSurface =>
  visualMetricPattern.test(
    `${metric.metric_id} ${metric.label} ${metric.description}`.toLowerCase()
  )
    ? "browser"
    : "manual_review";

const slug = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/gu, "_")
    .replace(/^_+|_+$/gu, "") || "custom_metric";

const projectKindForTargetFamily = (
  targetFamily: TargetFamily | undefined
): ProjectKind => {
  if (
    targetFamily === "browser-app" ||
    targetFamily === "browser-editor" ||
    targetFamily === "editor-app" ||
    targetFamily === "dashboard" ||
    targetFamily === "fullstack-app"
  ) {
    return "browser_ui";
  }
  if (targetFamily === "api-service" || targetFamily === "crud-api") {
    return "api_service";
  }
  if (targetFamily === "chat-agent") {
    return "agent_workflow";
  }
  if (targetFamily === "cli-tool") {
    return "cli_tool";
  }
  if (targetFamily === "command-artifact") {
    return "automation";
  }
  return "generic";
};

export const commandFirstProjectKinds = new Set<ProjectKind>([
  "cli_tool",
  "library_package",
  "data_pipeline",
  "document_artifact",
  "agent_workflow",
  "automation"
]);

export const isCommandFirstProjectKind = (
  projectKind: ProjectKind | undefined
): boolean => Boolean(projectKind && commandFirstProjectKinds.has(projectKind));

export const inferProjectKindFromText = (value: string): ProjectKind => {
  const normalized = value.normalize("NFKC").toLowerCase();
  if (
    /(?:analy[sz]er|checker|validator|parser|converter|log\s+analysis\s+tool|\uBD84\uC11D\uAE30|\uBD84\uC11D\s*(?:\uD234|\uB3C4\uAD6C)|\uAC80\uC0AC\uAE30|\uAC80\uC0AC\s*(?:\uD234|\uB3C4\uAD6C)|\uD30C\uC11C|\uBCC0\uD658\uAE30)/u.test(
      normalized
    )
  ) {
    return "cli_tool";
  }
  if (/(?:cli|command line|터미널|명령|커맨드)/u.test(normalized)) {
    return "cli_tool";
  }
  if (/(?:library|package|sdk|npm package|라이브러리|패키지)/u.test(normalized)) {
    return "library_package";
  }
  if (/(?:agent|chatbot|assistant|에이전트|챗봇)/u.test(normalized)) {
    return "agent_workflow";
  }
  if (/(?:document|markdown|report|proposal|문서|보고서|기획서)/u.test(normalized)) {
    return "document_artifact";
  }
  if (/(?:pipeline|etl|csv|data|데이터|파이프라인)/u.test(normalized)) {
    return "data_pipeline";
  }
  if (/(?:automation|cron|scheduled\s+job|자동화|스케줄)/u.test(normalized)) {
    return "automation";
  }
  if (/(?:api|endpoint|backend|서버|백엔드)/u.test(normalized)) {
    return "api_service";
  }
  if (/(?:mobile|ios|android|앱스토어|모바일)/u.test(normalized)) {
    return "mobile_ui";
  }
  if (/(?:ui|browser|web app|dashboard|editor|화면|웹앱|대시보드)/u.test(normalized)) {
    return "browser_ui";
  }
  return "generic";
};

export const inferProjectKind = (
  intake: SessionIntakeSnapshot | undefined
): ProjectKind => {
  if (intake?.project_kind) {
    return intake.project_kind;
  }
  const text = [
    intake?.product_title,
    intake?.product_summary,
    ...(intake?.core_features ?? []),
    intake?.finish_line,
    ...(intake?.quality_bar ?? [])
  ]
    .filter(Boolean)
    .join(" ");
  const inferred = text ? inferProjectKindFromText(text) : "generic";
  return inferred === "generic"
    ? projectKindForTargetFamily(intake?.target_family)
    : inferred;
};

export const evidenceSurfacesForProjectKind = (
  projectKind: ProjectKind
): EvidenceSurface[] => {
  switch (projectKind) {
    case "browser_ui":
    case "mobile_ui":
      return ["browser", "screenshot", "test"];
    case "api_service":
      return ["api", "test", "file"];
    case "cli_tool":
      return ["cli", "file", "test"];
    case "library_package":
      return ["package_import", "test", "file"];
    case "data_pipeline":
      return ["cli", "file", "test"];
    case "agent_workflow":
      return ["agent_conversation", "file", "test"];
    case "document_artifact":
      return ["document", "file", "manual_review"];
    case "automation":
      return ["shell", "file", "test"];
    case "generic":
      return ["file", "test", "manual_review"];
  }
};

const toEvidenceSurface = (surface: VerificationSurface): EvidenceSurface => {
  if (surface === "db") {
    return "db";
  }
  return surface;
};

const normalizedEvidenceSurfaces = (
  intake: SessionIntakeSnapshot | undefined,
  projectKind: ProjectKind
): EvidenceSurface[] =>
  unique([
    ...(intake?.evidence_surfaces ?? []),
    ...(intake?.verification_surfaces ?? []).map(toEvidenceSurface),
    ...evidenceSurfacesForProjectKind(projectKind)
  ]);

const customDimensionsFromMetrics = (
  metrics: readonly SessionCustomQualityMetric[] | undefined,
  strictnessLevel: EvaluationStrictnessLevel
): EvaluationDimensionPolicy[] =>
  (metrics ?? []).map((metric) => {
    const required = metric.required ?? true;
    const minimum = required
      ? Math.max(
          metric.minimum_score_out_of_ten,
          defaultCustomMetricMinimumForStrictness(strictnessLevel)
        )
      : metric.minimum_score_out_of_ten;
    return {
      dimension_id: metric.metric_id || `custom.${slug(metric.label)}`,
      label: metric.label,
      description: metric.description,
      scale: 10,
      minimum_score: roundScore(minimum),
      required,
      weight: metric.weight ?? 1,
      evidence_surface: metricEvidenceSurface(metric),
      evidence_required: required,
      source: "custom"
    };
  });

const coreDimensionsFor = (
  projectKind: ProjectKind,
  evidenceSurfaces: readonly EvidenceSurface[]
): EvaluationDimensionPolicy[] => [
  {
    dimension_id: "functionality.core_workflows",
    label: "Core workflow behavior",
    description: "Primary workflows should pass with concrete evidence.",
    scale: 100,
    minimum_score: 90,
    required: true,
    weight: 3,
    evidence_surface: evidenceSurfaces[0] ?? "manual_review",
    evidence_required: true,
    source: "core"
  },
  {
    dimension_id: "proof.evidence_integrity",
    label: "Verification evidence",
    description: "The round should include evidence appropriate for the project kind.",
    scale: 100,
    minimum_score: 90,
    required: true,
    weight: 2,
    evidence_surface:
      projectKind === "browser_ui" || projectKind === "mobile_ui"
        ? "browser"
        : evidenceSurfaces[1] ?? "test",
    evidence_required: true,
    source: "core"
  }
];

const evidenceCapsForStrictness = (
  strictnessLevel: EvaluationStrictnessLevel
): EvaluationEvidenceCap[] => {
  if (strictnessLevel < 5) {
    return [];
  }

  return [
    {
      cap_id: "visual_without_rendered_evidence",
      applies_to: "visual or design dimensions",
      maximum_score: 4,
      condition: "No screenshot, browser trace, or browser evidence is present.",
      rationale: "Visual quality cannot receive a high score without visual proof."
    },
    {
      cap_id: "functionality_without_execution_evidence",
      applies_to: "functionality dimensions",
      maximum_score: 6,
      condition: "No test, command, API, browser, or agent execution proof is present.",
      rationale: "Functional quality cannot receive a high score without execution proof."
    },
    {
      cap_id: "dummy_or_noisy_text",
      applies_to: "no-noise-text dimensions",
      maximum_score: 6,
      condition: "Dummy text, placeholder text, or excessive explanatory copy remains.",
      rationale: "Noisy or placeholder copy violates strict release-review UX quality."
    },
    {
      cap_id: "template_or_scaffold_feel",
      applies_to: "app-like-feel dimensions",
      maximum_score: 7,
      condition: "The product still feels like a template, scaffold, or sample app.",
      rationale: "Release-review strictness requires a product-specific surface."
    }
  ];
};

export const buildEvaluationPolicy = (input: {
  intake?: SessionIntakeSnapshot;
  explicitTargetScore?: number;
}): EvaluationPolicy => {
  const strictnessLevel =
    normalizeStrictnessLevel(input.intake?.strictness_level) ?? 3;
  const projectKind = inferProjectKind(input.intake);
  const evidenceSurfaces = normalizedEvidenceSurfaces(input.intake, projectKind);
  const customDimensions = customDimensionsFromMetrics(
    input.intake?.custom_quality_metrics,
    strictnessLevel
  );
  const policyDimensions =
    input.intake?.evaluation_policy?.dimensions?.length
      ? input.intake.evaluation_policy.dimensions
      : [
          ...coreDimensionsFor(projectKind, evidenceSurfaces),
          ...customDimensions
        ];

  return {
    schema_version: "2026-05-26",
    generated_at: new Date().toISOString(),
    strictness_level: strictnessLevel,
    strictness_label: strictnessPresets[strictnessLevel].label,
    project_kind: projectKind,
    evidence_surfaces: evidenceSurfaces,
    target_total_score:
      input.explicitTargetScore ??
      input.intake?.evaluation_policy?.target_total_score ??
      strictnessPresets[strictnessLevel].targetTotalScore,
    pass_mode: "all_required_dimensions",
    dimensions: policyDimensions,
    evidence_caps: evidenceCapsForStrictness(strictnessLevel)
  };
};

export const evaluationPolicyPathForRun = (runDirectory: string): string =>
  join(runDirectory, "evaluation-policy.generated.json");

export const evaluationPolicyMarkdownPathForRun = (runDirectory: string): string =>
  join(runDirectory, "evaluation-policy.generated.md");

export const generatedAdapterEvaluationPolicyPathForRun = (
  runDirectory: string
): string => join(runDirectory, "generated-adapter", "evaluation-policy.generated.json");

export const loadEvaluationPolicyForRun = async (
  runDirectory: string
): Promise<EvaluationPolicy | undefined> =>
  (await loadJsonIfExists<EvaluationPolicy>(evaluationPolicyPathForRun(runDirectory))) ??
  (await loadJsonIfExists<EvaluationPolicy>(
    generatedAdapterEvaluationPolicyPathForRun(runDirectory)
  )) ??
  (process.env.HARNESS_EVALUATION_POLICY_PATH
    ? await loadJsonIfExists<EvaluationPolicy>(
        resolve(process.env.HARNESS_EVALUATION_POLICY_PATH)
      )
    : undefined);

export const renderEvaluationPolicyMarkdown = (
  policy: EvaluationPolicy
): string =>
  [
    "# Evaluation Policy",
    "",
    `- Strictness: ${policy.strictness_level} (${policy.strictness_label})`,
    `- Project kind: ${policy.project_kind}`,
    `- Evidence surfaces: ${policy.evidence_surfaces.join(", ")}`,
    `- Target total score: ${policy.target_total_score}`,
    `- Pass mode: ${policy.pass_mode}`,
    "",
    "## Dimensions",
    "",
    ...policy.dimensions.map(
      (dimension) =>
        `- ${dimension.label}: minimum ${dimension.minimum_score}/${dimension.scale}, required ${dimension.required ? "yes" : "no"}, evidence ${dimension.evidence_surface}`
    ),
    "",
    "## Evidence Caps",
    "",
    ...(policy.evidence_caps.length
      ? policy.evidence_caps.map(
          (cap) =>
            `- ${cap.cap_id}: max ${cap.maximum_score}/10 when ${cap.condition}`
        )
      : ["- none"]),
    ""
  ].join("\n");

export const writeEvaluationPolicyArtifacts = async (input: {
  runDirectory: string;
  policy: EvaluationPolicy;
}): Promise<void> => {
  await Promise.all([
    writeJson(evaluationPolicyPathForRun(input.runDirectory), input.policy),
    writeText(
      evaluationPolicyMarkdownPathForRun(input.runDirectory),
      renderEvaluationPolicyMarkdown(input.policy)
    ),
    writeJson(generatedAdapterEvaluationPolicyPathForRun(input.runDirectory), input.policy)
  ]);
};

const evidenceForDimension = (
  dimension: EvaluationDimensionPolicy,
  evalReport: EvalReport
): string[] => {
  const direct = evalReport.evidence_paths.filter((path) => {
    const lower = basename(path).toLowerCase();
    if (dimension.evidence_surface === "browser" || dimension.evidence_surface === "screenshot") {
      return /png|jpg|jpeg|webp|trace|browser|screenshot/u.test(lower);
    }
    if (dimension.evidence_surface === "api") {
      return /api|http|json/u.test(lower);
    }
    if (dimension.evidence_surface === "cli" || dimension.evidence_surface === "shell") {
      return /command|stdout|stderr|shell|cli/u.test(lower);
    }
    return true;
  });
  return direct.length > 0 ? direct : evalReport.evidence_paths;
};

const matchingEvalDimension = (
  dimension: EvaluationDimensionPolicy,
  evalReport: EvalReport
): EvalScoreDimension | undefined =>
  evalReport.dimension_scores.find(
    (candidate) => candidate.dimension_id === dimension.dimension_id
  );

interface MappedPolicyDimensionScore {
  normalized: number;
  detail: string;
  evidence: string[];
  violations?: string[];
  hasRequiredEvidence?: boolean;
}

const scoreForPolicyDimension = (
  dimension: EvaluationDimensionPolicy,
  evalReport: EvalReport
): MappedPolicyDimensionScore => {
  const matched = matchingEvalDimension(dimension, evalReport);
  if (matched) {
    return {
      normalized: matched.score,
      detail: matched.detail,
      evidence: [
        ...matched.contributing_probe_ids,
        ...matched.contributing_check_ids
      ]
    };
  }

  if (dimension.dimension_id === "functionality.core_workflows") {
    return {
      normalized: evalReport.proof_score,
      detail: "Mapped from proof_score because no dedicated functionality dimension was emitted.",
      evidence: evidenceForDimension(dimension, evalReport)
    };
  }
  if (dimension.dimension_id === "proof.evidence_integrity") {
    return {
      normalized: evalReport.control_plane_score,
      detail: "Mapped from control_plane_score because no dedicated evidence dimension was emitted.",
      evidence: evidenceForDimension(dimension, evalReport)
    };
  }

  const metricResult = evalReport.adapter_results
    .flatMap((execution) => execution.result.subjective_metric_results ?? [])
    .find((metric) => metric.metric_id === dimension.dimension_id);
  if (metricResult?.score_out_of_ten !== undefined) {
    return {
      normalized: metricResult.score_out_of_ten / 10,
      detail: metricResult.rationale ?? "Mapped from subjective metric result.",
      evidence: metricResult.evidence_paths ?? evidenceForDimension(dimension, evalReport),
      violations: metricResult.violations,
      hasRequiredEvidence: metricResult.evidence_quality?.has_required_evidence
    };
  }

  return {
    normalized: evalReport.total_score,
    detail: "No dedicated score was emitted; mapped from total_score.",
    evidence: evidenceForDimension(dimension, evalReport)
  };
};

const clampNormalizedByStrictnessCaps = (
  policy: EvaluationPolicy,
  dimension: EvaluationDimensionPolicy,
  evalReport: EvalReport,
  mapped: MappedPolicyDimensionScore
): number => {
  if (policy.strictness_level < 5) {
    return mapped.normalized;
  }

  const text = [
    dimension.dimension_id,
    dimension.label,
    dimension.description,
    mapped.detail,
    ...evalReport.blockers,
    ...evalReport.next_actions,
    ...evalReport.threshold_gap_details
  ]
    .join(" ")
    .toLowerCase();
  const visualDimension =
    dimension.evidence_surface === "browser" ||
    dimension.evidence_surface === "screenshot" ||
    visualMetricPattern.test(text);
  const executionDimension =
    dimension.dimension_id === "functionality.core_workflows" ||
    /(function|workflow|behavior|동작|기능)/u.test(text);
  const hasVisualEvidence =
    mapped.evidence.length > 0 &&
    mapped.evidence.some((path) =>
      /png|jpg|jpeg|webp|trace|browser|screenshot/u.test(path.toLowerCase())
    );
  const hasExecutionEvidence =
    mapped.evidence.length > 0 &&
    mapped.evidence.some((path) =>
      /test|command|stdout|stderr|api|http|browser|agent|probe|evidence/u.test(
        path.toLowerCase()
      )
    );
  const violations = new Set(
    (mapped.violations ?? []).map((violation) =>
      violation.trim().toLowerCase().replace(/[\s-]+/gu, "_")
    )
  );

  let capped = mapped.normalized;
  if (
    visualDimension &&
    (!hasVisualEvidence ||
      mapped.hasRequiredEvidence === false ||
      violations.has("no_visual_evidence"))
  ) {
    capped = Math.min(capped, 0.4);
  }
  if (
    executionDimension &&
    (!hasExecutionEvidence ||
      mapped.hasRequiredEvidence === false ||
      violations.has("no_execution_evidence"))
  ) {
    capped = Math.min(capped, 0.6);
  }
  if (
    violations.has("dummy_text_present") ||
    violations.has("placeholder_text") ||
    violations.has("excessive_helper_text")
  ) {
    capped = Math.min(capped, 0.6);
  }
  if (violations.has("template_feel") || violations.has("scaffold_feel")) {
    capped = Math.min(capped, 0.7);
  }
  if (
    /no[_-]?noise|noise[_-]?text|copy|text|쓸데없는|텍스트|문구/u.test(text) &&
    /dummy|placeholder|lorem|sample|excessive|too much|더미|샘플|과한|과다/u.test(text)
  ) {
    capped = Math.min(capped, 0.6);
  }
  if (
    /app[_-]?like|앱스러/u.test(text) &&
    /template|scaffold|sample|generic|boilerplate|템플릿|스캐폴드|샘플/u.test(text)
  ) {
    capped = Math.min(capped, 0.7);
  }
  if (
    dimension.dimension_id === "functionality.core_workflows" &&
    !evalReport.threshold_results.contract_completed
  ) {
    capped = Math.min(capped, 0.7);
  }

  return capped;
};

export const buildRoundScorecard = (input: {
  policy: EvaluationPolicy;
  evalReport: EvalReport;
}): RoundScorecard => {
  const dimensionScores = input.policy.dimensions.map((dimension) => {
    const mapped = scoreForPolicyDimension(dimension, input.evalReport);
    const normalized = clampNormalizedByStrictnessCaps(
      input.policy,
      dimension,
      input.evalReport,
      mapped
    );
    const score = roundScore(normalized * dimension.scale);
    const status =
      !dimension.required && mapped.evidence.length === 0
        ? "not_applicable"
        : score + 0.001 >= dimension.minimum_score
          ? "pass"
          : "fail";
    return {
      dimension_id: dimension.dimension_id,
      label: dimension.label,
      description: dimension.description,
      score,
      scale: dimension.scale,
      normalized_score: roundScore(normalized),
      minimum_score: dimension.minimum_score,
      required: dimension.required,
      weight: dimension.weight,
      evidence_surface: dimension.evidence_surface,
      evidence_required: dimension.evidence_required,
      status,
      evidence: mapped.evidence,
      detail: mapped.detail
    } satisfies ScorecardDimensionScore;
  });
  const blockingReasons = dimensionScores
    .filter((dimension) => dimension.required && dimension.status === "fail")
    .map((dimension) => ({
      dimension_id: dimension.dimension_id,
      score: dimension.score,
      minimum_score: dimension.minimum_score,
      reason: "Required dimension below threshold."
    }));
  const targetReached =
    input.evalReport.threshold_results.target_reached_eligible &&
    input.evalReport.total_score + 0.0005 >= input.policy.target_total_score &&
    blockingReasons.length === 0;

  return {
    schema_version: "2026-05-26",
    generated_at: new Date().toISOString(),
    round: input.evalReport.round,
    target_reached: targetReached,
    total_score: input.evalReport.total_score,
    target_total_score: input.policy.target_total_score,
    strictness_level: input.policy.strictness_level,
    pass_mode: input.policy.pass_mode,
    blocking_reasons: blockingReasons,
    dimension_scores: dimensionScores,
    next_round_focus:
      blockingReasons.length > 0
        ? blockingReasons.map(
            (reason) =>
              `Raise ${reason.dimension_id} from ${reason.score} to at least ${reason.minimum_score}.`
          )
        : input.evalReport.next_actions
  };
};

export const renderRoundScorecardMarkdown = (
  scorecard: RoundScorecard
): string =>
  [
    `# Round ${scorecard.round} Scorecard`,
    "",
    `- Total score: ${Math.round(scorecard.total_score * 100)} / 100`,
    `- Target total score: ${Math.round(scorecard.target_total_score * 100)} / 100`,
    `- Strictness: ${scorecard.strictness_level}`,
    `- Result: ${scorecard.target_reached ? "pass" : "fail"}`,
    "",
    "## Required Criteria",
    "",
    ...scorecard.dimension_scores
      .filter((dimension) => dimension.required)
      .map(
        (dimension) =>
          `- ${dimension.label}: ${dimension.score} / ${dimension.scale} ${dimension.status}`
      ),
    "",
    "## Blocking Reasons",
    "",
    ...(scorecard.blocking_reasons.length
      ? scorecard.blocking_reasons.map(
          (reason) =>
            `- ${reason.dimension_id}: ${reason.score} below ${reason.minimum_score}. ${reason.reason}`
        )
      : ["- none"]),
    "",
    "## Next Round Focus",
    "",
    ...(scorecard.next_round_focus.length
      ? scorecard.next_round_focus.map((focus) => `- ${focus}`)
      : ["- none"]),
    ""
  ].join("\n");

export const writeRoundScorecardArtifacts = async (input: {
  roundDirectory: string;
  scorecard: RoundScorecard;
}): Promise<void> => {
  await Promise.all([
    writeJson(join(input.roundDirectory, "scorecard.json"), input.scorecard),
    writeText(
      join(input.roundDirectory, "scorecard.md"),
      renderRoundScorecardMarkdown(input.scorecard)
    )
  ]);
};
