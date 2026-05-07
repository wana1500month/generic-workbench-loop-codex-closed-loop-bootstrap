import { spawn } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { stopProcessTree } from "./process-tree.mjs";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const validationLoopTimeoutMs = () => {
  const parsed = Number(process.env.HARNESS_VALIDATION_LOOP_TIMEOUT_MS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 300000;
};

export const runLoop = async (args, options = {}) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ["./scripts/testing/run-validation-loop.mjs", ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...(options.env ?? {})
      },
      detached: process.platform !== "win32",
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeoutMs = validationLoopTimeoutMs();
    const timer = setTimeout(() => {
      timedOut = true;
      void stopProcessTree(child.pid ?? -1);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (options.silent !== true) {
        process.stdout.write(text);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (options.silent !== true) {
        process.stderr.write(text);
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        code: timedOut ? 124 : code ?? 1,
        stdout,
        stderr: timedOut
          ? `${stderr}\nValidation loop timed out after ${timeoutMs} ms.\n`
          : stderr
      });
    });
  });

const walkFiles = async (root, predicate) => {
  const matches = [];
  const visit = async (directory) => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (entry.isFile() && predicate(path)) {
        matches.push(path);
      }
    }
  };
  await visit(resolve(root));
  return matches;
};

const numericPid = (value) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : undefined;

const targetServerPidCandidates = async (execution) => {
  const pids = [
    numericPid(execution?.result?.metadata?.target_server_pid),
    numericPid(execution?.result?.metadata?.target_server_manifest_pid)
  ].filter(Boolean);
  const evidencePaths = [
    ...(execution?.result?.evidence_paths ?? []),
    ...(execution?.verified_evidence_paths ?? [])
  ].filter((path) => typeof path === "string");
  for (const evidencePath of evidencePaths) {
    if (!evidencePath.endsWith("run_target.log")) {
      continue;
    }
    try {
      const manifestPath = join(dirname(resolve(evidencePath)), "target-manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const pid = numericPid(manifest.target_server_pid);
      if (pid) {
        pids.push(pid);
      }
    } catch {
      // Missing legacy manifests are expected for older fixtures.
    }
  }
  return [...new Set(pids)];
};

export const cleanupReferenceTargetServers = async (runDirectory) => {
  const executionFiles = await walkFiles(
    runDirectory,
    (path) => path.endsWith("pre-verification-executions.json")
  );
  const stoppedPids = [];
  for (const executionFile of executionFiles) {
    let executions;
    try {
      executions = JSON.parse(await readFile(executionFile, "utf8"));
    } catch {
      continue;
    }
    if (!Array.isArray(executions)) {
      continue;
    }
    for (const execution of executions) {
      if (execution?.capability !== "run_target") {
        continue;
      }
      for (const pid of await targetServerPidCandidates(execution)) {
        if (await stopProcessTree(pid)) {
          stoppedPids.push(pid);
        }
      }
    }
  }
  return [...new Set(stoppedPids)];
};

export const extractRunDirectory = (stdout) => {
  const match = stdout.match(/Run created:\s+(.+)/);
  if (!match) {
    throw new Error("Could not find 'Run created:' in loop output.");
  }
  return resolve(repoRoot, match[1].trim());
};

export const readSummary = async (runDirectory) =>
  JSON.parse(await readFile(resolve(runDirectory, "summary.json"), "utf8"));

export const isCurrentThreadCheckpointStopReason = (stopReason) =>
  stopReason === "awaiting_codex_checkpoint" ||
  stopReason === "awaiting_current_thread_handoff";

export const driveCurrentThreadHandoffs = async ({
  runDirectory,
  resumeArgs,
  env,
  silent = true,
  label = "current-thread run",
  responseText,
  maxHandoffs = 12
}) => {
  let summary = await readSummary(runDirectory);
  for (let handoff = 0; isCurrentThreadCheckpointStopReason(summary.stop_reason); handoff += 1) {
    if (handoff >= maxHandoffs) {
      throw new Error(`${label} exceeded ${maxHandoffs} current-thread checkpoints.`);
    }
    if (!summary.operator_surface_path) {
      throw new Error(`${label} is awaiting a current-thread checkpoint but has no operator_surface_path.`);
    }
    const operatorSurface = await readJsonFile(summary.operator_surface_path);
    if (operatorSurface.transport_mode !== "current-thread") {
      throw new Error(
        `${label} expected current-thread operator surface, received '${operatorSurface.transport_mode ?? "missing"}'.`
      );
    }
    if (typeof operatorSurface.active_response_path !== "string") {
      throw new Error(
        `${label} is awaiting a current-thread checkpoint but has no active_response_path.`
      );
    }
    const effectiveResponseText =
      responseText ??
      `${JSON.stringify(
        operatorSurface.checkpoint_id
          ? { checkpoint_id: operatorSurface.checkpoint_id }
          : {},
        null,
        2
      )}\n`;
    await writeFile(resolve(operatorSurface.active_response_path), effectiveResponseText, "utf8");
    const execution = await runLoop(resumeArgs, {
      env,
      silent
    });
    if (execution.code !== 0) {
      throw new Error(
        `${label} resume step ${handoff + 1} failed.\n${execution.stdout}\n${execution.stderr}`
      );
    }
    summary = await readSummary(runDirectory);
  }
  return summary;
};

export const readTextFile = async (path) =>
  readFile(resolve(path), "utf8");

export const readJsonFile = async (path) =>
  JSON.parse(await readFile(resolve(path), "utf8"));

export const assertStopReason = (summary, expectedStopReason) => {
  const actualStopReason = summary.stop_reason;
  const matched =
    (expectedStopReason === "awaiting_codex_checkpoint" ||
      expectedStopReason === "awaiting_current_thread_handoff")
      ? isCurrentThreadCheckpointStopReason(actualStopReason)
      : actualStopReason === expectedStopReason;
  if (!matched) {
    throw new Error(
      `Expected stop_reason '${expectedStopReason}', received '${actualStopReason ?? "none"}'.`
    );
  }
};

export const assertRoundCount = (summary, expectedRoundCount) => {
  if (summary.round_count !== expectedRoundCount) {
    throw new Error(
      `Expected round_count '${expectedRoundCount}', received '${summary.round_count}'.`
    );
  }
};

export const latestRoundSummary = (summary) =>
  summary.round_history?.[summary.round_history.length - 1];

export const assertRoundBundleSemantics = (
  roundSummary,
  expectedTargetFamily,
  expectedValidationLane
) => {
  if (!roundSummary) {
    throw new Error("Expected a round summary, but none was recorded.");
  }

  if (roundSummary.target_family !== expectedTargetFamily) {
    throw new Error(
      `Expected round ${roundSummary.round} target_family '${expectedTargetFamily}', received '${roundSummary.target_family ?? "none"}'.`
    );
  }

  if (roundSummary.validation_lane !== expectedValidationLane) {
    throw new Error(
      `Expected round ${roundSummary.round} validation_lane '${expectedValidationLane}', received '${roundSummary.validation_lane ?? "none"}'.`
    );
  }
};

export const assertRoundStopReason = (
  roundSummary,
  expectedRoundStopReason,
  label = "round summary"
) => {
  if (!roundSummary) {
    throw new Error(`Expected ${label}, but no round summary was recorded.`);
  }

  if (roundSummary.round_stop_reason !== expectedRoundStopReason) {
    throw new Error(
      `Expected ${label} round_stop_reason '${expectedRoundStopReason}', received '${roundSummary.round_stop_reason ?? "missing"}'.`
    );
  }
};

export const assertTargetFamily = (summary, expectedTargetFamily) => {
  if (summary.target_family !== expectedTargetFamily) {
    throw new Error(
      `Expected target_family '${expectedTargetFamily}', received '${summary.target_family ?? "none"}'.`
    );
  }
};

export const assertValidationLane = (summary, expectedValidationLane) => {
  if (summary.validation_lane !== expectedValidationLane) {
    throw new Error(
      `Expected validation_lane '${expectedValidationLane}', received '${summary.validation_lane ?? "none"}'.`
    );
  }
};

export const assertRuntimeWarningContains = (summary, expectedSubstring) => {
  const warnings = summary.runtime_warnings ?? [];
  if (!warnings.some((warning) => warning.includes(expectedSubstring))) {
    throw new Error(
      `Expected runtime warnings to contain '${expectedSubstring}', but received: ${warnings.join(" | ") || "none"}.`
    );
  }
};

export const assertRuntimeWarningMissing = (summary, unexpectedSubstring) => {
  const warnings = summary.runtime_warnings ?? [];
  if (warnings.some((warning) => warning.includes(unexpectedSubstring))) {
    throw new Error(
      `Expected runtime warnings to exclude '${unexpectedSubstring}', but received: ${warnings.join(" | ") || "none"}.`
    );
  }
};

export const assertRuntimeEventCode = (summary, expectedCode) => {
  const eventCodes = (summary.runtime_events ?? []).map((event) => event.code);
  if (!eventCodes.includes(expectedCode)) {
    throw new Error(
      `Expected runtime_events to include '${expectedCode}', but received: ${eventCodes.join(", ") || "none"}.`
    );
  }
};

export const assertRuntimeEventCodeMissing = (summary, unexpectedCode) => {
  const eventCodes = (summary.runtime_events ?? []).map((event) => event.code);
  if (eventCodes.includes(unexpectedCode)) {
    throw new Error(
      `Expected runtime_events to exclude '${unexpectedCode}', but received: ${eventCodes.join(", ") || "none"}.`
    );
  }
};

export const readResumeDecisionArtifact = async (summary) => {
  if (!summary.resume_decision_path) {
    throw new Error("Expected summary.resume_decision_path to be present.");
  }
  return readJsonFile(summary.resume_decision_path);
};

export const assertTextContains = (text, expectedSubstring, label = "text") => {
  if (!text.includes(expectedSubstring)) {
    throw new Error(
      `Expected ${label} to contain '${expectedSubstring}', but it did not.`
    );
  }
};

export const assertControllerDecisionBundleSemantics = async (
  roundSummary,
  expectedTargetFamily,
  expectedValidationLane,
  label = "controller decision"
) => {
  assertRoundBundleSemantics(
    roundSummary,
    expectedTargetFamily,
    expectedValidationLane
  );
  const controllerDecision = await readTextFile(roundSummary.controller_decision_path);
  assertTextContains(
    controllerDecision,
    `Target family: ${expectedTargetFamily}`,
    label
  );
  assertTextContains(
    controllerDecision,
    `Validation lane: ${expectedValidationLane}`,
    label
  );
};

export const assertSuccessfulRoundHasNoFailureClassification = async (
  roundSummary,
  label = "successful round"
) => {
  if (!roundSummary?.failure_lineage_path) {
    throw new Error(`Expected ${label} to persist failure_lineage_path.`);
  }
  const failureLineage = await readJsonFile(roundSummary.failure_lineage_path);
  if (failureLineage.failure_classification !== "none") {
    throw new Error(
      `Expected ${label} to record failure_classification 'none', received '${failureLineage.failure_classification ?? "missing"}'.`
    );
  }
};

export const assertEnvironmentBlockedRound = async (
  roundSummary,
  label = "environment-blocked round"
) => {
  if (!roundSummary?.failure_lineage_path) {
    throw new Error(`Expected ${label} to persist failure_lineage_path.`);
  }
  const [failureLineage, patchRequest] = await Promise.all([
    readJsonFile(roundSummary.failure_lineage_path),
    readJsonFile(roundSummary.patch_request_path)
  ]);
  if (failureLineage.failure_classification !== "environment_blocked") {
    throw new Error(
      `Expected ${label} to record failure_classification 'environment_blocked', received '${failureLineage.failure_classification ?? "missing"}'.`
    );
  }
  if (patchRequest.next_action !== "hold") {
    throw new Error(
      `Expected ${label} to keep patch_request.next_action 'hold', received '${patchRequest.next_action ?? "missing"}'.`
    );
  }
};

export const assertEvalReportCoverage = async (
  roundSummary,
  { expectedProbeIds = [], expectedCriterionIds = [], label = "eval report" } = {}
) => {
  if (!roundSummary?.eval_report_path) {
    throw new Error(`Expected ${label} to persist eval_report_path.`);
  }

  const evalReport = await readJsonFile(roundSummary.eval_report_path);
  const observedProbeIds = new Set(
    (evalReport.core_probe_results ?? []).map((probe) => probe.probe_id)
  );
  const observedCriterionIds = new Set(
    (evalReport.adapter_results ?? []).flatMap((execution) =>
      (execution.verified_criteria_results ?? []).map((criterion) => criterion.criterion_id)
    )
  );

  const missingProbeIds = expectedProbeIds.filter((probeId) => !observedProbeIds.has(probeId));
  if (missingProbeIds.length > 0) {
    throw new Error(
      `Expected ${label} to include probe ids ${missingProbeIds.join(", ")}, but they were missing.`
    );
  }

  const missingCriterionIds = expectedCriterionIds.filter(
    (criterionId) => !observedCriterionIds.has(criterionId)
  );
  if (missingCriterionIds.length > 0) {
    throw new Error(
      `Expected ${label} to include criterion ids ${missingCriterionIds.join(", ")}, but they were missing.`
    );
  }
};

export const assertRoundContractReleaseQa = async (
  roundSummary,
  {
    expectedBrowserProbeIds = [],
    expectedApiProbeIds = [],
    label = "round contract release QA"
  } = {}
) => {
  if (!roundSummary?.contract_path) {
    throw new Error(`Expected ${label} to persist contract_path.`);
  }
  const roundContract = await readJsonFile(roundSummary.contract_path);
  const missingBrowserProbeIds = expectedBrowserProbeIds.filter(
    (probeId) => !(roundContract.browser_release_gate_probe_ids ?? []).includes(probeId)
  );
  if (missingBrowserProbeIds.length > 0) {
    throw new Error(
      `Expected ${label} to include browser probe ids ${missingBrowserProbeIds.join(", ")}, but they were missing.`
    );
  }
  const missingApiProbeIds = expectedApiProbeIds.filter(
    (probeId) => !(roundContract.api_release_gate_probe_ids ?? []).includes(probeId)
  );
  if (missingApiProbeIds.length > 0) {
    throw new Error(
      `Expected ${label} to include api probe ids ${missingApiProbeIds.join(", ")}, but they were missing.`
    );
  }
  if (!(roundContract.release_gate_check_ids ?? []).length) {
    throw new Error(`Expected ${label} to include release_gate_check_ids.`);
  }
  if (!(roundContract.pivot_triggers ?? []).length) {
    throw new Error(`Expected ${label} to include pivot_triggers.`);
  }
  return roundContract;
};

export const assertDimensionScores = async (
  roundSummary,
  {
    expectedDimensionIds = [],
    requireThresholdsMet,
    label = "dimension scores"
  } = {}
) => {
  if (!roundSummary?.eval_report_path) {
    throw new Error(`Expected ${label} to persist eval_report_path.`);
  }
  const evalReport = await readJsonFile(roundSummary.eval_report_path);
  const observedDimensionIds = new Set(
    (evalReport.dimension_scores ?? []).map((dimension) => dimension.dimension_id)
  );
  const missingDimensionIds = expectedDimensionIds.filter(
    (dimensionId) => !observedDimensionIds.has(dimensionId)
  );
  if (missingDimensionIds.length > 0) {
    throw new Error(
      `Expected ${label} to include dimension ids ${missingDimensionIds.join(", ")}, but they were missing.`
    );
  }
  if (
    requireThresholdsMet !== undefined &&
    Boolean(evalReport.threshold_results?.dimension_thresholds_met) !== requireThresholdsMet
  ) {
    throw new Error(
      `Expected ${label} dimension_thresholds_met '${requireThresholdsMet}', received '${evalReport.threshold_results?.dimension_thresholds_met ?? "missing"}'.`
    );
  }
  return evalReport.dimension_scores ?? [];
};

export const assertFailurePolicyRecommendation = async (
  roundSummary,
  expectedAction,
  label = "failure policy"
) => {
  if (!roundSummary?.failure_lineage_path) {
    throw new Error(`Expected ${label} to persist failure_lineage_path.`);
  }
  const failureLineage = await readJsonFile(roundSummary.failure_lineage_path);
  const action = failureLineage.policy_snapshot?.recommended_action;
  if (action !== expectedAction) {
    throw new Error(
      `Expected ${label} to recommend '${expectedAction}', received '${action ?? "missing"}'.`
    );
  }
};

export const assertDecisionSource = (
  roundSummary,
  expectedDecisionSource,
  label = "decision source"
) => {
  if (!roundSummary) {
    throw new Error(`Expected ${label}, but no round summary was recorded.`);
  }
  if (roundSummary.decision_source !== expectedDecisionSource) {
    throw new Error(
      `Expected ${label} '${expectedDecisionSource}', received '${roundSummary.decision_source ?? "missing"}'.`
    );
  }
};

export const assertFailurePolicySnapshot = async (
  roundSummary,
  {
    expectedAction,
    expectedDominantTrigger,
    expectedPatchAuthorityState,
    expectedRecommendationSource,
    expectedTriggerCodes = [],
    label = "failure policy snapshot"
  }
) => {
  if (!roundSummary?.failure_lineage_path) {
    throw new Error(`Expected ${label} to persist failure_lineage_path.`);
  }
  const failureLineage = await readJsonFile(roundSummary.failure_lineage_path);
  const snapshot = failureLineage.policy_snapshot;
  if (!snapshot) {
    throw new Error(`Expected ${label} to persist policy_snapshot.`);
  }
  if (expectedAction && snapshot.recommended_action !== expectedAction) {
    throw new Error(
      `Expected ${label} recommended_action '${expectedAction}', received '${snapshot.recommended_action ?? "missing"}'.`
    );
  }
  if (
    expectedDominantTrigger &&
    snapshot.dominant_trigger_code !== expectedDominantTrigger
  ) {
    throw new Error(
      `Expected ${label} dominant_trigger_code '${expectedDominantTrigger}', received '${snapshot.dominant_trigger_code ?? "missing"}'.`
    );
  }
  if (
    expectedPatchAuthorityState &&
    snapshot.patch_authority_state !== expectedPatchAuthorityState
  ) {
    throw new Error(
      `Expected ${label} patch_authority_state '${expectedPatchAuthorityState}', received '${snapshot.patch_authority_state ?? "missing"}'.`
    );
  }
  if (
    expectedRecommendationSource &&
    snapshot.recommendation_source !== expectedRecommendationSource
  ) {
    throw new Error(
      `Expected ${label} recommendation_source '${expectedRecommendationSource}', received '${snapshot.recommendation_source ?? "missing"}'.`
    );
  }
  const missingTriggerCodes = expectedTriggerCodes.filter(
    (code) => !(snapshot.trigger_codes ?? []).includes(code)
  );
  if (missingTriggerCodes.length > 0) {
    throw new Error(
      `Expected ${label} to include trigger_codes ${missingTriggerCodes.join(", ")}, but they were missing.`
    );
  }
  return snapshot;
};

export const assertPatchOnlyArtifactSurface = async (
  roundSummary,
  label = "patch-only artifact surface"
) => {
  if (!roundSummary) {
    throw new Error(`Expected ${label}, but no round summary was recorded.`);
  }
  if (roundSummary.negotiation_mode !== "patch_only") {
    throw new Error(
      `Expected ${label} negotiation_mode 'patch_only', received '${roundSummary.negotiation_mode}'.`
    );
  }
  if (roundSummary.contract_review_path) {
    throw new Error(
      `Expected ${label} to omit contract_review_path, but found '${roundSummary.contract_review_path}'.`
    );
  }
  if (roundSummary.contract_agreement_path) {
    throw new Error(
      `Expected ${label} to omit contract_agreement_path, but found '${roundSummary.contract_agreement_path}'.`
    );
  }
  for (const requiredPath of [
    "contract_path",
    "generator_plan_path",
    "patch_request_path",
    "quality_critique_path",
    "trajectory_decision_path",
    "eval_report_path",
    "failure_lineage_path"
  ]) {
    if (!roundSummary[requiredPath]) {
      throw new Error(`Expected ${label} to persist '${requiredPath}'.`);
    }
  }
};

export const assertRecontractArtifactSurface = async (
  roundSummary,
  label = "recontract artifact surface"
) => {
  if (!roundSummary) {
    throw new Error(`Expected ${label}, but no round summary was recorded.`);
  }
  if (roundSummary.negotiation_mode !== "recontract") {
    throw new Error(
      `Expected ${label} negotiation_mode 'recontract', received '${roundSummary.negotiation_mode}'.`
    );
  }
  for (const requiredPath of [
    "contract_path",
    "contract_review_path",
    "contract_agreement_path",
    "generator_plan_path",
    "patch_request_path",
    "quality_critique_path",
    "trajectory_decision_path",
    "eval_report_path",
    "failure_lineage_path"
  ]) {
    if (!roundSummary[requiredPath]) {
      throw new Error(`Expected ${label} to persist '${requiredPath}'.`);
    }
  }
};

export const assertQualityCritiqueSurface = async (
  roundSummary,
  {
    expectedStrategy,
    minimumFindingCount = 1,
    requirePreserveSignals = true,
    label = "quality critique"
  } = {}
) => {
  if (!roundSummary?.quality_critique_path) {
    throw new Error(`Expected ${label} to persist quality_critique_path.`);
  }
  const qualityCritique = await readJsonFile(roundSummary.quality_critique_path);
  if (
    expectedStrategy &&
    qualityCritique.remediation_strategy !== expectedStrategy
  ) {
    throw new Error(
      `Expected ${label} remediation_strategy '${expectedStrategy}', received '${qualityCritique.remediation_strategy ?? "missing"}'.`
    );
  }
  if ((qualityCritique.findings ?? []).length < minimumFindingCount) {
    throw new Error(
      `Expected ${label} to include at least ${minimumFindingCount} finding(s), received ${(qualityCritique.findings ?? []).length}.`
    );
  }
  if (
    requirePreserveSignals &&
    !(qualityCritique.preserve_signals ?? []).length
  ) {
    throw new Error(`Expected ${label} to include preserve_signals.`);
  }
  return qualityCritique;
};

export const assertPatchRequestQualitySurface = async (
  roundSummary,
  {
    expectedStrategy,
    minimumMustFixCount = 1,
    requireQualityFindings = true,
    label = "patch request quality surface"
  } = {}
) => {
  if (!roundSummary?.patch_request_path) {
    throw new Error(`Expected ${label} to persist patch_request_path.`);
  }
  const patchRequest = await readJsonFile(roundSummary.patch_request_path);
  if (
    expectedStrategy &&
    patchRequest.remediation_strategy !== expectedStrategy
  ) {
    throw new Error(
      `Expected ${label} remediation_strategy '${expectedStrategy}', received '${patchRequest.remediation_strategy ?? "missing"}'.`
    );
  }
  if ((patchRequest.must_fix ?? []).length < minimumMustFixCount) {
    throw new Error(
      `Expected ${label} to include at least ${minimumMustFixCount} must_fix item(s), received ${(patchRequest.must_fix ?? []).length}.`
    );
  }
  if (
    requireQualityFindings &&
    !(patchRequest.quality_findings ?? []).length
  ) {
    throw new Error(`Expected ${label} to include structured quality_findings.`);
  }
  if (!(patchRequest.must_preserve ?? []).length) {
    throw new Error(`Expected ${label} to include must_preserve signals.`);
  }
  return patchRequest;
};

export const assertTrajectoryDecisionSurface = async (
  roundSummary,
  {
    expectedMode,
    expectedRestartFrom,
    label = "trajectory decision"
  } = {}
) => {
  if (!roundSummary?.trajectory_decision_path) {
    throw new Error(`Expected ${label} to persist trajectory_decision_path.`);
  }
  const trajectoryDecision = await readJsonFile(roundSummary.trajectory_decision_path);
  if (expectedMode && trajectoryDecision.mode !== expectedMode) {
    throw new Error(
      `Expected ${label} mode '${expectedMode}', received '${trajectoryDecision.mode ?? "missing"}'.`
    );
  }
  if (
    expectedRestartFrom &&
    trajectoryDecision.restart_from !== expectedRestartFrom
  ) {
    throw new Error(
      `Expected ${label} restart_from '${expectedRestartFrom}', received '${trajectoryDecision.restart_from ?? "missing"}'.`
    );
  }
  if (!(trajectoryDecision.preserve_signals ?? []).length) {
    throw new Error(`Expected ${label} to include preserve_signals.`);
  }
  return trajectoryDecision;
};

export const environmentPreflightChecklist = (targetFamily) => [
  `Run the ${targetFamily} preflight inside the Playwright-ready devcontainer or Docker image documented in RUNBOOK.md.`,
  "Install or expose a Chromium-compatible browser executable so headless browser probes can launch.",
  "Allow localhost browser navigation and loopback networking in the current host or CI environment.",
  "If the host remains blocked, use the deterministic semantic lane for controller regression and rerun realism preflight in the browser-ready environment."
];

export const writeEnvironmentPreflightArtifact = async ({
  runDirectory,
  artifactName,
  targetFamily,
  validationLane,
  stopReason,
  ready,
  checklist,
  notes = []
}) => {
  const artifactPath = join(runDirectory, artifactName);
  await writeFile(
    artifactPath,
    `${JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        target_family: targetFamily,
        validation_lane: validationLane,
        stop_reason: stopReason ?? null,
        ready,
        checklist,
        notes,
        summary_path: join(runDirectory, "summary.json")
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return artifactPath;
};
