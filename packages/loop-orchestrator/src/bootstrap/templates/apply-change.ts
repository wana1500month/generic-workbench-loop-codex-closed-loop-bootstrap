export const applyChangeTemplate = (): string => `import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  captureBrowserBaselineIfNeeded,
  finalize,
  readConfig,
  readJsonIfExists,
  readPacket,
  readCodexSession,
  relativeToRound,
  runCodexCommand,
  runtimePaths,
  writeArtifact,
  writeArtifactJson,
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
  const previousTrajectoryDecision = previousRoundDirectory
    ? await readJsonIfExists(join(previousRoundDirectory, "trajectory-decision.json"))
    : undefined;
  const previousEvalReport = previousRoundDirectory
    ? await readJsonIfExists(join(previousRoundDirectory, "eval_report.json"))
    : undefined;
  const controllerMode =
    process.env.HARNESS_CONTROLLER_MODE === "attached" ? "attached" : "detached";
  const transportMode =
    process.env.HARNESS_TRANSPORT === "codex-exec" ||
    process.env.HARNESS_TRANSPORT === "current-thread" ||
    process.env.HARNESS_TRANSPORT === "app-server"
      ? process.env.HARNESS_TRANSPORT
      : controllerMode === "attached"
        ? "current-thread"
        : "codex-exec";
  const baselineCapture =
    packet.round === 1
      ? transportMode === "codex-exec"
        ? await captureBrowserBaselineIfNeeded({ config })
        : (() => {
            const baselineManifestPath = join(runtimePaths.runtimeDirectory, "product-baseline.json");
            return readJsonIfExists(baselineManifestPath).then((baselineState) => {
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
              return {
                status: "skipped",
                reason: "attached_transport_requires_pre_generator_capture",
                source_phase:
                  typeof baselineState?.source_phase === "string" ? baselineState.source_phase : undefined,
                source_semantics: baselineSourceSemanticsForPhase(baselineState?.source_phase),
                baseline_path:
                  typeof baselineState?.baseline_path === "string"
                    ? baselineState.baseline_path
                    : undefined,
                source_target:
                  typeof baselineState?.source_target === "string"
                    ? baselineState.source_target
                    : undefined
              };
            });
          })()
      : undefined;
  const baselineCaptureNotePath = baselineCapture
    ? await writeArtifact(
        "pre-round-baseline.md",
        [
          "# Pre-round baseline",
          "",
          "Status: " + baselineCapture.status,
          "Source phase: " + String(baselineCapture.source_phase ?? "n/a"),
          "Source semantics: " + String(baselineCapture.source_semantics ?? "n/a"),
          "Baseline path: " + String(baselineCapture.baseline_path ?? "n/a"),
          "Target: " + String(baselineCapture.source_target ?? baselineCapture.readiness_url ?? "n/a"),
          "Reason: " + String(baselineCapture.reason ?? "none")
        ].join("\\n")
      )
    : undefined;
  const baselineCaptureJsonPath = baselineCapture
    ? await writeArtifactJson("pre-round-baseline.json", baselineCapture)
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
    latest_trajectory_decision: previousTrajectoryDecision
      ? {
          mode: previousTrajectoryDecision.mode,
          restart_from: previousTrajectoryDecision.restart_from,
          preserve_signals: previousTrajectoryDecision.preserve_signals,
          discardable_surface: previousTrajectoryDecision.discardable_surface,
          novelty_target: previousTrajectoryDecision.novelty_target,
          reason: previousTrajectoryDecision.reason,
          selected_round: previousTrajectoryDecision.selected_round,
          frontier: previousTrajectoryDecision.frontier
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
  const attachedGeneratorTaskPath =
    typeof process.env.HARNESS_ATTACHED_GENERATOR_TASK_PATH === "string"
      ? process.env.HARNESS_ATTACHED_GENERATOR_TASK_PATH
      : undefined;
  const attachedGeneratorResponsePath =
    typeof process.env.HARNESS_GENERATOR_RESPONSE_PATH === "string"
      ? process.env.HARNESS_GENERATOR_RESPONSE_PATH
      : undefined;
  if (transportMode === "current-thread" || transportMode === "app-server") {
    const attachedGeneratorResponse =
      attachedGeneratorResponsePath
        ? await readJsonIfExists(attachedGeneratorResponsePath)
        : undefined;
    const attachedNotePath = await writeArtifact(
      "apply-change.attached-controller.txt",
      [
        "Same-thread transports forbid nested Codex execution from bootstrap apply_change.",
        "Use the current Codex thread or App Server turn to perform generator work, then write the attached generator response artifact before apply_change resumes."
      ].join("\\n")
    );
    if (
      attachedGeneratorResponse &&
      (attachedGeneratorResponse.status === "applied" ||
        attachedGeneratorResponse.status === "noop") &&
      typeof attachedGeneratorResponse.summary === "string" &&
      attachedGeneratorResponse.summary.trim().length > 0
    ) {
      await finalize({
        capability: "apply_change",
        ok: true,
        summary:
          transportMode === "app-server"
            ? "App Server attached generator completed the round mutation."
            : "Current-thread attached generator completed the round mutation.",
        findings: [
          attachedGeneratorResponse.summary,
          ...(baselineCapture?.status === "blocked" && baselineCapture.reason
            ? ["Pre-round baseline capture was blocked: " + baselineCapture.reason]
            : []),
          ...(Array.isArray(attachedGeneratorResponse.notes)
            ? attachedGeneratorResponse.notes
            : [])
        ],
        evidence_paths: [
          remediationBriefPath,
          attachedNotePath,
          baselineCaptureNotePath,
          baselineCaptureJsonPath,
          attachedGeneratorTaskPath ? relativeToRound(attachedGeneratorTaskPath) : undefined,
          attachedGeneratorResponsePath
            ? relativeToRound(attachedGeneratorResponsePath)
            : undefined,
          ...(Array.isArray(attachedGeneratorResponse.evidence_paths)
            ? attachedGeneratorResponse.evidence_paths
            : [])
        ].filter(Boolean)
      });
      return;
    }
    await finalize({
      capability: "apply_change",
      ok: false,
      summary:
        "Transport '" +
        transportMode +
        "' requires an attached generator response before bootstrap apply_change can continue.",
      findings: [
        "HARNESS_TRANSPORT=" +
          transportMode +
          " requires generator work to stay on the active thread or App Server turn instead of spawning codex exec from bootstrap apply_change.",
        ...(baselineCapture?.status === "blocked" && baselineCapture.reason
          ? ["Pre-round baseline capture was blocked: " + baselineCapture.reason]
          : []),
        attachedGeneratorResponsePath
          ? "Expected attached generator response at " + attachedGeneratorResponsePath + "."
          : "HARNESS_GENERATOR_RESPONSE_PATH was not provided."
      ],
      evidence_paths: [
        remediationBriefPath,
        attachedNotePath,
        baselineCaptureNotePath,
        baselineCaptureJsonPath,
        attachedGeneratorTaskPath ? relativeToRound(attachedGeneratorTaskPath) : undefined
      ].filter(Boolean)
    });
    process.exitCode = 1;
    return;
  }
  const prompt = [
    "You are the generator for a closed-loop harness.",
    "Work only inside the target root.",
    "Use the intake brief and the current round packet to decide what to build next.",
    "Prefer the smallest coherent set of changes that moves the product forward.",
    "When remediation artifacts are present, treat them as load-bearing instructions.",
    "When a trajectory decision says pivot or parallel_pivot, do not keep sanding the same head. Re-open from the selected anchor and replace the discardable surface.",
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

  const storedGeneratorSession = await readCodexSession(
    runtimePaths.codexSessionRegistryPath,
    "generator"
  );
  const storedGeneratorSessionId =
    typeof storedGeneratorSession?.thread_id === "string" &&
    storedGeneratorSession.thread_id.trim().length > 0
      ? storedGeneratorSession.thread_id.trim()
      : undefined;
  const storedGeneratorSessionTargetRoot =
    typeof storedGeneratorSession?.metadata?.target_root === "string" &&
    storedGeneratorSession.metadata.target_root.trim().length > 0
      ? storedGeneratorSession.metadata.target_root.trim()
      : undefined;
  const generatorSessionMatchesTarget =
    typeof storedGeneratorSessionId === "string" &&
    (!storedGeneratorSession?.cwd ||
      storedGeneratorSession.cwd === runtimePaths.targetRoot) &&
    (!storedGeneratorSessionTargetRoot ||
      storedGeneratorSessionTargetRoot === runtimePaths.targetRoot);
  const generatorSessionId = generatorSessionMatchesTarget
    ? storedGeneratorSessionId
    : undefined;

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
    sessionId: generatorSessionId,
    artifactDirectory: runtimePaths.artifactsDirectory,
    metadata: {
      role: "generator",
      capability: "apply_change",
      session_registry_path: runtimePaths.codexSessionRegistryPath,
      stored_session_id: storedGeneratorSessionId ?? null,
      resume_source: generatorSessionId ? "session_registry" : "fresh_exec",
      resume_skipped_reason:
        storedGeneratorSessionId && !generatorSessionMatchesTarget
          ? "stored_generator_session_target_mismatch"
          : null
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
    baselineCaptureNotePath,
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
            ...(baselineCapture?.status === "blocked" && baselineCapture.reason
              ? ["Pre-round baseline capture was blocked: " + baselineCapture.reason]
              : []),
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

