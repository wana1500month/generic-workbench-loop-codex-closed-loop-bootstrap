import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  cleanupTempRoot,
  createBootstrapFixture,
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

const writeCapabilityPacket = async (fixture, capability, round) => {
  const inputPath = join(fixture.adapterDirectory, `${capability}-round-${round}-input.json`);
  await writeJsonFile(inputPath, {
    capability,
    round
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

const gradeRoundOverride = (prototypeDeltaScore) => ({
  summary: "Synthetic subjective review for baseline validity coverage.",
  metrics: [
    {
      metric_id: "interaction_clarity",
      score_out_of_ten: 9.4,
      rationale: "Primary actions are clear.",
      recommended_changes: ["none"]
    },
    {
      metric_id: "visual_hierarchy",
      score_out_of_ten: 9.2,
      rationale: "Visual hierarchy is legible.",
      recommended_changes: ["none"]
    },
    {
      metric_id: "finish_line_coherence",
      score_out_of_ten: 9.5,
      rationale: "The flow feels complete.",
      recommended_changes: ["none"]
    },
    {
      metric_id: "prototype_delta",
      score_out_of_ten: prototypeDeltaScore,
      rationale: "Synthetic prototype delta score.",
      recommended_changes: ["none"]
    }
  ]
});

const canLoadPlaywrightCore = async () => {
  try {
    await import("playwright-core");
    return true;
  } catch {
    return false;
  }
};

const seedSyntheticVisualEvidence = async (fixture) => {
  const screenshotPath = join(fixture.roundDirectory, "synthetic-visual-evidence.png");
  const tracePath = join(fixture.roundDirectory, "synthetic-visual-evidence-trace.zip");
  await writeFile(screenshotPath, "synthetic screenshot bytes\n", "utf8");
  await writeFile(tracePath, "synthetic trace bytes\n", "utf8");
  await writeJsonFile(fixture.coreProbeResultsPath, [
    {
      probe_id: "app-shell-renders",
      assertion_id: "ui_shell_renders",
      role: "release_gate",
      mode: "browser_journey",
      required: true,
      ok: true,
      summary: "Synthetic app shell render evidence.",
      observed_value: "visible",
      evidence_paths: [screenshotPath, tracePath]
    },
    {
      probe_id: "draft-persists",
      assertion_id: "draft_persists",
      role: "release_gate",
      mode: "http_json",
      required: true,
      ok: true,
      summary: "Synthetic persisted draft evidence.",
      observed_value: "persisted",
      evidence_paths: [screenshotPath]
    }
  ]);
  await writeJsonFile(join(fixture.adapterDirectory, "run_checks-result.json"), {
    ok: true,
    criteria_results: [
      {
        criterion_id: "target_accessible",
        status: "pass"
      }
    ],
    evidence_paths: [screenshotPath, tracePath]
  });
  return { screenshotPath, tracePath };
};

const createBaselineFixture = async (tempRoot, directoryName, baseUrl, overrides = {}) => {
  const fixture = await createBootstrapFixture(join(tempRoot, directoryName), {
    title: "Baseline Validity App",
    summary: "A fixture app for validating prototype baseline semantics.",
    finishLine: "The browser app renders and can be judged against an initial baseline.",
    targetFamily: "browser-app",
    targetScore: 0.95,
    projectMode: "existing",
    checkCommand: "",
    readyUrl: `${baseUrl}/healthz`,
    appUrl: baseUrl,
    referenceApps: [],
    ...overrides
  });
  fixture.coreProbeResultsPath = join(fixture.roundDirectory, "core-probe-results.json");
  fixture.targetManifestPath = join(fixture.roundDirectory, "target-manifest.json");
  await writeJsonFile(fixture.targetManifestPath, {
    app_url: baseUrl,
    health_url: `${baseUrl}/healthz`
  });
  return fixture;
};

const writePreRoundBaselineAttempt = async (fixture, value) =>
  writeJsonFile(join(fixture.roundDirectory, "pre-round-baseline.json"), value);

const runCapability = async (fixture, capability, round, outputFile, overrides = {}) => {
  const inputPath = await writeCapabilityPacket(fixture, capability, round);
  const outputPath = join(fixture.adapterDirectory, outputFile);
  const scriptPath =
    capability === "run_checks" ? fixture.runChecksScriptPath : fixture.gradeRoundScriptPath;
  const execution = await runCommand(process.execPath, [scriptPath], {
    cwd: fixture.workspaceRoot,
    env: capabilityEnv(fixture, capability, inputPath, outputPath, overrides),
    shell: false
  });
  assert(
    execution.code === 0,
    `${capability} round ${round} failed:\n${execution.stdout}\n${execution.stderr}`
  );
  return {
    outputPath,
    result: await readJsonFile(outputPath)
  };
};

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-baseline-validity");
  let server;

  try {
    server = createServer((request, response) => {
      if (request.url?.startsWith("/healthz")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "ok" }));
        return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`
        <html>
          <body>
            <main>
              <h1>Baseline Fixture</h1>
              <button>Continue</button>
            </main>
          </body>
        </html>
      `);
    });
    const address = await listen(server);
    if (!address || typeof address === "string") {
      throw new Error("baseline validity validator did not expose a TCP port");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const fixture = await createBaselineFixture(tempRoot, "helper-capture", baseUrl);

    const { loadAdapterContract } = await importDist("adapter-runtime.js");
    const {
      attachedPreGeneratorBaselineWindowOpen,
      captureBootstrapGeneratedBaselineIfNeeded
    } = await importDist(
      "prototype-baseline.js"
    );
    const loadedAdapter = await loadAdapterContract(fixture.paths.adapterPath);
    assert(loadedAdapter, "expected generated adapter contract to load");
    const playwrightAvailable = await canLoadPlaywrightCore();
    assert(
      attachedPreGeneratorBaselineWindowOpen({
        round: 1,
        attachedGeneratorEligible: true
      }) === true,
      "round 1 attached runs should open the pre-generator baseline window before any checkpoint exists"
    );
    assert(
      attachedPreGeneratorBaselineWindowOpen({
        round: 1,
        attachedGeneratorEligible: true,
        existingTask: {
          checkpoint_id: "checkpoint-1"
        }
      }) === false,
      "an existing attached-generator checkpoint should close the pre-generator baseline window"
    );
    assert(
      attachedPreGeneratorBaselineWindowOpen({
        round: 1,
        attachedGeneratorEligible: true,
        existingResponse: {
          checkpoint_id: "checkpoint-1",
          status: "applied",
          summary: "already mutated",
          generated_at: new Date().toISOString()
        }
      }) === false,
      "an existing attached-generator response should close the pre-generator baseline window"
    );

    const helperCapture = await captureBootstrapGeneratedBaselineIfNeeded({
      loadedAdapter,
      runtimeDirectory: fixture.runtimeDirectory,
      targetManifest: {
        app_url: baseUrl,
        health_url: `${baseUrl}/healthz`
      }
    });
    if (playwrightAvailable) {
      assert(
        helperCapture.status === "captured",
        "loop-side baseline helper should capture a pre-round baseline"
      );
      assert(
        helperCapture.source_phase === "pre_round_1" && helperCapture.prototype_baseline_valid,
        "loop-side baseline helper should persist a valid pre_round_1 baseline"
      );
    } else {
      assert(
        helperCapture.status === "blocked",
        "loop-side baseline helper should fail closed when browser tooling is unavailable"
      );
      assert(
        typeof helperCapture.reason === "string" && helperCapture.reason.includes("playwright-core"),
        "blocked helper capture should surface the missing browser runtime"
      );
    }

    await rm(join(fixture.runtimeDirectory, "product-baseline.json"), { force: true });
    await rm(join(fixture.runtimeDirectory, "baseline-home.png"), { force: true });
    await rm(join(fixture.runtimeDirectory, "baseline-trace.zip"), { force: true });
    const existingProjectFixture = await createBaselineFixture(
      tempRoot,
      "existing-project-no-fallback",
      baseUrl,
      { projectMode: "existing" }
    );
    await seedSyntheticVisualEvidence(existingProjectFixture);
    const round1ReviewPath = join(existingProjectFixture.roundDirectory, "subjective-round1.json");
    await writeJsonFile(round1ReviewPath, gradeRoundOverride(9.1));
    const existingRound1Grade = await runCapability(
      existingProjectFixture,
      "grade_round",
      1,
      "grade_round-round1-result.json",
      {
        HARNESS_SUBJECTIVE_REVIEW_PATH: round1ReviewPath
      }
    );
    assert(
      existingRound1Grade.result.metadata?.prototype_baseline_present === false,
      "existing projects should not silently treat a round-1 post-mutation screenshot as a valid initial baseline"
    );
    assert(
      existingRound1Grade.result.metadata?.prototype_baseline_valid === false,
      "existing projects without an allowed pre-round baseline attempt should keep prototype_baseline_valid false"
    );
    assert(
      !existsSync(join(existingProjectFixture.runtimeDirectory, "baseline-home.png")),
      "existing project round 1 should not mint a fallback baseline without an allowed reason"
    );

    const allowedExistingFixture = await createBaselineFixture(
      tempRoot,
      "existing-project-allowed-fallback",
      baseUrl,
      { projectMode: "existing" }
    );
    await seedSyntheticVisualEvidence(allowedExistingFixture);
    await writePreRoundBaselineAttempt(allowedExistingFixture, {
      status: "skipped",
      reason: "target_not_ready",
      prototype_baseline_present: false,
      prototype_baseline_valid: false
    });
    const allowedRound1ReviewPath = join(
      allowedExistingFixture.roundDirectory,
      "subjective-round1.json"
    );
    await writeJsonFile(allowedRound1ReviewPath, gradeRoundOverride(9.1));
    const allowedRound1Grade = await runCapability(
      allowedExistingFixture,
      "grade_round",
      1,
      "grade_round-round1-result.json",
      {
        HARNESS_SUBJECTIVE_REVIEW_PATH: allowedRound1ReviewPath
      }
    );
    assert(
      allowedRound1Grade.result.metadata?.prototype_baseline_present === true,
      "existing projects may still mint a round-1 fallback baseline when the pre-round attempt explicitly failed because the target was not ready"
    );
    assert(
      allowedRound1Grade.result.metadata?.prototype_baseline_valid === true,
      "allowed round-1 fallback should count as a valid initial prototype baseline"
    );
    assert(
      allowedRound1Grade.result.metadata?.prototype_baseline_source_phase ===
        "round_1_initial_prototype_fallback",
      "allowed round-1 fallback should record the round_1_initial_prototype_fallback source phase"
    );

    const invalidBaselinePath = join(allowedExistingFixture.runtimeDirectory, "baseline-home.png");
    assert(existsSync(invalidBaselinePath), "allowed round-1 fallback should leave a baseline screenshot on disk");
    await writeJsonFile(join(allowedExistingFixture.runtimeDirectory, "product-baseline.json"), {
      source_round: 2,
      source_phase: "post_round_2_grade_round",
      baseline_path: invalidBaselinePath,
      source_path: invalidBaselinePath,
      created_at: new Date().toISOString()
    });

    const round2ReviewPath = join(allowedExistingFixture.roundDirectory, "subjective-round2.json");
    await writeJsonFile(round2ReviewPath, gradeRoundOverride(9.8));
    const round2Grade = await runCapability(
      allowedExistingFixture,
      "grade_round",
      2,
      "grade_round-round2-result.json",
      {
        HARNESS_SUBJECTIVE_REVIEW_PATH: round2ReviewPath
      }
    );
    assert(
      round2Grade.result.metadata?.prototype_baseline_present === true,
      "round 2 should still report that a baseline file is present when the manifest exists"
    );
    assert(
      round2Grade.result.metadata?.prototype_baseline_valid === false,
      "round 2 should distinguish an invalid baseline source phase from a valid initial baseline"
    );
    assert(
      Array.isArray(round2Grade.result.subjective_metric_results) &&
        round2Grade.result.subjective_metric_results.some(
          (metric) =>
            metric.metric_id === "prototype_delta" &&
            metric.status === "fail" &&
            metric.score_out_of_ten === 0
        ),
      "prototype_delta should fail closed when no valid initial baseline exists"
    );
    assert(
      Array.isArray(round2Grade.result.metadata?.release_score_cap_reasons) &&
        round2Grade.result.metadata.release_score_cap_reasons.some((reason) =>
          reason.includes("valid initial prototype baseline")
        ),
      "round 2 should explain the invalid-baseline release-score cap"
    );
    assert(
      typeof round2Grade.result.score === "number" && round2Grade.result.score <= 0.79,
      "invalid baseline plus failed prototype_delta should keep the round score below the strict target"
    );
    const persistedInvalidBaseline = await readJsonFile(
      join(allowedExistingFixture.runtimeDirectory, "product-baseline.json")
    );
    assert(
      persistedInvalidBaseline.source_phase === "post_round_2_grade_round",
      "round 2 should not overwrite an invalid later-round baseline with a new fallback"
    );

    console.log("Validated prototype baseline validity semantics.");
  } finally {
    if (server) {
      await closeServer(server);
    }
    await cleanupTempRoot(tempRoot);
  }
};

main().catch((error) => {
  console.error("Baseline validity validation failed.");
  console.error(error);
  process.exitCode = 1;
});
