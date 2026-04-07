import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";

import {
  cleanupTempRoot,
  createTempRoot,
  ensureBuild,
  importDist,
  readJsonFile,
  runCommand,
  writeJsonFile
} from "./testing/bootstrap-validator-helpers.mjs";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const listen = async (server) =>
  new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectPromise);
      resolvePromise(server.address());
    });
  });

const closeServer = async (server) =>
  new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => {
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise();
    });
  });

const createFixture = async (tempRoot) => {
  const workspaceRoot = join(tempRoot, "workspace");
  const targetRoot = join(tempRoot, "target-app");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(targetRoot, { recursive: true });

  const server = createServer((request, response) => {
    if (request.url?.startsWith("/healthz")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (request.url?.startsWith("/api/")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ready" }));
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<div data-testid='app-shell'>fixture</div>");
  });
  const address = await listen(server);
  if (!address || typeof address === "string") {
    throw new Error("custom quality validator fixture did not expose a TCP port");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const { createBootstrapArtifactPaths, scaffoldBootstrapArtifacts } =
    await importDist("bootstrap.js");
  const paths = createBootstrapArtifactPaths(workspaceRoot);
  await scaffoldBootstrapArtifacts(
    {
      title: "Subjective Quality App",
      summary: "A fixture app for validating bootstrap subjective quality metrics.",
      targetUsers: ["reviewer"],
      coreFeatures: ["review release"],
      referenceApps: ["Linear"],
      finishLine: "A reviewer can complete the release workflow without losing context.",
      targetFamily: "api-service",
      goalLevel: "usable",
      targetScore: 0.9,
      maxRounds: 2,
      targetRoot,
      projectMode: "existing",
      frameworkHint: "Express",
      packageManager: "npm",
      runCommand: "npm run dev",
      checkCommand: "",
      readyUrl: `${baseUrl}/healthz`,
      healthUrl: `${baseUrl}/healthz`,
      apiBaseUrl: `${baseUrl}/api/`,
      constraints: ["Keep verifier wiring deterministic."],
      qualityBar: ["Design quality must score at least 8/10."],
      customQualityMetrics: [
        {
          metricId: "design-quality",
          label: "Design quality",
          description:
            "Reward clear hierarchy, spacing consistency, and polished visual execution.",
          minimumScoreOutOfTen: 8,
          required: true,
          weight: 2
        }
      ],
      notes: "bootstrap custom quality validator"
    },
    paths
  );

  const runDirectory = join(tempRoot, "run");
  const roundDirectory = join(runDirectory, "round-001");
  const adapterDirectory = join(roundDirectory, "adapter");
  const runtimeDirectory = join(runDirectory, "runtime");
  const coreProbesDirectory = join(roundDirectory, "core-probes");
  await mkdir(adapterDirectory, { recursive: true });
  await mkdir(runtimeDirectory, { recursive: true });
  await mkdir(coreProbesDirectory, { recursive: true });

  return {
    server,
    baseUrl,
    paths,
    workspaceRoot,
    targetRoot,
    runDirectory,
    roundDirectory,
    adapterDirectory,
    runtimeDirectory,
    coreProbesDirectory,
    sessionRegistryPath: join(runtimeDirectory, "codex-sessions.json"),
    coreProbeResultsPath: join(roundDirectory, "core-probe-results.json"),
    targetManifestPath: join(roundDirectory, "target-manifest.json"),
    subjectiveReviewOverridePath: join(roundDirectory, "subjective-review-override.json"),
    runChecksScriptPath: join(paths.generatedScriptsRoot, "run-checks.mjs"),
    gradeRoundScriptPath: join(paths.generatedScriptsRoot, "grade-round.mjs")
  };
};

const writeCapabilityPacket = async (fixture, capability) => {
  const inputPath = join(fixture.adapterDirectory, `${capability}-input.json`);
  await writeJsonFile(inputPath, {
    capability,
    round: 1
  });
  return inputPath;
};

const capabilityEnv = (fixture, capability, inputPath, outputPath, overrides = {}) => ({
  ...process.env,
  HARNESS_ROUND_DIRECTORY: fixture.roundDirectory,
  HARNESS_RUN_DIRECTORY: fixture.runDirectory,
  HARNESS_RUNTIME_DIRECTORY: fixture.runtimeDirectory,
  HARNESS_CODEX_SESSION_REGISTRY_PATH: fixture.sessionRegistryPath,
  HARNESS_INPUT_PATH: inputPath,
  HARNESS_OUTPUT_PATH: outputPath,
  HARNESS_TARGET_ROOT: fixture.targetRoot,
  HARNESS_CORE_PROBE_RESULTS_PATH: fixture.coreProbeResultsPath,
  HARNESS_TARGET_MANIFEST_PATH: fixture.targetManifestPath,
  HARNESS_VERIFICATION_PROFILE_PATH: fixture.paths.generatedVerificationProfilePath,
  HARNESS_PROVIDER_ID: "generated-codex-verifier",
  HARNESS_PROVIDER_ROLE: "verifier",
  HARNESS_CAPABILITY: capability,
  ...overrides
});

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-bootstrap-custom-quality-metrics");
  let server;

  try {
    const fixture = await createFixture(tempRoot);
    server = fixture.server;

    const generatedProfile = await readJsonFile(
      fixture.paths.generatedVerificationProfilePath
    );
    const releaseGateProbes = (generatedProfile.core_probes ?? []).filter(
      (probe) => (probe.role ?? "supporting") === "release_gate"
    );
    const syntheticProbeResults = [];
    for (const probe of releaseGateProbes) {
      const probeResultPath = join(
        fixture.coreProbesDirectory,
        `${probe.probe_id}-result.json`
      );
      await writeJsonFile(probeResultPath, {
        probe_id: probe.probe_id,
        ok: true
      });
      syntheticProbeResults.push({
        probe_id: probe.probe_id,
        label: probe.label,
        mode: probe.mode,
        role: probe.role ?? "release_gate",
        assertion_id: probe.assertion_id,
        quality_axis_id: probe.quality_axis_id,
        semantic_level: probe.semantic_level ?? "workflow",
        required: probe.required ?? true,
        ok: true,
        summary: `Synthetic probe '${probe.probe_id}' passed.`,
        target: fixture.baseUrl,
        evidence_paths: [probeResultPath],
        observed_value: "pass"
      });
    }

    await writeJsonFile(fixture.coreProbeResultsPath, syntheticProbeResults);
    await writeJsonFile(fixture.targetManifestPath, {
      health_url: `${fixture.baseUrl}/healthz`,
      api_base_url: `${fixture.baseUrl}/api/`
    });
    await writeJsonFile(fixture.subjectiveReviewOverridePath, {
      summary: "Synthetic subjective review for validator coverage.",
      metrics: [
        {
          metric_id: "design-quality",
          score_out_of_ten: 6.2,
          rationale: "Hierarchy is weak and spacing consistency is not convincing yet.",
          recommended_changes: [
            "Strengthen hierarchy and spacing consistency in the release workflow."
          ]
        }
      ]
    });

    const runChecksInputPath = await writeCapabilityPacket(fixture, "run_checks");
    const runChecksOutputPath = join(
      fixture.adapterDirectory,
      "run_checks-result.json"
    );
    const runChecksExecution = await runCommand(
      process.execPath,
      [fixture.runChecksScriptPath],
      {
        cwd: fixture.workspaceRoot,
        env: capabilityEnv(
          fixture,
          "run_checks",
          runChecksInputPath,
          runChecksOutputPath
        ),
        shell: false
      }
    );
    assert(
      runChecksExecution.code === 0,
      `run_checks script failed:\n${runChecksExecution.stdout}\n${runChecksExecution.stderr}`
    );

    const gradeRoundInputPath = await writeCapabilityPacket(fixture, "grade_round");
    const gradeRoundOutputPath = join(
      fixture.adapterDirectory,
      "grade_round-result.json"
    );
    const gradeRoundExecution = await runCommand(
      process.execPath,
      [fixture.gradeRoundScriptPath],
      {
        cwd: fixture.workspaceRoot,
        env: capabilityEnv(
          fixture,
          "grade_round",
          gradeRoundInputPath,
          gradeRoundOutputPath,
          {
            HARNESS_SUBJECTIVE_REVIEW_PATH: fixture.subjectiveReviewOverridePath
          }
        ),
        shell: false
      }
    );
    assert(
      gradeRoundExecution.code === 0,
      `grade_round script failed:\n${gradeRoundExecution.stdout}\n${gradeRoundExecution.stderr}`
    );

    const gradeRoundResult = await readJsonFile(gradeRoundOutputPath);
    assert(gradeRoundResult.ok === true, "grade_round should stay ok when subjective criteria fail");
    assert(
      gradeRoundResult.threshold_verdict === "fail",
      "grade_round should fail threshold_verdict when a required subjective metric misses its minimum"
    );
    assert(
      Array.isArray(gradeRoundResult.blocking_criterion_ids) &&
        gradeRoundResult.blocking_criterion_ids.includes(
          "subjective_metric_design-quality_minimum"
        ),
      "grade_round should block on the failing subjective metric criterion"
    );
    assert(
      Array.isArray(gradeRoundResult.subjective_metric_results) &&
        gradeRoundResult.subjective_metric_results.some(
          (metric) =>
            metric.metric_id === "design-quality" &&
            metric.status === "fail" &&
            metric.score_out_of_ten === 6.2
        ),
      "grade_round should expose failing subjective metric results"
    );
    assert(
      Array.isArray(gradeRoundResult.criteria_results) &&
        gradeRoundResult.criteria_results.some(
          (criterion) =>
            criterion.criterion_id === "subjective_metric_design-quality_minimum" &&
            criterion.status === "fail"
        ),
      "grade_round should emit subjective metric criteria results"
    );
    const subjectiveReviewItem = (gradeRoundResult.evidence_items ?? []).find(
      (item) => item.path === "artifacts/subjective-quality-review.json"
    );
    assert(
      subjectiveReviewItem,
      "grade_round should publish subjective-quality-review.json as evidence"
    );
    assert(
      existsSync(join(fixture.roundDirectory, subjectiveReviewItem.path)),
      "subjective-quality-review evidence path should exist on disk"
    );

    const { buildQualityCritiqueArtifact } = await importDist("protocol-artifacts.js");
    const qualityCritique = buildQualityCritiqueArtifact({
      round: 1,
      contractArtifact: {
        contract_id: "contract-001"
      },
      evalReport: {
        generated_at: new Date().toISOString(),
        round: 1,
        total_score: 0.72,
        control_plane_score: 1,
        proof_score: 0.72,
        release_score: gradeRoundResult.score ?? 0,
        overall_verdict: "revise",
        strengths: [],
        blockers: ["design quality remains below the requested threshold"],
        next_actions: [],
        evidence_paths: gradeRoundResult.evidence_paths ?? [],
        threshold_gap_details: [],
        check_results: [],
        resolved_check_ids: [],
        unresolved_check_ids: ["target_signal_thresholds_met"],
        adapter_attached: true,
        threshold_results: {
          contract_completed: false,
          minimum_control_plane_score_met: true,
          minimum_proof_score_met: false,
          minimum_release_score_met: false,
          adapter_required_met: true,
          grade_score_required_met: false,
          core_probe_required_met: true,
          dimension_thresholds_met: false,
          target_reached_eligible: false
        },
        dimension_scores: [],
        adapter_results: [
          {
            capability: "grade_round",
            result: gradeRoundResult
          }
        ],
        core_probe_results: []
      },
      loadedAdapter: {
        verification_profile: {
          profile: generatedProfile
        }
      }
    });

    assert(
      qualityCritique.findings.some(
        (finding) =>
          finding.category === "subjective_quality" &&
          finding.axis_id === "design-quality" &&
          finding.summary.includes("6.2/10")
      ),
      "quality critique should convert failing subjective metrics into subjective_quality findings"
    );

    console.log("Validated bootstrap custom quality metrics.");
  } finally {
    if (server) {
      await closeServer(server);
    }
    await cleanupTempRoot(tempRoot);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
