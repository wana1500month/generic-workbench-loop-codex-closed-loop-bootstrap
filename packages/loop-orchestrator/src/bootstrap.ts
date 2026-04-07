import { stdin as input, stdout as output } from "node:process";
import { join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import { loadJson, repoRoot, writeJson, writeText } from "./file-system.js";
import { inferProductTargetFamily } from "./intake-gate.js";
import { resolveTargetFamilySelection } from "./profile-selection.js";
import type {
  LoopRubric,
  TargetSurface,
  TargetFamily as SupportedTargetFamily,
  VerificationAssertionTag,
  VerificationCoreProbe,
  VerificationProfile
} from "./types.js";

export type BootstrapTargetFamily = Exclude<
  SupportedTargetFamily,
  "generic-core" | "editor-app"
>;

export type GoalLevel =
  | "prototype"
  | "mvp"
  | "usable"
  | "production-like"
  | "custom";

export type BootstrapCustomQualityMetric = {
  metricId: string;
  label: string;
  description: string;
  minimumScoreOutOfTen: number;
  required?: boolean;
  weight?: number;
};

export type BootstrapProbeHints = {
  appShellSelector?: string;
  successSelector?: string;
  errorSelector?: string;
  persistenceInputSelector?: string;
  saveActionSelector?: string;
  restoredSelector?: string;
  apiFinishLinePath?: string;
  apiErrorPath?: string;
  apiPersistencePath?: string;
};

export type BootstrapAnswers = {
  title: string;
  summary: string;
  targetUsers: string[];
  coreFeatures: string[];
  referenceApps: string[];
  finishLine: string;
  targetFamily: BootstrapTargetFamily;
  goalLevel: GoalLevel;
  targetScore: number;
  maxRounds: number;
  targetRoot: string;
  projectMode: "new" | "existing";
  frameworkHint: string;
  packageManager: string;
  runCommand: string;
  checkCommand: string;
  readyUrl: string;
  appUrl?: string;
  healthUrl?: string;
  apiBaseUrl?: string;
  constraints: string[];
  qualityBar: string[];
  notes?: string;
  mustNotBreak?: string[];
  failureExpectations?: string[];
  continuityBoundaries?: string[];
  referenceSignals?: string[];
  nonGoals?: string[];
  probeHints?: BootstrapProbeHints;
  customQualityMetrics?: BootstrapCustomQualityMetric[];
};

export type BootstrapResult = {
  adapterPath: string;
  rubricPath: string;
  evaluatorProfilePath: string;
  targetFamily: BootstrapTargetFamily;
  targetScore: number;
  maxRounds: number;
  ideaPath: string;
  intakePath: string;
};

export type BootstrapArtifactPaths = {
  rootDirectory: string;
  ideaPath: string;
  intakePath: string;
  adapterPath: string;
  generatedRubricPath: string;
  generatedVerificationProfilePath: string;
  generatedAdapterRoot: string;
  generatedScriptsRoot: string;
  generatedRuntimeConfigPath: string;
  generatedAdapterRelativePath: string;
};

export const createBootstrapArtifactPaths = (
  rootDirectory: string
): BootstrapArtifactPaths => {
  const generatedAdapterRoot = join(rootDirectory, ".generated", "codex-adapter");
  return {
    rootDirectory,
    ideaPath: join(rootDirectory, "IDEA.md"),
    intakePath: join(rootDirectory, "intake.json"),
    adapterPath: join(rootDirectory, "adapter.generated.json"),
    generatedRubricPath: join(rootDirectory, "rubric.generated.json"),
    generatedVerificationProfilePath: join(
      rootDirectory,
      "verification-profile.generated.json"
    ),
    generatedAdapterRoot,
    generatedScriptsRoot: join(generatedAdapterRoot, "scripts"),
    generatedRuntimeConfigPath: join(generatedAdapterRoot, "runtime-config.json"),
    generatedAdapterRelativePath: "./.generated/codex-adapter"
  };
};

const defaultBootstrapPaths = createBootstrapArtifactPaths(repoRoot);
const defaultBootstrapRubricPath = join(
  repoRoot,
  "evals",
  "rubrics",
  "generic-harness-rubric.json"
);

const familyHelp = [
  "Choose the app family:",
  "1. browser-app (site or web app with mostly browser-only proof)",
  "2. api-service (service or backend API)",
  "3. fullstack-app (web app plus API/backend)",
  "4. dashboard (browser analytics or admin surface with API data)",
  "5. browser-editor (drag/drop editor, canvas, storyboard, builder)",
  "6. crud-api (canonical CRUD-style service)",
  "7. chat-agent (tool-using or grounded chat API)"
].join("\n");

const goalHelp = [
  "Choose the target level:",
  "1. prototype (0.65)",
  "2. mvp (0.8)",
  "3. usable (0.9)",
  "4. production-like (0.95)",
  "5. custom"
].join("\n");

const goalPresets: Record<Exclude<GoalLevel, "custom">, number> = {
  prototype: 0.65,
  mvp: 0.8,
  usable: 0.9,
  "production-like": 0.95
};

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "generated-app";

const splitList = (value: string): string[] =>
  value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const uniqueList = (values: readonly string[]): string[] => [...new Set(values.filter(Boolean))];

const uniqueAxisList = (
  axes: NonNullable<VerificationProfile["quality_contract"]>["quality_axes"]
): NonNullable<VerificationProfile["quality_contract"]>["quality_axes"] => {
  const seen = new Set<string>();
  return axes.filter((axis) => {
    if (seen.has(axis.axis_id)) {
      return false;
    }
    seen.add(axis.axis_id);
    return true;
  });
};

const topPreserveSignals = (answers: BootstrapAnswers, limit = 4): string[] =>
  uniqueList([
    answers.finishLine,
    ...(answers.mustNotBreak ?? []),
    ...(answers.failureExpectations ?? []),
    ...(answers.qualityBar ?? [])
  ]).slice(0, limit);

const topReferenceSignals = (answers: BootstrapAnswers, limit = 4): string[] =>
  uniqueList([
    ...(answers.referenceSignals ?? []),
    ...(answers.referenceApps ?? [])
  ]).slice(0, limit);

const nonEmptyProbeHints = (
  probeHints: BootstrapProbeHints | undefined
): BootstrapProbeHints | undefined => {
  if (!probeHints) {
    return undefined;
  }

  const normalized = Object.fromEntries(
    Object.entries(probeHints).filter(([, value]) => typeof value === "string" && value.trim())
  ) as BootstrapProbeHints;
  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const mergeQualityContract = (
  base: VerificationProfile["quality_contract"] | undefined,
  overlay: NonNullable<VerificationProfile["quality_contract"]>
): NonNullable<VerificationProfile["quality_contract"]> => ({
  primary_goal: overlay.primary_goal || base?.primary_goal || "",
  critique_style: overlay.critique_style ?? base?.critique_style,
  quality_axes: uniqueAxisList([...(base?.quality_axes ?? []), ...overlay.quality_axes]),
  preserve_signals: uniqueList([
    ...(base?.preserve_signals ?? []),
    ...(overlay.preserve_signals ?? [])
  ]),
  reference_signals: uniqueList([
    ...(base?.reference_signals ?? []),
    ...(overlay.reference_signals ?? [])
  ])
});

const mergeSubjectiveMetrics = (
  baseMetrics: readonly NonNullable<VerificationProfile["subjective_metrics"]>[number][],
  overlayMetrics: readonly NonNullable<VerificationProfile["subjective_metrics"]>[number][]
): NonNullable<VerificationProfile["subjective_metrics"]> => {
  const merged = new Map<
    string,
    NonNullable<VerificationProfile["subjective_metrics"]>[number]
  >();
  for (const metric of [...baseMetrics, ...overlayMetrics]) {
    merged.set(metric.metric_id, metric);
  }
  return [...merged.values()];
};

const buildProductInferenceText = (input: {
  title: string;
  summary: string;
  targetUsers: readonly string[];
  coreFeatures: readonly string[];
  referenceApps: readonly string[];
  finishLine: string;
}): string =>
  [
    input.title,
    input.summary,
    ...input.targetUsers,
    ...input.coreFeatures,
    ...input.referenceApps,
    input.finishLine
  ]
    .filter(Boolean)
    .join(" ");

const inferGoalLevelFromTargetScore = (targetScore: number): GoalLevel => {
  for (const [goalLevel, presetScore] of Object.entries(goalPresets) as Array<[
    Exclude<GoalLevel, "custom">,
    number
  ]>) {
    if (Math.abs(presetScore - targetScore) < 0.0005) {
      return goalLevel;
    }
  }

  return "custom";
};

const inferPackageManagerFromCommand = (command: string): string => {
  const normalized = command.trim().toLowerCase();
  if (normalized.startsWith("pnpm ")) {
    return "pnpm";
  }
  if (normalized.startsWith("yarn ")) {
    return "yarn";
  }
  if (normalized.startsWith("bun ")) {
    return "bun";
  }
  return "npm";
};

const normalizeTargetFamily = (value: string): BootstrapTargetFamily | undefined => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "browser-app") {
    return "browser-app";
  }
  if (normalized === "2" || normalized === "api-service") {
    return "api-service";
  }
  if (normalized === "3" || normalized === "fullstack-app") {
    return "fullstack-app";
  }
  if (normalized === "4" || normalized === "dashboard") {
    return "dashboard";
  }
  if (normalized === "5" || normalized === "browser-editor" || normalized === "editor-app") {
    return "browser-editor";
  }
  if (normalized === "6" || normalized === "crud-api" || normalized === "crud-service") {
    return "crud-api";
  }
  if (normalized === "7" || normalized === "chat-agent") {
    return "chat-agent";
  }

  return undefined;
};

const normalizeGoalLevel = (value: string): GoalLevel | undefined => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "prototype") {
    return "prototype";
  }
  if (normalized === "2" || normalized === "mvp") {
    return "mvp";
  }
  if (normalized === "3" || normalized === "usable") {
    return "usable";
  }
  if (normalized === "4" || normalized === "production-like" || normalized === "production") {
    return "production-like";
  }
  if (normalized === "5" || normalized === "custom") {
    return "custom";
  }

  return undefined;
};

const defaultRootForTitle = (title: string): string =>
  resolve(repoRoot, "..", slugify(title));

const isApiOnlyFamily = (targetFamily: BootstrapTargetFamily): boolean =>
  targetFamily === "api-service" ||
  targetFamily === "crud-api" ||
  targetFamily === "chat-agent";

const defaultFrameworkHintForFamily = (targetFamily: BootstrapTargetFamily): string => {
  if (targetFamily === "api-service") {
    return "Node.js API";
  }
  if (targetFamily === "crud-api") {
    return "Node.js CRUD API";
  }
  if (targetFamily === "chat-agent") {
    return "Node.js chat agent API";
  }
  if (targetFamily === "browser-editor") {
    return "Vite + React editor app";
  }
  if (targetFamily === "dashboard") {
    return "Vite + React dashboard";
  }
  if (targetFamily === "fullstack-app") {
    return "Next.js or Vite + Node";
  }

  return "Vite + React";
};

const defaultReadyUrlForFamily = (targetFamily: BootstrapTargetFamily): string => {
  if (isApiOnlyFamily(targetFamily)) {
    return "http://127.0.0.1:3000/health";
  }

  return "http://127.0.0.1:3000/";
};

const defaultAppUrlForFamily = (
  targetFamily: BootstrapTargetFamily
): string | undefined => (isApiOnlyFamily(targetFamily) ? undefined : "http://127.0.0.1:3000/");

const defaultHealthUrlForFamily = (
  targetFamily: BootstrapTargetFamily
): string | undefined =>
  isApiOnlyFamily(targetFamily) ||
  targetFamily === "fullstack-app" ||
  targetFamily === "browser-editor" ||
  targetFamily === "dashboard"
    ? "http://127.0.0.1:3000/health"
    : undefined;

const defaultApiBaseUrlForFamily = (
  targetFamily: BootstrapTargetFamily
): string | undefined =>
  isApiOnlyFamily(targetFamily) ||
  targetFamily === "fullstack-app" ||
  targetFamily === "browser-editor" ||
  targetFamily === "dashboard"
    ? "http://127.0.0.1:3000/api"
    : undefined;

const browserBackedFamily = (targetFamily: BootstrapTargetFamily): boolean =>
  !isApiOnlyFamily(targetFamily);

const apiBackedFamily = (targetFamily: BootstrapTargetFamily): boolean =>
  isApiOnlyFamily(targetFamily) ||
  targetFamily === "fullstack-app" ||
  targetFamily === "browser-editor" ||
  targetFamily === "dashboard";

const targetSurfacesForFamily = (
  targetFamily: BootstrapTargetFamily
): TargetSurface[] =>
  uniqueList([
    ...(browserBackedFamily(targetFamily) ? ["browser"] : []),
    ...(apiBackedFamily(targetFamily) ? ["api"] : [])
  ]) as TargetSurface[];

const liveVerificationModesForFamily = (targetFamily: BootstrapTargetFamily) =>
  uniqueList([
    ...(browserBackedFamily(targetFamily) ? ["browser"] : []),
    ...(apiBackedFamily(targetFamily) ? ["api"] : [])
  ]) as Array<"browser" | "api">;

const buildGeneratedQualityAxes = (
  answers: BootstrapAnswers
): NonNullable<VerificationProfile["quality_contract"]>["quality_axes"] => {
  const featureAxes = answers.coreFeatures.slice(0, 3).map((feature, index) => {
    const featureSlug = slugify(feature) || `feature-${index + 1}`;
    return {
      axis_id: `feature_${featureSlug}`,
      label: `Feature: ${feature}`,
      description: `Keep the '${feature}' workflow reachable and explicit in the generated target.`,
      desired_outcome: `The '${feature}' workflow should remain visible, coherent, and releasable.`,
      preserve_signals: topPreserveSignals(answers, 4),
      reference_signals: topReferenceSignals(answers, 4)
    };
  });
  const customMetricAxes = (answers.customQualityMetrics ?? []).map((metric) => ({
    axis_id: metric.metricId,
    label: metric.label,
    description: metric.description,
    desired_outcome: `${metric.label} should score at least ${metric.minimumScoreOutOfTen}/10.`,
    preserve_signals: topPreserveSignals(answers, 4),
    reference_signals: topReferenceSignals(answers, 4),
    scoring_mode: "subjective_out_of_ten" as const,
    minimum_score_out_of_ten: metric.minimumScoreOutOfTen
  }));

  return [
    {
      axis_id: "primary_flow",
      label: "Primary Flow",
      description: `The main finish line for '${answers.title}' should stay reachable.`,
      desired_outcome: answers.finishLine,
      preserve_signals: topPreserveSignals(answers, 4),
      reference_signals: topReferenceSignals(answers, 4)
    },
    ...featureAxes,
    {
      axis_id: "error_recovery",
      label: "Error Recovery",
      description: "Invalid flows should fail with a visible, explicit recovery state.",
      desired_outcome: "Invalid flows should surface a clear recovery affordance instead of silently breaking.",
      preserve_signals: topPreserveSignals(answers, 4),
      reference_signals: topReferenceSignals(answers, 4)
    },
    ...(browserBackedFamily(answers.targetFamily) || apiBackedFamily(answers.targetFamily)
      ? [
          {
            axis_id: "state_continuity",
            label: "State Continuity",
            description: "Progress should survive reload, refresh, retry, or persistence boundaries.",
            desired_outcome: "The target should preserve in-flight state across the first release workflow.",
            preserve_signals: topPreserveSignals(answers, 4),
            reference_signals: topReferenceSignals(answers, 4)
          }
        ]
      : []),
    ...(answers.referenceApps.length > 0 ||
    answers.qualityBar.length > 0 ||
    (answers.referenceSignals?.length ?? 0) > 0
      ? [
          {
            axis_id: "reference_fit",
            label: "Reference Fit",
            description: "The generated result should respect the requested references and quality direction.",
            desired_outcome:
              answers.referenceSignals?.[0] ??
              answers.referenceApps[0] ??
              answers.qualityBar[0] ??
              "The product should feel aligned with the requested direction.",
            preserve_signals: topPreserveSignals(answers, 4),
            reference_signals: topReferenceSignals(answers, 4)
          }
        ]
      : []),
    ...customMetricAxes
  ];
};

const buildGeneratedQualityContract = (
  answers: BootstrapAnswers
): NonNullable<VerificationProfile["quality_contract"]> => ({
  primary_goal: answers.finishLine,
  critique_style: "deterministic_release_gate",
  quality_axes: buildGeneratedQualityAxes(answers),
  preserve_signals: topPreserveSignals(answers, 6),
  reference_signals: topReferenceSignals(answers, 6)
});

const buildGeneratedSubjectiveMetrics = (
  answers: BootstrapAnswers
): NonNullable<VerificationProfile["subjective_metrics"]> =>
  (answers.customQualityMetrics ?? []).map((metric) => ({
    metric_id: metric.metricId,
    label: metric.label,
    description: metric.description,
    minimum_score_out_of_ten: metric.minimumScoreOutOfTen,
    quality_axis_id: metric.metricId,
    required: metric.required ?? true,
    weight: metric.weight ?? 1
  }));

const uniqueCriteria = (
  criteria: VerificationProfile["criteria"]
): VerificationProfile["criteria"] => {
  const seen = new Set<string>();
  return criteria.filter((criterion) => {
    const key = `${criterion.capability}:${criterion.criterion_id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const mergeGeneratedProbeOverlay = (
  baseProbes: readonly VerificationCoreProbe[],
  generatedProbes: readonly VerificationCoreProbe[]
): VerificationCoreProbe[] => {
  const seenProbeIds = new Set<string>();
  const seenAssertionKeys = new Set<string>();
  const merged: VerificationCoreProbe[] = [];

  for (const probe of [...baseProbes, ...generatedProbes]) {
    const assertionKey = probe.assertion_id
      ? `${probe.mode}:${probe.assertion_id}`
      : undefined;
    if (seenProbeIds.has(probe.probe_id)) {
      continue;
    }
    if (assertionKey && seenAssertionKeys.has(assertionKey)) {
      continue;
    }
    merged.push(probe);
    seenProbeIds.add(probe.probe_id);
    if (assertionKey) {
      seenAssertionKeys.add(assertionKey);
    }
  }

  return merged;
};

const mergeAssertionTagCountFloors = (
  baseCounts: Partial<Record<VerificationAssertionTag, number>>,
  generatedCounts: Partial<Record<VerificationAssertionTag, number>>
): Partial<Record<VerificationAssertionTag, number>> => {
  const merged: Partial<Record<VerificationAssertionTag, number>> = {};
  for (const tag of uniqueList([
    ...Object.keys(baseCounts),
    ...Object.keys(generatedCounts)
  ]) as VerificationAssertionTag[]) {
    merged[tag] = Math.max(baseCounts[tag] ?? 0, generatedCounts[tag] ?? 0);
  }
  return merged;
};

const buildGeneratedCriteria = (
  answers: BootstrapAnswers,
  generatedCoreProbes: readonly VerificationCoreProbe[] = buildGeneratedCoreProbes(
    answers
  )
): VerificationProfile["criteria"] => {
  const releaseGateProbeCriteria = generatedCoreProbes
    .filter(
      (probe) =>
        (probe.role ?? "supporting") === "release_gate" && Boolean(probe.assertion_id)
    )
    .flatMap((probe) => [
      {
        criterion_id: probe.assertion_id!,
        assertion_id: probe.assertion_id!,
        quality_axis_id: probe.quality_axis_id,
        capability: "run_checks" as const,
        summary: `run_checks must keep '${probe.label}' green.`,
        operator: "contains" as const,
        expected_value: "pass",
        hard: probe.required ?? true
      },
      {
        criterion_id: probe.assertion_id!,
        assertion_id: probe.assertion_id!,
        quality_axis_id: probe.quality_axis_id,
        capability: "grade_round" as const,
        summary: `grade_round must keep '${probe.label}' green before release.`,
        operator: "contains" as const,
        expected_value: "pass",
        hard: probe.required ?? true
      }
    ]);
  const customMetricCriteria = (answers.customQualityMetrics ?? []).map((metric) => ({
    criterion_id: `subjective_metric_${metric.metricId}_minimum`,
    capability: "grade_round" as const,
    summary: `${metric.label} must score at least ${metric.minimumScoreOutOfTen}/10.`,
    operator: "number_gte" as const,
    expected_value: String(metric.minimumScoreOutOfTen),
    quality_axis_id: metric.metricId,
    hard: metric.required ?? true
  }));

  return uniqueCriteria([
    {
      criterion_id: "target_accessible",
      assertion_id: "target_accessible",
      quality_axis_id: "primary_flow",
      capability: "run_checks" as const,
      summary: `run_checks must prove the generated target for '${answers.title}' is reachable.`,
      operator: "contains",
      expected_value: "HTTP ",
      hard: true
    },
    ...(answers.checkCommand
      ? [
          {
            criterion_id: "command_checks",
            assertion_id: "command_checks",
            capability: "run_checks" as const,
            summary: "run_checks must report the configured check command as passing.",
            operator: "contains" as const,
            expected_value: "pass",
            hard: false
          }
        ]
      : []),
    {
      criterion_id: "target_accessible",
      assertion_id: "target_accessible",
      quality_axis_id: "primary_flow",
      capability: "grade_round" as const,
      summary: "grade_round must keep target accessibility green before release.",
      operator: "contains",
      expected_value: "HTTP ",
      hard: true
    },
    ...releaseGateProbeCriteria,
    ...customMetricCriteria
  ]);
};

const buildBrowserJourneyProbe = (input: {
  probeId: string;
  label: string;
  assertionId: string;
  qualityAxisId: string;
  assertionTags: VerificationAssertionTag[];
  steps: NonNullable<VerificationCoreProbe["steps"]>;
  semanticLevel?: VerificationCoreProbe["semantic_level"];
}): VerificationCoreProbe => ({
  probe_id: input.probeId,
  label: input.label,
  role: "release_gate",
  mode: "browser_journey",
  assertion_id: input.assertionId,
  quality_axis_id: input.qualityAxisId,
  assertion_tags: input.assertionTags,
  semantic_level: input.semanticLevel ?? "workflow",
  target_manifest_key: "app_url",
  steps: input.steps,
  required: true
});

const buildApiJsonProbe = (input: {
  probeId: string;
  label: string;
  assertionId: string;
  qualityAxisId: string;
  assertionTags: VerificationAssertionTag[];
  targetPath: string;
  expectedValue: string;
  expectedStatus?: number;
  jsonPath?: string;
}): VerificationCoreProbe => ({
  probe_id: input.probeId,
  label: input.label,
  role: "release_gate",
  mode: "http_json",
  assertion_id: input.assertionId,
  quality_axis_id: input.qualityAxisId,
  assertion_tags: input.assertionTags,
  semantic_level: "workflow",
  target_manifest_key: "api_base_url",
  target_path: input.targetPath,
  json_path: input.jsonPath ?? "status",
  expected_value: input.expectedValue,
  expected_status: input.expectedStatus ?? 200,
  required: true
});

const buildGeneratedCoreProbes = (
  answers: BootstrapAnswers
): VerificationCoreProbe[] => {
  const titleSlug = slugify(answers.title);
  const qualityContract = buildGeneratedQualityContract(answers);
  const selectors = {
    appShell: answers.probeHints?.appShellSelector ?? "[data-testid='app-shell']",
    success:
      answers.probeHints?.successSelector ?? "[data-testid='finish-line-ready']",
    error: answers.probeHints?.errorSelector ?? "[data-testid='error-banner']",
    draftInput:
      answers.probeHints?.persistenceInputSelector ?? "[data-testid='draft-input']",
    saveAction:
      answers.probeHints?.saveActionSelector ?? "[data-testid='save-draft']",
    restored:
      answers.probeHints?.restoredSelector ?? "[data-testid='draft-restored']"
  };
  const apiPaths = {
    finishLine: answers.probeHints?.apiFinishLinePath ?? "quality/finish-line",
    errorPath: answers.probeHints?.apiErrorPath ?? "quality/error-path",
    persistence: answers.probeHints?.apiPersistencePath ?? "quality/persistence"
  };
  const continuityBoundaries = new Set(
    (answers.continuityBoundaries ?? []).map((boundary) => boundary.toLowerCase())
  );
  const shouldProbeContinuity =
    continuityBoundaries.size === 0 ||
    continuityBoundaries.has("reload") ||
    continuityBoundaries.has("refresh") ||
    continuityBoundaries.has("reopen");
  const featureSlugs = answers.coreFeatures
    .slice(0, 3)
    .map((feature, index) => ({
      feature,
      featureSlug: slugify(feature) || `feature-${index + 1}`,
      axisId: qualityContract.quality_axes.find(
        (axis) => axis.axis_id === `feature_${slugify(feature) || `feature-${index + 1}`}`
      )?.axis_id ?? `feature_${slugify(feature) || `feature-${index + 1}`}`
    }));
  const probes: VerificationCoreProbe[] = [];

  if (answers.healthUrl) {
    probes.push({
      probe_id: `${titleSlug}-health`,
      label: `${answers.title} health endpoint responds while the target is live`,
      role: "supporting",
      mode: "http",
      target_manifest_key: "health_url",
      expected_value: "\"status\"",
      required: true
    });
  }

  if (browserBackedFamily(answers.targetFamily)) {
    probes.push(
      buildBrowserJourneyProbe({
        probeId: `${titleSlug}-finish-line`,
        label: `Finish line remains visible: ${answers.finishLine}`,
        assertionId: `${titleSlug}_finish_line_ready`,
        qualityAxisId: "primary_flow",
        assertionTags: ["browser", "workflow_multi_step"],
        steps: [
          { action: "goto" },
          { action: "assert_visible", selector: selectors.appShell },
          { action: "assert_visible", selector: selectors.success }
        ]
      }),
      buildBrowserJourneyProbe({
        probeId: `${titleSlug}-error-recovery`,
        label: `Invalid browser flows surface explicit recovery for ${answers.title}`,
        assertionId: `${titleSlug}_error_recovery_ready`,
        qualityAxisId: "error_recovery",
        assertionTags: ["browser", "error_path"],
        steps: [
          { action: "goto", value: "?fixture=invalid" },
          { action: "assert_visible", selector: selectors.appShell },
          { action: "assert_visible", selector: selectors.error },
          {
            action: "assert_not_visible",
            selector: selectors.success
          }
        ]
      }),
      ...(shouldProbeContinuity
        ? [
            buildBrowserJourneyProbe({
              probeId: `${titleSlug}-state-continuity`,
              label: `Saved browser state restores after a reload for ${answers.title}`,
              assertionId: `${titleSlug}_state_continuity_ready`,
              qualityAxisId: "state_continuity",
              assertionTags: ["browser", "persistence", "workflow_multi_step"],
              steps: [
                { action: "goto", value: "?fixture=persistence" },
                { action: "assert_visible", selector: selectors.appShell },
                {
                  action: "fill",
                  selector: selectors.draftInput,
                  value: `${answers.title} continuity draft`
                },
                {
                  action: "click",
                  selector: selectors.saveAction
                },
                { action: "reload" },
                {
                  action: "assert_value",
                  selector: selectors.draftInput,
                  value: `${answers.title} continuity draft`
                },
                {
                  action: "assert_visible",
                  selector: selectors.restored
                }
              ]
            })
          ]
        : []),
      ...featureSlugs.map(({ feature, featureSlug, axisId }) =>
        buildBrowserJourneyProbe({
          probeId: `${titleSlug}-${featureSlug}`,
          label: `Core workflow remains visible: ${feature}`,
          assertionId: `${titleSlug}_${featureSlug}_ready`,
          qualityAxisId: axisId,
          assertionTags: ["browser", "workflow_multi_step"],
          semanticLevel: "feature",
          steps: [
            { action: "goto" },
            { action: "assert_visible", selector: selectors.appShell },
            {
              action: "assert_visible",
              selector: `[data-testid='feature-${featureSlug}']`
            }
          ]
        })
      )
    );
  }

  if (apiBackedFamily(answers.targetFamily)) {
    probes.push(
      buildApiJsonProbe({
        probeId: `${titleSlug}-finish-line-api`,
        label: `Finish line state is published through the API for ${answers.title}`,
        assertionId: `${titleSlug}_finish_line_api_ready`,
        qualityAxisId: "primary_flow",
        assertionTags: ["api", "workflow_multi_step"],
        targetPath: apiPaths.finishLine,
        expectedValue: "ready"
      }),
      buildApiJsonProbe({
        probeId: `${titleSlug}-error-recovery-api`,
        label: `Invalid API flows are rejected with explicit recovery metadata`,
        assertionId: `${titleSlug}_api_error_recovery_ready`,
        qualityAxisId: "error_recovery",
        assertionTags: ["api", "error_path"],
        targetPath: apiPaths.errorPath,
        expectedValue: "handled",
        expectedStatus: 400
      }),
      ...(shouldProbeContinuity
        ? [
            buildApiJsonProbe({
              probeId: `${titleSlug}-persistence-api`,
              label: `State persistence remains intact across the generated workflow`,
              assertionId: `${titleSlug}_persistence_ready`,
              qualityAxisId: "state_continuity",
              assertionTags: ["api", "persistence", "workflow_multi_step"],
              targetPath: apiPaths.persistence,
              expectedValue: "ready"
            })
          ]
        : []),
      ...featureSlugs.map(({ feature, featureSlug, axisId }) =>
        buildApiJsonProbe({
          probeId: `${titleSlug}-${featureSlug}-api`,
          label: `Core workflow remains coherent through the API: ${feature}`,
          assertionId: `${titleSlug}_${featureSlug}_api_ready`,
          qualityAxisId: axisId,
          assertionTags: ["api", "workflow_multi_step"],
          targetPath: `quality/features/${featureSlug}`,
          expectedValue: "ready"
        })
      )
    );
  }

  return probes;
};

const minimumAssertionTagCountsForGeneratedProbes = (
  probes: readonly VerificationCoreProbe[]
): Partial<Record<VerificationAssertionTag, number>> => {
  const counts: Partial<Record<VerificationAssertionTag, number>> = {};
  for (const probe of probes) {
    if ((probe.role ?? "supporting") !== "release_gate") {
      continue;
    }
    for (const tag of probe.assertion_tags ?? []) {
      counts[tag] = 1;
    }
  }
  return counts;
};

const buildGeneratedVerificationProfile = async (
  answers: BootstrapAnswers
): Promise<VerificationProfile> => {
  const familySelection = resolveTargetFamilySelection(answers.targetFamily);
  if (!familySelection) {
    throw new Error(
      `No evaluator bundle is registered for bootstrap target family '${answers.targetFamily}'.`
    );
  }

  const baseProfile = await loadJson<VerificationProfile>(familySelection.profile_path);
  const generatedCoreProbes = buildGeneratedCoreProbes(answers);
  const generatedCriteria = buildGeneratedCriteria(answers, generatedCoreProbes);
  const generatedSubjectiveMetrics = buildGeneratedSubjectiveMetrics(answers);
  const generatedReleaseGateProbeCount = generatedCoreProbes.filter(
    (probe) => (probe.role ?? "supporting") === "release_gate"
  ).length;
  const generatedMinimumAssertionTagCounts =
    minimumAssertionTagCountsForGeneratedProbes(generatedCoreProbes);
  const mergedCoreProbes = mergeGeneratedProbeOverlay(
    baseProfile.core_probes ?? [],
    generatedCoreProbes
  );
  const mergedCriteria = uniqueCriteria([
    ...(baseProfile.criteria ?? []),
    ...generatedCriteria
  ]);
  const mergedMinimumAssertionTagCounts = mergeAssertionTagCountFloors(
    baseProfile.minimum_assertion_tag_counts ?? {},
    generatedMinimumAssertionTagCounts
  );
  const titleSlug = slugify(answers.title);
  const qualityContract = mergeQualityContract(
    baseProfile.quality_contract,
    buildGeneratedQualityContract(answers)
  );
  const mergedSubjectiveMetrics = mergeSubjectiveMetrics(
    baseProfile.subjective_metrics ?? [],
    generatedSubjectiveMetrics
  );
  const mergedScorePolicy =
    generatedSubjectiveMetrics.length > 0
      ? {
          ...(baseProfile.score_policy ?? {}),
          proof_weights: {
            ...(baseProfile.score_policy?.proof_weights ?? {}),
            external_grade: Math.max(
              baseProfile.score_policy?.proof_weights?.external_grade ?? 0,
              0.35
            )
          }
        }
      : baseProfile.score_policy;
  const mergedExpectedTargetSurfaces = uniqueList([
    ...(baseProfile.expected_target_surfaces ?? []),
    ...targetSurfacesForFamily(answers.targetFamily)
  ]) as TargetSurface[];
  const mergedLiveVerificationModes = uniqueList([
    ...(baseProfile.required_live_verification_modes ?? []),
    ...liveVerificationModesForFamily(answers.targetFamily)
  ]) as NonNullable<VerificationProfile["required_live_verification_modes"]>;

  return {
    ...baseProfile,
    profile_id: `generated-${titleSlug}-profile`,
    label: `${answers.title} Evaluator Bundle`,
    bundle_label: `${answers.title} Evaluator Bundle`,
    target_family: answers.targetFamily,
    validation_lane: baseProfile.validation_lane,
    expected_target_surfaces: mergedExpectedTargetSurfaces,
    required_live_verification_modes: mergedLiveVerificationModes,
    target_reached_requires_core_probes:
      baseProfile.target_reached_requires_core_probes ?? true,
    minimum_feature_release_assertions: Math.max(
      baseProfile.minimum_feature_release_assertions ?? 2,
      Math.max(generatedReleaseGateProbeCount, 2)
    ),
    minimum_assertion_tag_counts: mergedMinimumAssertionTagCounts,
    score_policy: mergedScorePolicy,
    core_probes: mergedCoreProbes,
    criteria: mergedCriteria,
    quality_contract: qualityContract,
    ...(mergedSubjectiveMetrics.length > 0
      ? { subjective_metrics: mergedSubjectiveMetrics }
      : {}),
    notes: uniqueList([
      ...(baseProfile.notes ?? []),
      `Generated from intake for '${answers.title}'.`,
      `Finish line: ${answers.finishLine}`,
      ...qualityContract.quality_axes
        .slice(0, 4)
        .map((axis) => `Quality axis: ${axis.label}`),
      ...generatedSubjectiveMetrics.map(
        (metric) =>
          `Subjective metric: ${metric.label} >= ${metric.minimum_score_out_of_ten}/10`
      ),
      ...answers.coreFeatures.slice(0, 3).map((feature) => `Core workflow: ${feature}`),
      ...answers.qualityBar.slice(0, 4).map((entry) => `Quality bar: ${entry}`)
    ])
  };
};

const buildGeneratedRubric = async (
  answers: BootstrapAnswers
): Promise<LoopRubric> => {
  const baseRubric = await loadJson<LoopRubric>(defaultBootstrapRubricPath);
  const qualityContract = buildGeneratedQualityContract(answers);
  return {
    ...baseRubric,
    rubric_id: `generated-${slugify(answers.title)}-rubric`,
    evaluator_profile_path: "./verification-profile.generated.json",
    quality_dimensions: uniqueList([
      ...(baseRubric.quality_dimensions ?? []),
      ...qualityContract.quality_axes.map((axis) => axis.axis_id)
    ]),
    target_total_score: answers.targetScore
  };
};

const resolveUserPath = (value: string, fallback: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  return resolve(repoRoot, trimmed);
};

const askText = async (
  rl: ReturnType<typeof createInterface>,
  label: string,
  fallback?: string
): Promise<string> => {
  const prompt = fallback ? `${label} [${fallback}]: ` : `${label}: `;
  const answer = (await rl.question(prompt)).trim();
  return answer.length > 0 ? answer : fallback ?? "";
};

const askRequired = async (
  rl: ReturnType<typeof createInterface>,
  label: string,
  fallback?: string
): Promise<string> => {
  while (true) {
    const answer = await askText(rl, label, fallback);
    if (answer.trim().length > 0) {
      return answer.trim();
    }
    output.write("This value is required.\n");
  }
};

const askList = async (
  rl: ReturnType<typeof createInterface>,
  label: string,
  fallback?: string[]
): Promise<string[]> => {
  const fallbackText = fallback && fallback.length > 0 ? fallback.join(", ") : undefined;
  const answer = await askRequired(rl, label, fallbackText);
  return splitList(answer);
};

const askOptionalList = async (
  rl: ReturnType<typeof createInterface>,
  label: string,
  fallback?: string[]
): Promise<string[]> => {
  const fallbackText = fallback && fallback.length > 0 ? fallback.join(", ") : undefined;
  const answer = await askText(rl, label, fallbackText);
  return splitList(answer);
};

const askYesNo = async (
  rl: ReturnType<typeof createInterface>,
  label: string,
  fallback = "n"
): Promise<boolean> => {
  while (true) {
    const answer = (await askText(rl, label, fallback)).toLowerCase();
    if (answer === "y" || answer === "yes") {
      return true;
    }
    if (answer === "n" || answer === "no") {
      return false;
    }
    output.write("Please answer with 'y' or 'n'.\n");
  }
};

const askScoreOutOfTen = async (
  rl: ReturnType<typeof createInterface>,
  label: string,
  fallback = 8
): Promise<number> => {
  while (true) {
    const answer = await askRequired(rl, label, String(fallback));
    const parsed = Number(answer);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 10) {
      return Number(parsed.toFixed(1));
    }
    output.write("Please enter a number between 0 and 10.\n");
  }
};

const askCustomQualityMetrics = async (
  rl: ReturnType<typeof createInterface>
): Promise<BootstrapCustomQualityMetric[]> => {
  const wantsCustomMetrics = await askYesNo(
    rl,
    "Do you want extra quality metrics like design quality or originality? (y/n)",
    "n"
  );
  if (!wantsCustomMetrics) {
    return [];
  }

  const metrics: BootstrapCustomQualityMetric[] = [];
  while (true) {
    const label = await askText(
      rl,
      "Metric name (leave blank to finish)",
      metrics.length === 0 ? "design quality" : undefined
    );
    if (!label.trim()) {
      break;
    }

    const description = await askRequired(
      rl,
      `What should '${label}' reward or punish?`
    );
    const minimumScoreOutOfTen = await askScoreOutOfTen(
      rl,
      `Minimum passing score for '${label}' (0-10)`,
      8
    );
    const required = await askYesNo(
      rl,
      `Should '${label}' block target_reached if it falls below the threshold? (y/n)`,
      "y"
    );
    const weight = await askScoreOutOfTen(
      rl,
      `Weight for '${label}' in the subjective average (0-10, usually 1 or 2)`,
      required ? 2 : 1
    );

    metrics.push({
      metricId: slugify(label),
      label: label.trim(),
      description,
      minimumScoreOutOfTen,
      required,
      weight
    });
  }

  return metrics;
};

const askProbeHints = async (
  rl: ReturnType<typeof createInterface>,
  targetFamily: BootstrapTargetFamily
): Promise<BootstrapProbeHints | undefined> => {
  const wantsHints = await askYesNo(
    rl,
    "Do you want to add probe hints like selectors or API paths? (y/n)",
    "n"
  );
  if (!wantsHints) {
    return undefined;
  }

  const probeHints: BootstrapProbeHints = {};
  if (browserBackedFamily(targetFamily)) {
    const appShellSelector = await askText(
      rl,
      "App shell selector (leave blank to skip)"
    );
    const successSelector = await askText(
      rl,
      "Success selector (leave blank to skip)"
    );
    const errorSelector = await askText(
      rl,
      "Error selector (leave blank to skip)"
    );
    const persistenceInputSelector = await askText(
      rl,
      "Persistence input selector (leave blank to skip)"
    );
    const saveActionSelector = await askText(
      rl,
      "Save action selector (leave blank to skip)"
    );
    const restoredSelector = await askText(
      rl,
      "Restored-state selector (leave blank to skip)"
    );

    Object.assign(probeHints, {
      ...(appShellSelector ? { appShellSelector } : {}),
      ...(successSelector ? { successSelector } : {}),
      ...(errorSelector ? { errorSelector } : {}),
      ...(persistenceInputSelector ? { persistenceInputSelector } : {}),
      ...(saveActionSelector ? { saveActionSelector } : {}),
      ...(restoredSelector ? { restoredSelector } : {})
    });
  }

  if (apiBackedFamily(targetFamily)) {
    const apiFinishLinePath = await askText(
      rl,
      "API finish-line path (leave blank to skip)"
    );
    const apiErrorPath = await askText(
      rl,
      "API error-path (leave blank to skip)"
    );
    const apiPersistencePath = await askText(
      rl,
      "API persistence path (leave blank to skip)"
    );
    Object.assign(probeHints, {
      ...(apiFinishLinePath ? { apiFinishLinePath } : {}),
      ...(apiErrorPath ? { apiErrorPath } : {}),
      ...(apiPersistencePath ? { apiPersistencePath } : {})
    });
  }

  return nonEmptyProbeHints(probeHints);
};

const askTargetFamily = async (
  rl: ReturnType<typeof createInterface>,
  fallback: BootstrapTargetFamily = "fullstack-app"
): Promise<BootstrapTargetFamily> => {
  while (true) {
    output.write(`${familyHelp}\n`);
    const answer = await askText(rl, "Target family", fallback);
    const targetFamily = normalizeTargetFamily(answer);
    if (targetFamily) {
      return targetFamily;
    }
    output.write(
      "Please choose browser-app, api-service, fullstack-app, dashboard, browser-editor, crud-api, or chat-agent.\n"
    );
  }
};

const askProjectMode = async (
  rl: ReturnType<typeof createInterface>,
  fallback: "new" | "existing" = "new"
): Promise<"new" | "existing"> => {
  while (true) {
    const answer = (await askText(
      rl,
      "Is this a new project or an existing project? (new/existing)",
      fallback
    )).toLowerCase();
    if (answer === "new" || answer === "existing") {
      return answer;
    }
    output.write("Please answer with 'new' or 'existing'.\n");
  }
};

const askGoalLevel = async (
  rl: ReturnType<typeof createInterface>,
  fallback: GoalLevel = "usable"
): Promise<GoalLevel> => {
  while (true) {
    output.write(`${goalHelp}\n`);
    const answer = await askText(rl, "Target level", fallback);
    const goalLevel = normalizeGoalLevel(answer);
    if (goalLevel) {
      return goalLevel;
    }
    output.write(
      "Please choose prototype, mvp, usable, production-like, or custom.\n"
    );
  }
};

const askTargetScore = async (
  rl: ReturnType<typeof createInterface>,
  fallback = goalPresets.usable
): Promise<number> => {
  while (true) {
    const answer = await askRequired(
      rl,
      "Target score (0 to 1)",
      String(fallback)
    );
    const parsed = Number(answer);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
      return Number(parsed.toFixed(3));
    }
    output.write("Please enter a number between 0 and 1.\n");
  }
};

const askMaxRounds = async (
  rl: ReturnType<typeof createInterface>,
  fallback = 3
): Promise<number> => {
  while (true) {
    const answer = await askRequired(
      rl,
      "Maximum loop rounds",
      String(fallback)
    );
    const parsed = Number(answer);
    if (Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 1) {
      return parsed;
    }
    output.write("Please enter an integer greater than or equal to 1.\n");
  }
};

const summarizeAnswers = (answers: BootstrapAnswers): string =>
  [
    "",
    "Confirmation summary",
    `- Product: ${answers.title}`,
    `- Product brief: ${answers.summary}`,
    `- Users: ${answers.targetUsers.join("; ")}`,
    `- Core workflows: ${answers.coreFeatures.join("; ")}`,
    `- First-version success: ${answers.finishLine}`,
    answers.referenceApps.length > 0
      ? `- References: ${answers.referenceApps.join("; ")}`
      : "- References: none provided",
    `- Project mode: ${answers.projectMode}`,
    `- Target root: ${answers.targetRoot}`,
    `- Target score: ${answers.targetScore}`,
    `- Max rounds: ${answers.maxRounds}`,
    `- Run command: ${answers.runCommand}`,
    `- Check command: ${answers.checkCommand || "(none)"}`,
    `- Ready URL: ${answers.readyUrl}`,
    answers.mustNotBreak?.length
      ? `- Must not break: ${answers.mustNotBreak.join("; ")}`
      : undefined,
    answers.failureExpectations?.length
      ? `- Failure expectations: ${answers.failureExpectations.join("; ")}`
      : undefined,
    answers.continuityBoundaries?.length
      ? `- Continuity boundaries: ${answers.continuityBoundaries.join("; ")}`
      : undefined,
    answers.referenceSignals?.length
      ? `- Reference signals: ${answers.referenceSignals.join("; ")}`
      : undefined,
    answers.nonGoals?.length
      ? `- Non-goals: ${answers.nonGoals.join("; ")}`
      : undefined,
    answers.customQualityMetrics?.length
      ? `- Subjective metrics: ${answers.customQualityMetrics
          .map(
            (metric) =>
              `${metric.label} >= ${metric.minimumScoreOutOfTen}/10${metric.required === false ? " (score-only)" : ""}`
          )
          .join("; ")}`
      : undefined,
    answers.notes ? `- Notes: ${answers.notes}` : undefined,
    ""
  ]
    .filter(Boolean)
    .join("\n");

const confirmAnswers = async (
  rl: ReturnType<typeof createInterface>,
  answers: BootstrapAnswers
): Promise<boolean> => {
  output.write(`${summarizeAnswers(answers)}\n`);
  const answer = (await askText(rl, "Use this bootstrap config? (y/n)", "y")).toLowerCase();
  return answer === "y" || answer === "yes";
};

const writeIdeaMarkdown = (answers: BootstrapAnswers): string => {
  const lines = [
    `# ${answers.title}`,
    "",
    "## Summary",
    answers.summary,
    "",
    "## Users",
    ...answers.targetUsers.map((entry) => `- ${entry}`),
    "",
    "## Goals",
    ...answers.coreFeatures.map((entry) => `- ${entry}`),
    "",
    "## Constraints",
    ...(answers.constraints.length > 0
      ? answers.constraints.map((entry) => `- ${entry}`)
      : ["- Keep the generated workbench loop deterministic and resumable."]),
    ...(answers.nonGoals?.length
      ? ["", "## Non-Goals", ...answers.nonGoals.map((entry) => `- ${entry}`)]
      : []),
    "",
    "## Success Target",
    `- Finish line: ${answers.finishLine}`,
    `- Goal level: ${answers.goalLevel}`,
    `- Target score: ${answers.targetScore}`,
    `- Max rounds: ${answers.maxRounds}`,
    "",
    "## Quality Bar",
    ...(answers.qualityBar.length > 0
      ? answers.qualityBar.map((entry) => `- ${entry}`)
      : ["- The generated app should be coherent, runnable, and easy to extend."]),
    "",
    "## References",
    ...(answers.referenceApps.length > 0
      ? answers.referenceApps.map((entry) => `- ${entry}`)
      : ["- None provided."]),
    ...(answers.referenceSignals?.length
      ? ["", "## Reference Signals", ...answers.referenceSignals.map((entry) => `- ${entry}`)]
      : []),
    ...(answers.mustNotBreak?.length
      ? ["", "## Must Not Break", ...answers.mustNotBreak.map((entry) => `- ${entry}`)]
      : []),
    ...(answers.failureExpectations?.length
      ? [
          "",
          "## Failure Expectations",
          ...answers.failureExpectations.map((entry) => `- ${entry}`)
        ]
      : []),
    ...(answers.continuityBoundaries?.length
      ? [
          "",
          "## State Continuity",
          ...answers.continuityBoundaries.map((entry) => `- ${entry}`)
        ]
      : []),
    ...(answers.customQualityMetrics?.length
      ? [
          "",
          "## Subjective Metrics",
          ...answers.customQualityMetrics.map(
            (metric) =>
              `- ${metric.label}: ${metric.description} Minimum ${metric.minimumScoreOutOfTen}/10.${metric.required === false ? " Score influence only." : " Blocking if below threshold."}`
          )
        ]
      : []),
    ...(answers.probeHints && Object.keys(answers.probeHints).length > 0
      ? [
          "",
          "## Probe Hints",
          ...Object.entries(answers.probeHints).map(
            ([key, value]) => `- ${key}: ${value}`
          )
        ]
      : []),
    "",
    "## Technical Notes",
    `- Target family: ${answers.targetFamily}`,
    `- Project mode: ${answers.projectMode}`,
    `- Framework hint: ${answers.frameworkHint}`,
    `- Package manager: ${answers.packageManager}`,
    `- Expected run command: ${answers.runCommand}`,
    `- Expected check command: ${answers.checkCommand || "(none configured)"}`,
    `- Ready URL: ${answers.readyUrl}`,
    ...(answers.appUrl ? [`- App URL: ${answers.appUrl}`] : []),
    ...(answers.healthUrl ? [`- Health URL: ${answers.healthUrl}`] : []),
    ...(answers.apiBaseUrl ? [`- API base URL: ${answers.apiBaseUrl}`] : []),
    ...(answers.notes ? [`- Intake notes: ${answers.notes}`] : [])
  ];

  return `${lines.join("\n")}\n`;
};

const moduleImportPath = (fromDirectory: string, toFile: string): string =>
  (() => {
    const normalized = relative(fromDirectory, toFile).replace(/\\/g, "/");
    return normalized.startsWith(".") ? normalized : `./${normalized}`;
  })();

const helperTemplate = (codexRuntimeImportPath: string): string => `import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import {
  readCodexSession,
  runCodexCommand,
  writeCodexSession
} from "${codexRuntimeImportPath}";

const roundDirectory = process.env.HARNESS_ROUND_DIRECTORY ?? process.cwd();
const runDirectory = process.env.HARNESS_RUN_DIRECTORY ?? roundDirectory;
const adapterDirectory = join(roundDirectory, "adapter");
const artifactsDirectory = join(roundDirectory, "artifacts");
const runtimeDirectory =
  process.env.HARNESS_RUNTIME_DIRECTORY ?? join(runDirectory, "runtime");
const codexSessionRegistryPath =
  process.env.HARNESS_CODEX_SESSION_REGISTRY_PATH ??
  join(runtimeDirectory, "codex-sessions.json");
const inputPath = process.env.HARNESS_INPUT_PATH;
const outputPath = process.env.HARNESS_OUTPUT_PATH;
const targetRoot = process.env.HARNESS_TARGET_ROOT ?? process.cwd();
const verificationProfilePath =
  process.env.HARNESS_VERIFICATION_PROFILE_PATH ??
  new URL("../../../verification-profile.generated.json", import.meta.url);

const ensureDirectory = async (path) => {
  await mkdir(path, { recursive: true });
  return path;
};

export const readConfig = async () =>
  JSON.parse(await readFile(new URL("../runtime-config.json", import.meta.url), "utf8"));

export const readIdeaMarkdown = async () => {
  const config = await readConfig();
  if (!config.idea_path) {
    return "";
  }
  try {
    return await readFile(config.idea_path, "utf8");
  } catch {
    return "";
  }
};

export const readVerificationProfile = async () =>
  JSON.parse(await readFile(verificationProfilePath, "utf8"));

export const readPacket = async () => {
  if (!inputPath) {
    return {};
  }
  return JSON.parse(await readFile(inputPath, "utf8"));
};

export const readCoreProbeResults = async () => {
  const path = process.env.HARNESS_CORE_PROBE_RESULTS_PATH;
  if (!path) {
    return [];
  }
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return [];
  }
};

export const readTargetManifest = async () => {
  const path = process.env.HARNESS_TARGET_MANIFEST_PATH;
  if (!path) {
    return {};
  }
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return {};
  }
};

export const writeJson = async (path, value) => {
  await ensureDirectory(dirname(path));
  await writeFile(path, JSON.stringify(value, null, 2) + "\\n", "utf8");
};

export const writeText = async (path, value) => {
  await ensureDirectory(dirname(path));
  await writeFile(path, value, "utf8");
};

export const relativeToRound = (path) =>
  path.startsWith(roundDirectory)
    ? path.slice(roundDirectory.length + 1).replace(/\\\\/g, "/")
    : path.replace(/\\\\/g, "/");

export const normalizeRoundPath = (value) =>
  typeof value === "string" && value
    ? value.startsWith(roundDirectory)
      ? relativeToRound(value)
      : value.replace(/\\\\/g, "/")
    : value;

export const writeArtifact = async (name, contents) => {
  const fullPath = join(artifactsDirectory, name);
  await writeText(fullPath, contents);
  return relativeToRound(fullPath);
};

export const writeArtifactJson = async (name, value) => {
  const fullPath = join(artifactsDirectory, name);
  await writeJson(fullPath, value);
  return relativeToRound(fullPath);
};

export const writeRuntimeJson = async (name, value) => {
  const fullPath = join(runtimeDirectory, name);
  await writeJson(fullPath, value);
  return fullPath;
};

export const writeRuntimeText = async (name, value) => {
  const fullPath = join(runtimeDirectory, name);
  await writeText(fullPath, value);
  return fullPath;
};

export const readJsonIfExists = async (path) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
};

export const finalize = async (result) => {
  if (!outputPath) {
    throw new Error("HARNESS_OUTPUT_PATH is not set.");
  }
  await writeJson(outputPath, result);
};

export const roundScore = (value) => Math.round(value * 1000) / 1000;

export const spawnCommand = async (command, options = {}) =>
  new Promise((resolvePromise) => {
    const child = spawn(command, {
      cwd: options.cwd ?? targetRoot,
      env: { ...process.env, ...(options.env ?? {}) },
      shell: options.shell ?? true,
      detached: options.detached ?? false
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    if (typeof options.stdinText === "string") {
      child.stdin?.write(options.stdinText);
      child.stdin?.end();
    }

    if (options.detached) {
      child.unref();
      resolvePromise({ code: 0, stdout, stderr, pid: child.pid ?? -1 });
      return;
    }

    child.on("close", (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr, pid: child.pid ?? -1 });
    });
  });

export const startDetachedCommand = async (command, logPath, cwd = targetRoot) => {
  await ensureDirectory(dirname(logPath));
  const logStream = createWriteStream(logPath, { flags: "a" });
  const child = spawn(command, {
    cwd,
    env: process.env,
    shell: true,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);
  child.unref();
  return { pid: child.pid ?? -1 };
};

export { readCodexSession, runCodexCommand, writeCodexSession };

export const stopProcess = (pid) => {
  if (typeof pid !== "number" || pid <= 0) {
    return;
  }
  try {
    process.kill(pid);
  } catch {}
};

export const waitForUrl = async (url, timeoutMs = 60000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      const body = await response.text();
      return {
        ok: response.status >= 200 && response.status < 500,
        status: response.status,
        body: body.slice(0, 4000)
      };
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
    }
  }
  return {
    ok: false,
    status: 0,
    body: ""
  };
};

export const runtimePaths = {
  runDirectory,
  roundDirectory,
  adapterDirectory,
  artifactsDirectory,
  runtimeDirectory,
  codexSessionRegistryPath,
  targetRoot
};
`;

const prepareTargetTemplate = (): string => `import { mkdir } from "node:fs/promises";

import { finalize, readConfig, runtimePaths, writeArtifact } from "./runtime-helpers.mjs";

const main = async () => {
  const config = await readConfig();
  await mkdir(runtimePaths.targetRoot, { recursive: true });
  const notePath = await writeArtifact(
    "prepare-target.md",
    [
      "# Prepare Target",
      "",
      "Target root: " + runtimePaths.targetRoot,
      "Project mode: " + config.project_mode,
      "Framework hint: " + config.framework_hint
    ].join("\\n")
  );

  await finalize({
    capability: "prepare_target",
    ok: true,
    summary: "Prepared target root at " + runtimePaths.targetRoot + ".",
    findings: [],
    evidence_paths: [notePath]
  });
};

main().catch(async (error) => {
  await finalize({
    capability: "prepare_target",
    ok: false,
    summary: "prepare_target failed.",
    findings: [error instanceof Error ? error.message : String(error)],
    evidence_paths: []
  });
  process.exitCode = 1;
});
`;

const applyChangeTemplate = (): string => `import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  finalize,
  readConfig,
  readJsonIfExists,
  readPacket,
  readCodexSession,
  relativeToRound,
  runCodexCommand,
  runtimePaths,
  writeArtifact,
  writeCodexSession
} from "./runtime-helpers.mjs";

const main = async () => {
  const config = await readConfig();
  const packet = await readPacket();
  const ideaMarkdown = await readFile(config.idea_path, "utf8");
  const roundContract =
    typeof packet.round_contract_path === "string"
      ? await readJsonIfExists(packet.round_contract_path)
      : undefined;
  const contractAgreement =
    typeof packet.contract_agreement_path === "string"
      ? await readJsonIfExists(packet.contract_agreement_path)
      : undefined;
  const generatorPlan =
    typeof packet.generator_plan_path === "string"
      ? await readJsonIfExists(packet.generator_plan_path)
      : undefined;
  const previousPatchRequest =
    typeof packet.patch_request_path === "string"
      ? await readJsonIfExists(packet.patch_request_path)
      : undefined;
  const previousRoundDirectory =
    typeof packet.patch_request_path === "string"
      ? dirname(packet.patch_request_path)
      : undefined;
  const previousQualityCritique = previousRoundDirectory
    ? await readJsonIfExists(join(previousRoundDirectory, "quality-critique.json"))
    : undefined;
  const previousEvalReport = previousRoundDirectory
    ? await readJsonIfExists(join(previousRoundDirectory, "eval_report.json"))
    : undefined;
  const remediationBrief = {
    round_contract: roundContract
      ? {
          objective: roundContract.objective,
          attempt_kind: roundContract.attempt_kind,
          negotiation_mode: roundContract.negotiation_mode,
          acceptance_checks: roundContract.acceptance_checks,
          carry_over_check_ids: roundContract.carry_over_check_ids,
          non_goals: roundContract.non_goals
        }
      : null,
    contract_agreement: contractAgreement
      ? {
          acceptance_checks: contractAgreement.acceptance_checks,
          release_gate_probe_ids: contractAgreement.release_gate_probe_ids,
          required_live_verification_modes:
            contractAgreement.required_live_verification_modes,
          notes: contractAgreement.notes
        }
      : null,
    generator_plan: generatorPlan
      ? {
          implementation_intent: generatorPlan.implementation_intent,
          remediation_strategy: generatorPlan.remediation_strategy,
          target_check_ids: generatorPlan.target_check_ids,
          quality_focus: generatorPlan.quality_focus,
          must_preserve: generatorPlan.must_preserve,
          out_of_scope: generatorPlan.out_of_scope
        }
      : null,
    latest_patch_request: previousPatchRequest
      ? {
          next_action: previousPatchRequest.next_action,
          remediation_strategy: previousPatchRequest.remediation_strategy,
          must_fix: Array.isArray(previousPatchRequest.must_fix)
            ? previousPatchRequest.must_fix.map((item) => ({
                id: item.id,
                why: item.why,
                expected_change: item.expected_change,
                target_check_ids: item.target_check_ids
              }))
            : [],
          must_preserve: previousPatchRequest.must_preserve,
          forbidden_scope_expansion:
            previousPatchRequest.forbidden_scope_expansion
        }
      : null,
    latest_quality_critique: previousQualityCritique
      ? {
          remediation_strategy: previousQualityCritique.remediation_strategy,
          quality_focus: previousQualityCritique.quality_focus,
          preserve_signals: previousQualityCritique.preserve_signals,
          findings: Array.isArray(previousQualityCritique.findings)
            ? previousQualityCritique.findings.map((finding) => ({
                summary: finding.summary,
                expected_change: finding.expected_change,
                category: finding.category,
                severity: finding.severity,
                axis_id: finding.axis_id,
                probe_id: finding.probe_id,
                target_check_ids: finding.target_check_ids
              }))
            : []
        }
      : null,
    latest_eval_summary: previousEvalReport
      ? {
          release_score: previousEvalReport.release_score,
          blockers: previousEvalReport.blockers,
          threshold_gap_details: previousEvalReport.threshold_gap_details,
          unresolved_check_ids: previousEvalReport.unresolved_check_ids
        }
      : null
  };
  const remediationBriefPath = await writeArtifact(
    "generator-remediation-brief.json",
    JSON.stringify(remediationBrief, null, 2)
  );
  const prompt = [
    "You are the generator for a closed-loop harness.",
    "Work only inside the target root.",
    "Use the intake brief and the current round packet to decide what to build next.",
    "Prefer the smallest coherent set of changes that moves the product forward.",
    "When remediation artifacts are present, treat them as load-bearing instructions.",
    "Do not widen scope beyond the latest patch request unless the controller explicitly reopened contract scope.",
    "",
    "# Product brief",
    ideaMarkdown,
    "",
    "# Intake summary",
    JSON.stringify(config, null, 2),
    "",
    "# Harness packet",
    JSON.stringify(packet, null, 2),
    "",
    "# Active remediation brief",
    JSON.stringify(remediationBrief, null, 2)
  ].join("\\n");

  const previousSession = await readCodexSession(
    runtimePaths.codexSessionRegistryPath,
    "generator"
  );
  const execution = await runCodexCommand({
    name: "generator",
    prompt,
    cwd: runtimePaths.targetRoot,
    configOverrides: {
      approval_policy: "never",
      sandbox_mode: "workspace-write",
      "sandbox_workspace_write.network_access": false
    },
    addDirs: [
      runtimePaths.roundDirectory,
      dirname(config.idea_path),
      ...(previousRoundDirectory ? [previousRoundDirectory] : [])
    ],
    sessionId:
      typeof previousSession?.thread_id === "string" ? previousSession.thread_id : undefined,
    artifactDirectory: runtimePaths.artifactsDirectory,
    metadata: {
      role: "generator",
      capability: "apply_change",
      session_registry_path: runtimePaths.codexSessionRegistryPath
    }
  });

  const mutationSucceeded =
    execution.code === 0 &&
    !execution.disabled &&
    !execution.error &&
    execution.responseWritten;

  if (mutationSucceeded && execution.threadId) {
    await writeCodexSession(runtimePaths.codexSessionRegistryPath, "generator", {
      role: "generator",
      thread_id: execution.threadId,
      cwd: runtimePaths.targetRoot,
      metadata: {
        capability: "apply_change",
        target_root: runtimePaths.targetRoot
      }
    });
  }

  const stdoutPath = await writeArtifact("apply-change.stdout.log", execution.stdout);
  const stderrPath = await writeArtifact("apply-change.stderr.log", execution.stderr);
  const evidencePaths = [
    remediationBriefPath,
    stdoutPath,
    stderrPath,
    relativeToRound(execution.promptPath),
    relativeToRound(execution.eventsPath),
    execution.responseWritten ? relativeToRound(execution.responsePath) : undefined
  ].filter(Boolean);

  await finalize({
    capability: "apply_change",
    ok: mutationSucceeded,
    summary: mutationSucceeded
      ? "Codex generator completed the round mutation."
      : execution.disabled
        ? "Codex generator was disabled; no mutation was attempted."
        : execution.error
          ? "Codex generator was unavailable; mutation was not applied."
          : "Codex generator did not complete a valid mutation.",
    findings:
      mutationSucceeded
        ? []
        : [
            execution.error ||
              (execution.disabled
                ? "HARNESS_DISABLE_CODEX_AGENTS=1 prevented generator mutation."
                : undefined) ||
              (!execution.responseWritten
                ? "Codex did not write a response artifact for apply_change."
                : undefined) ||
              execution.stderr.trim() ||
              "codex exec exited with code " + execution.code + "."
          ],
    evidence_paths: evidencePaths
  });

  if (!mutationSucceeded) {
    process.exitCode = 1;
  }
};

main().catch(async (error) => {
  await finalize({
    capability: "apply_change",
    ok: false,
    summary: "apply_change failed.",
    findings: [error instanceof Error ? error.message : String(error)],
    evidence_paths: []
  });
  process.exitCode = 1;
});
`;

const runTargetTemplate = (): string => `import { join } from "node:path";

import {
  finalize,
  readConfig,
  readJsonIfExists,
  runtimePaths,
  startDetachedCommand,
  stopProcess,
  waitForUrl,
  writeArtifact,
  writeRuntimeJson
} from "./runtime-helpers.mjs";

const main = async () => {
  const config = await readConfig();
  const processStatePath = runtimePaths.runtimeDirectory + "/server-process.json";
  const previousState = await readJsonIfExists(processStatePath);
  if (previousState?.pid) {
    stopProcess(previousState.pid);
  }

  const logPath = join(runtimePaths.artifactsDirectory, "run-target.log");
  if (config.run_command) {
    const started = await startDetachedCommand(config.run_command, logPath, runtimePaths.targetRoot);
    await writeRuntimeJson("server-process.json", {
      pid: started.pid,
      command: config.run_command
    });
  }

  const probe = await waitForUrl(config.ready_url, 90000);
  const probePath = await writeArtifact(
    "run-target-probe.log",
    [
      "ready_url=" + config.ready_url,
      "status=" + probe.status,
      "ok=" + String(probe.ok),
      "",
      probe.body
    ].join("\\n")
  );

  await finalize({
    capability: "run_target",
    ok: probe.ok,
    summary: probe.ok
      ? "Target responded at " + config.ready_url + "."
      : "Target did not become ready at " + config.ready_url + ".",
    findings: probe.ok ? [] : ["Failed to reach " + config.ready_url + "."],
    evidence_paths: ["artifacts/run-target.log", probePath],
    target_manifest: {
      ...(config.app_url ? { app_url: config.app_url } : {}),
      ...(config.health_url ? { health_url: config.health_url } : {}),
      ...(config.api_base_url ? { api_base_url: config.api_base_url } : {})
    }
  });

  if (!probe.ok) {
    process.exitCode = 1;
  }
};

main().catch(async (error) => {
  await finalize({
    capability: "run_target",
    ok: false,
    summary: "run_target failed.",
    findings: [error instanceof Error ? error.message : String(error)],
    evidence_paths: []
  });
  process.exitCode = 1;
});
`;

const captureEvidenceTemplate = (): string => `import {
  finalize,
  readConfig,
  waitForUrl,
  writeArtifact
} from "./runtime-helpers.mjs";

const main = async () => {
  const config = await readConfig();
  const probe = await waitForUrl(config.ready_url, 15000);
  const reportPath = await writeArtifact(
    "capture-evidence.md",
    [
      "# Live evidence",
      "",
      "Ready URL: " + config.ready_url,
      "HTTP status: " + probe.status,
      "Reachable: " + String(probe.ok),
      "",
      probe.body || "No response body captured."
    ].join("\\n")
  );

  await finalize({
    capability: "capture_evidence",
    ok: probe.ok,
    summary: probe.ok
      ? "Captured live evidence from " + config.ready_url + "."
      : "Could not capture live evidence from " + config.ready_url + ".",
    findings: probe.ok ? [] : ["Failed to capture evidence from " + config.ready_url + "."],
    evidence_paths: [reportPath],
    evidence_items: [
      {
        path: reportPath,
        kind: "report",
        description: "Bootstrap-generated live evidence capture."
      }
    ]
  });

  if (!probe.ok) {
    process.exitCode = 1;
  }
};

main().catch(async (error) => {
  await finalize({
    capability: "capture_evidence",
    ok: false,
    summary: "capture_evidence failed.",
    findings: [error instanceof Error ? error.message : String(error)],
    evidence_paths: []
  });
  process.exitCode = 1;
});
`;

const runChecksTemplate = (): string => `import {
  finalize,
  readConfig,
  readCoreProbeResults,
  readTargetManifest,
  readVerificationProfile,
  normalizeRoundPath,
  runtimePaths,
  spawnCommand,
  waitForUrl,
  writeArtifact,
  writeArtifactJson
} from "./runtime-helpers.mjs";

const main = async () => {
  const config = await readConfig();
  const profile = await readVerificationProfile();
  const coreProbeResults = await readCoreProbeResults();
  const targetManifest = await readTargetManifest();
  const liveProbe = await waitForUrl(config.ready_url, 15000);
  const runCheckCriteria = (profile.criteria ?? []).filter(
    (criterion) => criterion.capability === "run_checks"
  );
  const releaseGateProbes = coreProbeResults.filter(
    (probe) => (probe.role ?? "supporting") === "release_gate"
  );
  const probeByAssertionId = new Map(
    coreProbeResults
      .filter((probe) => typeof probe.assertion_id === "string" && probe.assertion_id)
      .map((probe) => [probe.assertion_id, probe])
  );
  const interactionLogPath = await writeArtifact(
    "live-verification.log",
    [
      "provider=" + (process.env.HARNESS_PROVIDER_ID ?? "generated-codex-verifier"),
      "role=" + (process.env.HARNESS_PROVIDER_ROLE ?? "verifier"),
      "profile_id=" + (profile.profile_id ?? "generated-bootstrap-profile"),
      "ready_url=" + config.ready_url,
      "status=" + liveProbe.status,
      "reachable=" + String(liveProbe.ok),
      "release_gate_probe_count=" + releaseGateProbes.length,
      "",
      liveProbe.body || "No live body captured."
    ].join("\\n")
  );

  let checksOk = true;
  let checkSummary = "No explicit check command configured.";
  let checkLogPath;
  if (config.check_command) {
    const execution = await spawnCommand(config.check_command, {
      cwd: runtimePaths.targetRoot
    });
    checksOk = execution.code === 0;
    checkSummary = checksOk
      ? "Configured check command passed."
      : "Configured check command failed.";
    checkLogPath = await writeArtifact(
      "check-command.log",
      [execution.stdout, execution.stderr].filter(Boolean).join("\\n\\n")
    );
  }

  const coreProbeSummaryPath = await writeArtifactJson("core-probe-summary.json", {
    profile_id: profile.profile_id,
    target_manifest: targetManifest,
    release_gate_probe_count: releaseGateProbes.length,
    passing_probe_ids: releaseGateProbes
      .filter((probe) => probe.ok)
      .map((probe) => probe.probe_id),
    failing_probe_ids: releaseGateProbes
      .filter((probe) => !probe.ok)
      .map((probe) => probe.probe_id),
    probes: coreProbeResults.map((probe) => ({
      probe_id: probe.probe_id,
      assertion_id: probe.assertion_id,
      quality_axis_id: probe.quality_axis_id,
      role: probe.role,
      required: probe.required,
      ok: probe.ok,
      summary: probe.summary,
      observed_value: probe.observed_value,
      evidence_paths: Array.isArray(probe.evidence_paths)
        ? probe.evidence_paths.map((path) => normalizeRoundPath(path))
        : []
    }))
  });

  const witness = {
    witness_id:
      (process.env.HARNESS_PROVIDER_ID ?? "generated-codex-verifier") +
      "-run-checks",
    provider_id: process.env.HARNESS_PROVIDER_ID ?? "generated-codex-verifier",
    provider_role: process.env.HARNESS_PROVIDER_ROLE ?? "verifier",
    capability: "run_checks",
    mode: ["api-service", "crud-api", "chat-agent"].includes(config.target_family)
      ? "api"
      : "browser",
    target_root: runtimePaths.targetRoot,
    target_reference: config.ready_url,
    interaction_log_path: interactionLogPath,
    assertion_ids: runCheckCriteria.map(
      (criterion) => criterion.assertion_id ?? criterion.criterion_id
    ),
    steps: [
      {
        action: "probe ready url",
        outcome: liveProbe.ok ? "pass" : "fail",
        artifact_paths: [interactionLogPath]
      },
      ...(config.check_command
        ? [
            {
              action: "run configured check command",
              outcome: checksOk ? "pass" : "fail",
              artifact_paths: checkLogPath ? [checkLogPath] : [interactionLogPath]
            }
          ]
        : [])
    ]
  };
  const witnessPath = await writeArtifactJson("verification-witness.json", witness);

  const criteriaResults = runCheckCriteria.map((criterion) => {
    if (criterion.criterion_id === "target_accessible") {
      return {
        criterion_id: criterion.criterion_id,
        status: liveProbe.ok ? "pass" : "fail",
        summary: liveProbe.ok
          ? "The configured ready URL responded."
          : "The configured ready URL did not respond successfully.",
        hard: criterion.hard ?? true,
        threshold: criterion.summary,
        observed_value: liveProbe.ok ? "HTTP " + liveProbe.status : "No successful response",
        evidence_paths: [interactionLogPath, witnessPath]
      };
    }

    if (criterion.criterion_id === "command_checks") {
      const commandConfigured = Boolean(config.check_command);
      const commandPassed = commandConfigured && checksOk;
      return {
        criterion_id: criterion.criterion_id,
        status: commandConfigured && commandPassed ? "pass" : "fail",
        summary: commandConfigured
          ? checkSummary
          : "No configured check command was available for this criterion.",
        hard: criterion.hard ?? false,
        threshold: criterion.summary,
        observed_value: commandConfigured
          ? commandPassed
            ? "pass"
            : "fail"
          : "missing check command",
        evidence_paths: checkLogPath ? [checkLogPath] : [interactionLogPath]
      };
    }

    const probe = probeByAssertionId.get(criterion.assertion_id ?? criterion.criterion_id);
    return {
      criterion_id: criterion.criterion_id,
      status: probe?.ok ? "pass" : "fail",
      summary:
        probe?.summary ??
        "No core-owned probe result matched this generated criterion.",
      hard: criterion.hard ?? true,
      threshold: criterion.summary,
      observed_value:
        probe?.ok
          ? "pass"
          : "fail: " + (probe?.observed_value ?? "unmapped"),
      evidence_paths: [coreProbeSummaryPath]
    };
  });

  const hardFailures = criteriaResults.filter(
    (criterion) => criterion.hard && criterion.status === "fail"
  );
  const failedReleaseGateProbes = releaseGateProbes.filter((probe) => !probe.ok);
  const evidencePaths = [
    interactionLogPath,
    witnessPath,
    coreProbeSummaryPath,
    ...(checkLogPath ? [checkLogPath] : [])
  ];
  await finalize({
    capability: "run_checks",
    ok: true,
    summary:
      hardFailures.length === 0
        ? "run_checks completed with all hard profile criteria passing."
        : "run_checks completed with " +
          hardFailures.length +
          " hard profile criteria failing.",
    findings: [
      ...hardFailures.map(
        (criterion) => "Blocking criterion failed: " + criterion.criterion_id + "."
      ),
      ...failedReleaseGateProbes.map(
        (probe) => "Release-gate probe failed: " + probe.probe_id + "."
      )
    ],
    evidence_paths: evidencePaths,
    evidence_items: [
      {
        path: interactionLogPath,
        kind: "interaction-log",
        description: "Verifier-owned live probe log.",
        supports_check_ids: ["target_accessible"],
        supports_criterion_ids: ["target_accessible"]
      },
      {
        path: witnessPath,
        kind: "verification-witness",
        description: "Structured witness for the live probe.",
        supports_check_ids: ["target_accessible"],
        supports_criterion_ids: runCheckCriteria
          .filter((criterion) => criterion.criterion_id === "target_accessible")
          .map((criterion) => criterion.criterion_id)
      },
      ...(checkLogPath
        ? [
            {
              path: checkLogPath,
              kind: "log",
              description: "Configured check command output.",
              supports_check_ids: ["command_checks"],
              supports_criterion_ids: ["command_checks"]
            }
          ]
        : []),
      {
        path: coreProbeSummaryPath,
        kind: "json",
        description: "Core-owned probe outcomes summarized for profile-aware run_checks.",
        supports_criterion_ids: runCheckCriteria
          .filter(
            (criterion) =>
              criterion.criterion_id !== "target_accessible" &&
              criterion.criterion_id !== "command_checks"
          )
          .map((criterion) => criterion.criterion_id)
      }
    ],
    criteria_results: criteriaResults,
    metadata: {
      check_count: criteriaResults.length,
      hard_failure_count: hardFailures.length,
      release_gate_probe_count: releaseGateProbes.length,
      failed_release_gate_probe_count: failedReleaseGateProbes.length
    }
  });
};

main().catch(async (error) => {
  await finalize({
    capability: "run_checks",
    ok: false,
    summary: "run_checks failed.",
    findings: [error instanceof Error ? error.message : String(error)],
    evidence_paths: []
  });
  process.exitCode = 1;
});
`;

const gradeRoundTemplate = (): string => `import { join } from "node:path";

import {
  finalize,
  readConfig,
  readCoreProbeResults,
  readIdeaMarkdown,
  readJsonIfExists,
  readVerificationProfile,
  roundScore,
  runCodexCommand,
  runtimePaths,
  writeArtifact,
  writeArtifactJson
} from "./runtime-helpers.mjs";

const subjectiveMetricSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "metrics"],
  properties: {
    summary: { type: "string" },
    metrics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "metric_id",
          "score_out_of_ten",
          "rationale",
          "recommended_changes"
        ],
        properties: {
          metric_id: { type: "string" },
          score_out_of_ten: { type: "number", minimum: 0, maximum: 10 },
          rationale: { type: "string" },
          recommended_changes: {
            type: "array",
            items: { type: "string" },
            maxItems: 4
          }
        }
      }
    }
  }
};

const clampScore = (value) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(10, Number(value.toFixed(1))))
    : 0;

const failClosedSubjectiveReview = (metrics, summary) => ({
  summary,
  metrics: metrics.map((metric) => ({
    metric_id: metric.metric_id,
    score_out_of_ten: 0,
    rationale: "No subjective judge result was available.",
    recommended_changes: [
      "Re-run with Codex judge enabled or provide HARNESS_SUBJECTIVE_REVIEW_PATH."
    ]
  }))
});

const main = async () => {
  const config = await readConfig();
  const ideaMarkdown = await readIdeaMarkdown();
  const profile = await readVerificationProfile();
  const coreProbeResults = await readCoreProbeResults();
  const checksPath = join(runtimePaths.adapterDirectory, "run_checks-result.json");
  const checksResult = await readJsonIfExists(checksPath);
  const checksCriteria = Array.isArray(checksResult?.criteria_results)
    ? checksResult.criteria_results
    : [];
  const checksEvidencePaths = Array.isArray(checksResult?.evidence_paths)
    ? checksResult.evidence_paths
    : [];
  const gradeCriteria = (profile.criteria ?? []).filter(
    (criterion) => criterion.capability === "grade_round"
  );
  const subjectiveMetrics = Array.isArray(profile.subjective_metrics)
    ? profile.subjective_metrics
    : [];
  const releaseGateProbes = coreProbeResults.filter(
    (probe) => (probe.role ?? "supporting") === "release_gate"
  );
  const requiredReleaseGateProbes = releaseGateProbes.filter(
    (probe) => probe.required !== false
  );
  const releaseGatePassRate =
    requiredReleaseGateProbes.length > 0
      ? requiredReleaseGateProbes.filter((probe) => probe.ok).length /
        requiredReleaseGateProbes.length
      : 0;
  const checksPass = checksCriteria.some(
    (criterion) =>
      criterion.criterion_id === "target_accessible" && criterion.status === "pass"
  )
    ? 1
    : 0;
  const commandCriterionPresent = checksCriteria.some(
    (criterion) => criterion.criterion_id === "command_checks"
  );
  const commandPass = commandCriterionPresent
    ? checksCriteria.some(
        (criterion) =>
          criterion.criterion_id === "command_checks" && criterion.status === "pass"
      )
      ? 1
      : 0
    : 1;
  const deterministicReleaseScore = roundScore(
    0.2 * checksPass + 0.15 * commandPass + 0.65 * releaseGatePassRate
  );

  const reviewOverridePath = process.env.HARNESS_SUBJECTIVE_REVIEW_PATH;
  let subjectiveReview;
  let judgeArtifacts = [];
  if (subjectiveMetrics.length > 0) {
    if (reviewOverridePath) {
      subjectiveReview = await readJsonIfExists(reviewOverridePath);
    }

    if (!subjectiveReview) {
      const evidenceInventory = {
        run_checks_evidence_paths: checksEvidencePaths,
        core_probe_results: coreProbeResults.map((probe) => ({
          probe_id: probe.probe_id,
          assertion_id: probe.assertion_id,
          quality_axis_id: probe.quality_axis_id,
          ok: probe.ok,
          summary: probe.summary,
          observed_value: probe.observed_value,
          evidence_paths: probe.evidence_paths
        }))
      };
      const prompt = [
        "You are a skeptical product-quality judge.",
        "Score each requested quality metric from 0 to 10.",
        "Use only the supplied product brief, quality contract, requested metrics, and captured evidence.",
        "Be conservative when evidence is thin.",
        "Do not score visual or design metrics above 6/10 if there is no direct rendered evidence such as screenshots or browser traces.",
        "",
        "# Product brief",
        ideaMarkdown || config.product_summary || config.product_title,
        "",
        "# Quality contract",
        JSON.stringify(profile.quality_contract ?? {}, null, 2),
        "",
        "# Requested subjective metrics",
        JSON.stringify(subjectiveMetrics, null, 2),
        "",
        "# Core probe summary",
        JSON.stringify(evidenceInventory.core_probe_results, null, 2),
        "",
        "# Evidence inventory",
        JSON.stringify(evidenceInventory, null, 2)
      ].join("\\n");

      const judgeExecution = await runCodexCommand({
        name: "subjective-quality-judge",
        prompt,
        cwd: runtimePaths.targetRoot,
        artifactDirectory: runtimePaths.artifactsDirectory,
        configOverrides: {
          approval_policy: "never",
          sandbox_mode: "read-only",
          "sandbox_read_only.network_access": false
        },
        addDirs: [runtimePaths.roundDirectory],
        outputSchema: subjectiveMetricSchema,
        metadata: {
          role: "judge",
          capability: "grade_round",
          subjective_metric_count: subjectiveMetrics.length
        }
      });

      judgeArtifacts = [judgeExecution.promptPath, judgeExecution.responsePath]
        .filter(Boolean)
        .map((path) => path.startsWith(runtimePaths.roundDirectory)
          ? path.slice(runtimePaths.roundDirectory.length + 1).replace(/\\\\/g, "/")
          : path.replace(/\\\\/g, "/"));

      subjectiveReview =
        judgeExecution.responseWritten && judgeExecution.responsePath
          ? await readJsonIfExists(judgeExecution.responsePath)
          : undefined;

      if (
        judgeExecution.disabled ||
        judgeExecution.error ||
        !judgeExecution.responseWritten ||
        !subjectiveReview
      ) {
        subjectiveReview = failClosedSubjectiveReview(
          subjectiveMetrics,
          judgeExecution.disabled
            ? "Subjective quality judge was disabled, so configured custom metrics failed closed."
            : judgeExecution.error
              ? "Subjective quality judge was unavailable, so configured custom metrics failed closed."
              : "Subjective quality judge did not return structured output, so configured custom metrics failed closed."
        );
      }
    }
  }

  const reviewMetricById = new Map(
    Array.isArray(subjectiveReview?.metrics)
      ? subjectiveReview.metrics
          .filter((metric) => metric && typeof metric.metric_id === "string")
          .map((metric) => [metric.metric_id, metric])
      : []
  );
  const subjectiveMetricResults = subjectiveMetrics.map((metric) => {
    const reviewMetric = reviewMetricById.get(metric.metric_id);
    const scoreOutOfTen = clampScore(reviewMetric?.score_out_of_ten);
    const passed = scoreOutOfTen + 0.001 >= metric.minimum_score_out_of_ten;
    const rationale =
      typeof reviewMetric?.rationale === "string" && reviewMetric.rationale.trim().length > 0
        ? reviewMetric.rationale.trim()
        : "No subjective judge rationale was available.";
    const recommendedChanges = Array.isArray(reviewMetric?.recommended_changes)
      ? reviewMetric.recommended_changes
          .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
          .map((entry) => entry.trim())
          .slice(0, 4)
      : [];

    return {
      metric_id: metric.metric_id,
      label: metric.label,
      score_out_of_ten: scoreOutOfTen,
      minimum_score_out_of_ten: metric.minimum_score_out_of_ten,
      status: passed ? "pass" : "fail",
      rationale,
      recommended_changes:
        recommendedChanges.length > 0
          ? recommendedChanges
          : ["Raise this metric until it clears the requested threshold."],
      evidence_paths: [],
      quality_axis_id: metric.quality_axis_id,
      required: metric.required ?? true
    };
  });

  const weightedSubjectiveScore =
    subjectiveMetricResults.length > 0
      ? subjectiveMetricResults.reduce(
          (sum, metricResult) =>
            sum +
            metricResult.score_out_of_ten *
              (subjectiveMetrics.find((metric) => metric.metric_id === metricResult.metric_id)?.weight ?? 1),
          0
        ) /
        Math.max(
          1,
          subjectiveMetrics.reduce((sum, metric) => sum + (metric.weight ?? 1), 0)
        )
      : undefined;
  const subjectiveAverageNormalized =
    typeof weightedSubjectiveScore === "number"
      ? roundScore(weightedSubjectiveScore / 10)
      : undefined;
  const subjectiveReviewPath =
    subjectiveMetricResults.length > 0
      ? await writeArtifactJson("subjective-quality-review.json", {
          summary:
            typeof subjectiveReview?.summary === "string" && subjectiveReview.summary.trim().length > 0
              ? subjectiveReview.summary.trim()
              : "Subjective metric review.",
          metrics: subjectiveMetricResults,
          overall_subjective_score_out_of_ten:
            typeof weightedSubjectiveScore === "number"
              ? roundScore(weightedSubjectiveScore)
              : undefined
        })
      : undefined;

  const subjectiveCriteriaResults = subjectiveMetrics.map((metric) => {
    const metricResult = subjectiveMetricResults.find(
      (candidate) => candidate.metric_id === metric.metric_id
    );
    const observed = metricResult?.score_out_of_ten ?? 0;
    const passed = observed + 0.001 >= metric.minimum_score_out_of_ten;
    return {
      criterion_id: "subjective_metric_" + metric.metric_id + "_minimum",
      status: passed ? "pass" : "fail",
      summary: passed
        ? metric.label + " scored " + observed + "/10 and cleared the requested minimum."
        : metric.label +
          " scored " +
          observed +
          "/10 and missed the requested minimum " +
          metric.minimum_score_out_of_ten +
          "/10.",
      hard: metric.required ?? true,
      threshold: metric.label + " >= " + metric.minimum_score_out_of_ten + "/10",
      observed_value: String(observed),
      evidence_paths: [
        ...(subjectiveReviewPath ? [subjectiveReviewPath] : []),
        ...checksEvidencePaths.slice(0, 1)
      ]
    };
  });

  const gradeCriteriaResults = [...checksCriteria, ...subjectiveCriteriaResults].filter(
    (criterion) =>
      gradeCriteria.some(
        (expectedCriterion) => expectedCriterion.criterion_id === criterion.criterion_id
      )
  );
  const hardFailures = gradeCriteriaResults.filter(
    (criterion) => criterion.hard && criterion.status === "fail"
  );
  const thresholdVerdict = hardFailures.length === 0 ? "pass" : "fail";
  const blockingCriterionIds = hardFailures.map((criterion) => criterion.criterion_id);
  const overallVerdict = thresholdVerdict === "pass" ? "advance" : "revise";
  const failedReleaseGateProbeIds = requiredReleaseGateProbes
    .filter((probe) => !probe.ok)
    .map((probe) => probe.probe_id);
  const releaseScore =
    subjectiveAverageNormalized === undefined
      ? deterministicReleaseScore
      : roundScore(0.7 * deterministicReleaseScore + 0.3 * subjectiveAverageNormalized);
  const reportPath = await writeArtifact(
    "grade-summary.md",
    [
      "# Round grading",
      "",
      "Profile: " + (profile.profile_id ?? "generated-bootstrap-profile"),
      "Accessibility green: " + String(Boolean(checksPass)),
      "Command check green: " + String(Boolean(commandPass)),
      "Release gate pass rate: " + String(roundScore(releaseGatePassRate)),
      "Failed release gate probes: " + (failedReleaseGateProbeIds.join(", ") || "none"),
      "Subjective metric failures: " +
        (subjectiveMetricResults
          .filter((metric) => metric.status === "fail")
          .map((metric) => metric.metric_id)
          .join(", ") || "none"),
      "Hard failed criteria: " + (blockingCriterionIds.join(", ") || "none"),
      "Deterministic release score: " + String(deterministicReleaseScore),
      "Subjective average (0-10): " +
        (typeof weightedSubjectiveScore === "number"
          ? String(roundScore(weightedSubjectiveScore))
          : "n/a"),
      "Release score: " + String(releaseScore),
      "Threshold verdict: " + thresholdVerdict,
      "Overall verdict: " + overallVerdict
    ].join("\\n")
  );

  const findings = [
    ...blockingCriterionIds.map(
      (criterionId) => "Blocking criterion failed: " + criterionId + "."
    ),
    ...subjectiveMetricResults
      .filter((metric) => metric.status === "fail")
      .map(
        (metric) =>
          metric.label +
          " scored " +
          metric.score_out_of_ten +
          "/10 against the requested minimum " +
          metric.minimum_score_out_of_ten +
          "/10."
      )
  ].slice(0, 8);

  await finalize({
    capability: "grade_round",
    ok: true,
    summary:
      thresholdVerdict === "pass"
        ? "Bootstrap verifier recommends advancing."
        : "Bootstrap verifier recommends revising.",
    findings,
    evidence_paths: [
      reportPath,
      ...(subjectiveReviewPath ? [subjectiveReviewPath] : []),
      ...checksEvidencePaths
    ],
    evidence_items: [
      {
        path: reportPath,
        kind: "report",
        description: "Bootstrap-generated grading summary.",
        derived_from_capabilities: ["run_checks"],
        derived_from_evidence_paths: checksEvidencePaths
      },
      ...(subjectiveReviewPath
        ? [
            {
              path: subjectiveReviewPath,
              kind: "json",
              description: "Subjective quality review for user-defined metrics.",
              derived_from_capabilities: ["run_checks"],
              derived_from_evidence_paths: checksEvidencePaths
            }
          ]
        : [])
    ],
    criteria_results: gradeCriteriaResults,
    score: releaseScore,
    overall_verdict: overallVerdict,
    threshold_verdict: thresholdVerdict,
    blocking_criterion_ids: blockingCriterionIds,
    subjective_metric_results: subjectiveMetricResults.map((metricResult) => ({
      ...metricResult,
      evidence_paths: [
        ...(subjectiveReviewPath ? [subjectiveReviewPath] : []),
        ...checksEvidencePaths.slice(0, 1)
      ]
    })),
    metadata: {
      release_gate_probe_count: requiredReleaseGateProbes.length,
      failed_release_gate_probe_count: failedReleaseGateProbeIds.length,
      hard_failure_count: hardFailures.length,
      subjective_metric_count: subjectiveMetrics.length,
      failed_subjective_metric_count: subjectiveMetricResults.filter(
        (metric) => metric.status === "fail"
      ).length,
      ...(typeof weightedSubjectiveScore === "number"
        ? { subjective_average_out_of_ten: roundScore(weightedSubjectiveScore) }
        : {})
    }
  });
};

main().catch(async (error) => {
  await finalize({
    capability: "grade_round",
    ok: false,
    summary: "grade_round failed.",
    findings: [error instanceof Error ? error.message : String(error)],
    evidence_paths: []
  });
  process.exitCode = 1;
});
`;

const scaffoldAdapterArtifacts = async (
  answers: BootstrapAnswers,
  paths: BootstrapArtifactPaths = defaultBootstrapPaths
): Promise<void> => {
  const runtimeConfig = {
    product_title: answers.title,
    product_summary: answers.summary,
    target_users: answers.targetUsers,
    core_features: answers.coreFeatures,
    reference_apps: answers.referenceApps,
    finish_line: answers.finishLine,
    goal_level: answers.goalLevel,
    target_score: answers.targetScore,
    max_rounds: answers.maxRounds,
    target_family: answers.targetFamily,
    target_root: answers.targetRoot,
    project_mode: answers.projectMode,
    framework_hint: answers.frameworkHint,
    package_manager: answers.packageManager,
    run_command: answers.runCommand,
    check_command: answers.checkCommand,
    ready_url: answers.readyUrl,
    ...(answers.appUrl ? { app_url: answers.appUrl } : {}),
    ...(answers.healthUrl ? { health_url: answers.healthUrl } : {}),
    ...(answers.apiBaseUrl ? { api_base_url: answers.apiBaseUrl } : {}),
    constraints: answers.constraints,
    quality_bar: answers.qualityBar,
    must_not_break: answers.mustNotBreak ?? [],
    failure_expectations: answers.failureExpectations ?? [],
    continuity_boundaries: answers.continuityBoundaries ?? [],
    reference_signals: answers.referenceSignals ?? [],
    non_goals: answers.nonGoals ?? [],
    ...(answers.probeHints ? { probe_hints: answers.probeHints } : {}),
    ...(answers.customQualityMetrics
      ? {
          custom_quality_metrics: answers.customQualityMetrics.map((metric) => ({
            metric_id: metric.metricId,
            label: metric.label,
            description: metric.description,
            minimum_score_out_of_ten: metric.minimumScoreOutOfTen,
            required: metric.required ?? true,
            weight: metric.weight ?? 1
          }))
        }
      : {}),
    notes: answers.notes ?? "",
    idea_path: paths.ideaPath
  };

  const codexRuntimeImportPath = moduleImportPath(
    paths.generatedScriptsRoot,
    join(repoRoot, "packages", "loop-orchestrator", "dist", "codex-runtime.js")
  );

  await writeJson(paths.generatedRuntimeConfigPath, runtimeConfig);
  await writeText(
    join(paths.generatedScriptsRoot, "runtime-helpers.mjs"),
    helperTemplate(codexRuntimeImportPath)
  );
  await writeText(join(paths.generatedScriptsRoot, "prepare-target.mjs"), prepareTargetTemplate());
  await writeText(join(paths.generatedScriptsRoot, "apply-change.mjs"), applyChangeTemplate());
  await writeText(join(paths.generatedScriptsRoot, "run-target.mjs"), runTargetTemplate());
  await writeText(join(paths.generatedScriptsRoot, "capture-evidence.mjs"), captureEvidenceTemplate());
  await writeText(join(paths.generatedScriptsRoot, "run-checks.mjs"), runChecksTemplate());
  await writeText(join(paths.generatedScriptsRoot, "grade-round.mjs"), gradeRoundTemplate());

  const adapterId = `generated-${slugify(answers.title)}-adapter`;
  await writeJson(paths.adapterPath, {
    adapter_id: adapterId,
    label: `${answers.title} Generated Adapter`,
    contract_version: "1",
    target_root: answers.targetRoot,
    capabilities: {
      prepare_target: {
        command: `node ${paths.generatedAdapterRelativePath}/scripts/prepare-target.mjs`,
        cwd: "."
      },
      apply_change: {
        command: `node ${paths.generatedAdapterRelativePath}/scripts/apply-change.mjs`,
        cwd: "."
      },
      run_target: {
        command: `node ${paths.generatedAdapterRelativePath}/scripts/run-target.mjs`,
        cwd: "."
      }
    },
    verification_provider: {
      provider_id: `${adapterId}-verifier`,
      capabilities: {
        capture_evidence: {
          command: `node ${paths.generatedAdapterRelativePath}/scripts/capture-evidence.mjs`,
          cwd: "."
        },
        run_checks: {
          command: `node ${paths.generatedAdapterRelativePath}/scripts/run-checks.mjs`,
          cwd: "."
        },
        grade_round: {
          command: `node ${paths.generatedAdapterRelativePath}/scripts/grade-round.mjs`,
          cwd: "."
        }
      }
    },
    notes: [
      "Generated by interactive bootstrap.",
      "This adapter is opinionated toward Codex-driven target mutation and generic HTTP-based verification.",
      "If the target needs richer runtime or QA behavior, edit the generated scripts under .generated/codex-adapter/scripts."
    ]
  });
};

export const scaffoldBootstrapArtifacts = async (
  answers: BootstrapAnswers,
  paths: BootstrapArtifactPaths = defaultBootstrapPaths
): Promise<BootstrapResult> => {
  const [generatedProfile, generatedRubric] = await Promise.all([
    buildGeneratedVerificationProfile(answers),
    buildGeneratedRubric(answers)
  ]);

  await writeText(paths.ideaPath, writeIdeaMarkdown(answers));
  await writeJson(paths.intakePath, {
    product_title: answers.title,
    product_summary: answers.summary,
    target_users: answers.targetUsers,
    core_features: answers.coreFeatures,
    reference_apps: answers.referenceApps,
    finish_line: answers.finishLine,
    goal_level: answers.goalLevel,
    target_score: answers.targetScore,
    max_rounds: answers.maxRounds,
    target_family: answers.targetFamily,
    target_root: answers.targetRoot,
    project_mode: answers.projectMode,
    framework_hint: answers.frameworkHint,
    package_manager: answers.packageManager,
    run_command: answers.runCommand,
    check_command: answers.checkCommand,
    ready_url: answers.readyUrl,
    ...(answers.appUrl ? { app_url: answers.appUrl } : {}),
    ...(answers.healthUrl ? { health_url: answers.healthUrl } : {}),
    ...(answers.apiBaseUrl ? { api_base_url: answers.apiBaseUrl } : {}),
    constraints: answers.constraints,
    quality_bar: answers.qualityBar,
    must_not_break: answers.mustNotBreak ?? [],
    failure_expectations: answers.failureExpectations ?? [],
    continuity_boundaries: answers.continuityBoundaries ?? [],
    reference_signals: answers.referenceSignals ?? [],
    non_goals: answers.nonGoals ?? [],
    ...(answers.probeHints ? { probe_hints: answers.probeHints } : {}),
    ...(answers.customQualityMetrics
      ? {
          custom_quality_metrics: answers.customQualityMetrics.map((metric) => ({
            metric_id: metric.metricId,
            label: metric.label,
            description: metric.description,
            minimum_score_out_of_ten: metric.minimumScoreOutOfTen,
            required: metric.required ?? true,
            weight: metric.weight ?? 1
          }))
        }
      : {}),
    ...(answers.notes ? { notes: answers.notes } : {})
  });
  await writeJson(paths.generatedVerificationProfilePath, generatedProfile);
  await writeJson(paths.generatedRubricPath, generatedRubric);
  await scaffoldAdapterArtifacts(answers, paths);

  return {
    adapterPath: paths.adapterPath,
    rubricPath: paths.generatedRubricPath,
    evaluatorProfilePath: paths.generatedVerificationProfilePath,
    targetFamily: answers.targetFamily,
    targetScore: answers.targetScore,
    maxRounds: answers.maxRounds,
    ideaPath: paths.ideaPath,
    intakePath: paths.intakePath
  };
};

const collectAnswers = async (): Promise<BootstrapAnswers> => {
  const rl = createInterface({ input, output });

  try {
    while (true) {
      output.write("\nProduct intake\n");
      const title = await askRequired(rl, "What do you want to build?");
      const summary = await askRequired(
        rl,
        "Describe the product in one or two concrete sentences"
      );
      const targetUsers = await askList(
        rl,
        "Who is this for? (comma-separated)",
        ["founder", "operator"]
      );
      const coreFeatures = await askList(
        rl,
        "What are the core workflows for v1? (comma-separated)",
        ["primary workflow", "basic persistence"]
      );
      const referenceApps = await askOptionalList(
        rl,
        "Any reference products, screens, or visual directions? (optional)"
      );
      const finishLine = await askRequired(
        rl,
        "For the first version, what counts as success?"
      );
      output.write("\nQuality intake\n");
      const mustNotBreak = await askOptionalList(
        rl,
        "Which experiences must never break? (optional, comma-separated)",
        ["draft should survive reload"]
      );
      const failureExpectations = await askOptionalList(
        rl,
        "When the user hits a bad or invalid state, what should they see or be able to do? (optional, comma-separated)",
        ["show an explicit error message", "offer a retry or recovery path"]
      );
      const continuityBoundaries = await askOptionalList(
        rl,
        "Which boundaries must preserve state? (optional, comma-separated: reload, retry, refresh, reopen)",
        ["reload"]
      );
      const referenceSignals = await askOptionalList(
        rl,
        "What exactly should feel like the reference? (optional, comma-separated)",
        ["clear hierarchy", "calm density", "fast transitions"]
      );
      const nonGoals = await askOptionalList(
        rl,
        "What is explicitly out of scope or forbidden? (optional, comma-separated)",
        ["do not add a settings area"]
      );
      const customQualityMetrics = await askCustomQualityMetrics(rl);

      const targetFamily = inferProductTargetFamily(
        buildProductInferenceText({
          title,
          summary,
          targetUsers,
          coreFeatures,
          referenceApps,
          finishLine
        })
      );

      output.write("\nExecution intake\n");
      const projectMode = await askProjectMode(rl);
      const targetRoot = resolveUserPath(
        await askRequired(
          rl,
          "Where should the working project live?",
          defaultRootForTitle(title)
        ),
        defaultRootForTitle(title)
      );
      const goalLevel = await askGoalLevel(rl, "usable");
      const targetScore = await askTargetScore(
        rl,
        goalLevel === "custom" ? goalPresets.usable : goalPresets[goalLevel]
      );
      const maxRounds = await askMaxRounds(rl, 3);

      const frameworkHint = defaultFrameworkHintForFamily(targetFamily);
      const defaultRunCommand =
        projectMode === "existing" && isApiOnlyFamily(targetFamily)
          ? "npm run start"
          : "npm run dev";
      const runCommand =
        projectMode === "existing"
          ? await askRequired(
              rl,
              "What command should the harness use to start the existing target?",
              defaultRunCommand
            )
          : defaultRunCommand;
      const packageManager = inferPackageManagerFromCommand(runCommand);
      const defaultCheckCommand = packageManager === "pnpm" ? "pnpm test" : "npm test";
      const checkCommand =
        projectMode === "existing"
          ? await askText(
              rl,
              "What command should the harness use for checks? Leave blank if optional.",
              defaultCheckCommand
            )
          : "";
      const readyUrl =
        projectMode === "existing"
          ? await askRequired(
              rl,
              "Which URL should the harness wait for after starting the target?",
              defaultReadyUrlForFamily(targetFamily)
            )
          : defaultReadyUrlForFamily(targetFamily);
      const appUrl =
        projectMode === "existing"
          ? await askText(
              rl,
              "App URL (leave blank if not relevant)",
              defaultAppUrlForFamily(targetFamily)
            )
          : defaultAppUrlForFamily(targetFamily) ?? "";
      const healthUrl =
        projectMode === "existing"
          ? await askText(
              rl,
              "Health URL (leave blank if not relevant)",
              defaultHealthUrlForFamily(targetFamily)
            )
          : defaultHealthUrlForFamily(targetFamily) ?? "";
      const apiBaseUrl =
        projectMode === "existing"
          ? await askText(
              rl,
              "API base URL (leave blank if not relevant)",
              defaultApiBaseUrlForFamily(targetFamily)
            )
          : defaultApiBaseUrlForFamily(targetFamily) ?? "";
      const probeHints =
        projectMode === "existing" ? await askProbeHints(rl, targetFamily) : undefined;

      const customMetricBar = customQualityMetrics.map(
        (metric) =>
          `${metric.label} must score at least ${metric.minimumScoreOutOfTen}/10`
      );
      const constraints = uniqueList(nonGoals);
      const notes = "";
      const qualityBar = uniqueList([
        finishLine,
        ...mustNotBreak,
        ...failureExpectations,
        ...referenceSignals,
        ...customMetricBar
      ]);

      const answers: BootstrapAnswers = {
        title,
        summary,
        targetUsers,
        coreFeatures,
        referenceApps,
        finishLine,
        targetFamily,
        goalLevel,
        targetScore,
        maxRounds,
        targetRoot,
        projectMode,
        frameworkHint,
        packageManager,
        runCommand,
        checkCommand,
        readyUrl,
        ...(appUrl ? { appUrl } : {}),
        ...(healthUrl ? { healthUrl } : {}),
        ...(apiBaseUrl ? { apiBaseUrl } : {}),
        constraints,
        qualityBar,
        ...(mustNotBreak.length > 0 ? { mustNotBreak } : {}),
        ...(failureExpectations.length > 0 ? { failureExpectations } : {}),
        ...(continuityBoundaries.length > 0 ? { continuityBoundaries } : {}),
        ...(referenceSignals.length > 0 ? { referenceSignals } : {}),
        ...(nonGoals.length > 0 ? { nonGoals } : {}),
        ...(probeHints ? { probeHints } : {}),
        ...(customQualityMetrics.length > 0 ? { customQualityMetrics } : {}),
        ...(notes ? { notes } : {})
      };

      if (await confirmAnswers(rl, answers)) {
        return answers;
      }
    }
  } finally {
    rl.close();
  }
};

export const runInteractiveBootstrap = async (): Promise<BootstrapResult> => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive bootstrap requires a TTY.");
  }

  const answers = await collectAnswers();
  return scaffoldBootstrapArtifacts(answers, defaultBootstrapPaths);
};
