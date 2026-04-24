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
  extractRunDirectory,
  readSummary,
  runLoop
} from "./validation-utils.mjs";

const buildForegroundThreadEnv = (threadId) => ({
  ...process.env,
  CODEX_THREAD_ID: threadId,
  HARNESS_LAUNCH_ORIGIN: "codex-app-thread",
  HARNESS_THREAD_BINDING_STATE: "bound",
  HARNESS_SURFACE_OWNER: "stock-codex-thread",
  HARNESS_ENTRYPOINT: "skill",
  HARNESS_APP_VISIBILITY: "visible-in-stock-app"
});

const unboundCurrentThreadEnv = {
  ...process.env,
  CODEX_THREAD_ID: "",
  HARNESS_LAUNCH_ORIGIN: "shell",
  HARNESS_THREAD_BINDING_STATE: "unbound",
  HARNESS_SURFACE_OWNER: "external-controller",
  HARNESS_ENTRYPOINT: "shell",
  HARNESS_APP_VISIBILITY: "not-visible-in-stock-app"
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
    "validate-prepared-session-consumption-boundary"
  );
  const threadId = `thread_validate_prepared_session_boundary_${Date.now()}`;
  const foregroundThreadEnv = buildForegroundThreadEnv(threadId);
  const runsDirectory = join(process.cwd(), "evals", "runs");

  try {
    const fixture = await createBootstrapFixture(tempRoot, {
      title: "Prepared Session Boundary Fixture",
      summary:
        "A dashboard fixture that should stop being startable once the same-thread loop begins.",
      targetUsers: ["operator"],
      coreFeatures: ["triage queue", "issue detail", "reply composer"],
      referenceApps: ["Zendesk", "Linear"],
      finishLine:
        "The dashboard reaches a same-thread checkpoint without being reusable as a fresh prepared session.",
      targetFamily: "dashboard",
      targetScore: 0.9,
      maxRounds: 2,
      projectMode: "existing",
      frameworkHint: "Next.js dashboard",
      packageManager: "npm",
      runCommand: "npm run dev",
      checkCommand: "npm run lint",
      healthUrl: "http://127.0.0.1:3000/health"
    });

    const [{ prepareSessionRun, findLatestPreparedRunAwaitingStart }] =
      await Promise.all([importDist("prepare-session.js")]);
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

    const preparedSessionStatus = await readJsonFile(prepared.sessionStatusPath);
    assert.equal(preparedSessionStatus.session_status, "ready_to_start");

    const sameThreadCandidateBeforeStart =
      await findLatestPreparedRunAwaitingStart(runsDirectory, threadId);
    assert.equal(sameThreadCandidateBeforeStart?.runDirectory, prepared.runDirectory);

    const startExecution = await runLoop(
      ["--single", "--controller-mode", "attached", "--transport", "current-thread"],
      {
        env: foregroundThreadEnv,
        silent: true
      }
    );
    if (startExecution.code !== 0) {
      throw new Error(
        `prepared boundary start failed.\nSTDOUT:\n${startExecution.stdout}\nSTDERR:\n${startExecution.stderr}`
      );
    }

    const startedRunDirectory = extractRunDirectory(startExecution.stdout);
    assert.equal(startedRunDirectory, prepared.runDirectory);

    const [summary, startedSessionStatus, startedOperatorSurface] =
      await Promise.all([
        readSummary(prepared.runDirectory),
        readJsonFile(prepared.sessionStatusPath),
        readJsonFile(prepared.operatorSurfacePath)
      ]);
    assertStopReason(summary, "awaiting_codex_checkpoint");
    assert.equal(startedSessionStatus.session_status, "running");
    assert.equal(startedSessionStatus.readiness, "running");
    assert.equal(startedSessionStatus.next_attention, "codex");
    assert.equal(startedSessionStatus.ui_visibility, "internal_checkpoint");
    assert.equal(startedSessionStatus.foreground_owner, "codex");
    assert.equal(
      startedSessionStatus.latest_stop_reason,
      "awaiting_codex_checkpoint"
    );
    assert.equal(startedOperatorSurface.session.session_status, "running");
    assert.equal(startedOperatorSurface.attention_required, "codex");
    assert.equal(startedOperatorSurface.ui_visibility, "internal_checkpoint");
    assert.equal(startedOperatorSurface.foreground_owner, "codex");
    assert.equal(startedOperatorSurface.session.ui_visibility, "internal_checkpoint");
    assert.equal(startedOperatorSurface.session.foreground_owner, "codex");

    const sameThreadCandidateAfterStart =
      await findLatestPreparedRunAwaitingStart(runsDirectory, threadId);
    assert.equal(
      sameThreadCandidateAfterStart,
      undefined,
      "Started prepared session should not remain discoverable on the same bound thread."
    );

    const unboundCandidateAfterStart =
      await findLatestPreparedRunAwaitingStart(runsDirectory, undefined);
    assert.notEqual(unboundCandidateAfterStart?.runDirectory, prepared.runDirectory);

    await rm(tempRoot, { recursive: true, force: true });

    const unboundExecution = await runLoop(
      ["--single", "--controller-mode", "attached", "--transport", "current-thread"],
      {
        env: unboundCurrentThreadEnv,
        silent: true
      }
    );
    if (unboundExecution.code !== 0) {
      throw new Error(
        `unbound current-thread validation run failed.\nSTDOUT:\n${unboundExecution.stdout}\nSTDERR:\n${unboundExecution.stderr}`
      );
    }
    assert(
      !unboundExecution.stderr.includes("ENOENT"),
      "Unbound current-thread start should not fail by re-consuming a started prepared session with deleted bundle artifacts."
    );

    const unboundRunDirectory = extractRunDirectory(unboundExecution.stdout);
    assert.notEqual(
      unboundRunDirectory,
      prepared.runDirectory,
      "Unbound current-thread start should not reuse the started bound prepared run."
    );
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

await main();
console.log("validate:prepared-session-consumption-boundary passed");
