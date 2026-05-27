import { stdin as input, stdout as output } from "node:process";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import { scaffoldAdapterArtifacts } from "./bootstrap/generated-adapter.js";
import { createBootstrapArtifactPaths } from "./bootstrap/paths.js";
import {
  alignWorkflowChecksToCoreFeatures,
  adapterPlanMarkdown,
  buildAdapterPlanFromIntake,
  defaultVerificationSurfacesForFamily,
  defaultWorkflowChecksFromCoreFeatures,
  normalizeVerificationSurfacesForFamily
} from "./adapter-plan.js";
import {
  scaffoldDurableMemoryArtifacts,
  type DurableMemoryContext
} from "./durable-memory.js";
import { loadJson, repoRoot, writeJson, writeText } from "./file-system.js";
import { inferProductTargetFamily } from "./intake-gate.js";
import type {
  SessionAdapterPlan,
  SessionWorkflowCheck,
  VerificationSurface
} from "./intake-schema.js";
import { resolveTargetFamilySelection } from "./profile-selection.js";
import type {
  LoopRubric,
  TargetSurface,
  TargetFamily as SupportedTargetFamily,
  VerificationAssertionTag,
  VerificationCoreProbe,
  VerificationProfile
} from "./types.js";

export { createBootstrapArtifactPaths } from "./bootstrap/paths.js";

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

export type BootstrapVerificationSurface = VerificationSurface;

export type BootstrapWorkflowCheck = {
  workflow: string;
  surface: BootstrapVerificationSurface;
  trigger?: string;
  expectedResult: string;
  selectorHints?: {
    root?: string;
    action?: string;
    result?: string;
  };
  apiHint?: {
    method?: string;
    path?: string;
    expectedStatus?: number;
    expectedJsonPath?: string;
    expectedValue?: string;
  };
  commandHint?: {
    command?: string;
    expectedOutput?: string;
  };
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
  verificationSurfaces: BootstrapVerificationSurface[];
  workflowChecks: BootstrapWorkflowCheck[];
  adapterPlan: SessionAdapterPlan;
};

export type BootstrapSeed = {
  title: string;
  summary: string;
  targetUsers?: string[];
  coreFeatures?: string[];
  referenceApps?: string[];
  finishLine?: string;
  targetFamily: BootstrapTargetFamily;
  goalLevel?: GoalLevel;
  targetScore?: number;
  maxRounds?: number;
  targetRoot?: string;
  projectMode?: "new" | "existing";
  frameworkHint?: string;
  packageManager?: string;
  runCommand?: string;
  checkCommand?: string;
  readyUrl?: string;
  appUrl?: string;
  healthUrl?: string;
  apiBaseUrl?: string;
  constraints?: string[];
  qualityBar?: string[];
  notes?: string;
  mustNotBreak?: string[];
  failureExpectations?: string[];
  continuityBoundaries?: string[];
  referenceSignals?: string[];
  nonGoals?: string[];
  probeHints?: BootstrapProbeHints;
  customQualityMetrics?: BootstrapCustomQualityMetric[];
  verificationSurfaces?: BootstrapVerificationSurface[];
  workflowChecks?: BootstrapWorkflowCheck[];
  adapterPlan?: SessionAdapterPlan;
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
  featureListPath: string;
  progressPath: string;
  progressLogPath: string;
  doneWhenPath: string;
  initScriptPath: string;
  adapterPlanPath: string;
  adapterPlanMarkdownPath: string;
  adapterReviewTaskPath: string;
  adapterReviewResponsePath: string;
};

export type BootstrapArtifactPaths = {
  rootDirectory: string;
  ideaPath: string;
  intakePath: string;
  featureListPath: string;
  progressPath: string;
  progressLogPath: string;
  doneWhenPath: string;
  initScriptPath: string;
  adapterPath: string;
  adapterPlanPath: string;
  adapterPlanMarkdownPath: string;
  adapterReviewTaskPath: string;
  adapterReviewResponsePath: string;
  generatedRubricPath: string;
  generatedVerificationProfilePath: string;
  generatedAdapterRoot: string;
  generatedScriptsRoot: string;
  generatedRuntimeConfigPath: string;
  generatedAdapterRelativePath: string;
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
  "7. chat-agent (tool-using or grounded chat API)",
  "8. cli-tool (command-line tool with stdout/file proof)",
  "9. command-artifact (non-web command, package, pipeline, document, or automation proof)"
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

const slugifyAscii = (value: string): string =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

const slugify = (value: string): string =>
  slugifyAscii(value) || "generated-app";

const slugForIndexedFeature = (value: string, index: number): string =>
  slugifyAscii(value) || `feature-${index + 1}`;

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

export const normalizeBootstrapTargetFamily = (
  targetFamily: SupportedTargetFamily | undefined
): BootstrapTargetFamily | undefined => {
  if (!targetFamily || targetFamily === "generic-core") {
    return undefined;
  }
  if (targetFamily === "editor-app") {
    return "browser-editor";
  }
  return targetFamily;
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
  if (normalized === "8" || normalized === "cli-tool" || normalized === "cli") {
    return "cli-tool";
  }
  if (
    normalized === "9" ||
    normalized === "command-artifact" ||
    normalized === "command"
  ) {
    return "command-artifact";
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

const isCommandOnlyFamily = (targetFamily: BootstrapTargetFamily): boolean =>
  targetFamily === "cli-tool" || targetFamily === "command-artifact";

const defaultFrameworkHintForFamily = (
  targetFamily: BootstrapTargetFamily,
  projectMode: BootstrapAnswers["projectMode"] = "existing"
): string => {
  if (targetFamily === "cli-tool") {
    return projectMode === "new"
      ? "dependency-light Node.js CLI using built-in modules where possible"
      : "Node.js CLI";
  }
  if (targetFamily === "command-artifact") {
    return projectMode === "new"
      ? "dependency-light command-first Node.js package or script with file/test evidence"
      : "command-first package or script";
  }

  if (projectMode === "new") {
    if (
      targetFamily === "browser-app" ||
      targetFamily === "browser-editor" ||
      targetFamily === "dashboard"
    ) {
      return "dependency-light static HTML/CSS/JS served by a Node.js built-in HTTP server; use external frameworks only if explicitly requested";
    }
    if (targetFamily === "fullstack-app") {
      return "dependency-light Node.js built-in HTTP server with static frontend and JSON API; use external frameworks only if explicitly requested";
    }
    if (
      targetFamily === "api-service" ||
      targetFamily === "crud-api" ||
      targetFamily === "chat-agent"
    ) {
      return "dependency-light Node.js API using built-in modules";
    }
  }

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
  if (isCommandOnlyFamily(targetFamily)) {
    return "";
  }
  if (isApiOnlyFamily(targetFamily)) {
    return "http://127.0.0.1:3000/health";
  }

  return "http://127.0.0.1:3000/";
};

const defaultAppUrlForFamily = (
  targetFamily: BootstrapTargetFamily
): string | undefined =>
  isApiOnlyFamily(targetFamily) || isCommandOnlyFamily(targetFamily)
    ? undefined
    : "http://127.0.0.1:3000/";

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

const surfacesNeedBrowserRuntime = (
  surfaces: readonly BootstrapVerificationSurface[] | undefined
): boolean =>
  Boolean(
    surfaces?.some((surface) => surface === "browser" || surface === "screenshot")
  );

const surfacesNeedApiRuntime = (
  surfaces: readonly BootstrapVerificationSurface[] | undefined
): boolean => Boolean(surfaces?.includes("api"));

const surfacesNeedUrlRuntime = (
  surfaces: readonly BootstrapVerificationSurface[] | undefined
): boolean =>
  surfaces === undefined || surfaces.length === 0
    ? true
    : surfacesNeedBrowserRuntime(surfaces) || surfacesNeedApiRuntime(surfaces);

const toSessionWorkflowCheck = (
  check: BootstrapWorkflowCheck
): SessionWorkflowCheck => ({
  workflow: check.workflow,
  surface: check.surface,
  ...(check.trigger ? { trigger: check.trigger } : {}),
  expected_result: check.expectedResult,
  ...(check.selectorHints ? { selector_hints: check.selectorHints } : {}),
  ...(check.apiHint
    ? {
        api_hint: {
          ...(check.apiHint.method
            ? {
                method:
                  check.apiHint.method as NonNullable<
                    SessionWorkflowCheck["api_hint"]
                  >["method"]
              }
            : {}),
          ...(check.apiHint.path ? { path: check.apiHint.path } : {}),
          ...(check.apiHint.expectedStatus !== undefined
            ? { expected_status: check.apiHint.expectedStatus }
            : {}),
          ...(check.apiHint.expectedJsonPath
            ? { expected_json_path: check.apiHint.expectedJsonPath }
            : {}),
          ...(check.apiHint.expectedValue
            ? { expected_value: check.apiHint.expectedValue }
            : {})
        }
      }
    : {}),
  ...(check.commandHint
    ? {
        command_hint: {
          ...(check.commandHint.command ? { command: check.commandHint.command } : {}),
          ...(check.commandHint.expectedOutput
            ? { expected_output: check.commandHint.expectedOutput }
            : {})
        }
      }
    : {})
});

const toBootstrapWorkflowCheck = (
  check: SessionWorkflowCheck
): BootstrapWorkflowCheck => ({
  workflow: check.workflow,
  surface: check.surface,
  ...(check.trigger ? { trigger: check.trigger } : {}),
  expectedResult: check.expected_result,
  ...(check.selector_hints ? { selectorHints: check.selector_hints } : {}),
  ...(check.api_hint
    ? {
        apiHint: {
          ...(check.api_hint.method ? { method: check.api_hint.method } : {}),
          ...(check.api_hint.path ? { path: check.api_hint.path } : {}),
          ...(check.api_hint.expected_status !== undefined
            ? { expectedStatus: check.api_hint.expected_status }
            : {}),
          ...(check.api_hint.expected_json_path
            ? { expectedJsonPath: check.api_hint.expected_json_path }
            : {}),
          ...(check.api_hint.expected_value
            ? { expectedValue: check.api_hint.expected_value }
            : {})
        }
      }
    : {}),
  ...(check.command_hint
    ? {
        commandHint: {
          ...(check.command_hint.command ? { command: check.command_hint.command } : {}),
          ...(check.command_hint.expected_output
            ? { expectedOutput: check.command_hint.expected_output }
            : {})
        }
      }
    : {})
});

export const buildBootstrapAnswersFromSeed = (
  seed: BootstrapSeed
): BootstrapAnswers => {
  const normalizedTitle = seed.title.trim() || "Untitled Product";
  const targetScore = seed.targetScore ?? goalPresets.usable;
  const goalLevel = seed.goalLevel ?? inferGoalLevelFromTargetScore(targetScore);
  const maxRounds = seed.maxRounds ?? 3;
  const projectMode = seed.projectMode ?? "existing";
  const targetRoot = resolveUserPath(
    seed.targetRoot ?? "",
    defaultRootForTitle(normalizedTitle)
  );
  const seedVerificationSurfaces =
    seed.verificationSurfaces?.length
      ? seed.verificationSurfaces
      : seed.adapterPlan?.verification_surfaces;
  const needsUrlRuntime = surfacesNeedUrlRuntime(seedVerificationSurfaces);
  const runCommand =
    seed.runCommand?.trim() ||
    defaultRunCommandForBootstrap(seed.targetFamily, projectMode);
  const packageManager =
    seed.packageManager?.trim() || inferPackageManagerFromCommand(runCommand);
  const checkCommand =
    seed.checkCommand?.trim() ||
    (packageManager === "pnpm" ? "pnpm test" : "npm test");
  const frameworkHint =
    seed.frameworkHint?.trim() ||
    defaultFrameworkHintForFamily(seed.targetFamily, projectMode);
  const appUrl =
    seed.appUrl?.trim() ||
    (surfacesNeedBrowserRuntime(seedVerificationSurfaces)
      ? defaultAppUrlForFamily(seed.targetFamily)
      : undefined);
  const healthUrl =
    seed.healthUrl?.trim() ||
    (surfacesNeedApiRuntime(seedVerificationSurfaces)
      ? defaultHealthUrlForFamily(seed.targetFamily)
      : undefined);
  const apiBaseUrl =
    seed.apiBaseUrl?.trim() ||
    (surfacesNeedApiRuntime(seedVerificationSurfaces)
      ? defaultApiBaseUrlForFamily(seed.targetFamily)
      : undefined);
  const readyUrl =
    seed.readyUrl?.trim() ||
    (needsUrlRuntime
      ? appUrl || healthUrl || defaultReadyUrlForFamily(seed.targetFamily)
      : "");
  const qualityBar = uniqueList(
    (seed.qualityBar ?? []).filter((entry) => entry.trim().length > 0)
  );
  const finishLine =
    seed.finishLine?.trim() ||
    qualityBar[0] ||
    `${normalizedTitle} meets the requested finish line.`;
  const probeHints = nonEmptyProbeHints(seed.probeHints);
  const verificationSurfaces = normalizeVerificationSurfacesForFamily(
    seed.targetFamily,
    seed.verificationSurfaces
  ) as BootstrapVerificationSurface[];
  const coreFeatures = uniqueList(seed.coreFeatures ?? []);
  const rawWorkflowChecks =
    seed.workflowChecks?.length
      ? seed.workflowChecks
      : defaultWorkflowChecksFromCoreFeatures(
          coreFeatures,
          verificationSurfaces
        ).map(toBootstrapWorkflowCheck);
  const workflowChecks =
    !seed.workflowChecks?.length && coreFeatures.length > 0
      ? alignWorkflowChecksToCoreFeatures(
          coreFeatures,
          rawWorkflowChecks.map(toSessionWorkflowCheck),
          verificationSurfaces
        ).map(toBootstrapWorkflowCheck)
      : rawWorkflowChecks;
  const adapterPlan = buildAdapterPlanFromIntake({
    targetFamily: seed.targetFamily,
    intake: {
      product_title: normalizedTitle,
      product_summary: seed.summary.trim() || finishLine,
      target_users: uniqueList(seed.targetUsers ?? []),
      core_features: coreFeatures,
      reference_apps: uniqueList(seed.referenceApps ?? []),
      finish_line: finishLine,
      target_family: seed.targetFamily,
      target_root: targetRoot,
      project_mode: projectMode,
      framework_hint: frameworkHint,
      package_manager: packageManager,
      run_command: runCommand,
      check_command: checkCommand,
      ...(readyUrl ? { ready_url: readyUrl } : {}),
      ...(appUrl ? { app_url: appUrl } : {}),
      ...(healthUrl ? { health_url: healthUrl } : {}),
      ...(apiBaseUrl ? { api_base_url: apiBaseUrl } : {}),
      verification_surfaces: verificationSurfaces,
      workflow_checks: workflowChecks.map(toSessionWorkflowCheck),
      ...(seed.adapterPlan ? { adapter_plan: seed.adapterPlan } : {})
    }
  });

  return {
    title: normalizedTitle,
    summary: seed.summary.trim() || finishLine,
    targetUsers: uniqueList(seed.targetUsers ?? []),
    coreFeatures,
    referenceApps: uniqueList(seed.referenceApps ?? []),
    finishLine,
    targetFamily: seed.targetFamily,
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
    constraints: uniqueList(seed.constraints ?? []),
    qualityBar,
    ...(seed.notes?.trim() ? { notes: seed.notes.trim() } : {}),
    ...(seed.mustNotBreak?.length ? { mustNotBreak: uniqueList(seed.mustNotBreak) } : {}),
    ...(seed.failureExpectations?.length
      ? { failureExpectations: uniqueList(seed.failureExpectations) }
      : {}),
    ...(seed.continuityBoundaries?.length
      ? { continuityBoundaries: uniqueList(seed.continuityBoundaries) }
      : {}),
    ...(seed.referenceSignals?.length
      ? { referenceSignals: uniqueList(seed.referenceSignals) }
      : {}),
    ...(seed.nonGoals?.length ? { nonGoals: uniqueList(seed.nonGoals) } : {}),
    ...(probeHints ? { probeHints } : {}),
    ...(seed.customQualityMetrics?.length
      ? {
          customQualityMetrics: seed.customQualityMetrics.map((metric) => ({
            metricId: metric.metricId,
            label: metric.label,
            description: metric.description,
            minimumScoreOutOfTen: metric.minimumScoreOutOfTen,
            ...(metric.required !== undefined ? { required: metric.required } : {}),
            ...(metric.weight !== undefined ? { weight: metric.weight } : {})
          }))
        }
      : {}),
    verificationSurfaces,
    workflowChecks,
    adapterPlan
  };
};

const completeBootstrapAnswers = (answers: BootstrapAnswers): BootstrapAnswers => {
  const verificationSurfaces = normalizeVerificationSurfacesForFamily(
    answers.targetFamily,
    answers.verificationSurfaces
  ) as BootstrapVerificationSurface[];
  const rawWorkflowChecks =
    answers.workflowChecks?.length
      ? answers.workflowChecks
      : defaultWorkflowChecksFromCoreFeatures(
          answers.coreFeatures,
          verificationSurfaces
        ).map(toBootstrapWorkflowCheck);
  const workflowChecks =
    !answers.workflowChecks?.length && answers.coreFeatures.length > 0
      ? alignWorkflowChecksToCoreFeatures(
          answers.coreFeatures,
          rawWorkflowChecks.map(toSessionWorkflowCheck),
          verificationSurfaces
        ).map(toBootstrapWorkflowCheck)
      : rawWorkflowChecks;
  const adapterPlan = buildAdapterPlanFromIntake({
    targetFamily: answers.targetFamily,
    intake: {
      product_title: answers.title,
      product_summary: answers.summary,
      target_users: answers.targetUsers,
      core_features: answers.coreFeatures,
      reference_apps: answers.referenceApps,
      finish_line: answers.finishLine,
      target_family: answers.targetFamily,
      target_root: answers.targetRoot,
      project_mode: answers.projectMode,
      framework_hint: answers.frameworkHint,
      package_manager: answers.packageManager,
      run_command: answers.runCommand,
      check_command: answers.checkCommand,
      ...(answers.readyUrl ? { ready_url: answers.readyUrl } : {}),
      ...(answers.appUrl ? { app_url: answers.appUrl } : {}),
      ...(answers.healthUrl ? { health_url: answers.healthUrl } : {}),
      ...(answers.apiBaseUrl ? { api_base_url: answers.apiBaseUrl } : {}),
      verification_surfaces: verificationSurfaces,
      workflow_checks: workflowChecks.map(toSessionWorkflowCheck),
      ...(answers.adapterPlan?.notes?.length
        ? { adapter_plan: { ...answers.adapterPlan, notes: answers.adapterPlan.notes } }
        : {})
    }
  });

  return {
    ...answers,
    verificationSurfaces,
    workflowChecks,
    adapterPlan
  };
};

const defaultStrictPortBrowserRunCommand =
  "npm run dev -- --host 127.0.0.1 --port 3000 --strictPort";

export const defaultRunCommandForBootstrap = (
  targetFamily: BootstrapTargetFamily,
  projectMode: BootstrapAnswers["projectMode"]
): string => {
  if (targetFamily === "cli-tool") {
    return "npm run start -- --help";
  }
  if (targetFamily === "command-artifact") {
    return projectMode === "existing" ? "npm test" : "npm run start";
  }

  if (
    targetFamily === "browser-app" ||
    targetFamily === "browser-editor" ||
    targetFamily === "dashboard"
  ) {
    return defaultStrictPortBrowserRunCommand;
  }

  if (projectMode === "existing" && isApiOnlyFamily(targetFamily)) {
    return "npm run start";
  }

  return "npm run dev";
};

const browserBackedFamily = (targetFamily: BootstrapTargetFamily): boolean =>
  targetFamily === "browser-app" ||
  targetFamily === "browser-editor" ||
  targetFamily === "fullstack-app" ||
  targetFamily === "dashboard";

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
    ...(apiBackedFamily(targetFamily) ? ["api"] : []),
    ...(isCommandOnlyFamily(targetFamily) ? ["shell"] : [])
  ]) as NonNullable<VerificationProfile["required_live_verification_modes"]>;

const verificationSurfaceSetFor = (answers: BootstrapAnswers): Set<VerificationSurface> =>
  new Set(
    answers.verificationSurfaces.length > 0
      ? answers.verificationSurfaces
      : defaultVerificationSurfacesForFamily(answers.targetFamily)
  );

const browserSurfaceRequested = (answers: BootstrapAnswers): boolean =>
  verificationSurfaceSetFor(answers).has("browser");

const apiSurfaceRequested = (answers: BootstrapAnswers): boolean =>
  verificationSurfaceSetFor(answers).has("api");

const targetSurfacesForAnswers = (answers: BootstrapAnswers): TargetSurface[] =>
  uniqueList([
    ...(browserSurfaceRequested(answers) ? ["browser"] : []),
    ...(apiSurfaceRequested(answers) ? ["api"] : [])
  ]) as TargetSurface[];

const liveVerificationModesForAnswers = (
  answers: BootstrapAnswers
): NonNullable<VerificationProfile["required_live_verification_modes"]> =>
  uniqueList([
    ...(browserSurfaceRequested(answers) ? ["browser"] : []),
    ...(apiSurfaceRequested(answers) ? ["api"] : []),
    ...(isCommandOnlyFamily(answers.targetFamily) ||
    verificationSurfaceSetFor(answers).has("test") ||
    verificationSurfaceSetFor(answers).has("cli")
      ? ["shell"]
      : [])
  ]) as NonNullable<VerificationProfile["required_live_verification_modes"]>;

const productIntentText = (answers: BootstrapAnswers): string =>
  [
    answers.title,
    answers.summary,
    answers.finishLine,
    ...answers.coreFeatures,
    ...answers.qualityBar,
    ...(answers.mustNotBreak ?? []),
    ...(answers.failureExpectations ?? []),
    ...(answers.continuityBoundaries ?? []),
    ...(answers.referenceSignals ?? []),
    answers.notes ?? ""
  ]
    .join(" ")
    .toLowerCase();

const shouldProbeContinuity = (answers: BootstrapAnswers): boolean => {
  const continuityBoundaries = new Set(
    (answers.continuityBoundaries ?? []).map((boundary) => boundary.toLowerCase())
  );
  if (
    continuityBoundaries.has("reload") ||
    continuityBoundaries.has("refresh") ||
    continuityBoundaries.has("reopen")
  ) {
    return true;
  }

  return /저장|복원|새로고침|리로드|유지|초안|드래프트|임시저장|autosave|draft|persist|persistence|restore|reload|refresh|reopen|local storage|session storage|state continuity/.test(
    productIntentText(answers)
  );
};

const shouldProbeErrorRecovery = (answers: BootstrapAnswers): boolean => {
  if ((answers.failureExpectations ?? []).length > 0) {
    return true;
  }

  return /오류|에러|검증|실패|거부|잘못된|invalid|validation|reject|recovery|error path|failure/.test(
    productIntentText(answers)
  );
};

const probeAllowedForSurfaces = (
  probe: VerificationCoreProbe,
  surfaces: ReadonlySet<VerificationSurface>
): boolean => {
  const tags = new Set(probe.assertion_tags ?? []);
  if (probe.target_manifest_key === "api_base_url" || probe.mode === "http_json") {
    return surfaces.has("api");
  }
  if (tags.has("api")) {
    return surfaces.has("api");
  }
  if (probe.mode === "browser_journey" || probe.mode === "browser" || tags.has("browser")) {
    return surfaces.has("browser");
  }
  if (probe.mode === "shell_command") {
    return surfaces.has("test") || surfaces.has("cli");
  }
  return true;
};

const probeAllowedForProductIntent = (
  probe: VerificationCoreProbe,
  answers: BootstrapAnswers
): boolean => {
  const tags = new Set(probe.assertion_tags ?? []);
  if ((tags.has("persistence") || tags.has("consistency")) && !shouldProbeContinuity(answers)) {
    return false;
  }
  if (tags.has("error_path") && !shouldProbeErrorRecovery(answers)) {
    return false;
  }
  return true;
};

const filterCriteriaForActiveProbes = (
  criteria: readonly NonNullable<VerificationProfile["criteria"]>[number][] | undefined,
  probes: readonly VerificationCoreProbe[]
): VerificationProfile["criteria"] => {
  const activeAssertionIds = new Set(
    probes
      .map((probe) => probe.assertion_id)
      .filter((assertionId): assertionId is string => Boolean(assertionId))
  );

  return (criteria ?? []).filter((criterion) => {
    if (
      criterion.criterion_id === "target_accessible" ||
      criterion.criterion_id === "command_checks"
    ) {
      return true;
    }
    if (!criterion.assertion_id) {
      return true;
    }
    return activeAssertionIds.has(criterion.assertion_id);
  });
};

const filterVerificationProfileForAnswers = (
  profile: VerificationProfile,
  answers: BootstrapAnswers
): VerificationProfile => {
  const surfaces = verificationSurfaceSetFor(answers);
  const coreProbes = (profile.core_probes ?? []).filter(
    (probe) =>
      probeAllowedForSurfaces(probe, surfaces) &&
      probeAllowedForProductIntent(probe, answers)
  );

  return {
    ...profile,
    expected_target_surfaces: targetSurfacesForAnswers(answers),
    required_live_verification_modes: liveVerificationModesForAnswers(answers),
    core_probes: coreProbes,
    criteria: filterCriteriaForActiveProbes(profile.criteria, coreProbes),
    minimum_assertion_tag_counts: minimumAssertionTagCountsForGeneratedProbes(coreProbes),
    minimum_feature_release_assertions: Math.max(
      coreProbes.filter((probe) => (probe.role ?? "supporting") === "release_gate")
        .length,
      1
    )
  };
};

const buildGeneratedQualityAxes = (
  answers: BootstrapAnswers
): NonNullable<VerificationProfile["quality_contract"]>["quality_axes"] => {
  const workflowNames =
    (answers.workflowChecks ?? []).length > 0
      ? answers.workflowChecks.map((check) => check.workflow).slice(0, 5)
      : answers.coreFeatures.slice(0, 3);
  const featureAxes = workflowNames.map((feature, index) => {
    const featureSlug = slugForIndexedFeature(feature, index);
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
    ...(shouldProbeErrorRecovery(answers)
      ? [
          {
            axis_id: "error_recovery",
            label: "Error Recovery",
            description: "Invalid flows should fail with a visible, explicit recovery state.",
            desired_outcome:
              "Invalid flows should surface a clear recovery affordance instead of silently breaking.",
            preserve_signals: topPreserveSignals(answers, 4),
            reference_signals: topReferenceSignals(answers, 4)
          }
        ]
      : []),
    ...(shouldProbeContinuity(answers)
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

const defaultSubjectiveFloorFor = (targetScore: number): number => {
  if (targetScore >= 0.95) {
    return 9;
  }
  if (targetScore >= 0.9) {
    return 8.5;
  }
  if (targetScore >= 0.85) {
    return 8;
  }
  return 7.2;
};

const defaultSubjectiveMetricsFor = (
  answers: BootstrapAnswers
): NonNullable<VerificationProfile["subjective_metrics"]> => {
  if (!browserBackedFamily(answers.targetFamily)) {
    return [];
  }

  const floor = defaultSubjectiveFloorFor(answers.targetScore);
  const hasReferenceDirection =
    answers.referenceApps.length > 0 ||
    answers.qualityBar.length > 0 ||
    (answers.referenceSignals?.length ?? 0) > 0;
  const metrics: NonNullable<VerificationProfile["subjective_metrics"]> = [
    {
      metric_id: "interaction_clarity",
      label: "Interaction clarity",
      description: "Primary actions should be obvious and low-friction.",
      minimum_score_out_of_ten: floor,
      quality_axis_id: "primary_flow",
      required: true,
      weight: 2
    },
    {
      metric_id: "visual_hierarchy",
      label: "Visual hierarchy",
      description: "Layout and emphasis should make the main flow legible at a glance.",
      minimum_score_out_of_ten: Math.max(7, floor - 0.2),
      quality_axis_id: "primary_flow",
      required: true,
      weight: 2
    },
    {
      metric_id: "finish_line_coherence",
      label: "Finish-line coherence",
      description: "The requested finish line should feel complete end-to-end.",
      minimum_score_out_of_ten: floor,
      quality_axis_id: "primary_flow",
      required: true,
      weight: 2
    },
    {
      metric_id: "adapter_contract_fulfillment",
      label: "Adapter contract fulfillment",
      description:
        "The product should satisfy the generated adapter workflow checks through real visible behavior, not superficial markers.",
      minimum_score_out_of_ten: floor,
      quality_axis_id: "primary_flow",
      required: true,
      weight: 2
    },
    {
      metric_id: "reference_fit",
      label: "Reference fit",
      description: "The build should visibly align with the requested reference direction.",
      minimum_score_out_of_ten: Math.max(7, floor - 0.3),
      quality_axis_id: "reference_fit",
      required: hasReferenceDirection,
      weight: 1.5
    },
    {
      metric_id: "prototype_delta",
      label: "Prototype-to-release improvement",
      description:
        "The current build should be materially beyond the initial prototype or scaffold.",
      minimum_score_out_of_ten: Math.max(7, floor - 0.2),
      quality_axis_id: "primary_flow",
      required: answers.goalLevel !== "prototype",
      weight: 2
    }
  ];

  return metrics.filter((metric) => metric.required !== false);
};

const customSubjectiveMetricsFor = (
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

const buildGeneratedSubjectiveMetrics = (
  answers: BootstrapAnswers
): NonNullable<VerificationProfile["subjective_metrics"]> =>
  mergeSubjectiveMetrics(defaultSubjectiveMetricsFor(answers), customSubjectiveMetricsFor(answers));

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
  const subjectiveMetricCriteria = buildGeneratedSubjectiveMetrics(answers).map((metric) => ({
    criterion_id: `subjective_metric_${metric.metric_id}_minimum`,
    capability: "grade_round" as const,
    summary: `${metric.label} must score at least ${metric.minimum_score_out_of_ten}/10.`,
    operator: "number_gte" as const,
    expected_value: String(metric.minimum_score_out_of_ten),
    quality_axis_id: metric.quality_axis_id ?? metric.metric_id,
    hard: metric.required ?? true
  }));

  return uniqueCriteria([
    ...(answers.readyUrl
      ? [
          {
            criterion_id: "target_accessible",
            assertion_id: "target_accessible",
            quality_axis_id: "primary_flow",
            capability: "run_checks" as const,
            summary: `run_checks must prove the generated target for '${answers.title}' is reachable.`,
            operator: "contains" as const,
            expected_value: "HTTP ",
            hard: true
          }
        ]
      : []),
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
    ...(answers.readyUrl
      ? [
          {
            criterion_id: "target_accessible",
            assertion_id: "target_accessible",
            quality_axis_id: "primary_flow",
            capability: "grade_round" as const,
            summary: "grade_round must keep target accessibility green before release.",
            operator: "contains" as const,
            expected_value: "HTTP ",
            hard: true
          }
        ]
      : []),
    ...releaseGateProbeCriteria,
    ...subjectiveMetricCriteria
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

const buildShellCommandProbe = (input: {
  probeId: string;
  label: string;
  assertionId: string;
  qualityAxisId: string;
  command: string;
  expectedValue?: string;
}): VerificationCoreProbe => ({
  probe_id: input.probeId,
  label: input.label,
  role: "release_gate",
  mode: "shell_command",
  assertion_id: input.assertionId,
  quality_axis_id: input.qualityAxisId,
  assertion_tags: ["workflow_multi_step"],
  semantic_level: "workflow",
  target: input.command,
  cwd: ".",
  ...(input.expectedValue ? { expected_value: input.expectedValue } : {}),
  expected_exit_code: 0,
  required: true
});

const buildGeneratedCoreProbes = (
  answers: BootstrapAnswers
): VerificationCoreProbe[] => {
  const titleSlug = slugify(answers.title);
  const qualityContract = buildGeneratedQualityContract(answers);
  const selectors = {
    appShell:
      answers.probeHints?.appShellSelector ??
      "[data-harness='app-shell'], [data-testid='app-shell']",
    success:
      answers.probeHints?.successSelector ??
      "[data-harness='finish-line-ready'], [data-testid='finish-line-ready']",
    error:
      answers.probeHints?.errorSelector ??
      "[data-harness='error-banner'], [data-testid='error-banner']",
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
  const requestedVerificationSurfaces = Array.from(verificationSurfaceSetFor(answers));
  const includeContinuityProbe = shouldProbeContinuity(answers);
  const includeErrorRecoveryProbe = shouldProbeErrorRecovery(answers);
  const workflowChecks =
    (answers.workflowChecks ?? []).length > 0
      ? answers.workflowChecks
      : defaultWorkflowChecksFromCoreFeatures(
          answers.coreFeatures,
          requestedVerificationSurfaces
        ).map(toBootstrapWorkflowCheck);
  const featureSlugs = workflowChecks
    .slice(0, 5)
    .map((check, index) => {
      const featureSlug = slugForIndexedFeature(check.workflow, index);
      const axisId = `feature_${featureSlug}`;
      return {
        feature: check.workflow,
        check,
        featureSlug,
        axisId:
          qualityContract.quality_axes.find((axis) => axis.axis_id === axisId)
            ?.axis_id ?? axisId
      };
    });
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

  if (browserSurfaceRequested(answers)) {
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
      ...(includeErrorRecoveryProbe
        ? [
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
            })
          ]
        : []),
      ...(includeContinuityProbe
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
      ...featureSlugs
        .filter(({ check }) => check.surface === "browser")
        .map(({ feature, featureSlug, axisId, check }) =>
        buildBrowserJourneyProbe({
          probeId: `${titleSlug}-${featureSlug}`,
          label: `Workflow works: ${feature}`,
          assertionId: `${titleSlug}_${featureSlug}_ready`,
          qualityAxisId: axisId,
          assertionTags: ["browser", "workflow_multi_step"],
          semanticLevel: "feature",
          steps: [
            { action: "goto" },
            { action: "assert_visible", selector: selectors.appShell },
            {
              action: "assert_visible",
              selector:
                check.selectorHints?.root ?? `[data-testid='feature-${featureSlug}']`
            },
            {
              action: "click",
              selector:
                check.selectorHints?.action ??
                `[data-testid='feature-${featureSlug}-action']`
            },
            {
              action: "assert_visible",
              selector:
                check.selectorHints?.result ??
                `[data-testid='feature-${featureSlug}-result']`
            }
          ]
        })
      )
    );
  }

  if (apiSurfaceRequested(answers)) {
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
      ...(includeErrorRecoveryProbe
        ? [
            buildApiJsonProbe({
              probeId: `${titleSlug}-error-recovery-api`,
              label: `Invalid API flows are rejected with explicit recovery metadata`,
              assertionId: `${titleSlug}_api_error_recovery_ready`,
              qualityAxisId: "error_recovery",
              assertionTags: ["api", "error_path"],
              targetPath: apiPaths.errorPath,
              expectedValue: "handled",
              expectedStatus: 400
            })
          ]
        : []),
      ...(includeContinuityProbe
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
      ...featureSlugs
        .filter(({ check }) => check.surface === "api")
        .map(({ feature, featureSlug, axisId, check }) =>
        buildApiJsonProbe({
          probeId: `${titleSlug}-${featureSlug}-api`,
          label: `Workflow API works: ${feature}`,
          assertionId: `${titleSlug}_${featureSlug}_api_ready`,
          qualityAxisId: axisId,
          assertionTags: ["api", "workflow_multi_step"],
          targetPath: check.apiHint?.path ?? `quality/features/${featureSlug}`,
          expectedValue: check.apiHint?.expectedValue ?? "ready",
          expectedStatus: check.apiHint?.expectedStatus ?? 200,
          jsonPath: check.apiHint?.expectedJsonPath ?? "status"
        })
      )
    );
  }

  const shouldGenerateCommandProbes =
    isCommandOnlyFamily(answers.targetFamily) ||
    requestedVerificationSurfaces.some((surface) =>
      ["cli", "shell", "test", "package_import"].includes(surface)
    );
  if (shouldGenerateCommandProbes) {
    probes.push(
      ...featureSlugs
        .filter(({ check }) =>
          isCommandOnlyFamily(answers.targetFamily) ||
          ["cli", "shell", "test", "package_import"].includes(check.surface)
        )
        .map(({ feature, featureSlug, axisId, check }) =>
          buildShellCommandProbe({
            probeId: `${titleSlug}-${featureSlug}-command`,
            label: `Workflow command works: ${feature}`,
            assertionId: `${titleSlug}_${featureSlug}_command_ready`,
            qualityAxisId: axisId,
            command:
              check.commandHint?.command ||
              answers.checkCommand ||
              answers.runCommand,
            ...(check.commandHint?.expectedOutput
              ? { expectedValue: check.commandHint.expectedOutput }
              : {})
          })
        )
    );
  }

  return probes;
};

const minimumAssertionTagCountsForGeneratedProbes = (
  probes: readonly VerificationCoreProbe[]
): Partial<Record<VerificationAssertionTag, number>> => {
  const assertionIdsByTag: Partial<Record<VerificationAssertionTag, Set<string>>> = {};
  for (const probe of probes) {
    if ((probe.role ?? "supporting") !== "release_gate") {
      continue;
    }
    for (const tag of probe.assertion_tags ?? []) {
      const assertionIds = assertionIdsByTag[tag] ?? new Set<string>();
      assertionIds.add(probe.assertion_id ?? probe.probe_id);
      assertionIdsByTag[tag] = assertionIds;
    }
  }
  return Object.fromEntries(
    Object.entries(assertionIdsByTag).map(([tag, assertionIds]) => [
      tag,
      assertionIds.size
    ])
  ) as Partial<Record<VerificationAssertionTag, number>>;
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
  const filteredBaseProfile = filterVerificationProfileForAnswers(baseProfile, answers);
  const generatedCoreProbes = buildGeneratedCoreProbes(answers);
  const generatedCriteria = buildGeneratedCriteria(answers, generatedCoreProbes);
  const generatedSubjectiveMetrics = buildGeneratedSubjectiveMetrics(answers);
  const generatedReleaseGateProbeCount = generatedCoreProbes.filter(
    (probe) => (probe.role ?? "supporting") === "release_gate"
  ).length;
  const generatedMinimumAssertionTagCounts =
    minimumAssertionTagCountsForGeneratedProbes(generatedCoreProbes);
  const mergedCoreProbes = mergeGeneratedProbeOverlay(
    filteredBaseProfile.core_probes ?? [],
    generatedCoreProbes
  );
  const mergedCriteria = uniqueCriteria([
    ...(filteredBaseProfile.criteria ?? []),
    ...generatedCriteria
  ]);
  const mergedMinimumAssertionTagCounts =
    minimumAssertionTagCountsForGeneratedProbes(mergedCoreProbes);
  const titleSlug = slugify(answers.title);
  const qualityContract = mergeQualityContract(
    filteredBaseProfile.quality_contract,
    buildGeneratedQualityContract(answers)
  );
  const mergedSubjectiveMetrics = mergeSubjectiveMetrics(
    filteredBaseProfile.subjective_metrics ?? [],
    generatedSubjectiveMetrics
  );
  const mergedScorePolicy =
    generatedSubjectiveMetrics.length > 0 && browserSurfaceRequested(answers)
      ? {
          ...(filteredBaseProfile.score_policy ?? {}),
          proof_weights: {
            proof_pass_rate: 0.15,
            criterion_pass_rate: 0.2,
            threshold_verdict: 0.05,
            external_grade: Math.max(
              filteredBaseProfile.score_policy?.proof_weights?.external_grade ?? 0,
              0.6
            )
          },
          release_weights: {
            control_plane_score: 0.2,
            proof_score: 0.8
          }
        }
      : generatedSubjectiveMetrics.length > 0
        ? {
            ...(filteredBaseProfile.score_policy ?? {}),
            proof_weights: {
              ...(filteredBaseProfile.score_policy?.proof_weights ?? {}),
              external_grade: Math.max(
                filteredBaseProfile.score_policy?.proof_weights?.external_grade ?? 0,
                0.35
              )
            }
          }
        : filteredBaseProfile.score_policy;
  const mergedExpectedTargetSurfaces = targetSurfacesForAnswers(answers);
  const mergedLiveVerificationModes = liveVerificationModesForAnswers(answers);
  const mergedReleaseGateProbeCount = mergedCoreProbes.filter(
    (probe) => (probe.role ?? "supporting") === "release_gate"
  ).length;

  return {
    ...filteredBaseProfile,
    profile_id: `generated-${titleSlug}-profile`,
    label: `${answers.title} Evaluator Bundle`,
    bundle_label: `${answers.title} Evaluator Bundle`,
    target_family: answers.targetFamily,
    validation_lane: baseProfile.validation_lane,
    expected_target_surfaces: mergedExpectedTargetSurfaces,
    required_live_verification_modes: mergedLiveVerificationModes,
    target_reached_requires_core_probes:
      filteredBaseProfile.target_reached_requires_core_probes ?? true,
    minimum_feature_release_assertions: Math.max(
      mergedReleaseGateProbeCount,
      Math.max(generatedReleaseGateProbeCount, 1)
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
      ...(filteredBaseProfile.notes ?? []),
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
      "Please choose browser-app, api-service, fullstack-app, dashboard, browser-editor, crud-api, chat-agent, cli-tool, or command-artifact.\n"
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
    ...(answers.readyUrl ? [`- Ready URL: ${answers.readyUrl}`] : []),
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
    ...(answers.readyUrl ? [`- Ready URL: ${answers.readyUrl}`] : []),
    ...(answers.appUrl ? [`- App URL: ${answers.appUrl}`] : []),
    ...(answers.healthUrl ? [`- Health URL: ${answers.healthUrl}`] : []),
    ...(answers.apiBaseUrl ? [`- API base URL: ${answers.apiBaseUrl}`] : []),
    ...(answers.notes ? [`- Intake notes: ${answers.notes}`] : [])
  ];

  return `${lines.join("\n")}\n`;
};

const buildDurableMemoryContextFromAnswers = (
  answers: BootstrapAnswers
): DurableMemoryContext => ({
  title: answers.title,
  summary: answers.summary,
  finishLine: answers.finishLine,
  targetUsers: answers.targetUsers,
  coreFeatures: answers.coreFeatures,
  qualityBar: answers.qualityBar,
  constraints: answers.constraints,
  mustNotBreak: answers.mustNotBreak ?? [],
  targetScore: answers.targetScore,
  maxRounds: answers.maxRounds
});

export const scaffoldBootstrapArtifacts = async (
  answers: BootstrapAnswers,
  paths: BootstrapArtifactPaths = defaultBootstrapPaths
): Promise<BootstrapResult> => {
  answers = completeBootstrapAnswers(answers);
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
    ...(answers.readyUrl ? { ready_url: answers.readyUrl } : {}),
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
    verification_surfaces: answers.verificationSurfaces,
    workflow_checks: answers.workflowChecks.map(toSessionWorkflowCheck),
    adapter_plan: answers.adapterPlan,
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
  await writeJson(paths.adapterPlanPath, answers.adapterPlan);
  await writeText(paths.adapterPlanMarkdownPath, adapterPlanMarkdown(answers.adapterPlan));
  await writeJson(paths.generatedVerificationProfilePath, generatedProfile);
  await writeJson(paths.generatedRubricPath, generatedRubric);
  await scaffoldDurableMemoryArtifacts(
    paths.rootDirectory,
    buildDurableMemoryContextFromAnswers(answers)
  );
  await scaffoldAdapterArtifacts(answers, paths);

  return {
    adapterPath: paths.adapterPath,
    rubricPath: paths.generatedRubricPath,
    evaluatorProfilePath: paths.generatedVerificationProfilePath,
    targetFamily: answers.targetFamily,
    targetScore: answers.targetScore,
    maxRounds: answers.maxRounds,
    ideaPath: paths.ideaPath,
    intakePath: paths.intakePath,
    featureListPath: paths.featureListPath,
    progressPath: paths.progressPath,
    progressLogPath: paths.progressLogPath,
    doneWhenPath: paths.doneWhenPath,
    initScriptPath: paths.initScriptPath,
    adapterPlanPath: paths.adapterPlanPath,
    adapterPlanMarkdownPath: paths.adapterPlanMarkdownPath,
    adapterReviewTaskPath: paths.adapterReviewTaskPath,
    adapterReviewResponsePath: paths.adapterReviewResponsePath
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

      const frameworkHint = defaultFrameworkHintForFamily(targetFamily, projectMode);
      const defaultRunCommand = defaultRunCommandForBootstrap(targetFamily, projectMode);
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
      const readyUrl = isCommandOnlyFamily(targetFamily)
        ? ""
        : projectMode === "existing"
          ? await askRequired(
              rl,
              "Which URL should the harness wait for after starting the target?",
              defaultReadyUrlForFamily(targetFamily)
            )
          : defaultReadyUrlForFamily(targetFamily);
      const appUrl = isCommandOnlyFamily(targetFamily)
        ? ""
        : projectMode === "existing"
          ? await askText(
              rl,
              "App URL (leave blank if not relevant)",
              defaultAppUrlForFamily(targetFamily)
            )
          : defaultAppUrlForFamily(targetFamily) ?? "";
      const healthUrl = isCommandOnlyFamily(targetFamily)
        ? ""
        : projectMode === "existing"
          ? await askText(
              rl,
              "Health URL (leave blank if not relevant)",
              defaultHealthUrlForFamily(targetFamily)
            )
          : defaultHealthUrlForFamily(targetFamily) ?? "";
      const apiBaseUrl = isCommandOnlyFamily(targetFamily)
        ? ""
        : projectMode === "existing"
          ? await askText(
              rl,
              "API base URL (leave blank if not relevant)",
              defaultApiBaseUrlForFamily(targetFamily)
            )
          : defaultApiBaseUrlForFamily(targetFamily) ?? "";
      const probeHints =
        projectMode === "existing" && !isCommandOnlyFamily(targetFamily)
          ? await askProbeHints(rl, targetFamily)
          : undefined;

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
      const verificationSurfaces =
        defaultVerificationSurfacesForFamily(targetFamily);
      const workflowChecks = defaultWorkflowChecksFromCoreFeatures(
        coreFeatures,
        verificationSurfaces
      ).map(toBootstrapWorkflowCheck);
      const adapterPlan = buildAdapterPlanFromIntake({
        targetFamily,
        intake: {
          product_title: title,
          product_summary: summary,
          target_users: targetUsers,
          core_features: coreFeatures,
          reference_apps: referenceApps,
          finish_line: finishLine,
          target_family: targetFamily,
          target_root: targetRoot,
          project_mode: projectMode,
          framework_hint: frameworkHint,
          package_manager: packageManager,
          run_command: runCommand,
          check_command: checkCommand,
          ready_url: readyUrl,
          ...(appUrl ? { app_url: appUrl } : {}),
          ...(healthUrl ? { health_url: healthUrl } : {}),
          ...(apiBaseUrl ? { api_base_url: apiBaseUrl } : {}),
          verification_surfaces: verificationSurfaces,
          workflow_checks: workflowChecks.map(toSessionWorkflowCheck)
        }
      });

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
        verificationSurfaces,
        workflowChecks,
        adapterPlan,
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
