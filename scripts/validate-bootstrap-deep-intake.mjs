import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  cleanupTempRoot,
  createTempRoot,
  ensureBuild,
  importDist,
  readJsonFile
} from "./testing/bootstrap-validator-helpers.mjs";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-bootstrap-deep-intake");

  try {
    const workspaceRoot = join(tempRoot, "workspace");
    const targetRoot = join(tempRoot, "target-app");
    const { createBootstrapArtifactPaths, scaffoldBootstrapArtifacts } =
      await importDist("bootstrap.js");
    const paths = createBootstrapArtifactPaths(workspaceRoot);

    await scaffoldBootstrapArtifacts(
      {
        title: "Deep Intake App",
        summary: "A fixture app for validating deeper bootstrap intake fields.",
        targetUsers: ["operator", "reviewer"],
        coreFeatures: ["review release", "save draft", "retry publish"],
        referenceApps: ["Linear", "Notion"],
        finishLine: "A reviewer can save, reload, and finish the release flow without losing state.",
        targetFamily: "fullstack-app",
        goalLevel: "production-like",
        targetScore: 0.95,
        maxRounds: 4,
        targetRoot,
        projectMode: "existing",
        frameworkHint: "Next.js",
        packageManager: "npm",
        runCommand: "npm run dev",
        checkCommand: "npm test",
        readyUrl: "http://127.0.0.1:3000/healthz",
        appUrl: "http://127.0.0.1:3000/",
        healthUrl: "http://127.0.0.1:3000/healthz",
        apiBaseUrl: "http://127.0.0.1:3000/api/",
        constraints: ["Do not add an admin settings area."],
        qualityBar: [
          "The reviewer flow must feel coherent across reload.",
          "Design quality must score at least 8/10."
        ],
        mustNotBreak: ["draft should survive reload"],
        failureExpectations: [
          "show an explicit error message",
          "offer a retry or recovery path"
        ],
        continuityBoundaries: ["reload", "retry"],
        referenceSignals: ["clear hierarchy", "calm density", "fast transitions"],
        nonGoals: ["do not add a settings area"],
        probeHints: {
          appShellSelector: "[data-testid='shell']",
          successSelector: "[data-testid='release-ready']",
          errorSelector: "[data-testid='error-banner']",
          persistenceInputSelector: "[data-testid='draft-input']",
          saveActionSelector: "[data-testid='save-draft']",
          restoredSelector: "[data-testid='draft-restored']",
          apiFinishLinePath: "quality/release-ready",
          apiErrorPath: "quality/release-error",
          apiPersistencePath: "quality/release-persistence"
        },
        customQualityMetrics: [
          {
            metricId: "design-quality",
            label: "Design quality",
            description: "Reward clear hierarchy, spacing consistency, and polished visual execution.",
            minimumScoreOutOfTen: 8,
            required: true,
            weight: 2
          },
          {
            metricId: "originality",
            label: "Originality",
            description: "Reward distinctive layout and non-generic product feel.",
            minimumScoreOutOfTen: 7,
            required: false,
            weight: 1
          }
        ],
        notes: "deep-intake validator"
      },
      paths
    );

    const intake = await readJsonFile(paths.intakePath);
    const runtimeConfig = await readJsonFile(paths.generatedRuntimeConfigPath);
    const generatedProfile = await readJsonFile(paths.generatedVerificationProfilePath);
    const ideaMarkdown = await readFile(paths.ideaPath, "utf8");

    assert(
      Array.isArray(intake.must_not_break) &&
        intake.must_not_break.includes("draft should survive reload"),
      "intake.json should retain must_not_break entries"
    );
    assert(
      Array.isArray(intake.failure_expectations) &&
        intake.failure_expectations.includes("show an explicit error message"),
      "intake.json should retain failure_expectations"
    );
    assert(
      Array.isArray(intake.continuity_boundaries) &&
        intake.continuity_boundaries.includes("reload"),
      "intake.json should retain continuity boundaries"
    );
    assert(
      Array.isArray(intake.non_goals) &&
        intake.non_goals.includes("do not add a settings area"),
      "intake.json should retain non-goals"
    );
    assert(
      Array.isArray(intake.custom_quality_metrics) &&
        intake.custom_quality_metrics.length === 2,
      "intake.json should retain custom quality metrics"
    );
    assert(
      runtimeConfig.probe_hints?.successSelector === "[data-testid='release-ready']",
      "runtime-config.json should retain probe hints"
    );
    assert(
      ideaMarkdown.includes("## Must Not Break") &&
        ideaMarkdown.includes("## Subjective Metrics") &&
        ideaMarkdown.includes("Design quality"),
      "IDEA.md should include deeper intake sections and subjective metric details"
    );
    assert(
      Array.isArray(generatedProfile.subjective_metrics) &&
        generatedProfile.subjective_metrics.some(
          (metric) =>
            metric.metric_id === "design-quality" &&
            metric.minimum_score_out_of_ten === 8
        ),
      "generated verification profile should retain subjective metrics"
    );
    assert(
      Array.isArray(generatedProfile.quality_contract?.quality_axes) &&
        generatedProfile.quality_contract.quality_axes.some(
          (axis) =>
            axis.axis_id === "design-quality" &&
            axis.scoring_mode === "subjective_out_of_ten" &&
            axis.minimum_score_out_of_ten === 8
        ),
      "generated verification profile should publish subjective quality axes"
    );
    assert(
      Array.isArray(generatedProfile.criteria) &&
        generatedProfile.criteria.some(
          (criterion) =>
            criterion.capability === "grade_round" &&
            criterion.criterion_id === "subjective_metric_design-quality_minimum"
        ),
      "generated verification profile should publish grade_round subjective criteria"
    );

    console.log("Validated bootstrap deep intake artifacts.");
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
