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
    assert.equal(fourthTurn.status, "ready_for_prepare");
    assert.equal(fourthTurn.phase, "ready_for_prepare");
    assert.equal(fourthTurn.intake.project_mode, "new");
    assert.equal(fourthTurn.intake.target_root, targetRootRelative);
    assert.deepEqual(fourthTurn.defaults_accepted, [
      "max_rounds",
      "target_root",
      "target_score"
    ]);
    assert.equal(fourthTurn.turn_count, 4);

    const restored = await getFrontDoorSessionStatus("thread-123");
    assert.ok(restored);
    assert.equal(restored?.status, "ready_for_prepare");
    assert.equal(restored?.turn_count, 4);
    assert.equal(restored?.intake.target_root, targetRootRelative);

    process.env.CODEX_THREAD_ID = "different-thread";
    await assert.rejects(
      () =>
        prepareSessionRun({
          runDirectory: join(tempRoot, "mismatch-run"),
          ideaPath,
          frontDoorSessionPath: fourthTurn.front_door_session_path,
          transportMode: "current-thread",
          controllerMode: "attached"
        }),
      /belongs to thread thread-123/
    );
    delete process.env.CODEX_THREAD_ID;

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
      fourthTurn.front_door_session_path
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
    assert.equal(koThird.status, "ready_for_prepare");
    assert.equal(koThird.intake.project_mode, "new");
    assert.deepEqual(
      koThird.unresolved_conflicts.filter(
        (conflict) => conflict.field === "product_summary"
      ),
      []
    );
    assert.match(koThird.intake.target_root ?? "", /^\.\/apps\/가계부-앱/);

    const koPrepared = await prepareSessionRun({
      ideaPath: genericIdeaPath,
      frontDoorSessionPath: koThird.front_door_session_path,
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
      /^Core workflow remains/.test(probe.label)
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
