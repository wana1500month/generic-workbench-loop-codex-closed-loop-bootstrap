import { join } from "node:path";

import type {
  BootstrapAnswers,
  BootstrapArtifactPaths,
  BootstrapWorkflowCheck
} from "../bootstrap.js";
import { repoRoot, writeJson, writeText } from "../file-system.js";
import {
  applyChangeTemplate,
  captureEvidenceTemplate,
  gradeRoundTemplate,
  helperTemplate,
  moduleImportPath,
  prepareTargetTemplate,
  runChecksTemplate,
  runTargetTemplate
} from "./templates.js";

const slugifyAscii = (value: string): string =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

const slugify = (value: string): string => slugifyAscii(value) || "generated-app";

const slugForIndexedFeature = (value: string, index: number): string =>
  slugifyAscii(value) || `feature-${index + 1}`;

const workflowRootSelector = (index: number): string =>
  `[data-workflow-id='workflow-${index + 1}'], [data-testid='feature-${index + 1}']`;

const workflowActionSelector = (index: number): string =>
  `[data-workflow-id='workflow-${index + 1}'] [data-workflow-action='primary'], [data-testid='feature-${index + 1}-action']`;

const workflowResultSelector = (index: number): string =>
  `[data-workflow-id='workflow-${index + 1}'] [data-workflow-result='primary'], [data-testid='feature-${index + 1}-result']`;

const featureProbeMap = (features: readonly string[]) =>
  features.slice(0, 3).map((feature, index) => {
    const slug = slugForIndexedFeature(feature, index);
    return {
      feature,
      slug,
      root_selector: workflowRootSelector(index),
      action_selector: workflowActionSelector(index),
      result_selector: workflowResultSelector(index),
      legacy_root_selector: `[data-testid='feature-${index + 1}']`,
      legacy_action_selector: `[data-testid='feature-${index + 1}-action']`,
      legacy_result_selector: `[data-testid='feature-${index + 1}-result']`
    };
  });

const workflowProbeMap = (input: {
  coreFeatures: readonly string[];
  workflowChecks: readonly BootstrapWorkflowCheck[];
}) => {
  const checks: readonly BootstrapWorkflowCheck[] =
    input.workflowChecks.length > 0
      ? input.workflowChecks
      : input.coreFeatures.slice(0, 3).map((feature, index) => ({
          workflow: feature,
          surface: "browser" as const,
          expectedResult: `${feature} succeeds visibly.`,
          selectorHints: {
            root: workflowRootSelector(index),
            action: workflowActionSelector(index),
            result: workflowResultSelector(index)
          }
        }));

  return checks.slice(0, 5).map((check, index) => {
    const slug = slugForIndexedFeature(check.workflow, index);
    return {
      workflow: check.workflow,
      surface: check.surface,
      slug,
      expected_result: check.expectedResult,
      root_selector: check.selectorHints?.root ?? workflowRootSelector(index),
      action_selector:
        check.selectorHints?.action ?? workflowActionSelector(index),
      result_selector:
        check.selectorHints?.result ?? workflowResultSelector(index),
      legacy_root_selector: `[data-testid='feature-${index + 1}']`,
      legacy_action_selector: `[data-testid='feature-${index + 1}-action']`,
      legacy_result_selector: `[data-testid='feature-${index + 1}-result']`,
      api_path: check.apiHint?.path ?? `quality/features/${slug}`
    };
  });
};

const adapterReviewTask = (answers: BootstrapAnswers, paths: BootstrapArtifactPaths): string =>
  [
    "# Generated Adapter Review Task",
    "",
    `Product: ${answers.title}`,
    "",
    "Review only these files:",
    `- ${paths.adapterPath}`,
    `- ${paths.adapterPlanPath}`,
    `- ${paths.generatedVerificationProfilePath}`,
    `- ${paths.generatedRubricPath}`,
    `- ${paths.generatedRuntimeConfigPath}`,
    `- ${paths.generatedScriptsRoot}/*`,
    "",
    "Do not edit the target product during this review.",
    "",
    "Check:",
    "1. Does the adapter plan match the user intake?",
    "2. Are workflow checks executable?",
    "3. Are browser selectors/API paths realistic?",
    "4. Does apply-change prompt tell the generator how to satisfy the adapter?",
    "5. Does run-checks report workflow failures clearly?",
    "6. Does grade-round fail closed when evidence is thin?",
    "",
    "If needed, patch only the generated adapter surface.",
    "",
    "Adapter plan:",
    `- ${paths.adapterPlanMarkdownPath}`,
    "",
    "Workflow checks:",
    ...answers.workflowChecks.map(
      (check, index) =>
        `${index + 1}. ${check.workflow} -> ${check.expectedResult} (${check.surface})`
    )
  ].join("\n");

export const scaffoldAdapterArtifacts = async (
  answers: BootstrapAnswers,
  paths: BootstrapArtifactPaths
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
    verification_surfaces: answers.verificationSurfaces,
    workflow_checks: answers.workflowChecks.map((check) => ({
      workflow: check.workflow,
      surface: check.surface,
      ...(check.trigger ? { trigger: check.trigger } : {}),
      expected_result: check.expectedResult,
      ...(check.selectorHints ? { selector_hints: check.selectorHints } : {}),
      ...(check.apiHint ? { api_hint: check.apiHint } : {}),
      ...(check.commandHint ? { command_hint: check.commandHint } : {})
    })),
    adapter_plan: answers.adapterPlan,
    verification_contract: {
      app_shell_selector: "[data-harness='app-shell'], [data-testid='app-shell']",
      finish_line_selector:
        "[data-harness='finish-line-ready'], [data-testid='finish-line-ready']",
      error_selector: "[data-harness='error-banner'], [data-testid='error-banner']",
      legacy_feature_selectors: featureProbeMap(answers.coreFeatures),
      workflow_selectors: workflowProbeMap({
        coreFeatures: answers.coreFeatures,
        workflowChecks: answers.workflowChecks
      })
    },
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
    idea_path: paths.ideaPath,
    verification_profile_path: paths.generatedVerificationProfilePath
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
  await writeText(
    join(paths.generatedScriptsRoot, "capture-evidence.mjs"),
    captureEvidenceTemplate()
  );
  await writeText(join(paths.generatedScriptsRoot, "run-checks.mjs"), runChecksTemplate());
  await writeText(join(paths.generatedScriptsRoot, "grade-round.mjs"), gradeRoundTemplate());
  await writeText(paths.adapterReviewTaskPath, adapterReviewTask(answers, paths));
  await writeJson(paths.adapterReviewResponsePath, {
    status: "not_reviewed",
    instructions:
      "Review adapter-review-task.md before loop start if the operator wants an explicit generated-adapter review checkpoint.",
    generated_at: new Date().toISOString()
  });

  const adapterId = `generated-${slugify(answers.title)}-adapter`;
  await writeJson(paths.adapterPath, {
    adapter_id: adapterId,
    label: `${answers.title} Generated Adapter`,
    contract_version: "1",
    target_root: answers.targetRoot,
    capabilities: {
      prepare_target: {
        command: "node",
        args: [`${paths.generatedAdapterRelativePath}/scripts/prepare-target.mjs`],
        cwd: ".",
        timeout_ms: 180000
      },
      apply_change: {
        command: "node",
        args: [`${paths.generatedAdapterRelativePath}/scripts/apply-change.mjs`],
        cwd: ".",
        timeout_ms: 900000
      },
      run_target: {
        command: "node",
        args: [`${paths.generatedAdapterRelativePath}/scripts/run-target.mjs`],
        cwd: ".",
        timeout_ms: 300000
      }
    },
    verification_provider: {
      provider_id: `${adapterId}-verifier`,
      capabilities: {
        capture_evidence: {
          command: "node",
          args: [`${paths.generatedAdapterRelativePath}/scripts/capture-evidence.mjs`],
          cwd: ".",
          timeout_ms: 180000
        },
        run_checks: {
          command: "node",
          args: [`${paths.generatedAdapterRelativePath}/scripts/run-checks.mjs`],
          cwd: ".",
          timeout_ms: 300000
        },
        grade_round: {
          command: "node",
          args: [`${paths.generatedAdapterRelativePath}/scripts/grade-round.mjs`],
          cwd: ".",
          timeout_ms: 180000
        }
      }
    },
    notes: [
      "Generated by interactive bootstrap.",
      "This adapter is opinionated toward Codex-driven target mutation and generic HTTP-based verification.",
      `If the target needs richer runtime or QA behavior, edit the generated scripts under ${paths.generatedAdapterRelativePath}/scripts.`
    ]
  });
};
