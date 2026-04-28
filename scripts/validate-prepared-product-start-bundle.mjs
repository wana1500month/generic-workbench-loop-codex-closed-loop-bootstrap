import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
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
  CODEX_THREAD_ID: "thread_validate_prepared_product_start_bundle",
  HARNESS_LAUNCH_ORIGIN: "codex-app-thread",
  HARNESS_THREAD_BINDING_STATE: "bound",
  HARNESS_SURFACE_OWNER: "stock-codex-thread",
  HARNESS_ENTRYPOINT: "skill",
  HARNESS_APP_VISIBILITY: "visible-in-stock-app"
};

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-prepared-product-start-bundle");

  try {
    const fixture = await createBootstrapFixture(tempRoot, {
      title: "Prepared Product Bundle Fixture",
      summary: "A prepared dashboard session should carry its product bundle into the same-thread start.",
      targetUsers: ["operator"],
      coreFeatures: ["triage queue", "issue detail", "reply composer"],
      referenceApps: ["Zendesk", "Linear"],
      finishLine: "The dashboard ships triage, detail, and reply workflows in one reviewed surface.",
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

    const runContract = await readJsonFile(prepared.runContractPath);
    assert.deepEqual(runContract.validation_strategy.validation_bundle, {
      target_family: "dashboard",
      validation_lane: "environment_integration",
      adapter_contract_path: fixture.paths.adapterPath,
      rubric_path: fixture.paths.generatedRubricPath,
      evaluator_profile_path: fixture.paths.generatedVerificationProfilePath
    });

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

    const summary = await readSummary(prepared.runDirectory);
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

    const startedPlan = await readJsonFile(join(prepared.runDirectory, "plan.json"));
    assert.equal(startedPlan.plan_kind, "product_build");
    assert.equal(startedPlan.product_title, "Prepared Product Bundle Fixture");
    assert.match(startedPlan.north_star, /Prepared Product Bundle Fixture/);
    assert.doesNotMatch(
      startedPlan.north_star,
      /generic harness mechanics/i,
      JSON.stringify(startedPlan, null, 2)
    );

    const attachedPromptPath = join(
      prepared.runDirectory,
      "round-001",
      "runtime",
      "attached-generator-prompt.md"
    );
    for (let hop = 0; hop < 8 && !existsSync(attachedPromptPath); hop += 1) {
      const currentSummary = await readSummary(prepared.runDirectory);
      assertStopReason(currentSummary, "awaiting_codex_checkpoint");
      const operatorSurface = await readJsonFile(currentSummary.operator_surface_path);
      assert.equal(
        operatorSurface.ui_visibility,
        "internal_checkpoint",
        JSON.stringify(operatorSurface, null, 2)
      );
      assert.ok(
        typeof operatorSurface.active_response_path === "string",
        JSON.stringify(operatorSurface, null, 2)
      );
      await writeFile(
        operatorSurface.active_response_path,
        `${JSON.stringify({ checkpoint_id: operatorSurface.checkpoint_id }, null, 2)}\n`,
        "utf8"
      );
      const resumeExecution = await runLoop(
        [
          "--resume-run",
          prepared.runDirectory,
          "--controller-mode",
          "attached",
          "--transport",
          "current-thread",
          "--single"
        ],
        {
          env: foregroundThreadEnv,
          silent: true
        }
      );
      if (resumeExecution.code !== 0) {
        throw new Error(
          `prepared product resume failed.\nSTDOUT:\n${resumeExecution.stdout}\nSTDERR:\n${resumeExecution.stderr}`
        );
      }
    }
    assert.ok(existsSync(attachedPromptPath), "attached generator prompt was not written");
    const attachedPrompt = await readFile(attachedPromptPath, "utf8");
    assert.match(attachedPrompt, /Prepared Product Bundle Fixture/);
    assert.match(attachedPrompt, /triage queue/);
    assert.match(attachedPrompt, /issue detail/);
    assert.match(attachedPrompt, /reply composer/);
    assert.match(attachedPrompt, /Required release-gate selectors/);
    assert.match(attachedPrompt, /\[data-testid='app-shell'\]/);
    assert.match(attachedPrompt, /\[data-testid='finish-line-ready'\]/);
    assert.match(attachedPrompt, /\[data-testid='feature-/);
    assert.doesNotMatch(attachedPrompt, /planner_context_surface_reserved/);
    assert.doesNotMatch(attachedPrompt, /generator_brief_surface_reserved/);
    assert.doesNotMatch(attachedPrompt, /Keep the repository generic and adapter-free/);
    assert.doesNotMatch(attachedPrompt, /packages\/loop-orchestrator\/src/);
    assert.doesNotMatch(attachedPrompt, /ADAPTER_CONTRACT\.md/);

    const roundContract = await readJsonFile(
      join(prepared.runDirectory, "round-001", "round-contract.json")
    );
    assert.match(
      roundContract.objective,
      /Prepared Product Bundle Fixture|runtime\/build-brief\.json/
    );
    assert.doesNotMatch(
      roundContract.objective,
      /Build against the planner spec/i,
      JSON.stringify(roundContract, null, 2)
    );
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

await main();
console.log("validate:prepared-product-start-bundle passed");
