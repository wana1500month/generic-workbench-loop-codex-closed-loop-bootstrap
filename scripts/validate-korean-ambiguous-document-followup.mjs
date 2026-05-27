import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";

import {
  cleanupTempRoot,
  createTempRoot,
  ensureBuild,
  importDist
} from "./testing/bootstrap-validator-helpers.mjs";

const writeSummaryIfRequested = async (summary) => {
  if (!process.env.HARNESS_VALIDATION_SUMMARY_PATH) {
    return;
  }
  await writeFile(
    process.env.HARNESS_VALIDATION_SUMMARY_PATH,
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8"
  );
};

await ensureBuild();
const tempRoot = await createTempRoot("validate-korean-ambiguous-document-followup");
const previousEnv = {
  HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY:
    process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY
};
process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY = tempRoot;

try {
  const [
    { evaluateLoopIntent },
    { runFrontDoorDiscoveryTurn }
  ] = await Promise.all([
    importDist("intent-gate.js"),
    importDist("front-door-session.js")
  ]);

  const firstMessage =
    "\u0041\u0050\u0049 \uBB38\uC11C \uB9CC\uB4E4\uC5B4\uC918";
  const followupMessage =
    "\uB3C4\uAD6C \uB9CC\uB4DC\uB294 \uB73B\uC774\uC57C. \u004F\u0070\u0065\u006E\u0041\u0050\u0049 \uC785\uB825\uC744 \uBC1B\uC544 \u004D\u0061\u0072\u006B\u0064\u006F\u0077\u006E \uBB38\uC11C\uB97C \uC0DD\uC131\uD574\uC57C \uD574.";

  const firstTurn = await runFrontDoorDiscoveryTurn({
    threadId: "ko-ambiguous-document-followup",
    message: firstMessage
  });
  assert.equal(firstTurn.status, "ambiguous_document_request");
  assert.equal(firstTurn.phase, "clarification");
  assert.equal(firstTurn.turn_count, 1);
  assert.ok(firstTurn.front_door_session_path);

  const resolvedIntent = evaluateLoopIntent(`${firstMessage}\n${followupMessage}`);
  assert.equal(resolvedIntent.intent, "product_build");

  const secondTurn = await runFrontDoorDiscoveryTurn({
    threadId: "ko-ambiguous-document-followup",
    message: followupMessage
  });
  assert.notEqual(secondTurn.status, "ambiguous_document_request");
  assert.notEqual(secondTurn.status, "not_product_build_request");
  assert.equal(secondTurn.turn_count, 2);
  assert.equal(secondTurn.intake.project_kind, "document_artifact");
  assert.equal(secondTurn.intake.target_family, "command-artifact");
  assert.equal(secondTurn.intake.adapter_plan?.target_family, "command-artifact");
  assert.ok(
    secondTurn.front_door_session_path?.endsWith(
      "session-ko-ambiguous-document-followup.json"
    )
  );

  const summary = {
    first: {
      status: firstTurn.status,
      phase: firstTurn.phase,
      turn_count: firstTurn.turn_count
    },
    second: {
      status: secondTurn.status,
      phase: secondTurn.phase,
      turn_count: secondTurn.turn_count,
      project_kind: secondTurn.intake.project_kind,
      target_family: secondTurn.intake.target_family,
      adapter_plan_target_family: secondTurn.intake.adapter_plan?.target_family,
      verification_surfaces:
        secondTurn.intake.adapter_plan?.verification_surfaces ?? []
    }
  };
  await writeSummaryIfRequested(summary);
} finally {
  if (previousEnv.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY === undefined) {
    delete process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY;
  } else {
    process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY =
      previousEnv.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY;
  }
  await cleanupTempRoot(tempRoot);
}

console.log("validate:korean-ambiguous-document-followup passed");
