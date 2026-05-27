import { strict as assert } from "node:assert";

import {
  cleanupTempRoot,
  createTempRoot,
  ensureBuild,
  importDist
} from "./testing/bootstrap-validator-helpers.mjs";

await ensureBuild();
const tempRoot = await createTempRoot("validate-korean-ambiguous-document-request");
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

  const ambiguousRequests = [
    "\u0041\u0050\u0049 \uBB38\uC11C \uB9CC\uB4E4\uC5B4\uC918",
    "\u0041\u0050\u0049 \uBB38\uC11C \uC791\uC131\uD574\uC918",
    "\uBB38\uC11C \uC791\uC131\uD574\uC918",
    "\uBCF4\uACE0\uC11C \uB9CC\uB4E4\uC5B4\uC918"
  ];

  for (const [index, request] of ambiguousRequests.entries()) {
    const intake = evaluateIntakeRequest(request);
    assert.equal(intake.status, "ambiguous_document_request", request);
    assert.equal(intake.phase, "clarification", request);
    assert.equal(intake.is_product_build_request, false, request);
    assert.ok(intake.questions.length >= 1, request);
    assert.equal(
      intake.ambiguous_document_request?.reason,
      "ambiguous_document_request",
      request
    );

    const intent = evaluateLoopIntent(request);
    assert.equal(intent.intent, "unknown", request);
    assert.equal(intent.status, "ambiguous_document_request", request);
    assert.equal(intent.route_target, "clarify", request);
    assert.equal(intent.intake_status, "ambiguous_document_request", request);

    const turn = await runFrontDoorDiscoveryTurn({
      threadId: `ko-ambiguous-document-${index}`,
      message: request
    });
    assert.equal(turn.status, "ambiguous_document_request", request);
    assert.equal(turn.phase, "clarification", request);
    assert.ok(turn.questions.length >= 1, request);
    assert.equal(turn.turn_count, 0, request);
  }

  const productRequests = [
    "\u0041\u0050\u0049 \uBB38\uC11C \uC0DD\uC131\uAE30",
    "\uBB38\uC11C \uC790\uB3D9\uD654 \uB3C4\uAD6C \uB9CC\uB4E4\uC5B4\uC918",
    "\uBCF4\uACE0\uC11C \uC790\uB3D9 \uC0DD\uC131 \uB3C4\uAD6C \uB9CC\uB4E4\uC5B4\uC918",
    "\uBB38\uC11C \uD15C\uD50C\uB9BF \uC0DD\uC131\uAE30 \uB9CC\uB4E4\uC5B4\uC918"
  ];

  for (const request of productRequests) {
    const intake = evaluateIntakeRequest(request);
    assert.equal(intake.is_product_build_request, true, request);
    assert.notEqual(intake.status, "ambiguous_document_request", request);
    assert.notEqual(intake.status, "not_product_build_request", request);
    const intent = evaluateLoopIntent(request);
    assert.equal(intent.intent, "product_build", request);
  }

  const nonProductRequests = [
    "\uBB38\uC11C \uC694\uC57D\uD574\uC918",
    "\uBB38\uC11C \uBD84\uC11D\uD574\uC918",
    "\uBB38\uC11C \uBC88\uC5ED\uD574\uC918",
    "\uBB38\uC11C \uAC80\uD1A0\uD574\uC918"
  ];

  for (const request of nonProductRequests) {
    const intake = evaluateIntakeRequest(request);
    assert.equal(intake.status, "not_product_build_request", request);
    const intent = evaluateLoopIntent(request);
    assert.notEqual(intent.intent, "product_build", request);
    assert.notEqual(intent.status, "ambiguous_document_request", request);
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

console.log("validate:korean-ambiguous-document-request passed");
