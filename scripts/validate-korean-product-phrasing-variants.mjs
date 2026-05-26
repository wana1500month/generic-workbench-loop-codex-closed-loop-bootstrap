import { strict as assert } from "node:assert";

import {
  cleanupTempRoot,
  createTempRoot,
  ensureBuild,
  importDist
} from "./testing/bootstrap-validator-helpers.mjs";

await ensureBuild();
const tempRoot = await createTempRoot("validate-korean-product-phrasing-variants");
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

  const productCases = [
    [
      "\u004D\u0061\u0072\u006B\u0064\u006F\u0077\u006E \uBCF4\uACE0\uC11C \uC0B0\uCD9C\uBB3C \uC0DD\uC131\uAE30\uB97C \uB9CC\uB4E4\uC5B4\uC918",
      "document_artifact",
      "command-artifact"
    ],
    [
      "\uB9C8\uD06C\uB2E4\uC6B4 \uBCF4\uACE0\uC11C \uC0DD\uC131\uAE30 \uB9CC\uB4E4\uC5B4\uC918",
      "document_artifact",
      "command-artifact"
    ],
    [
      "\uBCF4\uACE0\uC11C \uC0DD\uC131\uAE30\uB97C \uB9CC\uB4E4\uC5B4\uC918",
      "document_artifact",
      "command-artifact"
    ],
    [
      "\uBB38\uC11C \uC0DD\uC131\uAE30\uB97C \uB9CC\uB4E4\uC5B4\uC918",
      "document_artifact",
      "command-artifact"
    ],
    [
      "\uBB38\uC11C \uC0DD\uC131 \uB3C4\uAD6C \uB9CC\uB4E4\uC5B4\uC918",
      "document_artifact",
      "command-artifact"
    ],
    [
      "\uBB38\uC11C \uC790\uB3D9\uD654 \uB3C4\uAD6C \uB9CC\uB4E4\uC5B4\uC918",
      "document_artifact",
      "command-artifact"
    ],
    [
      "\uBB38\uC11C \uD15C\uD50C\uB9BF \uB9CC\uB4E4\uC5B4\uC918",
      "document_artifact",
      "command-artifact"
    ],
    [
      "\uC124\uCE58 \uAC00\uC774\uB4DC \uC0DD\uC131\uAE30\uB97C \uB9CC\uB4E4\uC5B4\uC918",
      "document_artifact",
      "command-artifact"
    ],
    [
      "\uC124\uCE58 \uAC00\uC774\uB4DC \uD15C\uD50C\uB9BF \uB9CC\uB4E4\uC5B4\uC918",
      "document_artifact",
      "command-artifact"
    ],
    [
      "\uCCB4\uD06C\uB9AC\uC2A4\uD2B8 \uC790\uB3D9\uD654 \uB3C4\uAD6C \uB9CC\uB4E4\uC5B4\uC918",
      "document_artifact",
      "command-artifact"
    ],
    [
      "\uB370\uC774\uD130 \uD30C\uC774\uD504\uB77C\uC778 \uC0DD\uC131\uAE30 \uB9CC\uB4E4\uC5B4\uC918",
      "data_pipeline",
      "command-artifact"
    ],
    [
      "\uB370\uC774\uD130 \uD30C\uC774\uD504\uB77C\uC778\uC744 \uC0DD\uC131\uD558\uB294 \uB3C4\uAD6C \uB9CC\uB4E4\uC5B4\uC918",
      "data_pipeline",
      "command-artifact"
    ],
    [
      "\uB370\uC774\uD130 \uD30C\uC774\uD504\uB77C\uC778 \uBE4C\uB354 \uB9CC\uB4E4\uC5B4\uC918",
      "data_pipeline",
      "command-artifact"
    ],
    [
      "\u0043\u0053\u0056 \u0045\u0054\u004C \uD30C\uC774\uD504\uB77C\uC778 \uB3C4\uAD6C \uB9CC\uB4E4\uC5B4\uC918",
      "data_pipeline",
      "command-artifact"
    ],
    [
      "\u0043\u0053\u0056 \uBCC0\uD658\uAE30 \uB9CC\uB4E4\uC5B4\uC918",
      "cli_tool",
      "cli-tool"
    ]
  ];

  for (const [index, [request, projectKind, targetFamily]] of productCases.entries()) {
    const intake = evaluateIntakeRequest(request);
    assert.equal(intake.is_product_build_request, true, request);
    assert.notEqual(intake.status, "not_product_build_request", request);
    const intent = evaluateLoopIntent(request);
    assert.equal(intent.intent, "product_build", request);
    const turn = await runFrontDoorDiscoveryTurn({
      threadId: `ko-phrasing-${projectKind}-${index}`,
      message: request
    });
    assert.equal(turn.intake.project_kind, projectKind, request);
    assert.equal(turn.intake.target_family, targetFamily, request);
    assert.ok(turn.intake.adapter_plan, request);
  }
} finally {
  if (previousEnv.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY === undefined) {
    delete process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY;
  } else {
    process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY =
      previousEnv.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY;
  }
  await cleanupTempRoot(tempRoot);
}

console.log("validate:korean-product-phrasing-variants passed");
