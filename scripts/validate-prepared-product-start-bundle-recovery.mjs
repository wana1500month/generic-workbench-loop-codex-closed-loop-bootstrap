import { strict as assert } from "node:assert";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import {
  cleanupTempRoot,
  createBootstrapFixture,
  createTempRoot,
  ensureBuild,
  importDist,
  readJsonFile
} from "./testing/bootstrap-validator-helpers.mjs";
import {
  assertStopReason,
  assertTargetFamily,
  assertValidationLane,
  extractRunDirectory,
  readSummary,
  runLoop
} from "./validation-utils.mjs";

const foregroundThreadEnv = {
  ...process.env,
  CODEX_THREAD_ID: "thread_validate_prepared_product_start_bundle_recovery",
  HARNESS_LAUNCH_ORIGIN: "codex-app-thread",
  HARNESS_THREAD_BINDING_STATE: "bound",
  HARNESS_SURFACE_OWNER: "stock-codex-thread",
  HARNESS_ENTRYPOINT: "skill",
  HARNESS_APP_VISIBILITY: "visible-in-stock-app"
};

const assertPreparedBundle = (runContract, fixture) => {
  assert.deepEqual(runContract.validation_strategy.validation_bundle, {
    target_family: "dashboard",
    validation_lane: "environment_integration",
    adapter_contract_path: fixture.paths.adapterPath,
    rubric_path: fixture.paths.generatedRubricPath,
    evaluator_profile_path: fixture.paths.generatedVerificationProfilePath
  });
};

const assertDashboardSummary = (summary, fixture) => {
  assertStopReason(summary, "awaiting_codex_checkpoint");
  assertTargetFamily(summary, "dashboard");
  assertValidationLane(summary, "environment_integration");
  assert.equal(summary.adapter_attached, true);
  assert.equal(summary.adapter_contract_path, fixture.paths.adapterPath);
  assert.equal(
    summary.evaluator_profile_path,
    fixture.paths.generatedVerificationProfilePath
  );
  assert(
    !summary.evaluator_profile_path.includes("generic-core.profile.json"),
    "Prepared product session should not fall back to generic-core."
  );
};

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot(
    "validate-prepared-product-start-bundle-recovery"
  );

  try {
    const fixture = await createBootstrapFixture(tempRoot, {
      title: "Prepared Product Bundle Recovery Fixture",
      summary:
        "A prepared dashboard session should keep its product bundle across refresh and summary recovery.",
      targetUsers: ["operator"],
      coreFeatures: ["triage queue", "issue detail", "reply composer"],
      referenceApps: ["Zendesk", "Linear"],
      finishLine:
        "The dashboard ships triage, detail, and reply workflows in one reviewed surface.",
      targetFamily: "dashboard",
      targetScore: 0.95,
      maxRounds: 2,
      projectMode: "existing",
      frameworkHint: "Next.js dashboard",
      packageManager: "npm",
      runCommand: "npm run dev",
      checkCommand: "npm run lint",
      healthUrl: "http://127.0.0.1:3000/health"
    });

    const [{ prepareSessionRun }] = await Promise.all([
      importDist("prepare-session.js")
    ]);
    const previousEnv = {
      CODEX_THREAD_ID: process.env.CODEX_THREAD_ID,
      HARNESS_THREAD_BINDING_STATE: process.env.HARNESS_THREAD_BINDING_STATE,
      HARNESS_LAUNCH_ORIGIN: process.env.HARNESS_LAUNCH_ORIGIN,
      HARNESS_SURFACE_OWNER: process.env.HARNESS_SURFACE_OWNER,
      HARNESS_ENTRYPOINT: process.env.HARNESS_ENTRYPOINT,
      HARNESS_APP_VISIBILITY: process.env.HARNESS_APP_VISIBILITY
    };
    Object.assign(process.env, foregroundThreadEnv);
    let prepared;
    try {
      prepared = await prepareSessionRun({
        ideaPath: fixture.paths.ideaPath,
        transportMode: "current-thread",
        controllerMode: "attached"
      });
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }

    assertPreparedBundle(await readJsonFile(prepared.runContractPath), fixture);

    const startExecution = await runLoop(
      ["--controller-mode", "attached", "--transport", "current-thread", "--single"],
      {
        env: foregroundThreadEnv,
        silent: true
      }
    );
    if (startExecution.code !== 0) {
      throw new Error(
        `prepared product start failed.\nSTDOUT:\n${startExecution.stdout}\nSTDERR:\n${startExecution.stderr}`
      );
    }

    const startedRunDirectory = extractRunDirectory(startExecution.stdout);
    assert.equal(startedRunDirectory, prepared.runDirectory);
    assertDashboardSummary(await readSummary(prepared.runDirectory), fixture);
    assertPreparedBundle(await readJsonFile(prepared.runContractPath), fixture);

    await rm(join(prepared.runDirectory, "summary.json"));

    const resumeExecution = await runLoop(
      [
        "--resume-run",
        prepared.runDirectory,
        "--controller-mode",
        "attached",
        "--transport",
        "current-thread"
      ],
      {
        env: foregroundThreadEnv,
        silent: true
      }
    );
    if (resumeExecution.code !== 0) {
      throw new Error(
        `prepared product recovery resume failed.\nSTDOUT:\n${resumeExecution.stdout}\nSTDERR:\n${resumeExecution.stderr}`
      );
    }

    assertDashboardSummary(await readSummary(prepared.runDirectory), fixture);
    assertPreparedBundle(await readJsonFile(prepared.runContractPath), fixture);
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

await main();
console.log("validate:prepared-product-start-bundle-recovery passed");
