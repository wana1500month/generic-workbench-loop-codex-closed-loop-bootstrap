import { strict as assert } from "node:assert";

import {
  cleanupTempRoot,
  createTempRoot,
  ensureBuild,
  importDist
} from "./testing/bootstrap-validator-helpers.mjs";

await ensureBuild();
const tempRoot = await createTempRoot("validate-korean-non-product-rejection");
const previousEnv = {
  HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY:
    process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY
};
process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY = tempRoot;

try {
  const [{ evaluateIntakeRequest }, { evaluateLoopIntent }] = await Promise.all([
    importDist("intake-gate.js"),
    importDist("intent-gate.js")
  ]);

  const nonProductRequests = [
    "\uBB38\uC11C \uC694\uC57D\uD574\uC918",
    "\uBB38\uC11C \uBD84\uC11D\uD574\uC918",
    "\uBB38\uC11C \uBC88\uC5ED\uD574\uC918",
    "\uBB38\uC11C \uAC80\uD1A0\uD574\uC918",
    "\u0041\u0050\u0049 \uBB38\uC11C \uB9CC\uB4E4\uC5B4\uC918"
  ];

  for (const request of nonProductRequests) {
    const intake = evaluateIntakeRequest(request);
    assert.equal(intake.status, "not_product_build_request", request);
    assert.equal(intake.is_product_build_request, false, request);
    const intent = evaluateLoopIntent(request);
    assert.notEqual(intent.intent, "product_build", request);
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

console.log("validate:korean-non-product-rejection passed");
