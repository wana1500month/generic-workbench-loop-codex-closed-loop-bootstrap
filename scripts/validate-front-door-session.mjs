import { strict as assert } from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import {
  cleanupTempRoot,
  createTempRoot,
  ensureBuild,
  importDist,
  readJsonFile,
  repoRoot,
  runCommand
} from "./testing/bootstrap-validator-helpers.mjs";

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-front-door-session");
  const sessionsDirectory = join(tempRoot, "front-door-sessions");
  const workspaceRoot = join(tempRoot, "workspace");
  const targetRootRelative = `tmp-targets/${basename(tempRoot)}-target-app`;
  const targetRoot = resolve(repoRoot, targetRootRelative);
  const ideaPath = join(workspaceRoot, "IDEA.md");
  const previousSessionsDirectory = process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY;
  process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY = sessionsDirectory;

  try {
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(
      ideaPath,
      [
        "# Discovery Session App",
        "",
        "A product build session prepared from front-door discovery.",
        ""
      ].join("\n"),
      "utf8"
    );

    const [
      { getFrontDoorSessionStatus, runFrontDoorDiscoveryTurn },
      { prepareSessionRun }
    ] = await Promise.all([
      importDist("front-door-session.js"),
      importDist("prepare-session.js")
    ]);

    const firstTurn = await runFrontDoorDiscoveryTurn({
      threadId: "thread-123",
      message: "Build me a todo app with auth"
    });
    assert.equal(firstTurn.status, "ask_product_questions");
    assert.equal(firstTurn.phase, "product");
    assert.ok(firstTurn.front_door_session_path?.endsWith("session-thread-123.json"));
    assert.match(firstTurn.intake.product_summary ?? "", /todo app with auth/i);
    assert.equal(firstTurn.turn_count, 1);

    const secondTurn = await runFrontDoorDiscoveryTurn({
      threadId: "thread-123",
      message:
        "Solo founders. Must create tasks, assign priorities, and archive completed tasks."
    });
    assert.equal(secondTurn.status, "ask_product_questions");
    assert.deepEqual(secondTurn.intake.target_users, ["Solo founders"]);
    assert.ok(
      (secondTurn.intake.core_features ?? []).includes("create tasks"),
      JSON.stringify(secondTurn, null, 2)
    );
    assert.equal(secondTurn.turn_count, 2);

    const thirdTurn = await runFrontDoorDiscoveryTurn({
      threadId: "thread-123",
      message:
        "References can be Linear. Good enough means solo founders can sign in and manage tasks end to end."
    });
    assert.equal(thirdTurn.status, "ask_execution_questions");
    assert.deepEqual(thirdTurn.intake.reference_apps, ["Linear"]);
    assert.match(thirdTurn.intake.finish_line ?? "", /manage tasks end to end/i);
    assert.equal(thirdTurn.phase, "execution");

    const fourthTurn = await runFrontDoorDiscoveryTurn({
      threadId: "thread-123",
      message: `This is a new project and the target root is ${targetRootRelative}.`
    });
    assert.equal(fourthTurn.status, "ready_for_prepare");
    assert.equal(fourthTurn.phase, "ready_for_prepare");
    assert.equal(fourthTurn.intake.project_mode, "new");
    assert.equal(fourthTurn.intake.target_root, targetRootRelative);
    assert.deepEqual(fourthTurn.defaults_accepted, ["max_rounds", "target_score"]);
    assert.equal(fourthTurn.turn_count, 4);

    const restored = await getFrontDoorSessionStatus("thread-123");
    assert.ok(restored);
    assert.equal(restored?.status, "ready_for_prepare");
    assert.equal(restored?.turn_count, 4);
    assert.equal(restored?.intake.target_root, targetRootRelative);

    const prepared = await prepareSessionRun({
      ideaPath,
      frontDoorSessionPath: fourthTurn.front_door_session_path,
      transportMode: "current-thread",
      controllerMode: "attached"
    });
    const [
      workspaceIntake,
      targetIntake,
      runContract,
      preparedSession,
      preparedSessionStatus,
      preparedOperatorSurface
    ] =
      await Promise.all([
        readJsonFile(join(workspaceRoot, "intake.json")),
        readJsonFile(join(targetRoot, "intake.json")),
        readJsonFile(prepared.runContractPath),
        readJsonFile(fourthTurn.front_door_session_path),
        readJsonFile(prepared.sessionStatusPath),
        readJsonFile(prepared.operatorSurfacePath)
      ]);
    assert.equal(workspaceIntake.target_root, targetRoot);
    assert.equal(targetIntake.target_root, targetRoot);
    assert.equal(runContract.execution_controls.target_root, targetRoot);
    assert.equal(runContract.discovery_source.turn_count, 4);
    assert.ok(
      runContract.discovery_source.front_door_session_path.endsWith(
        "session-thread-123.json"
      ),
      JSON.stringify(runContract.discovery_source, null, 2)
    );
    assert.equal(runContract.continuation_policy.mode, "patch_first");
    assert.deepEqual(runContract.continuation_policy.recontract_only_on, [
      "missing_patch_authority",
      "release_gate_regression",
      "scope_drift",
      "repeated_unresolved_signature",
      "plateau_without_progress"
    ]);
    assert.equal(preparedSession.phase, "prepared");
    assert.equal(preparedSessionStatus.ui_visibility, "user_boundary");
    assert.equal(preparedSessionStatus.foreground_owner, "human");
    assert.equal(preparedOperatorSurface.ui_visibility, "user_boundary");
    assert.equal(preparedOperatorSurface.foreground_owner, "human");

    const secondThread = await runFrontDoorDiscoveryTurn({
      threadId: "thread-456",
      message: "Create a CRM web app for sales reps"
    });
    assert.equal(secondThread.turn_count, 1);
    assert.notEqual(
      secondThread.front_door_session_path,
      fourthTurn.front_door_session_path
    );
    assert.equal(secondThread.intake.target_root, undefined);

    const cliResult = await runCommand(
      process.execPath,
      [
        "./scripts/loop-discover.mjs",
        "--thread-id",
        "thread-cli",
        "--message",
        "Make a booking service for salons",
        "--json"
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY: sessionsDirectory
        },
        shell: false
      }
    );
    if (cliResult.code !== 0) {
      throw new Error(
        `loop-discover failed.\nSTDOUT:\n${cliResult.stdout}\nSTDERR:\n${cliResult.stderr}`
      );
    }
    const parsedCliResult = JSON.parse(cliResult.stdout);
    assert.equal(parsedCliResult.status, "ask_product_questions");
    assert.equal(parsedCliResult.phase, "product");
    assert.ok(parsedCliResult.front_door_session_path.endsWith("session-thread-cli.json"));
  } finally {
    if (previousSessionsDirectory === undefined) {
      delete process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY;
    } else {
      process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY = previousSessionsDirectory;
    }
    await cleanupTempRoot(tempRoot);
    await cleanupTempRoot(targetRoot);
  }
};

await main();
console.log("validate:front-door-session passed");
