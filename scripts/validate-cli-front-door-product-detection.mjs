import { strict as assert } from "node:assert";

import {
  cleanupTempRoot,
  createTempRoot,
  ensureBuild,
  importDist
} from "./testing/bootstrap-validator-helpers.mjs";

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-cli-front-door-product-detection");
  const previousEnv = {
    HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY:
      process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY
  };
  process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY = tempRoot;

  try {
    const [
      { evaluateIntakeRequest },
      { evaluateLoopIntent },
      { runFrontDoorDiscoveryTurn }
    ] = await Promise.all([
      importDist("intake-gate.js"),
      importDist("intent-gate.js"),
      importDist("front-door-session.js")
    ]);

    const requests = [
      "\u0043\u004C\u0049 \uB85C\uADF8 \uBD84\uC11D\uAE30 \uB9CC\uB4E4\uC5B4\uC918",
      "\uB85C\uADF8 \uBD84\uC11D \uD234 \uB9CC\uB4E4\uC5B4\uC918",
      "parser \uB9CC\uB4E4\uC5B4\uC918",
      "converter \uB9CC\uB4E4\uC5B4\uC918",
      "Build a CLI log analyzer",
      "Create a parser tool",
      "Make a converter"
    ];

    for (const request of requests) {
      const intake = evaluateIntakeRequest(request);
      assert.equal(intake.is_product_build_request, true, request);
      assert.notEqual(intake.status, "not_product_build_request", request);
      const intent = evaluateLoopIntent(request);
      assert.equal(intent.intent, "product_build", request);
      assert.equal(intent.route_target, "app_builder_loop", request);
    }

    const firstTurn = await runFrontDoorDiscoveryTurn({
      threadId: "cli-log-analyzer",
      message:
        "\u0043\u004C\u0049 \uB85C\uADF8 \uBD84\uC11D\uAE30 \uB9CC\uB4E4\uC5B4\uC918"
    });
    assert.equal(firstTurn.status, "ask_product_questions");
    assert.equal(firstTurn.intake.project_kind, "cli_tool");
    assert.equal(firstTurn.intake.target_family, "cli-tool");
    assert.ok(
      firstTurn.questions.some((question) => /CLI|\uBA85\uB839|command/i.test(question)),
      JSON.stringify(firstTurn.questions, null, 2)
    );
    assert.ok(
      firstTurn.questions.some((question) =>
        /stdout|\uC0B0\uCD9C\uBB3C|failure|\uC2E4\uD328/i.test(question)
      ),
      JSON.stringify(firstTurn.questions, null, 2)
    );
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
console.log("validate:cli-front-door-product-detection passed");
