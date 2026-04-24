import { strict as assert } from "node:assert";

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
  extractRunDirectory,
  readSummary,
  runLoop
} from "./validation-utils.mjs";

const foregroundThreadEnv = {
  ...process.env,
  CODEX_THREAD_ID: "thread_validate_prepare",
  HARNESS_LAUNCH_ORIGIN: "codex-app-thread",
  HARNESS_THREAD_BINDING_STATE: "bound",
  HARNESS_SURFACE_OWNER: "stock-codex-thread",
  HARNESS_ENTRYPOINT: "skill",
  HARNESS_APP_VISIBILITY: "visible-in-stock-app"
};

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-loop-prepare");

  try {
    const fixture = await createBootstrapFixture(tempRoot, {
      title: "Prepared Support Desk",
      summary: "A support operations dashboard for triaging and replying to customer issues.",
      targetUsers: ["support lead", "support agent"],
      coreFeatures: ["triage tickets", "write internal notes", "reply to customers"],
      referenceApps: ["Zendesk", "Linear"],
      finishLine: "Agents can triage, annotate, and reply in one reviewable flow.",
      targetFamily: "dashboard",
      targetScore: 0.82,
      maxRounds: 4,
      projectMode: "new",
      frameworkHint: "Next.js",
      packageManager: "npm",
      runCommand: "npm run dev",
      checkCommand: "npm run lint"
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
        rubricPath: fixture.paths.generatedRubricPath,
        targetFamily: "dashboard",
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

    const [buildBrief, runContract, sessionStatus, operatorSurface] =
      await Promise.all([
        readJsonFile(prepared.buildBriefPath),
        readJsonFile(prepared.runContractPath),
        readJsonFile(prepared.sessionStatusPath),
        readJsonFile(prepared.operatorSurfacePath)
      ]);

    assert.equal(buildBrief.product.title, "Prepared Support Desk");
    assert.equal(runContract.execution_controls.target_score, 0.82);
    assert.equal(runContract.execution_controls.max_rounds, 4);
    assert.equal(sessionStatus.session_status, "ready_to_start");
    assert.equal(sessionStatus.readiness, "ready_to_run");
    assert.equal(sessionStatus.attention_kind, "decision");
    assert.equal(sessionStatus.ui_visibility, "user_boundary");
    assert.equal(sessionStatus.foreground_owner, "human");
    assert.equal(operatorSurface.session.session_status, "ready_to_start");
    assert.equal(operatorSurface.ui_visibility, "user_boundary");
    assert.equal(operatorSurface.foreground_owner, "human");
    assert.equal(operatorSurface.session.ui_visibility, "user_boundary");
    assert.equal(operatorSurface.session.foreground_owner, "human");
    assert.match(operatorSurface.next_action, /Preparation is complete/i);
    assert.equal(
      operatorSurface.recommended_command,
      "npm run loop:start:codex -- --json"
    );

    const startExecution = await runLoop(
      ["--controller-mode", "attached", "--transport", "current-thread", "--single"],
      {
        env: foregroundThreadEnv,
        silent: true
      }
    );
    if (startExecution.code !== 0) {
      throw new Error(
        `prepared run start failed.\nSTDOUT:\n${startExecution.stdout}\nSTDERR:\n${startExecution.stderr}`
      );
    }

    const startedRunDirectory = extractRunDirectory(startExecution.stdout);
    assert.equal(startedRunDirectory, prepared.runDirectory);

    const [summary, refreshedSessionStatus, refreshedOperatorSurface] =
      await Promise.all([
        readSummary(prepared.runDirectory),
        readJsonFile(prepared.sessionStatusPath),
        readJsonFile(prepared.operatorSurfacePath)
      ]);
    assertStopReason(summary, "awaiting_codex_checkpoint");
    assert.equal(refreshedSessionStatus.session_status, "running");
    assert.equal(refreshedSessionStatus.readiness, "running");
    assert.equal(refreshedSessionStatus.next_attention, "codex");
    assert.equal(refreshedSessionStatus.ui_visibility, "internal_checkpoint");
    assert.equal(refreshedSessionStatus.foreground_owner, "codex");
    assert.equal(
      refreshedSessionStatus.latest_stop_reason,
      "awaiting_codex_checkpoint"
    );
    assert.equal(refreshedOperatorSurface.session.session_status, "running");
    assert.equal(refreshedOperatorSurface.attention_required, "codex");
    assert.equal(refreshedOperatorSurface.ui_visibility, "internal_checkpoint");
    assert.equal(refreshedOperatorSurface.foreground_owner, "codex");
    assert.equal(refreshedOperatorSurface.session.ui_visibility, "internal_checkpoint");
    assert.equal(refreshedOperatorSurface.session.foreground_owner, "codex");

    const refreshedRunContract = await readJsonFile(prepared.runContractPath);
    assert.equal(refreshedRunContract.start_gate.required, true);
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

await main();
console.log("validate:loop-prepare passed");
