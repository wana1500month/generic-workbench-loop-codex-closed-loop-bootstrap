import { strict as assert } from "node:assert";

import { ensureBuild, importDist } from "./testing/bootstrap-validator-helpers.mjs";

const main = async () => {
  await ensureBuild();
  const [{ evaluateIntakeRequest }, { evaluateLoopIntent }] = await Promise.all([
    importDist("intake-gate.js"),
    importDist("intent-gate.js")
  ]);

  for (const request of [
    "Design product strategy for Q2",
    "Build onboarding docs for our service",
    "Create API documentation for developers",
    "\uBD84\uC11D\uD574\uC918",
    "\uB85C\uB4DC\uB9F5 \uC791\uC131\uD574\uC918"
  ]) {
    const intake = evaluateIntakeRequest(request);
    assert.equal(intake.status, "not_product_build_request", request);
    const intent = evaluateLoopIntent(request);
    assert.notEqual(intent.intent, "product_build", request);
  }

  for (const request of [
    "\uB85C\uADF8 \uBD84\uC11D \uB3C4\uAD6C \uB9CC\uB4E4\uC5B4\uC918",
    "Build a log analyzer",
    "Create a converter"
  ]) {
    const intake = evaluateIntakeRequest(request);
    assert.equal(intake.is_product_build_request, true, request);
    assert.notEqual(intake.status, "not_product_build_request", request);
  }

  assert.equal(evaluateLoopIntent("start loop").intent, "run_control");
  assert.equal(
    evaluateLoopIntent("Change the harness front door routing").intent,
    "harness_design"
  );
};

await main();
console.log("validate:fast-exits passed");
