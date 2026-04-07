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
    throw new Error("bootstrap verifier fixture did not expose a TCP port");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const { createBootstrapArtifactPaths, scaffoldBootstrapArtifacts } =
    await importDist("bootstrap.js");
  const paths = createBootstrapArtifactPaths(workspaceRoot);
  await scaffoldBootstrapArtifacts(
    {
      title: "Profile Aware Verifier",
      summary: "A fixture app for validating profile-aware bootstrap verifier plumbing.",
      targetUsers: ["operator"],
      coreFeatures: [],
      referenceApps: ["Postman"],
      finishLine: "The API finish line remains ready across verification runs.",
      targetFamily: "api-service",
      goalLevel: "usable",
      targetScore: 0.9,
      maxRounds: 2,
      targetRoot,
      projectMode: "new",
      frameworkHint: "Express",
      packageManager: "npm",
      runCommand: "npm run dev",
      checkCommand: "",
      readyUrl: `${baseUrl}/healthz`,
      healthUrl: `${baseUrl}/healthz`,
      apiBaseUrl: `${baseUrl}/api/`,
      constraints: ["Keep verifier wiring deterministic."],
      qualityBar: ["Release criteria should map directly to core probe results."],
      notes: "profile-aware verifier validator"
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

const capabilityEnv = (fixture, capability, inputPath, outputPath) => ({
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
  HARNESS_CAPABILITY: capability
});

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-bootstrap-profile-aware-verifier");
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
    assert(
      releaseGateProbes.length === 3,
      "api-service bootstrap fixture should emit exactly three release-gate probes"
    );
    const failingProbe = releaseGateProbes[releaseGateProbes.length - 1];
    assert(
      typeof failingProbe.assertion_id === "string" && failingProbe.assertion_id,
      "synthetic failing probe must expose an assertion_id"
    );

    const syntheticProbeResults = [];
    for (const probe of releaseGateProbes) {
      const probeResultPath = join(
        fixture.coreProbesDirectory,
        `${probe.probe_id}-result.json`
      );
      const passed = probe.probe_id !== failingProbe.probe_id;
      await writeJsonFile(probeResultPath, {
        probe_id: probe.probe_id,
        ok: passed
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
        ok: passed,
        summary: passed
          ? `Synthetic probe '${probe.probe_id}' passed.`
          : `Synthetic probe '${probe.probe_id}' failed.`,
        target: fixture.baseUrl,
        evidence_paths: [probeResultPath],
        observed_value: passed ? "pass" : "synthetic-fail"
      });
    }

    await writeJsonFile(fixture.coreProbeResultsPath, syntheticProbeResults);
    await writeJsonFile(fixture.targetManifestPath, {
      health_url: `${fixture.baseUrl}/healthz`,
      api_base_url: `${fixture.baseUrl}/api/`
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

    const runChecksResult = await readJsonFile(runChecksOutputPath);
    assert(runChecksResult.ok === true, "run_checks should stay ok when criteria fail");
    const failingCriterion = (runChecksResult.criteria_results ?? []).find(
      (criterion) => criterion.criterion_id === failingProbe.assertion_id
    );
    assert(
      failingCriterion?.status === "fail",
      "run_checks should translate failing core probe assertions into failing criteria"
    );
    const coreProbeSummaryItem = (runChecksResult.evidence_items ?? []).find(
      (item) => item.path === "artifacts/core-probe-summary.json"
    );
    assert(
      coreProbeSummaryItem,
      "run_checks should publish core-probe-summary.json as verifier evidence"
    );
    assert(
      existsSync(join(fixture.roundDirectory, coreProbeSummaryItem.path)),
      "core-probe-summary evidence path should exist on disk"
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
          gradeRoundOutputPath
        ),
        shell: false
      }
    );
    assert(
      gradeRoundExecution.code === 0,
      `grade_round script failed:\n${gradeRoundExecution.stdout}\n${gradeRoundExecution.stderr}`
    );

    const gradeRoundResult = await readJsonFile(gradeRoundOutputPath);
    assert(gradeRoundResult.ok === true, "grade_round should complete successfully");
    assert(
      gradeRoundResult.threshold_verdict === "fail",
      "grade_round should fail threshold_verdict when a hard probe-backed criterion fails"
    );
    assert(
      Array.isArray(gradeRoundResult.blocking_criterion_ids) &&
        gradeRoundResult.blocking_criterion_ids.includes(failingProbe.assertion_id),
      "grade_round should block on the failing probe-backed assertion id"
    );
    assert(
      typeof gradeRoundResult.score === "number" && gradeRoundResult.score < 0.8,
      "grade_round should lower release score when release-gate probe pass rate drops"
    );
    assert(
      Array.isArray(gradeRoundResult.criteria_results) &&
        gradeRoundResult.criteria_results.some(
          (criterion) =>
            criterion.criterion_id === failingProbe.assertion_id &&
            criterion.status === "fail"
        ),
      "grade_round should preserve run_checks criteria results without inventing replacements"
    );

    console.log("Validated bootstrap profile-aware verifier.");
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
