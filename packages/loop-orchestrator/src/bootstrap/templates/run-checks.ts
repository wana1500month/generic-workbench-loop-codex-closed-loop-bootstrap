export const runChecksTemplate = (): string => `import {
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
  const workflowChecks =
    Array.isArray(config.workflow_checks) && config.workflow_checks.length > 0
      ? config.workflow_checks
      : Array.isArray(config.adapter_plan?.workflow_checks)
        ? config.adapter_plan.workflow_checks
        : [];
  const workflowCheckForProbe = (probe) =>
    workflowChecks.find(
      (check) =>
        typeof check.workflow === "string" &&
        typeof probe.label === "string" &&
        probe.label.includes(check.workflow)
    );
  const workflowCheckForCriterion = (criterion) => {
    const assertionId = criterion.assertion_id ?? criterion.criterion_id;
    const probe = probeByAssertionId.get(assertionId);
    return probe ? workflowCheckForProbe(probe) : undefined;
  };
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
      workflow_check: workflowCheckForProbe(probe) ?? null,
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
    const workflowCheck = workflowCheckForCriterion(criterion);
    return {
      criterion_id: criterion.criterion_id,
      status: probe?.ok ? "pass" : "fail",
      summary: workflowCheck
        ? probe?.ok
          ? "Workflow passed: " + workflowCheck.workflow + "."
          : "Workflow failed: " +
            workflowCheck.workflow +
            ". Expected: " +
            workflowCheck.expected_result
        : probe?.summary ??
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
      ...failedReleaseGateProbes.map((probe) => {
        const workflowCheck = workflowCheckForProbe(probe);
        return workflowCheck
          ? "Workflow failed: " +
              workflowCheck.workflow +
              ". Expected " +
              workflowCheck.expected_result +
              "."
          : "Release-gate probe failed: " + probe.probe_id + ".";
      })
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
