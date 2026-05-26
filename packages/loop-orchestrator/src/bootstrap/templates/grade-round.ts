export const gradeRoundTemplate = (): string => `import { copyFile } from "node:fs/promises";
import { extname, isAbsolute, join } from "node:path";

import {
  finalize,
  readConfig,
  readCoreProbeResults,
  readIdeaMarkdown,
  readPacket,
  readJsonIfExists,
  readVerificationProfile,
  relativeToRound,
  roundScore,
  runCodexCommand,
  runtimePaths,
  writeArtifact,
  writeArtifactJson,
  writeRuntimeJson
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
          },
          violations: {
            type: "array",
            items: { type: "string" },
            maxItems: 6
          },
          evidence_quality: {
            type: "object",
            additionalProperties: false,
            properties: {
              has_required_evidence: { type: "boolean" },
              evidence_type: { type: "string" }
            }
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

const unique = (values) =>
  [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];

const screenshotExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);

const isScreenshotPath = (value) => screenshotExtensions.has(extname(value).toLowerCase());

const isTracePath = (value) => {
  const normalized = value.toLowerCase();
  return normalized.endsWith(".zip") && normalized.includes("trace");
};

const resolveEvidencePath = (value) =>
  isAbsolute(value) ? value : join(runtimePaths.roundDirectory, value);

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
  const packet = await readPacket();
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
  const adapterPlan = config.adapter_plan ?? {
    verification_surfaces: config.verification_surfaces ?? [],
    workflow_checks: config.workflow_checks ?? []
  };
  const releaseGateProbes = coreProbeResults.filter(
    (probe) => (probe.role ?? "supporting") === "release_gate"
  );
  const browserSurfaceExpected =
    (Array.isArray(profile.expected_target_surfaces) &&
      profile.expected_target_surfaces.includes("browser")) ||
    releaseGateProbes.some((probe) => probe.mode === "browser_journey");
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
  const visualEvidencePaths = unique([
    ...checksEvidencePaths,
    ...coreProbeResults.flatMap((probe) => probe.evidence_paths ?? [])
  ])
    .map((path) => resolveEvidencePath(path))
    .filter((path) => isScreenshotPath(path) || isTracePath(path));
  const currentScreenshotPath = visualEvidencePaths.find((path) => isScreenshotPath(path));
  const baselineManifestPath = join(runtimePaths.runtimeDirectory, "product-baseline.json");
  const baselineScreenshotPath = join(runtimePaths.runtimeDirectory, "baseline-home.png");
  const roundBaselineAttemptPath = join(runtimePaths.roundDirectory, "pre-round-baseline.json");
  const artifactBaselineAttemptPath = join(runtimePaths.artifactsDirectory, "pre-round-baseline.json");
  const validBaselineSourcePhases = new Set([
    "pre_round_1",
    "round_1_initial_prototype_fallback",
    "operator_provided_baseline"
  ]);
  const baselineSourceSemanticsForPhase = (value) => {
    if (value === "pre_round_1") {
      return "initial_pre_round_baseline";
    }
    if (value === "round_1_initial_prototype_fallback") {
      return "first_rendered_round_fallback";
    }
    if (value === "operator_provided_baseline") {
      return "operator_provided_initial_baseline";
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      return undefined;
    }
    if (value.startsWith("post_round_") || value.includes("post_")) {
      return "post_mutation_or_late_round_baseline";
    }
    return "unknown_baseline_origin";
  };
  const describeBaselineSourceSemantics = (value) => {
    if (value === "initial_pre_round_baseline") {
      return "A true pre-round baseline was captured before generator mutation began.";
    }
    if (value === "first_rendered_round_fallback") {
      return "No pre-round existing-product baseline was available, so the first rendered round is serving as the comparison baseline.";
    }
    if (value === "operator_provided_initial_baseline") {
      return "An operator-provided initial baseline is serving as the comparison baseline.";
    }
    if (value === "post_mutation_or_late_round_baseline") {
      return "The stored baseline came from post-mutation or later-round evidence, so it does not represent the initial prototype honestly.";
    }
    if (value === "unknown_baseline_origin") {
      return "The stored baseline origin is unclear, so it should not be trusted as an initial prototype without operator review.";
    }
    return undefined;
  };
  const baselineAttempt =
    (await readJsonIfExists(roundBaselineAttemptPath)) ??
    (await readJsonIfExists(artifactBaselineAttemptPath));
  let baselineState = await readJsonIfExists(baselineManifestPath);
  const baselinePresent =
    typeof baselineState?.baseline_path === "string" && baselineState.baseline_path.length > 0;
  const baselineValid =
    baselinePresent &&
    typeof baselineState?.source_phase === "string" &&
    validBaselineSourcePhases.has(baselineState.source_phase);
  const round1FallbackAllowed =
    browserSurfaceExpected &&
    packet.round === 1 &&
    currentScreenshotPath &&
    !baselineValid &&
    (config.project_mode === "new" ||
      baselineAttempt?.reason === "no_browser_target" ||
      baselineAttempt?.reason === "target_not_ready") &&
    baselineAttempt?.status !== "blocked";
  if (round1FallbackAllowed) {
    await copyFile(currentScreenshotPath, baselineScreenshotPath);
    baselineState = {
      source_round: 1,
      source_phase: "round_1_initial_prototype_fallback",
      source_semantics: "first_rendered_round_fallback",
      source_path: currentScreenshotPath,
      baseline_path: baselineScreenshotPath,
      created_at: new Date().toISOString()
    };
    await writeRuntimeJson("product-baseline.json", baselineState);
  }
  const baselineScreenshotReference =
    typeof baselineState?.baseline_path === "string" ? baselineState.baseline_path : undefined;
  const baselineSourcePhase =
    typeof baselineState?.source_phase === "string" ? baselineState.source_phase : undefined;
  const baselineSourceRound =
    typeof baselineState?.source_round === "number" ? baselineState.source_round : undefined;
  const baselineSourceSemantics =
    typeof baselineState?.source_semantics === "string"
      ? baselineState.source_semantics
      : baselineSourceSemanticsForPhase(baselineSourcePhase);
  const baselineSourceSemanticsDetail =
    describeBaselineSourceSemantics(baselineSourceSemantics);
  const prototypeBaselinePresent = Boolean(baselineScreenshotReference);
  const prototypeBaselineValid =
    prototypeBaselinePresent &&
    typeof baselineSourcePhase === "string" &&
    validBaselineSourcePhases.has(baselineSourcePhase);

  const reviewOverridePath = process.env.HARNESS_SUBJECTIVE_REVIEW_PATH;
  let subjectiveReview;
  let judgeArtifacts = [];
  let subjectiveJudgeDisabled = false;
  let subjectiveJudgeUnavailable = false;
  let subjectiveJudgeFailureReason;
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
        "Open and inspect any screenshot or browser trace paths listed below before scoring visual metrics.",
        "If a baseline screenshot is provided, compare the current UI against the baseline and score prototype_delta conservatively.",
        "Do not score prototype_delta above 6/10 unless the rendered product shows material improvement in layout, hierarchy, workflow visibility, or state expression.",
        "Do not score adapter_contract_fulfillment above 6/10 if workflow checks are satisfied only by static markers without realistic user behavior.",
        "",
        "# Product brief",
        ideaMarkdown || config.product_summary || config.product_title,
        "",
        "# Quality contract",
        JSON.stringify(profile.quality_contract ?? {}, null, 2),
        "",
        "# Adapter verification plan",
        JSON.stringify(adapterPlan, null, 2),
        "",
        "# Requested subjective metrics",
        JSON.stringify(subjectiveMetrics, null, 2),
        "",
        "# Core probe summary",
        JSON.stringify(evidenceInventory.core_probe_results, null, 2),
        "",
        "# Browser evidence",
        JSON.stringify(
          {
            browser_surface_expected: browserSurfaceExpected,
            current_screenshot_path: currentScreenshotPath,
            baseline_screenshot_path: baselineScreenshotReference,
            visual_evidence_paths: visualEvidencePaths
          },
          null,
          2
        ),
        "",
        "# Evidence inventory",
        JSON.stringify(evidenceInventory, null, 2)
      ].join("\\n");

      const judgeExecution = await runCodexCommand({
        name: "subjective-quality-judge",
        prompt,
        cwd: runtimePaths.targetRoot,
        artifactDirectory: runtimePaths.artifactsDirectory,
        allowCurrentThreadReadOnlyJudge: true,
        configOverrides: {
          approval_policy: "never",
          sandbox_mode: "read-only",
          "sandbox_read_only.network_access": false
        },
        addDirs: [runtimePaths.roundDirectory, runtimePaths.runtimeDirectory],
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
        subjectiveJudgeUnavailable = true;
        subjectiveJudgeDisabled = judgeExecution.disabled === true;
        subjectiveJudgeFailureReason = judgeExecution.disabled
          ? judgeExecution.error ??
            "Subjective quality judge was disabled before it could score the round."
          : judgeExecution.error
            ? judgeExecution.error
            : "Subjective quality judge did not return structured output.";
        subjectiveReview = failClosedSubjectiveReview(
          subjectiveMetrics,
          judgeExecution.disabled
            ? "Subjective quality judge was disabled, so configured subjective metrics failed closed."
            : judgeExecution.error
              ? "Subjective quality judge was unavailable, so configured subjective metrics failed closed."
              : "Subjective quality judge did not return structured output, so configured subjective metrics failed closed."
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
    const violations = Array.isArray(reviewMetric?.violations)
      ? [
          ...new Set(
            reviewMetric.violations
              .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
              .map((entry) => entry.trim())
          )
        ].slice(0, 6)
      : [];
    const evidenceQuality =
      reviewMetric?.evidence_quality && typeof reviewMetric.evidence_quality === "object"
        ? {
            ...(typeof reviewMetric.evidence_quality.has_required_evidence === "boolean"
              ? {
                  has_required_evidence:
                    reviewMetric.evidence_quality.has_required_evidence
                }
              : {}),
            ...(typeof reviewMetric.evidence_quality.evidence_type === "string" &&
            reviewMetric.evidence_quality.evidence_type.trim().length > 0
              ? {
                  evidence_type: reviewMetric.evidence_quality.evidence_type.trim()
                }
              : {})
          }
        : undefined;

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
      ...(violations.length > 0 ? { violations } : {}),
      ...(evidenceQuality && Object.keys(evidenceQuality).length > 0
        ? { evidence_quality: evidenceQuality }
        : {}),
      quality_axis_id: metric.quality_axis_id,
      required: metric.required ?? true
    };
  });
  const prototypeDeltaMetricIndex = subjectiveMetricResults.findIndex(
    (metric) => metric.metric_id === "prototype_delta"
  );
  const prototypeDeltaBaselineRequired = browserSurfaceExpected && packet.round >= 2;
  if (prototypeDeltaMetricIndex >= 0 && prototypeDeltaBaselineRequired && !prototypeBaselineValid) {
    subjectiveMetricResults[prototypeDeltaMetricIndex] = {
      ...subjectiveMetricResults[prototypeDeltaMetricIndex],
      score_out_of_ten: 0,
      status: "fail",
      rationale:
        "No valid initial prototype baseline was available, so prototype_delta failed closed.",
      recommended_changes: [
        "Capture or provide a valid initial prototype baseline before judging prototype_delta again."
      ]
    };
  }

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
              : undefined,
          browser_surface_expected: browserSurfaceExpected,
          current_screenshot_path: currentScreenshotPath,
          baseline_screenshot_path: baselineScreenshotReference,
          baseline_source_phase: baselineSourcePhase,
          baseline_source_semantics: baselineSourceSemantics,
          baseline_source_semantics_detail: baselineSourceSemanticsDetail,
          baseline_source_round: baselineSourceRound,
          prototype_baseline_valid: prototypeBaselineValid,
          visual_evidence_paths: visualEvidencePaths.map((path) =>
            path.startsWith(runtimePaths.roundDirectory) ? relativeToRound(path) : path
          )
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
  const requiredSubjectiveFailures = subjectiveMetricResults.filter(
    (metric) => (metric.required ?? true) && metric.status === "fail"
  );
  const prototypeDeltaMetric = subjectiveMetricResults.find(
    (metric) => metric.metric_id === "prototype_delta"
  );
  const prototypeDeltaRequired = browserSurfaceExpected && packet.round >= 2;
  const prototypeDeltaPassed =
    !prototypeDeltaRequired ||
    (prototypeBaselineValid && prototypeDeltaMetric?.status === "pass");
  const uncappedReleaseScore =
    subjectiveAverageNormalized === undefined
      ? browserSurfaceExpected
        ? roundScore(deterministicReleaseScore * 0.6)
        : deterministicReleaseScore
      : browserSurfaceExpected
        ? roundScore(0.35 * deterministicReleaseScore + 0.65 * subjectiveAverageNormalized)
        : roundScore(0.7 * deterministicReleaseScore + 0.3 * subjectiveAverageNormalized);
  let releaseScore = uncappedReleaseScore;
  const releaseScoreCapReasons = [];
  if (browserSurfaceExpected && subjectiveMetricResults.length === 0) {
    releaseScore = Math.min(releaseScore, 0.59);
    releaseScoreCapReasons.push(
      "Browser release score is capped at 0.590 because no subjective metric results were available."
    );
  }
  if (browserSurfaceExpected && visualEvidencePaths.length === 0) {
    releaseScore = Math.min(releaseScore, 0.59);
    releaseScoreCapReasons.push(
      "Browser release score is capped at 0.590 because no screenshots or traces were attached."
    );
  }
  if (browserSurfaceExpected && requiredSubjectiveFailures.length > 0) {
    releaseScore = Math.min(releaseScore, 0.79);
    releaseScoreCapReasons.push(
      "Browser release score is capped at 0.790 because required subjective metrics still fail: " +
        requiredSubjectiveFailures.map((metric) => metric.metric_id).join(", ") +
        "."
    );
  }
  if (browserSurfaceExpected && prototypeDeltaRequired && !prototypeBaselineValid) {
    releaseScore = Math.min(releaseScore, 0.84);
    releaseScoreCapReasons.push(
      "Browser release score is capped at 0.840 because no valid initial prototype baseline was available for prototype_delta judging."
    );
  } else if (browserSurfaceExpected && prototypeDeltaRequired && !prototypeDeltaPassed) {
    releaseScore = Math.min(releaseScore, 0.84);
    releaseScoreCapReasons.push(
      "Browser release score is capped at 0.840 because prototype_delta did not show a material improvement beyond the stored baseline."
    );
  }
  if (subjectiveJudgeUnavailable && subjectiveJudgeFailureReason) {
    releaseScoreCapReasons.push(
      "Subjective judge fallback was used: " + subjectiveJudgeFailureReason
    );
  }
  releaseScore = roundScore(releaseScore);
  const releaseScoreCap =
    releaseScoreCapReasons.length > 0 ? releaseScore : undefined;
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
      "Browser surface expected: " + String(browserSurfaceExpected),
      "Visual evidence present: " + String(visualEvidencePaths.length > 0),
      "Baseline screenshot: " + String(baselineScreenshotReference ?? "none"),
      "Baseline source phase: " + String(baselineSourcePhase ?? "none"),
      "Baseline semantics: " + String(baselineSourceSemantics ?? "none"),
      "Baseline meaning: " + String(baselineSourceSemanticsDetail ?? "none"),
      "Baseline source round: " + String(baselineSourceRound ?? "none"),
      "Baseline valid: " + String(prototypeBaselineValid),
      "Uncapped release score: " + String(uncappedReleaseScore),
      "Release score cap: " + String(releaseScoreCap ?? "none"),
      "Release score cap reasons: " + (releaseScoreCapReasons.join(" | ") || "none"),
      "Release score: " + String(releaseScore),
      "Threshold verdict: " + thresholdVerdict,
      "Overall verdict: " + overallVerdict
    ].join("\\n")
  );

  const findings = [
    ...(subjectiveJudgeUnavailable
      ? [
          "Status: needs_evaluator. Subjective quality judge could not complete scoring: " +
            (subjectiveJudgeFailureReason ?? "no judge failure reason was recorded")
        ]
      : []),
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
      ),
    ...releaseScoreCapReasons
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
              description: "Subjective quality review for configured product-quality metrics.",
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
      subjective_quality_present: subjectiveMetricResults.length > 0,
      subjective_judge_disabled: subjectiveJudgeDisabled,
      subjective_judge_unavailable: subjectiveJudgeUnavailable,
      ...(subjectiveJudgeFailureReason
        ? {
            subjective_judge_failure_reason: subjectiveJudgeFailureReason,
            subjective_judge_unavailable_reason: subjectiveJudgeFailureReason
          }
        : {}),
      ...(process.env.HARNESS_TRANSPORT
        ? { subjective_judge_transport_mode: process.env.HARNESS_TRANSPORT }
        : {}),
      visual_evidence_present: visualEvidencePaths.length > 0,
      prototype_baseline_present: prototypeBaselinePresent,
      prototype_baseline_valid: prototypeBaselineValid,
      ...(baselineSourcePhase ? { prototype_baseline_source_phase: baselineSourcePhase } : {}),
      ...(baselineSourceSemantics
        ? { prototype_baseline_source_semantics: baselineSourceSemantics }
        : {}),
      ...(typeof baselineSourceRound === "number"
        ? { prototype_baseline_source_round: baselineSourceRound }
        : {}),
      failed_subjective_metric_count: subjectiveMetricResults.filter(
        (metric) => metric.status === "fail"
      ).length,
      required_subjective_failure_count: subjectiveMetricResults.filter(
        (metric) => (metric.required ?? true) && metric.status === "fail"
      ).length,
      uncapped_release_score: uncappedReleaseScore,
      release_score_capped: releaseScoreCapReasons.length > 0,
      ...(typeof releaseScoreCap === "number" ? { release_score_cap: releaseScoreCap } : {}),
      ...(releaseScoreCapReasons.length > 0
        ? { release_score_cap_reasons: releaseScoreCapReasons }
        : {}),
      ...(subjectiveMetricResults.find((metric) => metric.metric_id === "prototype_delta")
        ? {
            prototype_delta_score_out_of_ten:
              subjectiveMetricResults.find((metric) => metric.metric_id === "prototype_delta")
                ?.score_out_of_ten ?? 0
          }
        : {}),
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
