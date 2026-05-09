import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import {
  cleanupTempRoot,
  createTempRoot,
  ensureBuild,
  importDist,
  readJsonFile,
  repoRoot
} from "./testing/bootstrap-validator-helpers.mjs";

const safeRm = async (path, allowedRoot) => {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(allowedRoot);
  assert.ok(
    resolvedPath.startsWith(resolvedRoot),
    `Refusing to remove path outside ${resolvedRoot}: ${resolvedPath}`
  );
  await rm(resolvedPath, { recursive: true, force: true });
};

const createReadySession = async ({
  runFrontDoorDiscoveryTurn,
  threadId,
  product,
  targetRoot
}) => {
  await runFrontDoorDiscoveryTurn({
    threadId,
    message: `Build me a ${product} browser app`
  });
  await runFrontDoorDiscoveryTurn({
    threadId,
    message:
      "Solo operators. Core workflows: create entries, filter entries, review summary. Good enough means operators can create and review entries."
  });
  await runFrontDoorDiscoveryTurn({
    threadId,
    message: `This is a new project and the target root is ${targetRoot}.`
  });
  const ready = await runFrontDoorDiscoveryTurn({
    threadId,
    message: [
      "Verify with browser.",
      "create entries -> a new entry is visible.",
      "filter entries -> filtered results are visible.",
      "review summary -> summary totals are visible."
    ].join("\n")
  });
  assert.equal(ready.status, "ready_for_prepare", JSON.stringify(ready, null, 2));
  return ready;
};

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-app-prepare-isolation");
  const workspaceDirectory = join(tempRoot, "workspace");
  const ideaPath = join(workspaceDirectory, "IDEA.md");
  const sessionsDirectory = join(tempRoot, "front-door-sessions");
  const runsDirectory = join(repoRoot, "evals", "runs");
  const repoRootIntakePath = join(repoRoot, "intake.json");
  const repoTmpPath = join(repoRoot, "tmp");
  const repoRootIntakeExisted = existsSync(repoRootIntakePath);
  const repoTmpExisted = existsSync(repoTmpPath);
  const previousEnv = {
    HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY:
      process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY,
    CODEX_THREAD_ID: process.env.CODEX_THREAD_ID,
    HARNESS_THREAD_BINDING_STATE: process.env.HARNESS_THREAD_BINDING_STATE,
    HARNESS_LAUNCH_ORIGIN: process.env.HARNESS_LAUNCH_ORIGIN
  };
  process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY = sessionsDirectory;
  delete process.env.CODEX_THREAD_ID;
  delete process.env.HARNESS_THREAD_BINDING_STATE;
  delete process.env.HARNESS_LAUNCH_ORIGIN;
  await mkdir(workspaceDirectory, { recursive: true });
  await writeFile(
    ideaPath,
    [
      "# Validator Workbench",
      "",
      "A temporary workspace for validating run-local generated adapter isolation."
    ].join("\n") + "\n",
    "utf8"
  );

  const preparedRuns = [];
  const targetRoots = [];
  try {
    const [
      { runFrontDoorDiscoveryTurn },
      {
        clearReadyToStartSessionMarker,
        findLatestPreparedRunAwaitingStart,
        readyToStartMarkerPathForRun,
        readyToStartMarkerPathForThread
      },
      { prepareSessionRun }
    ] = await Promise.all([
      importDist("front-door-session.js"),
      importDist("prepare-session.js"),
      importDist("prepare-session.js")
    ]);

    const threadA = "thread-ready-index-a";
    const threadB = "thread-ready-index-b";
    const readyA = await createReadySession({
      runFrontDoorDiscoveryTurn,
      threadId: threadA,
      product: "ledger",
      targetRoot: `./.tmp/${basename(tempRoot)}-ledger-a`
    });
    const readyB = await createReadySession({
      runFrontDoorDiscoveryTurn,
      threadId: threadB,
      product: "ledger",
      targetRoot: `./.tmp/${basename(tempRoot)}-ledger-b`
    });
    targetRoots.push(readyA.intake.target_root, readyB.intake.target_root);

    const preparedA = await prepareSessionRun({
      ideaPath,
      frontDoorSessionPath: readyA.front_door_session_path,
      transportMode: "current-thread",
      controllerMode: "attached"
    });
    const preparedB = await prepareSessionRun({
      ideaPath,
      frontDoorSessionPath: readyB.front_door_session_path,
      transportMode: "current-thread",
      controllerMode: "attached"
    });
    preparedRuns.push(preparedA, preparedB);

    const adapterA = await readJsonFile(preparedA.adapterPath);
    assert.ok(
      preparedA.adapterPath.startsWith(join(preparedA.runDirectory, "generated-adapter")),
      `adapter A is not run-local: ${preparedA.adapterPath}`
    );
    assert.ok(
      preparedB.adapterPath.startsWith(join(preparedB.runDirectory, "generated-adapter")),
      `adapter B is not run-local: ${preparedB.adapterPath}`
    );
    assert.ok(
      existsSync(
        join(preparedA.runDirectory, "generated-adapter", "codex-adapter", "runtime-config.json")
      ),
      "run-local generated adapter runtime-config is missing"
    );
    assert.equal(adapterA.capabilities.prepare_target.cwd, ".");
    assert.deepEqual(adapterA.capabilities.prepare_target.args, [
      "./codex-adapter/scripts/prepare-target.mjs"
    ]);
    assert.ok(
      !existsSync(join(repoRoot, "adapter.generated.json")),
      "prepare should not write root adapter.generated.json"
    );
    assert.ok(
      !existsSync(join(repoRoot, "adapter-plan.generated.json")),
      "prepare should not write root adapter-plan.generated.json"
    );

    const [markerAByRun, markerAByThread, markerBByRun, markerBByThread] =
      await Promise.all([
        readJsonFile(readyToStartMarkerPathForRun(runsDirectory, preparedA.runId)),
        readJsonFile(readyToStartMarkerPathForThread(runsDirectory, threadA)),
        readJsonFile(readyToStartMarkerPathForRun(runsDirectory, preparedB.runId)),
        readJsonFile(readyToStartMarkerPathForThread(runsDirectory, threadB))
      ]);
    assert.equal(markerAByRun.run_id, preparedA.runId);
    assert.equal(markerAByThread.run_id, preparedA.runId);
    assert.equal(markerBByRun.run_id, preparedB.runId);
    assert.equal(markerBByThread.run_id, preparedB.runId);
    assert.ok(
      !existsSync(join(runsDirectory, "ready-to-start-session.json")),
      "singleton ready-to-start-session.json must not be written"
    );

    const resolvedB = await findLatestPreparedRunAwaitingStart(runsDirectory, threadB);
    assert.equal(resolvedB?.runId, preparedB.runId);
    const resolvedA = await findLatestPreparedRunAwaitingStart(runsDirectory, threadA);
    assert.equal(resolvedA?.runId, preparedA.runId);

    await clearReadyToStartSessionMarker(runsDirectory, markerBByThread);
    assert.ok(
      existsSync(readyToStartMarkerPathForRun(runsDirectory, preparedA.runId)),
      "clearing thread B must not remove thread A by-run marker"
    );
    assert.ok(
      existsSync(readyToStartMarkerPathForThread(runsDirectory, threadA)),
      "clearing thread B must not remove thread A by-thread marker"
    );
    assert.ok(
      !existsSync(readyToStartMarkerPathForRun(runsDirectory, preparedB.runId)),
      "thread B by-run marker should be consumed"
    );
    assert.ok(
      !existsSync(readyToStartMarkerPathForThread(runsDirectory, threadB)),
      "thread B by-thread marker should be consumed"
    );
    await clearReadyToStartSessionMarker(runsDirectory, markerAByThread);
  } finally {
    process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY =
      previousEnv.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY;
    if (previousEnv.CODEX_THREAD_ID === undefined) {
      delete process.env.CODEX_THREAD_ID;
    } else {
      process.env.CODEX_THREAD_ID = previousEnv.CODEX_THREAD_ID;
    }
    if (previousEnv.HARNESS_THREAD_BINDING_STATE === undefined) {
      delete process.env.HARNESS_THREAD_BINDING_STATE;
    } else {
      process.env.HARNESS_THREAD_BINDING_STATE =
        previousEnv.HARNESS_THREAD_BINDING_STATE;
    }
    if (previousEnv.HARNESS_LAUNCH_ORIGIN === undefined) {
      delete process.env.HARNESS_LAUNCH_ORIGIN;
    } else {
      process.env.HARNESS_LAUNCH_ORIGIN = previousEnv.HARNESS_LAUNCH_ORIGIN;
    }
    for (const prepared of preparedRuns) {
      await safeRm(prepared.runDirectory, runsDirectory);
    }
    for (const targetRoot of targetRoots) {
      if (typeof targetRoot === "string" && targetRoot.trim()) {
        await safeRm(resolve(repoRoot, targetRoot), repoRoot);
      }
    }
    if (!repoRootIntakeExisted) {
      await rm(repoRootIntakePath, { force: true });
    }
    if (!repoTmpExisted) {
      await rm(repoTmpPath, { recursive: true, force: true });
    }
    await cleanupTempRoot(tempRoot);
  }
};

await main();
console.log("validate:app-prepare-isolation passed");
