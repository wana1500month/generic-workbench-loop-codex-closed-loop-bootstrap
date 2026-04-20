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
  extractRunDirectory,
  readSummary,
  runLoop
} from "./validation-utils.mjs";

const foregroundThreadEnv = {
  ...process.env,
  CODEX_THREAD_ID:
    "thread_validate_prepared_product_start_bundle_migration",
  HARNESS_LAUNCH_ORIGIN: "codex-app-thread",
  HARNESS_THREAD_BINDING_STATE: "bound",
  HARNESS_SURFACE_OWNER: "stock-codex-thread",
  HARNESS_ENTRYPOINT: "skill",
  HARNESS_APP_VISIBILITY: "visible-in-stock-app"
};

const readValidationBundle = async (runContractPath) =>
  (await readJsonFile(runContractPath)).validation_strategy.validation_bundle;

const assertPreparedBundle = (bundle, fixture) => {
  assert(bundle, "Expected validation_bundle to be present.");
  assert.equal(bundle.target_family, "api-service");
  assert.equal(bundle.adapter_contract_path, fixture.paths.adapterPath);
  assert.equal(bundle.rubric_path, fixture.paths.generatedRubricPath);
  assert.equal(
    bundle.evaluator_profile_path,
    fixture.paths.generatedVerificationProfilePath
  );
  assert.equal(typeof bundle.validation_lane, "string");
};

const assertPreparedSummary = (summary, fixture, bundle) => {
  assertStopReason(summary, "awaiting_codex_checkpoint");
  assertTargetFamily(summary, "api-service");
  assert.equal(summary.validation_lane, bundle.validation_lane);
  assert.equal(summary.adapter_attached, true);
  assert.equal(summary.adapter_contract_path, fixture.paths.adapterPath);
  assert.equal(
    summary.evaluator_profile_path,
    fixture.paths.generatedVerificationProfilePath
  );
};

const restoreProcessEnv = (previousEnv) => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot(
    "validate-prepared-product-start-bundle-migration"
  );

  try {
    const fixture = await createBootstrapFixture(tempRoot, {
      title: "Prepared Product Bundle Migration Fixture",
      summary:
        "An API service fixture that should keep product recovery defaults without blocking explicit resume migration overrides.",
      targetUsers: ["operator"],
      coreFeatures: ["health endpoint", "list endpoint", "create endpoint"],
      referenceApps: ["Stripe API", "Supabase"],
      finishLine:
        "The service exposes health, list, and create endpoints behind a reviewable API contract.",
      targetFamily: "api-service",
      targetScore: 0.95,
      maxRounds: 2,
      projectMode: "existing",
      frameworkHint: "Express API",
      packageManager: "npm",
      runCommand: "npm run dev",
      checkCommand: "npm test",
      healthUrl: "http://127.0.0.1:3000/health",
      appUrl: undefined
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
      restoreProcessEnv(previousEnv);
    }

    const preparedBundle = await readValidationBundle(prepared.runContractPath);
    assertPreparedBundle(preparedBundle, fixture);

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
    assertPreparedSummary(
      await readSummary(prepared.runDirectory),
      fixture,
      preparedBundle
    );

    await rm(join(prepared.runDirectory, "summary.json"));

    const rejectedMigration = await runLoop(
      [
        "--resume-run",
        prepared.runDirectory,
        "--controller-mode",
        "attached",
        "--transport",
        "current-thread",
        "--target-family",
        "crud-api"
      ],
      {
        env: foregroundThreadEnv,
        silent: true
      }
    );
    if (rejectedMigration.code === 0) {
      throw new Error(
        "Prepared product resume migration should fail closed without --allow-resume-migration."
      );
    }
    assert(
      rejectedMigration.stderr.includes("Resume identity mismatch"),
      "Rejected prepared product migration should fail through the standard resume identity mismatch path."
    );
    assert(
      !rejectedMigration.stderr.includes(
        "Prepared product session could not restore its product validation bundle"
      ),
      "Explicit prepared product migration override should not be blocked by the prepared-session guard."
    );
    assertPreparedBundle(
      await readValidationBundle(prepared.runContractPath),
      fixture
    );

    const allowedMigration = await runLoop(
      [
        "--resume-run",
        prepared.runDirectory,
        "--controller-mode",
        "attached",
        "--transport",
        "current-thread",
        "--target-family",
        "crud-api",
        "--allow-resume-migration"
      ],
      {
        env: foregroundThreadEnv,
        silent: true
      }
    );
    if (allowedMigration.code !== 0) {
      throw new Error(
        `prepared product migration override failed.\nSTDOUT:\n${allowedMigration.stdout}\nSTDERR:\n${allowedMigration.stderr}`
      );
    }

    const migratedSummary = await readSummary(prepared.runDirectory);
    const migratedBundle = await readValidationBundle(prepared.runContractPath);
    const resumeMigration = await readJsonFile(migratedSummary.resume_migration_path);
    assertStopReason(migratedSummary, "awaiting_codex_checkpoint");
    assertTargetFamily(migratedSummary, "crud-api");
    assert.equal(migratedSummary.bundle_migrated, true);
    assert.equal(migratedSummary.adapter_attached, true);
    assert.equal(migratedSummary.adapter_contract_path, fixture.paths.adapterPath);
    assert.equal(migratedSummary.validation_lane, migratedBundle.validation_lane);
    assert.equal(
      migratedSummary.evaluator_profile_path,
      migratedBundle.evaluator_profile_path
    );
    assert.notEqual(
      migratedSummary.evaluator_profile_path,
      fixture.paths.generatedVerificationProfilePath
    );
    assert.equal(migratedBundle.target_family, "crud-api");
    assert.equal(migratedBundle.adapter_contract_path, fixture.paths.adapterPath);
    assert.equal(
      migratedBundle.rubric_path,
      join(prepared.runDirectory, "effective-rubric.json")
    );
    assert.notEqual(
      migratedBundle.evaluator_profile_path,
      fixture.paths.generatedVerificationProfilePath
    );
    assert.equal(resumeMigration.new_identity?.target_family, "crud-api");
    assert.equal(resumeMigration.previous_identity?.target_family, "api-service");
    assert.equal(
      resumeMigration.previous_identity?.evaluator_profile_path,
      fixture.paths.generatedVerificationProfilePath
    );
    assert.equal(
      resumeMigration.new_identity?.evaluator_profile_path,
      migratedBundle.evaluator_profile_path
    );
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

await main();
console.log("validate:prepared-product-start-bundle-migration passed");
