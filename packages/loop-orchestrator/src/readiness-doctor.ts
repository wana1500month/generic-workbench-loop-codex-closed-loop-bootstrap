import { resolve } from "node:path";

import { pathExists, repoRoot, writeJson, writeText } from "./file-system.js";
import type {
  FrontDoorSessionConflict,
  SessionCustomQualityMetric,
  SessionIntakeSnapshot,
  VerificationSurface
} from "./intake-schema.js";
import type { SessionRunContractArtifact, TargetFamily } from "./types.js";

export type ReadinessBlockerSeverity = "blocking" | "warning";

export type ReadinessBlockerOwner =
  | "user"
  | "harness"
  | "target_project"
  | "environment";

export type ReadinessBlockerCode =
  | "TARGET_ROOT_MISSING"
  | "TARGET_ROOT_NOT_FOUND"
  | "RUN_COMMAND_MISSING"
  | "READY_URL_MISSING"
  | "API_BASE_URL_MISSING"
  | "WORKFLOW_CHECKS_MISSING"
  | "CUSTOM_DIMENSION_EVIDENCE_MISSING"
  | "ADAPTER_PLAN_MISSING"
  | "ADAPTER_GENERATION_MISSING"
  | "EVALUATOR_PROFILE_MISSING"
  | "RUBRIC_MISSING"
  | "THREAD_BINDING_MISMATCH"
  | "CONFLICTING_INTAKE";

export type ReadinessReportStatus =
  | "not_ready"
  | "ready_for_prepare"
  | "prepared_with_blockers"
  | "ready_to_start";

export interface ReadinessBlocker {
  code: ReadinessBlockerCode;
  severity: ReadinessBlockerSeverity;
  human_explanation: string;
  why_it_matters: string;
  how_to_fix: string;
  owner: ReadinessBlockerOwner;
  next_action: string;
  related_fields?: string[];
  related_paths?: string[];
}

export interface ReadinessReport {
  generated_at: string;
  run_id: string;
  run_directory: string;
  session_id?: string;
  status: ReadinessReportStatus;
  ready: boolean;
  summary: string;
  blockers: ReadinessBlocker[];
  warnings: ReadinessBlocker[];
  next_action: string;
}

export interface BuildReadinessReportInput {
  runId: string;
  runDirectory: string;
  sessionId?: string;
  isProductBuild: boolean;
  sourceIntake?: SessionIntakeSnapshot;
  intake?: SessionIntakeSnapshot;
  runContract?: SessionRunContractArtifact;
  targetFamily?: TargetFamily;
  adapterPath?: string;
  adapterPlanPath?: string;
  rubricPath?: string;
  evaluatorProfilePath?: string;
  unresolvedConflicts?: readonly FrontDoorSessionConflict[];
  threadBindingMismatch?: boolean;
}

const nonEmpty = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const targetRootFor = (
  intake: SessionIntakeSnapshot | undefined,
  runContract: SessionRunContractArtifact | undefined
): string | undefined =>
  nonEmpty(intake?.target_root) ??
  nonEmpty(runContract?.execution_controls.target_root);

const commandFor = (
  sourceIntake: SessionIntakeSnapshot | undefined,
  intake: SessionIntakeSnapshot | undefined,
  runContract: SessionRunContractArtifact | undefined,
  field: "run_command" | "check_command"
): string | undefined =>
  nonEmpty(sourceIntake?.[field]) ??
  nonEmpty(intake?.[field]) ??
  nonEmpty(runContract?.execution_controls[field]);

const targetManifestHintFor = (
  sourceIntake: SessionIntakeSnapshot | undefined,
  intake: SessionIntakeSnapshot | undefined,
  runContract: SessionRunContractArtifact | undefined,
  field: "ready_url" | "app_url" | "health_url" | "api_base_url"
): string | undefined =>
  nonEmpty(sourceIntake?.[field]) ??
  nonEmpty(intake?.[field]) ??
  (field === "ready_url"
    ? undefined
    : nonEmpty(runContract?.execution_controls.target_manifest_hints?.[field]));

const verificationSurfacesFor = (
  sourceIntake: SessionIntakeSnapshot | undefined,
  intake: SessionIntakeSnapshot | undefined
): VerificationSurface[] =>
  unique([
    ...(sourceIntake?.evidence_surfaces ?? []),
    ...(intake?.evidence_surfaces ?? []),
    ...(sourceIntake?.verification_surfaces ?? []),
    ...(intake?.verification_surfaces ?? []),
    ...((sourceIntake?.workflow_checks ?? intake?.workflow_checks ?? []).map(
      (check) => check.surface
    ))
  ]);

const familyNeedsBrowserEvidence = (targetFamily: TargetFamily | undefined): boolean =>
  targetFamily === "browser-app" ||
  targetFamily === "browser-editor" ||
  targetFamily === "editor-app" ||
  targetFamily === "dashboard" ||
  targetFamily === "fullstack-app";

const familyNeedsApiEvidence = (targetFamily: TargetFamily | undefined): boolean =>
  targetFamily === "api-service" ||
  targetFamily === "crud-api" ||
  targetFamily === "fullstack-app";

const metricNeedsVisualEvidence = (
  metric: SessionCustomQualityMetric
): boolean => {
  const text = `${metric.metric_id} ${metric.label} ${metric.description}`.toLowerCase();
  return /design|visual|clean|layout|spacing|text|copy|app[- ]?like|ui/u.test(text) ||
    /디자인|깔끔|텍스트|문구|앱스러|여백|정렬|화면/u.test(text);
};

const blocking = (input: Omit<ReadinessBlocker, "severity">): ReadinessBlocker => ({
  ...input,
  severity: "blocking"
});

const warning = (input: Omit<ReadinessBlocker, "severity">): ReadinessBlocker => ({
  ...input,
  severity: "warning"
});

const firstNextAction = (blockers: readonly ReadinessBlocker[]): string =>
  blockers[0]?.next_action ?? "start_loop";

export const buildReadinessReport = async (
  input: BuildReadinessReportInput
): Promise<ReadinessReport> => {
  const sourceIntake = input.sourceIntake;
  const intake = input.intake ?? sourceIntake;
  const projectMode =
    sourceIntake?.project_mode ??
    intake?.project_mode ??
    input.runContract?.execution_controls.project_mode;
  const targetFamily = input.targetFamily ?? intake?.target_family;
  const targetRoot = targetRootFor(intake, input.runContract);
  const surfaces = verificationSurfacesFor(sourceIntake, intake);
  const needsBrowser =
    surfaces.includes("browser") || familyNeedsBrowserEvidence(targetFamily);
  const needsApi = surfaces.includes("api") || familyNeedsApiEvidence(targetFamily);
  const needsCliOrTest =
    surfaces.includes("cli") ||
    surfaces.includes("shell") ||
    surfaces.includes("test") ||
    surfaces.includes("file") ||
    surfaces.includes("document") ||
    surfaces.includes("package_import") ||
    surfaces.includes("agent_conversation") ||
    needsBrowser ||
    needsApi;
  const blockers: ReadinessBlocker[] = [];
  const warnings: ReadinessBlocker[] = [];

  if (input.threadBindingMismatch) {
    blockers.push(
      blocking({
        code: "THREAD_BINDING_MISMATCH",
        human_explanation:
          "The prepared session is bound to a different Codex thread.",
        why_it_matters:
          "Starting from the wrong thread can consume another foreground run.",
        how_to_fix:
          "Prepare or start the run from the same Codex thread that owns the front-door session.",
        owner: "user",
        next_action: "use_the_bound_codex_thread"
      })
    );
  }

  if ((input.unresolvedConflicts?.length ?? 0) > 0) {
    blockers.push(
      blocking({
        code: "CONFLICTING_INTAKE",
        human_explanation:
          "The intake session still contains conflicting answers.",
        why_it_matters:
          "The loop cannot safely prepare execution controls while intake values disagree.",
        how_to_fix:
          "Resolve the conflicting intake fields, then run prepare again.",
        owner: "user",
        next_action: "resolve_intake_conflicts",
        related_fields: input.unresolvedConflicts?.map((conflict) => conflict.field)
      })
    );
  }

  if (input.isProductBuild && !targetRoot) {
    blockers.push(
      blocking({
        code: "TARGET_ROOT_MISSING",
        human_explanation: "No target root is defined for this product build.",
        why_it_matters:
          "The harness needs a concrete target directory before it can mutate or verify a project.",
        how_to_fix:
          "Set target_root during intake, for example: ./my-app or an absolute project path.",
        owner: "user",
        next_action: "ask_user_for_target_root",
        related_fields: ["target_root"]
      })
    );
  }

  if (targetRoot && projectMode === "existing") {
    const resolvedTargetRoot = resolve(repoRoot, targetRoot);
    if (!(await pathExists(resolvedTargetRoot))) {
      blockers.push(
        blocking({
          code: "TARGET_ROOT_NOT_FOUND",
          human_explanation:
            "The configured target root does not exist on disk.",
          why_it_matters:
            "The harness cannot inspect, patch, run, or verify an existing project that is not present.",
          how_to_fix:
            "Create the target directory or update target_root to the existing project path.",
          owner: "user",
          next_action: "fix_target_root",
          related_fields: ["target_root"],
          related_paths: [resolvedTargetRoot]
        })
      );
    }
  }

  if (projectMode === "existing" && needsCliOrTest) {
    const hasRunCommand = commandFor(sourceIntake, undefined, input.runContract, "run_command");
    const hasCheckCommand = commandFor(
      sourceIntake,
      undefined,
      input.runContract,
      "check_command"
    );
    if (!hasRunCommand && !hasCheckCommand) {
      blockers.push(
        blocking({
          code: "RUN_COMMAND_MISSING",
          human_explanation:
            "No run or check command was provided for the existing target project.",
          why_it_matters:
            "Without an operator-provided command, evaluator proof can accidentally rely on generated defaults that may not run this project.",
          how_to_fix:
            "Provide run_command or check_command, for example: npm run dev or npm test.",
          owner: "user",
          next_action: "ask_user_for_run_command",
          related_fields: ["run_command", "check_command"]
        })
      );
    }
  }

  if (projectMode === "existing" && needsBrowser) {
    const readyUrl =
      targetManifestHintFor(sourceIntake, undefined, input.runContract, "ready_url") ??
      targetManifestHintFor(sourceIntake, undefined, input.runContract, "app_url") ??
      targetManifestHintFor(sourceIntake, undefined, input.runContract, "health_url");
    if (!readyUrl) {
      blockers.push(
        blocking({
          code: "READY_URL_MISSING",
          human_explanation:
            "Browser verification is enabled, but no ready/app URL was provided.",
          why_it_matters:
            "The evaluator needs a reachable URL before it can capture browser evidence.",
          how_to_fix:
            "Provide ready_url or app_url, for example: http://127.0.0.1:3000/.",
          owner: "user",
          next_action: "ask_user_for_ready_url",
          related_fields: ["ready_url", "app_url", "health_url"]
        })
      );
    }
  }

  if (projectMode === "existing" && needsApi) {
    const apiBaseUrl =
      targetManifestHintFor(sourceIntake, undefined, input.runContract, "api_base_url") ??
      targetManifestHintFor(sourceIntake, undefined, input.runContract, "health_url");
    if (!apiBaseUrl) {
      blockers.push(
        blocking({
          code: "API_BASE_URL_MISSING",
          human_explanation:
            "API verification is enabled, but no API base URL or health URL was provided.",
          why_it_matters:
            "The evaluator needs a reachable API endpoint before it can verify API behavior.",
          how_to_fix:
            "Provide api_base_url or health_url, for example: http://127.0.0.1:3000/api.",
          owner: "user",
          next_action: "ask_user_for_api_base_url",
          related_fields: ["api_base_url", "health_url"]
        })
      );
    }
  }

  const workflowChecks = sourceIntake?.workflow_checks ?? intake?.workflow_checks ?? [];
  const coreFeatures = sourceIntake?.core_features ?? intake?.core_features ?? [];
  if (input.isProductBuild && workflowChecks.length === 0 && coreFeatures.length === 0) {
    blockers.push(
      blocking({
        code: "WORKFLOW_CHECKS_MISSING",
        human_explanation:
          "No core workflow or workflow check is available for evaluation.",
        why_it_matters:
          "The loop needs at least one concrete workflow to know what it is improving and verifying.",
        how_to_fix:
          "Add core_features or workflow_checks that describe the primary user-visible behavior.",
        owner: "user",
        next_action: "ask_user_for_core_workflow",
        related_fields: ["core_features", "workflow_checks"]
      })
    );
  }

  const visualMetrics = (sourceIntake?.custom_quality_metrics ?? []).filter(
    metricNeedsVisualEvidence
  );
  if (
    visualMetrics.length > 0 &&
    !surfaces.includes("browser") &&
    !surfaces.includes("screenshot")
  ) {
    blockers.push(
      blocking({
        code: "CUSTOM_DIMENSION_EVIDENCE_MISSING",
        human_explanation:
          "A visual custom quality metric was provided without browser evidence.",
        why_it_matters:
          "Metrics such as cleanliness, text noise, layout quality, or app-like feel need visual proof before they can be judged reliably.",
        how_to_fix:
          "Enable browser or screenshot verification, or remove the visual custom metric for this run.",
        owner: "user",
        next_action: "add_browser_evidence_for_custom_metric",
        related_fields: visualMetrics.map((metric) => metric.metric_id)
      })
    );
  }

  if (input.isProductBuild && input.adapterPlanPath && !(await pathExists(input.adapterPlanPath))) {
    blockers.push(
      blocking({
        code: "ADAPTER_PLAN_MISSING",
        human_explanation: "The generated adapter plan is missing.",
        why_it_matters:
          "The planner and evaluator need the adapter plan to understand how the target will be changed and verified.",
        how_to_fix:
          "Run prepare again so the bootstrap step can regenerate the adapter plan.",
        owner: "harness",
        next_action: "rerun_prepare",
        related_paths: [input.adapterPlanPath]
      })
    );
  }

  if (input.isProductBuild && input.adapterPath && !(await pathExists(input.adapterPath))) {
    blockers.push(
      blocking({
        code: "ADAPTER_GENERATION_MISSING",
        human_explanation: "The generated adapter contract is missing.",
        why_it_matters:
          "The loop cannot execute target-specific apply, run, evidence, and grade capabilities without an adapter contract.",
        how_to_fix:
          "Run prepare again so the bootstrap step can regenerate the adapter contract.",
        owner: "harness",
        next_action: "rerun_prepare",
        related_paths: [input.adapterPath]
      })
    );
  }

  if (input.isProductBuild && input.evaluatorProfilePath && !(await pathExists(input.evaluatorProfilePath))) {
    blockers.push(
      blocking({
        code: "EVALUATOR_PROFILE_MISSING",
        human_explanation: "The evaluator profile is missing.",
        why_it_matters:
          "The evaluator profile defines the proof expectations used during loop rounds.",
        how_to_fix:
          "Run prepare again or restore the evaluator profile file.",
        owner: "harness",
        next_action: "rerun_prepare",
        related_paths: [input.evaluatorProfilePath]
      })
    );
  }

  if (input.rubricPath && !(await pathExists(input.rubricPath))) {
    blockers.push(
      blocking({
        code: "RUBRIC_MISSING",
        human_explanation: "The selected rubric file is missing.",
        why_it_matters:
          "The loop cannot score or stop without a rubric.",
        how_to_fix:
          "Restore the rubric file or pass a valid --rubric path.",
        owner: "harness",
        next_action: "fix_rubric_path",
        related_paths: [input.rubricPath]
      })
    );
  }

  if (input.isProductBuild && surfaces.length === 0) {
    warnings.push(
      warning({
        code: "WORKFLOW_CHECKS_MISSING",
        human_explanation:
          "No explicit verification surface was captured; defaults will drive the initial proof path.",
        why_it_matters:
          "Explicit evidence surfaces make the evaluation easier to understand and debug.",
        how_to_fix:
          "Optionally add verification_surfaces or workflow_checks during intake.",
        owner: "user",
        next_action: "optionally_add_verification_surface",
        related_fields: ["verification_surfaces", "workflow_checks"]
      })
    );
  }

  const ready = blockers.length === 0;
  return {
    generated_at: new Date().toISOString(),
    run_id: input.runId,
    run_directory: input.runDirectory,
    ...(input.sessionId ? { session_id: input.sessionId } : {}),
    status: ready ? "ready_to_start" : "prepared_with_blockers",
    ready,
    summary: ready
      ? "The prepared session has no blocking readiness issues."
      : `The prepared session has ${blockers.length} blocking readiness issue${
          blockers.length === 1 ? "" : "s"
        }.`,
    blockers,
    warnings,
    next_action: ready ? "start_loop" : firstNextAction(blockers)
  };
};

export const renderReadinessReportMarkdown = (
  report: ReadinessReport
): string => {
  const sectionFor = (title: string, entries: readonly ReadinessBlocker[]): string[] =>
    entries.length === 0
      ? [`## ${title}`, "", "- None"]
      : [
          `## ${title}`,
          "",
          ...entries.flatMap((entry, index) => [
            `${index + 1}. ${entry.code}`,
            `   - Severity: ${entry.severity}`,
            `   - Explanation: ${entry.human_explanation}`,
            `   - Why it matters: ${entry.why_it_matters}`,
            `   - How to fix: ${entry.how_to_fix}`,
            `   - Owner: ${entry.owner}`,
            `   - Next action: ${entry.next_action}`,
            ...(entry.related_fields?.length
              ? [`   - Related fields: ${entry.related_fields.join(", ")}`]
              : []),
            ...(entry.related_paths?.length
              ? [`   - Related paths: ${entry.related_paths.join(", ")}`]
              : []),
            ""
          ])
        ];

  return [
    "# Readiness Report",
    "",
    `- Run id: ${report.run_id}`,
    `- Status: ${report.status}`,
    `- Ready: ${report.ready ? "true" : "false"}`,
    `- Generated at: ${report.generated_at}`,
    `- Next action: ${report.next_action}`,
    "",
    report.summary,
    "",
    ...sectionFor("Blockers", report.blockers),
    "",
    ...sectionFor("Warnings", report.warnings),
    ""
  ].join("\n");
};

export const writeReadinessReportArtifacts = async (input: {
  report: ReadinessReport;
  jsonPath: string;
  markdownPath: string;
}): Promise<void> => {
  await Promise.all([
    writeJson(input.jsonPath, input.report),
    writeText(input.markdownPath, renderReadinessReportMarkdown(input.report))
  ]);
};
