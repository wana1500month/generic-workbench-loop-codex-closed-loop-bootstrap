import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
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
    const genericIdeaPath = join(workspaceRoot, "GENERIC_IDEA.md");
    await writeFile(
      genericIdeaPath,
      [
        "# Generic Codex Workbench",
        "",
        "Harness memory should never replace front-door product intake.",
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
    assert.equal(firstTurn.intake.target_score, undefined);
    assert.equal(firstTurn.intake.max_rounds, undefined);
    assert.ok(firstTurn.last_question_ids.length > 0);
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
    assert.equal(fourthTurn.status, "ask_adapter_questions");
    assert.equal(fourthTurn.phase, "adapter");
    assert.equal(fourthTurn.intake.project_mode, "new");
    assert.equal(fourthTurn.intake.target_root, targetRootRelative);
    assert.ok(
      fourthTurn.missing_adapter_fields.includes("verification_surface"),
      JSON.stringify(fourthTurn, null, 2)
    );
    assert.equal(fourthTurn.turn_count, 4);

    const fifthTurn = await runFrontDoorDiscoveryTurn({
      threadId: "thread-123",
      message: [
        "Verify with browser.",
        "create tasks -> task appears in the list.",
        "assign priorities -> priority is visible.",
        "archive completed tasks -> archived state is visible."
      ].join("\n")
    });
    const readyTurn = fifthTurn;
    assert.equal(readyTurn.status, "ready_for_prepare");
    assert.equal(readyTurn.phase, "ready_for_prepare");
    assert.deepEqual(readyTurn.intake.verification_surfaces, ["browser"]);
    assert.ok((readyTurn.intake.workflow_checks ?? []).length >= 3);
    assert.deepEqual(fourthTurn.defaults_accepted, [
      "max_rounds",
      "target_root",
      "target_score"
    ]);
    assert.equal(readyTurn.turn_count, 5);

    const restored = await getFrontDoorSessionStatus("thread-123");
    assert.ok(restored);
    assert.equal(restored?.status, "ready_for_prepare");
    assert.equal(restored?.turn_count, 5);
    assert.equal(restored?.intake.target_root, targetRootRelative);

    process.env.CODEX_THREAD_ID = "different-thread";
    await assert.rejects(
      () =>
        prepareSessionRun({
          runDirectory: join(tempRoot, "mismatch-run"),
          ideaPath,
          frontDoorSessionPath: readyTurn.front_door_session_path,
          transportMode: "current-thread",
          controllerMode: "attached"
        }),
      /belongs to thread thread-123/
    );
    delete process.env.CODEX_THREAD_ID;

    const prepared = await prepareSessionRun({
      ideaPath,
      frontDoorSessionPath: readyTurn.front_door_session_path,
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
        readJsonFile(readyTurn.front_door_session_path),
        readJsonFile(prepared.sessionStatusPath),
        readJsonFile(prepared.operatorSurfacePath)
      ]);
    assert.equal(workspaceIntake.target_root, targetRoot);
    assert.equal(targetIntake.target_root, targetRoot);
    assert.equal(runContract.execution_controls.target_root, targetRoot);
    assert.equal(runContract.discovery_source.turn_count, 5);
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
    assert.equal(preparedSession.last_question_ids.length, 0);
    assert.equal(preparedSession.last_question_batch.length, 0);
    assert.equal(preparedSession.prepared_run.run_id, prepared.runId);
    assert.equal(preparedSession.prepared_run.run_directory, prepared.runDirectory);
    assert.match(preparedSession.prepared_run.prepared_at, /\d{4}-\d{2}-\d{2}T/);
    assert.equal(preparedSessionStatus.session_binding.thread_id, "thread-123");
    assert.equal(preparedSessionStatus.session_binding.binding_state, "bound");
    assert.equal(preparedSessionStatus.ui_visibility, "user_boundary");
    assert.equal(preparedSessionStatus.foreground_owner, "human");
    assert.equal(preparedOperatorSurface.ui_visibility, "user_boundary");
    assert.equal(preparedOperatorSurface.foreground_owner, "human");
    assert.ok(
      prepared.adapterPath.startsWith(join(prepared.runDirectory, "generated-adapter")),
      `prepared adapter should be run-local: ${prepared.adapterPath}`
    );
    assert.ok(
      prepared.adapterPlanPath.startsWith(join(prepared.runDirectory, "generated-adapter")),
      `prepared adapter plan should be run-local: ${prepared.adapterPlanPath}`
    );
    assert.ok(
      prepared.evaluatorProfilePath.startsWith(join(prepared.runDirectory, "generated-adapter")),
      `prepared evaluator profile should be run-local: ${prepared.evaluatorProfilePath}`
    );
    assert.ok(
      existsSync(join(prepared.runDirectory, "generated-adapter", "codex-adapter", "runtime-config.json")),
      "prepared session should write run-local generated adapter runtime config"
    );
    assert.ok(
      !existsSync(join(repoRoot, "adapter.generated.json")),
      "prepared session should not write root adapter.generated.json"
    );
    assert.ok(
      !existsSync(join(repoRoot, "adapter-plan.generated.json")),
      "prepared session should not write root adapter-plan.generated.json"
    );
    const readyIndexRoot = join(repoRoot, "evals", "runs", "ready-to-start");
    const [readyLatest, readyByRun, readyByThread] = await Promise.all([
      readJsonFile(join(readyIndexRoot, "latest.json")),
      readJsonFile(join(readyIndexRoot, "by-run", `${prepared.runId}.json`)),
      readJsonFile(
        join(readyIndexRoot, "by-thread", `${encodeURIComponent("thread-123")}.json`)
      )
    ]);
    assert.equal(readyLatest.run_id, prepared.runId);
    assert.equal(readyByRun.run_id, prepared.runId);
    assert.equal(readyByThread.run_id, prepared.runId);
    assert.ok(
      !existsSync(join(repoRoot, "evals", "runs", "ready-to-start-session.json")),
      "prepared session should not write singleton ready-to-start-session.json"
    );

    const preparedStatus = await getFrontDoorSessionStatus("thread-123");
    assert.equal(preparedStatus.status, "prepared");
    assert.equal(preparedStatus.phase, "prepared");
    assert.equal(preparedStatus.intake.target_root, targetRootRelative);

    const afterPreparedTurn = await runFrontDoorDiscoveryTurn({
      threadId: "thread-123",
      message: "Actually change it to a CRM app"
    });
    assert.equal(afterPreparedTurn.status, "prepared");
    assert.equal(afterPreparedTurn.phase, "prepared");
    assert.equal(
      afterPreparedTurn.intake.product_summary,
      preparedStatus.intake.product_summary
    );
    assert.equal(afterPreparedTurn.intake.target_root, targetRootRelative);

    const terseFirst = await runFrontDoorDiscoveryTurn({
      threadId: "thread-terse",
      message: "Build me a todo app with auth"
    });
    assert.equal(terseFirst.status, "ask_product_questions");

    const terseSecond = await runFrontDoorDiscoveryTurn({
      threadId: "thread-terse",
      message: [
        "1. Solo founders",
        "2. create tasks, assign priorities, archive completed tasks",
        "3. users can manage tasks end to end"
      ].join("\n")
    });
    assert.deepEqual(terseSecond.intake.target_users, ["Solo founders"]);
    assert.ok(terseSecond.intake.core_features.includes("create tasks"));
    assert.deepEqual(terseSecond.intake.reference_apps, []);

    await runFrontDoorDiscoveryTurn({
      threadId: "thread-reference-url",
      message: "Build me a todo app with auth"
    });
    const referenceUrlTurn = await runFrontDoorDiscoveryTurn({
      threadId: "thread-reference-url",
      message: "References can be https://linear.app and https://figma.com."
    });
    assert.deepEqual(referenceUrlTurn.intake.reference_apps, [
      "https://linear.app",
      "https://figma.com"
    ]);

    await runFrontDoorDiscoveryTurn({
      threadId: "thread-reference-url-labeled",
      message: "Build me a todo app with auth"
    });
    const labeledReferenceUrlTurn = await runFrontDoorDiscoveryTurn({
      threadId: "thread-reference-url-labeled",
      message: "References can be https://linear.app and https://figma.com."
    });
    assert.deepEqual(labeledReferenceUrlTurn.intake.reference_apps, [
      "https://linear.app",
      "https://figma.com"
    ]);

    await runFrontDoorDiscoveryTurn({
      threadId: "thread-reference-products-label",
      message: "Build me a todo app with auth"
    });
    const referenceProductsLabelTurn = await runFrontDoorDiscoveryTurn({
      threadId: "thread-reference-products-label",
      message: "Reference products are Linear and Figma."
    });
    assert.deepEqual(referenceProductsLabelTurn.intake.reference_apps, [
      "Linear",
      "Figma"
    ]);

    await runFrontDoorDiscoveryTurn({
      threadId: "thread-reference-apps-label",
      message: "Build me a todo app with auth"
    });
    const referenceAppsLabelTurn = await runFrontDoorDiscoveryTurn({
      threadId: "thread-reference-apps-label",
      message: "Reference apps: Linear, Figma."
    });
    assert.deepEqual(referenceAppsLabelTurn.intake.reference_apps, [
      "Linear",
      "Figma"
    ]);

    await runFrontDoorDiscoveryTurn({
      threadId: "thread-reference-url-and-path",
      message: "Build me a todo app with auth"
    });
    const referenceUrlAndPathTurn = await runFrontDoorDiscoveryTurn({
      threadId: "thread-reference-url-and-path",
      message:
        "References can be https://example.com/and/path and https://foo.com/or/view."
    });
    assert.deepEqual(referenceUrlAndPathTurn.intake.reference_apps, [
      "https://example.com/and/path",
      "https://foo.com/or/view"
    ]);

    await runFrontDoorDiscoveryTurn({
      threadId: "thread-reference-numbered-period",
      message: "Build me a todo app with auth"
    });
    await runFrontDoorDiscoveryTurn({
      threadId: "thread-reference-numbered-period",
      message: [
        "1. Solo founders.",
        "2. create tasks and archive them.",
        "3. users can manage tasks end to end."
      ].join("\n")
    });
    const referenceNumberedPeriodTurn = await runFrontDoorDiscoveryTurn({
      threadId: "thread-reference-numbered-period",
      message: "References: Linear and Figma."
    });
    assert.deepEqual(referenceNumberedPeriodTurn.intake.target_users, [
      "Solo founders"
    ]);
    assert.ok(
      referenceNumberedPeriodTurn.intake.core_features.includes("create tasks")
    );
    assert.deepEqual(referenceNumberedPeriodTurn.intake.reference_apps, [
      "Linear",
      "Figma"
    ]);

    const terseThird = await runFrontDoorDiscoveryTurn({
      threadId: "thread-terse",
      message: "They can sign in and manage tasks end to end."
    });
    assert.match(terseThird.intake.finish_line ?? "", /manage tasks/i);

    const terseFinishFirst = await runFrontDoorDiscoveryTurn({
      threadId: "thread-terse-finish",
      message: "Build me a todo app with auth"
    });
    assert.equal(terseFinishFirst.status, "ask_product_questions");

    await runFrontDoorDiscoveryTurn({
      threadId: "thread-terse-finish",
      message: ["1. Solo founders", "2. tasks"].join("\n")
    });

    const finishTurn = await runFrontDoorDiscoveryTurn({
      threadId: "thread-terse-finish",
      message: "MVP works"
    });
    assert.equal(finishTurn.intake.finish_line, "MVP works");
    assert.deepEqual(finishTurn.intake.target_users, ["Solo founders"]);

    const executionTurn = await runFrontDoorDiscoveryTurn({
      threadId: "thread-terse-finish",
      message: "new, tmp-targets/foo"
    });
    assert.equal(executionTurn.intake.project_mode, "new");
    assert.equal(executionTurn.intake.target_root, "tmp-targets/foo");
    assert.deepEqual(executionTurn.intake.target_users, ["Solo founders"]);

    await runFrontDoorDiscoveryTurn({
      threadId: "thread-users-can-finish",
      message: "Build me a todo app with auth"
    });
    await runFrontDoorDiscoveryTurn({
      threadId: "thread-users-can-finish",
      message: ["1. Solo founders", "2. tasks"].join("\n")
    });
    const usersCanFinish = await runFrontDoorDiscoveryTurn({
      threadId: "thread-users-can-finish",
      message: "Users can sign in and manage tasks end to end."
    });
    assert.equal(
      usersCanFinish.intake.finish_line,
      "Users can sign in and manage tasks end to end."
    );
    assert.deepEqual(usersCanFinish.intake.target_users, ["Solo founders"]);

    await runFrontDoorDiscoveryTurn({
      threadId: "thread-none-period",
      message: "Build me a todo app with auth"
    });
    const noneWithPeriodSecond = await runFrontDoorDiscoveryTurn({
      threadId: "thread-none-period",
      message: "References: none."
    });
    assert.deepEqual(noneWithPeriodSecond.intake.reference_apps, []);

    await runFrontDoorDiscoveryTurn({
      threadId: "thread-no-references-period",
      message: "Build me a todo app with auth"
    });
    const noReferencesSecond = await runFrontDoorDiscoveryTurn({
      threadId: "thread-no-references-period",
      message: "References: No references."
    });
    assert.deepEqual(noReferencesSecond.intake.reference_apps, []);

    await runFrontDoorDiscoveryTurn({
      threadId: "thread-windows-path",
      message: "Build me a todo app with auth"
    });
    await runFrontDoorDiscoveryTurn({
      threadId: "thread-windows-path",
      message: [
        "1. Solo founders",
        "2. create tasks and archive them",
        "3. users can manage tasks end to end"
      ].join("\n")
    });
    await runFrontDoorDiscoveryTurn({
      threadId: "thread-windows-path",
      message: "Users can manage tasks end to end."
    });
    const windowsExecution = await runFrontDoorDiscoveryTurn({
      threadId: "thread-windows-path",
      message: String.raw`new, C:\Users\SUNGMOK\Desktop\harness\todo-app`
    });
    assert.equal(windowsExecution.intake.project_mode, "new");
    assert.equal(
      windowsExecution.intake.target_root,
      String.raw`C:\Users\SUNGMOK\Desktop\harness\todo-app`
    );

    await runFrontDoorDiscoveryTurn({
      threadId: "thread-posix-absolute-path",
      message: "Build me a todo app with auth"
    });
    await runFrontDoorDiscoveryTurn({
      threadId: "thread-posix-absolute-path",
      message: [
        "1. Solo founders",
        "2. create tasks and archive them",
        "3. users can manage tasks end to end"
      ].join("\n")
    });
    await runFrontDoorDiscoveryTurn({
      threadId: "thread-posix-absolute-path",
      message: "Users can manage tasks end to end."
    });
    const posixAbsoluteExecution = await runFrontDoorDiscoveryTurn({
      threadId: "thread-posix-absolute-path",
      message: "new, /mnt/data/budget-app"
    });
    assert.equal(posixAbsoluteExecution.intake.project_mode, "new");
    assert.equal(posixAbsoluteExecution.intake.target_root, "/mnt/data/budget-app");

    await runFrontDoorDiscoveryTurn({
      threadId: "thread-latest-path-surface-guard",
      message: "\uAC00\uACC4\uBD80 \uC571 \uB9CC\uB4E4\uC5B4\uC918"
    });
    await runFrontDoorDiscoveryTurn({
      threadId: "thread-latest-path-surface-guard",
      message: [
        "\uB300\uC0C1\uC740 \uAC1C\uC778 \uC0AC\uC6A9\uC790\uC57C.",
        "\uD575\uC2EC\uC740 \uC218\uC785/\uC9C0\uCD9C \uAE30\uB85D, \uCE74\uD14C\uACE0\uB9AC \uAD00\uB9AC, \uC6D4\uBCC4 \uD1B5\uACC4 \uBCF4\uAE30\uC57C.",
        "\uC131\uACF5 \uAE30\uC900\uC740 \uAC70\uB798 \uCD94\uAC00/\uC0AD\uC81C\uC640 \uC6D4\uBCC4 \uD1B5\uACC4\uB97C \uD655\uC778\uD558\uB294 \uAC70\uC57C."
      ].join("\n")
    });
    const latestPathExecution = await runFrontDoorDiscoveryTurn({
      threadId: "thread-latest-path-surface-guard",
      message:
        "\uC0C8 \uD504\uB85C\uC81D\uD2B8\uACE0 \uC791\uC5C5 \uD3F4\uB354\uB294 /tmp/harness_latest/review-budget-app \uC785\uB2C8\uB2E4."
    });
    assert.equal(latestPathExecution.status, "ask_adapter_questions");
    assert.equal(
      latestPathExecution.intake.target_root,
      "/tmp/harness_latest/review-budget-app"
    );
    assert.deepEqual(latestPathExecution.intake.verification_surfaces ?? [], []);
    assert.ok(
      latestPathExecution.missing_adapter_fields.includes("verification_surface"),
      JSON.stringify(latestPathExecution, null, 2)
    );

    await runFrontDoorDiscoveryTurn({
      threadId: "thread-ko-labeled-natural-product-answer",
      message: "\uAC00\uACC4\uBD80 \uC571 \uB9CC\uB4E4\uC5B4\uC918"
    });
    const koLabeledNaturalProduct = await runFrontDoorDiscoveryTurn({
      threadId: "thread-ko-labeled-natural-product-answer",
      message: [
        "\uB300\uC0C1\uC740 \uAC1C\uC778 \uC0AC\uC6A9\uC790\uC57C.",
        "\uD575\uC2EC\uC740 \uC218\uC785/\uC9C0\uCD9C \uAE30\uB85D, \uCE74\uD14C\uACE0\uB9AC \uAD00\uB9AC, \uC6D4\uBCC4 \uD1B5\uACC4 \uBCF4\uAE30\uC57C.",
        "\uC131\uACF5 \uAE30\uC900\uC740 \uAC70\uB798 \uCD94\uAC00/\uC0AD\uC81C\uC640 \uC6D4\uBCC4 \uD1B5\uACC4\uB97C \uD655\uC778\uD558\uB294 \uAC70\uC57C."
      ].join("\n")
    });
    assert.equal(koLabeledNaturalProduct.status, "ask_execution_questions");
    assert.deepEqual(koLabeledNaturalProduct.intake.target_users, [
      "\uAC1C\uC778 \uC0AC\uC6A9\uC790"
    ]);
    assert.deepEqual(koLabeledNaturalProduct.intake.core_features, [
      "\uC218\uC785/\uC9C0\uCD9C \uAE30\uB85D",
      "\uCE74\uD14C\uACE0\uB9AC \uAD00\uB9AC",
      "\uC6D4\uBCC4 \uD1B5\uACC4 \uBCF4\uAE30"
    ]);
    assert.equal(
      koLabeledNaturalProduct.intake.finish_line,
      "\uAC70\uB798 \uCD94\uAC00/\uC0AD\uC81C\uC640 \uC6D4\uBCC4 \uD1B5\uACC4\uB97C \uD655\uC778"
    );

    await runFrontDoorDiscoveryTurn({
      threadId: "thread-ko-freelancer-labeled-answer",
      message: "\uAC00\uACC4\uBD80 \uC571 \uB9CC\uB4E4\uC5B4\uC918"
    });
    const koFreelancerLabeled = await runFrontDoorDiscoveryTurn({
      threadId: "thread-ko-freelancer-labeled-answer",
      message: [
        "\uC8FC \uC0AC\uC6A9\uC790\uB294 \uD504\uB9AC\uB79C\uC11C 1\uC778\uC774\uACE0,",
        "\uD575\uC2EC \uC791\uC5C5\uC740 \uC218\uC785/\uC9C0\uCD9C \uC785\uB825, \uC6D4\uBCC4 \uD569\uACC4 \uBCF4\uAE30, \uCE74\uD14C\uACE0\uB9AC\uBCC4 \uD544\uD130\uB9C1\uC774\uB2E4.",
        "\uC131\uACF5 \uAE30\uC900\uC740 \uAC70\uB798 \uC785\uB825 \uD6C4 \uC6D4\uBCC4 \uD569\uACC4\uC640 \uCE74\uD14C\uACE0\uB9AC \uD544\uD130\uAC00 \uD654\uBA74\uC5D0\uC11C \uD655\uC778\uB418\uB294 \uAC83\uC774\uB2E4."
      ].join("\n")
    });
    assert.deepEqual(koFreelancerLabeled.intake.target_users, [
      "\uD504\uB9AC\uB79C\uC11C 1\uC778"
    ]);
    assert.deepEqual(koFreelancerLabeled.intake.core_features, [
      "\uC218\uC785/\uC9C0\uCD9C \uC785\uB825",
      "\uC6D4\uBCC4 \uD569\uACC4 \uBCF4\uAE30",
      "\uCE74\uD14C\uACE0\uB9AC\uBCC4 \uD544\uD130\uB9C1"
    ]);

    await runFrontDoorDiscoveryTurn({
      threadId: "thread-ko-inline-numbered-workflows",
      message: "\uAC00\uACC4\uBD80 \uC571 \uB9CC\uB4E4\uC5B4\uC918"
    });
    const koInlineNumbered = await runFrontDoorDiscoveryTurn({
      threadId: "thread-ko-inline-numbered-workflows",
      message: [
        "\uB300\uC0C1 \uC0AC\uC6A9\uC790\uB294 \uD504\uB9AC\uB79C\uC11C 1\uC778",
        "\uD575\uC2EC \uC791\uC5C5: 1) \uC218\uC785 \uC785\uB825 2) \uC9C0\uCD9C \uC785\uB825 3) \uC6D4\uBCC4 \uD569\uACC4 \uBCF4\uAE30",
        "\uC131\uACF5 \uAE30\uC900: \uAC70\uB798\uB97C \uC785\uB825\uD558\uBA74 \uC6D4\uBCC4 \uD569\uACC4\uAC00 \uAC31\uC2E0\uB428"
      ].join("\n")
    });
    assert.deepEqual(koInlineNumbered.intake.target_users, [
      "\uD504\uB9AC\uB79C\uC11C 1\uC778"
    ]);
    assert.deepEqual(koInlineNumbered.intake.core_features, [
      "\uC218\uC785 \uC785\uB825",
      "\uC9C0\uCD9C \uC785\uB825",
      "\uC6D4\uBCC4 \uD569\uACC4 \uBCF4\uAE30"
    ]);

    await runFrontDoorDiscoveryTurn({
      threadId: "thread-ko-circled-numbered-workflows",
      message: "\uAC00\uACC4\uBD80 \uC571 \uB9CC\uB4E4\uC5B4\uC918"
    });
    const koCircledNumbered = await runFrontDoorDiscoveryTurn({
      threadId: "thread-ko-circled-numbered-workflows",
      message: [
        "\uB300\uC0C1 \uC0AC\uC6A9\uC790\uB294 \uD504\uB9AC\uB79C\uC11C 1\uC778",
        "\uD575\uC2EC \uC791\uC5C5\uC740 \u2460 \uC218\uC785 \uC785\uB825 \u2461 \uC9C0\uCD9C \uC785\uB825 \u2462 \uC6D4\uBCC4 \uD569\uACC4 \uBCF4\uAE30",
        "\uC131\uACF5 \uAE30\uC900\uC740 \uAC70\uB798\uB97C \uC785\uB825\uD558\uBA74 \uC6D4\uBCC4 \uD569\uACC4\uAC00 \uAC31\uC2E0\uB428"
      ].join("\n")
    });
    assert.deepEqual(koCircledNumbered.intake.core_features, [
      "\uC218\uC785 \uC785\uB825",
      "\uC9C0\uCD9C \uC785\uB825",
      "\uC6D4\uBCC4 \uD569\uACC4 \uBCF4\uAE30"
    ]);

    await runFrontDoorDiscoveryTurn({
      threadId: "thread-ko-incomplete-product-snapshot",
      message: "\uAC00\uACC4\uBD80 \uC571 \uB9CC\uB4E4\uC5B4\uC918"
    });
    const koIncompleteProduct = await runFrontDoorDiscoveryTurn({
      threadId: "thread-ko-incomplete-product-snapshot",
      message:
        "\uB300\uC0C1\uC740 \uAC1C\uC778 \uC0AC\uC6A9\uC790\uC57C. \uC131\uACF5 \uAE30\uC900\uC740 \uCCAB \uD654\uBA74\uC774 \uCDA9\uBD84\uD788 \uC644\uC131\uB418\uB294 \uAC70\uC57C."
    });
    assert.equal(koIncompleteProduct.status, "ask_product_questions");
    assert.ok(
      koIncompleteProduct.missing_product_fields.includes("core_workflows"),
      JSON.stringify(koIncompleteProduct, null, 2)
    );

    const koNaturalTargetRootRelative = `tmp-targets/${basename(tempRoot)}-ko-natural-budget`;
    const koNaturalTargetRoot = resolve(repoRoot, koNaturalTargetRootRelative);
    await runFrontDoorDiscoveryTurn({
      threadId: "thread-ko-natural-product-answer",
      message: "\uAC00\uACC4\uBD80 \uC571 \uB9CC\uB4E4\uC5B4\uC918"
    });
    const koNaturalProduct = await runFrontDoorDiscoveryTurn({
      threadId: "thread-ko-natural-product-answer",
      message:
        "\uAC1C\uC778 \uC0AC\uC6A9\uC790\uAC00 \uC4F8 \uAC70\uACE0, \uC218\uC785/\uC9C0\uCD9C \uAE30\uB85D, \uCE74\uD14C\uACE0\uB9AC \uAD00\uB9AC, \uC6D4\uBCC4 \uD1B5\uACC4 \uBCF4\uAE30\uAC00 \uD575\uC2EC\uC774\uC57C. \uAC70\uB798 \uCD94\uAC00/\uC0AD\uC81C\uC640 \uC6D4\uBCC4 \uD1B5\uACC4 \uD655\uC778\uC774 \uB418\uBA74 \uC131\uACF5."
    });
    assert.equal(koNaturalProduct.status, "ask_execution_questions");
    assert.deepEqual(koNaturalProduct.intake.target_users, [
      "\uAC1C\uC778 \uC0AC\uC6A9\uC790"
    ]);
    assert.ok(
      koNaturalProduct.intake.core_features.includes(
        "\uC218\uC785/\uC9C0\uCD9C \uAE30\uB85D"
      ),
      JSON.stringify(koNaturalProduct, null, 2)
    );
    assert.match(
      koNaturalProduct.intake.finish_line ?? "",
      /\uAC70\uB798 \uCD94\uAC00/u
    );
    const koNaturalExecution = await runFrontDoorDiscoveryTurn({
      threadId: "thread-ko-natural-product-answer",
      message: `new, ${koNaturalTargetRootRelative}`
    });
    assert.equal(koNaturalExecution.status, "ask_adapter_questions");
    const koNaturalReady = await runFrontDoorDiscoveryTurn({
      threadId: "thread-ko-natural-product-answer",
      message: [
        "\uD654\uBA74\uC73C\uB85C \uAC80\uC99D.",
        "\uC218\uC785/\uC9C0\uCD9C \uAE30\uB85D -> \uAC70\uB798\uB97C \uCD94\uAC00\uD558\uBA74 \uBAA9\uB85D\uACFC \uC6D4\uBCC4 \uD569\uACC4\uAC00 \uBC14\uB00C\uB2E4.",
        "\uCE74\uD14C\uACE0\uB9AC \uAD00\uB9AC -> \uCE74\uD14C\uACE0\uB9AC\uB97C \uB9CC\uB4E4\uACE0 \uAC70\uB798\uC5D0 \uC9C0\uC815\uD560 \uC218 \uC788\uB2E4.",
        "\uC6D4\uBCC4 \uD1B5\uACC4 -> \uC6D4\uBCC4 \uC218\uC785/\uC9C0\uCD9C/\uC794\uC561\uC774 \uD45C\uC2DC\uB41C\uB2E4."
      ].join("\n")
    });
    assert.equal(koNaturalReady.status, "ready_for_prepare");
    assert.equal(koNaturalReady.locale, "ko");
    assert.equal(
      koNaturalReady.preparation_summary[0],
      "\uC900\uBE44\uB41C \uBA85\uC138:"
    );
    assert.equal(
      koNaturalReady.adapter_plan_preview[0],
      "\uB2EB\uD78C \uB8E8\uD504 adapter \uC124\uACC4:"
    );
    assert.ok(
      koNaturalReady.preparation_summary.some((line) =>
        line.includes(koNaturalTargetRootRelative)
      ),
      JSON.stringify(koNaturalReady, null, 2)
    );
    assert.ok(
      koNaturalReady.adapter_plan_preview.some((line) =>
        /run command:/i.test(line)
      ),
      JSON.stringify(koNaturalReady, null, 2)
    );
    const koNaturalPrepared = await prepareSessionRun({
      ideaPath: genericIdeaPath,
      frontDoorSessionPath: koNaturalReady.front_door_session_path,
      transportMode: "current-thread",
      controllerMode: "attached"
    });
    const [koNaturalAdapterPlan, koNaturalVerificationProfile] =
      await Promise.all([
        readJsonFile(koNaturalPrepared.adapterPlanPath),
        readJsonFile(koNaturalPrepared.evaluatorProfilePath)
      ]);
    assert.equal(
      koNaturalAdapterPlan.runtime_strategy.run_command,
      "npm run dev -- --host 127.0.0.1 --port 3000 --strictPort"
    );
    assert.equal(koNaturalAdapterPlan.runtime_strategy.ready_url, "http://127.0.0.1:3000/");
    assert.ok(
      koNaturalAdapterPlan.workflow_checks.some(
        (check) => check.workflow === "\uC6D4\uBCC4 \uD1B5\uACC4 \uBCF4\uAE30"
      ),
      JSON.stringify(koNaturalAdapterPlan.workflow_checks, null, 2)
    );
    assert.ok(
      koNaturalVerificationProfile.core_probes.some((probe) =>
        probe.label.includes("\uC6D4\uBCC4 \uD1B5\uACC4 \uBCF4\uAE30")
      ),
      JSON.stringify(koNaturalVerificationProfile.core_probes, null, 2)
    );
    await cleanupTempRoot(koNaturalTargetRoot);

    const koTestSurfaceTargetRootRelative = `tmp-targets/${basename(tempRoot)}-ko-test-surface-budget`;
    const koTestSurfaceTargetRoot = resolve(repoRoot, koTestSurfaceTargetRootRelative);
    await runFrontDoorDiscoveryTurn({
      threadId: "thread-ko-test-surface-budget",
      message: "\uAC00\uACC4\uBD80 \uC571 \uB9CC\uB4E4\uC5B4\uC918"
    });
    await runFrontDoorDiscoveryTurn({
      threadId: "thread-ko-test-surface-budget",
      message: [
        "\uB300\uC0C1\uC740 \uAC1C\uC778 \uC0AC\uC6A9\uC790\uC57C.",
        "\uD575\uC2EC\uC740 \uC218\uC785/\uC9C0\uCD9C \uAE30\uB85D, \uCE74\uD14C\uACE0\uB9AC \uAD00\uB9AC, \uC6D4\uBCC4 \uD1B5\uACC4 \uBCF4\uAE30\uC57C.",
        "\uC131\uACF5 \uAE30\uC900\uC740 \uAC70\uB798 \uCD94\uAC00/\uC0AD\uC81C\uC640 \uC6D4\uBCC4 \uD1B5\uACC4\uB97C \uD655\uC778\uD558\uB294 \uAC70\uC57C."
      ].join("\n")
    });
    await runFrontDoorDiscoveryTurn({
      threadId: "thread-ko-test-surface-budget",
      message: `new, ${koTestSurfaceTargetRootRelative}`
    });
    const koTestSurfaceReady = await runFrontDoorDiscoveryTurn({
      threadId: "thread-ko-test-surface-budget",
      message: [
        "\uD14C\uC2A4\uD2B8 \uBA85\uB839\uC73C\uB85C \uAC80\uC99D.",
        "\uC218\uC785/\uC9C0\uCD9C \uAE30\uB85D -> \uAC70\uB798\uB97C \uCD94\uAC00\uD558\uBA74 \uBAA9\uB85D\uACFC \uC6D4\uBCC4 \uD569\uACC4\uAC00 \uBC14\uB00C\uB2E4.",
        "\uCE74\uD14C\uACE0\uB9AC \uAD00\uB9AC -> \uCE74\uD14C\uACE0\uB9AC\uB97C \uB9CC\uB4E4\uACE0 \uAC70\uB798\uC5D0 \uC9C0\uC815\uD560 \uC218 \uC788\uB2E4.",
        "\uC6D4\uBCC4 \uD1B5\uACC4 \uBCF4\uAE30 -> \uC6D4\uBCC4 \uC218\uC785/\uC9C0\uCD9C/\uC794\uC561\uC774 \uD45C\uC2DC\uB41C\uB2E4."
      ].join("\n")
    });
    assert.equal(koTestSurfaceReady.status, "ready_for_prepare");
    assert.equal(koTestSurfaceReady.intake.verification_surfaces?.[0], "browser");
    assert.ok(koTestSurfaceReady.intake.verification_surfaces?.includes("test"));
    assert.equal(koTestSurfaceReady.intake.workflow_checks?.[0]?.surface, "browser");
    const koTestSurfacePrepared = await prepareSessionRun({
      ideaPath: genericIdeaPath,
      frontDoorSessionPath: koTestSurfaceReady.front_door_session_path,
      transportMode: "current-thread",
      controllerMode: "attached"
    });
    const koTestSurfaceProfile = await readJsonFile(
      koTestSurfacePrepared.evaluatorProfilePath
    );
    assert.ok(
      koTestSurfaceProfile.core_probes.some((probe) =>
        probe.label.includes("\uC218\uC785/\uC9C0\uCD9C \uAE30\uB85D")
      ),
      JSON.stringify(koTestSurfaceProfile.core_probes, null, 2)
    );
    await cleanupTempRoot(koTestSurfaceTargetRoot);

    await runFrontDoorDiscoveryTurn({
      threadId: "thread-existing-runtime",
      message: "Build me a todo app with auth"
    });
    await runFrontDoorDiscoveryTurn({
      threadId: "thread-existing-runtime",
      message: [
        "1. Solo founders",
        "2. create tasks and archive them",
        "3. users can manage tasks end to end"
      ].join("\n")
    });
    await runFrontDoorDiscoveryTurn({
      threadId: "thread-existing-runtime",
      message: "Users can manage tasks end to end."
    });
    await runFrontDoorDiscoveryTurn({
      threadId: "thread-existing-runtime",
      message:
        "existing, tmp-targets/existing-runtime, target score 0.9 and max rounds 3"
    });
    const runtimeHints = await runFrontDoorDiscoveryTurn({
      threadId: "thread-existing-runtime",
      message: "npm run dev, http://127.0.0.1:3000/"
    });
    assert.equal(runtimeHints.intake.run_command, "npm run dev");
    assert.equal(runtimeHints.intake.ready_url, "http://127.0.0.1:3000/");

    const defaultsFirst = await runFrontDoorDiscoveryTurn({
      threadId: "thread-default-override",
      message: "Build me a todo app with auth"
    });
    assert.equal(defaultsFirst.intake.target_score, undefined);
    assert.equal(defaultsFirst.intake.max_rounds, undefined);

    const defaultsSecond = await runFrontDoorDiscoveryTurn({
      threadId: "thread-default-override",
      message: "target score 0.85 and max rounds 5"
    });
    assert.equal(defaultsSecond.intake.target_score, 0.85);
    assert.equal(defaultsSecond.intake.max_rounds, 5);

    const secondThread = await runFrontDoorDiscoveryTurn({
      threadId: "thread-456",
      message: "Create a CRM web app for sales reps"
    });
    assert.equal(secondThread.turn_count, 1);
    assert.notEqual(
      secondThread.front_door_session_path,
      readyTurn.front_door_session_path
    );
    assert.equal(secondThread.intake.target_root, undefined);

    const koFirst = await runFrontDoorDiscoveryTurn({
      threadId: "thread-ko-budget",
      message: "가계부 앱 만들어줘"
    });
    assert.equal(koFirst.status, "ask_product_questions");
    assert.equal(koFirst.intake.product_title, "가계부 앱");
    assert.match(koFirst.intake.product_summary ?? "", /가계부 앱/);
    assert.equal(koFirst.intake.target_root, undefined);
    assert.equal(koFirst.intake.target_users, undefined);

    const koSecond = await runFrontDoorDiscoveryTurn({
      threadId: "thread-ko-budget",
      message: [
        "개인 사용자용.",
        "수입/지출 기록, 카테고리 관리, 월별 통계.",
        "로컬에서 거래 추가/삭제와 통계 확인이 가능하면 성공."
      ].join("\n")
    });
    assert.deepEqual(koSecond.intake.target_users, ["개인 사용자용"]);
    assert.ok(
      koSecond.intake.core_features.includes("수입/지출 기록"),
      JSON.stringify(koSecond, null, 2)
    );
    assert.equal(koSecond.intake.target_root, undefined);

    const koThird = await runFrontDoorDiscoveryTurn({
      threadId: "thread-ko-budget",
      message: "새 프로젝트로 진행해."
    });
    assert.equal(koThird.status, "ask_adapter_questions");
    assert.equal(koThird.intake.project_mode, "new");
    assert.deepEqual(
      koThird.unresolved_conflicts.filter(
        (conflict) => conflict.field === "product_summary"
      ),
      []
    );
    assert.match(koThird.intake.target_root ?? "", /^\.\/apps\/가계부-앱/);

    const koFourth = await runFrontDoorDiscoveryTurn({
      threadId: "thread-ko-budget",
      message: [
        "화면으로 검증.",
        "수입/지출 기록 -> 거래를 추가하면 목록과 월별 합계가 바뀐다.",
        "카테고리 관리 -> 카테고리를 만들고 거래에 지정할 수 있다.",
        "월별 통계 -> 월별 수입/지출/잔액이 표시된다."
      ].join("\n")
    });
    assert.equal(koFourth.status, "ready_for_prepare");
    assert.deepEqual(koFourth.intake.verification_surfaces, ["browser"]);
    assert.ok((koFourth.intake.workflow_checks ?? []).length >= 3);

    const koPrepared = await prepareSessionRun({
      ideaPath: genericIdeaPath,
      frontDoorSessionPath: koFourth.front_door_session_path,
      transportMode: "current-thread",
      controllerMode: "attached"
    });
    const [koBuildBrief, koRunContract, koVerificationProfile] = await Promise.all([
      readJsonFile(koPrepared.buildBriefPath),
      readJsonFile(koPrepared.runContractPath),
      readJsonFile(koPrepared.evaluatorProfilePath)
    ]);
    assert.equal(koBuildBrief.product.title, "가계부 앱");
    assert.match(koBuildBrief.product.summary, /가계부/);
    assert.deepEqual(koBuildBrief.product.target_users, ["개인 사용자용"]);
    assert.ok(koBuildBrief.product.core_workflows.includes("수입/지출 기록"));
    assert.ok(
      koBuildBrief.product.success_definition.some((entry) => /거래 추가/.test(entry)),
      JSON.stringify(koBuildBrief, null, 2)
    );
    assert.match(koRunContract.objective, /가계부 앱/);
    assert.doesNotMatch(koRunContract.objective, /Generic Codex Workbench/);
    assert.doesNotMatch(JSON.stringify(koBuildBrief), /Generic Codex Workbench/);
    assert.doesNotMatch(
      JSON.stringify(koBuildBrief.product.success_definition),
      /workbench|controller|adapter/i
    );
    assert.doesNotMatch(
      JSON.stringify(koVerificationProfile.quality_contract),
      /workbench|controller|adapter/i
    );
    const koWorkflowProbes = koVerificationProfile.core_probes.filter((probe) =>
      /^Workflow works:/.test(probe.label)
    );
    for (const workflow of koBuildBrief.product.core_workflows) {
      assert.ok(
        koWorkflowProbes.some((probe) => probe.label.includes(workflow)),
        JSON.stringify(koWorkflowProbes, null, 2)
      );
    }
    const koWorkflowSelectors = koWorkflowProbes.map(
      (probe) => probe.steps.at(-1)?.selector
    );
    assert.equal(
      new Set(koWorkflowSelectors).size,
      koWorkflowSelectors.length,
      JSON.stringify(koWorkflowSelectors, null, 2)
    );
    assert.ok(
      !koWorkflowSelectors.includes("[data-testid='feature-generated-app']"),
      JSON.stringify(koWorkflowSelectors, null, 2)
    );
    for (const probe of koWorkflowProbes) {
      const selectors = probe.steps.map((step) => step.selector).filter(Boolean);
      assert.ok(
        selectors.some((selector) => /-action'\]$/.test(selector)),
        JSON.stringify(probe, null, 2)
      );
      assert.ok(
        selectors.some((selector) => /-result'\]$/.test(selector)),
        JSON.stringify(probe, null, 2)
      );
    }

    await runFrontDoorDiscoveryTurn({
      threadId: "thread-correction",
      message: "Build a budgeting web app for individuals"
    });
    await runFrontDoorDiscoveryTurn({
      threadId: "thread-correction",
      message:
        "Core workflows: add income/expense transactions, categorize them, and view monthly summary. Finish line: users can manage a monthly budget."
    });
    const corrected = await runFrontDoorDiscoveryTurn({
      threadId: "thread-correction",
      message: "This is a new project. Target root is ./budget-app."
    });
    assert.equal(corrected.intake.target_root, "./budget-app");
    assert.notEqual(corrected.intake.target_root, "income/expense");

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
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await cleanupTempRoot(tempRoot);
    await cleanupTempRoot(targetRoot);
    await cleanupTempRoot(join(repoRoot, "apps", "가계부-앱"));
  }
};

await main();
console.log("validate:front-door-session passed");
