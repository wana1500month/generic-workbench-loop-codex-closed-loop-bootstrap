import { strict as assert } from "node:assert";

import {
  cleanupTempRoot,
  createTempRoot,
  ensureBuild,
  importDist
} from "./testing/bootstrap-validator-helpers.mjs";

const assertNoBrowserRuntime = (plan) => {
  assert.ok(plan, "adapter plan should exist");
  assert.ok(
    !plan.verification_surfaces.includes("browser"),
    JSON.stringify(plan, null, 2)
  );
  assert.ok(
    !plan.verification_surfaces.includes("screenshot"),
    JSON.stringify(plan, null, 2)
  );
  assert.equal(plan.runtime_strategy.ready_url, undefined);
  assert.equal(plan.runtime_strategy.app_url, undefined);
  assert.equal(plan.runtime_strategy.api_base_url, undefined);
  assert.equal(plan.runtime_strategy.health_url, undefined);
  assert.ok(
    plan.runtime_strategy.run_command || plan.runtime_strategy.check_command,
    JSON.stringify(plan.runtime_strategy, null, 2)
  );
};

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-non-web-front-door-adapter-plan");
  const previousEnv = {
    HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY:
      process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY
  };
  process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY = tempRoot;

  try {
    const [
      { buildAdapterPlanFromIntake },
      { runFrontDoorDiscoveryTurn }
    ] = await Promise.all([
      importDist("adapter-plan.js"),
      importDist("front-door-session.js")
    ]);

    const directPlan = buildAdapterPlanFromIntake({
      targetFamily: "browser-app",
      intake: {
        product_summary: "Build a CLI log analyzer.",
        project_kind: "cli_tool",
        evidence_surfaces: ["cli", "file", "test"],
        verification_surfaces: ["cli", "file", "test"],
        core_features: ["parse a log file"],
        run_command: "node ./bin/log-analyzer.js sample.log",
        check_command: "npm test",
        ready_url: "http://127.0.0.1:3000/"
      }
    });
    assert.deepEqual(directPlan.verification_surfaces, ["cli", "file", "test"]);
    assertNoBrowserRuntime(directPlan);
    assert.equal(directPlan.target_family, "browser-app");
    assert.equal(
      directPlan.workflow_checks[0].command_hint.command,
      "node ./bin/log-analyzer.js sample.log"
    );

    const commandFirstKinds = [
      ["library_package", ["package_import", "test", "file"]],
      ["data_pipeline", ["cli", "file", "test"]],
      ["document_artifact", ["document", "file", "manual_review"]],
      ["automation", ["shell", "file", "test"]]
    ];
    for (const [projectKind, evidenceSurfaces] of commandFirstKinds) {
      const nonWebPlan = buildAdapterPlanFromIntake({
        targetFamily: "browser-app",
        intake: {
          product_summary: `Build a ${projectKind}.`,
          project_kind: projectKind,
          evidence_surfaces: evidenceSurfaces,
          core_features: [`${projectKind} workflow`],
          check_command: "npm test"
        }
      });
      assertNoBrowserRuntime(nonWebPlan);
      assert.equal(nonWebPlan.runtime_strategy.check_command, "npm test");
    }

    const firstTurn = await runFrontDoorDiscoveryTurn({
      threadId: "cli-adapter-plan",
      message:
        "\u0043\u004C\u0049 \uB85C\uADF8 \uBD84\uC11D\uAE30 \uB9CC\uB4E4\uC5B4\uC918"
    });
    assert.equal(firstTurn.intake.project_kind, "cli_tool");
    assert.equal(firstTurn.intake.target_family, "cli-tool");
    assert.equal(firstTurn.intake.adapter_plan.target_family, "cli-tool");
    assert.deepEqual(firstTurn.intake.evidence_surfaces, ["cli", "file", "test"]);
    assertNoBrowserRuntime(firstTurn.intake.adapter_plan);

    const pipelineTurn = await runFrontDoorDiscoveryTurn({
      threadId: "pipeline-adapter-plan",
      message: "Build a CSV data pipeline"
    });
    assert.equal(pipelineTurn.intake.project_kind, "data_pipeline");
    assert.equal(pipelineTurn.intake.target_family, "command-artifact");
    assertNoBrowserRuntime(pipelineTurn.intake.adapter_plan);

    const explicitSurfacePlan = buildAdapterPlanFromIntake({
      targetFamily: "browser-app",
      intake: {
        product_summary: "Build a converter.",
        verification_surfaces: ["file", "test"],
        evidence_surfaces: ["file", "test", "manual_review"]
      }
    });
    assert.deepEqual(explicitSurfacePlan.verification_surfaces, ["file", "test"]);
    assertNoBrowserRuntime(explicitSurfacePlan);
  } finally {
    if (previousEnv.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY === undefined) {
      delete process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY;
    } else {
      process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY =
        previousEnv.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY;
    }
    await cleanupTempRoot(tempRoot);
  }
};

await main();
console.log("validate:non-web-front-door-adapter-plan passed");
