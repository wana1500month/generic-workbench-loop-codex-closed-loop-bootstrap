import { strict as assert } from "node:assert";
import { join } from "node:path";

import {
  cleanupTempRoot,
  createBootstrapFixture,
  createTempRoot,
  ensureBuild,
  importDist,
  readJsonFile,
  writeJsonFile
} from "./testing/bootstrap-validator-helpers.mjs";

const readJsonLinesFile = async (path) =>
  (await import("node:fs/promises")).readFile(path, "utf8")
    .then((text) =>
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    );

const main = async () => {
  await ensureBuild();

  const tempRoot = await createTempRoot("validate-app-server-session-stream");
  const fakeAppServerPath = join(process.cwd(), "scripts", "testing", "fake-app-server.mjs");
  const previousBin = process.env.HARNESS_APP_SERVER_BIN;
  const previousArgs = process.env.HARNESS_APP_SERVER_BIN_ARGS;

  process.env.HARNESS_APP_SERVER_BIN = process.execPath;
  process.env.HARNESS_APP_SERVER_BIN_ARGS = JSON.stringify([fakeAppServerPath]);

  try {
    const fixture = await createBootstrapFixture(tempRoot, {
      title: "Attached Session Stream Fixture",
      summary: "A fixture run for validating the App Server mirrored session stream.",
      targetUsers: ["operator"],
      coreFeatures: ["follow live session state"],
      referenceApps: ["Linear"],
      finishLine: "Attached clients can subscribe to session changes through an App Server style event log.",
      targetFamily: "dashboard",
      goalLevel: "mvp",
      targetScore: 0.8,
      maxRounds: 4,
      projectMode: "new",
      frameworkHint: "Next.js",
      packageManager: "npm",
      runCommand: "npm run dev",
      checkCommand: "npm run lint"
    });

    const [
      { runtimeStatePathsForRun },
      { writeSessionPreparationArtifacts },
      { readIdeaBrief },
      { loadDurableMemoryContext },
      { buildScenarioFromIdea, buildLoopPlan },
      { writeTransportProtocol },
      { startAppServerTransport }
    ] = await Promise.all([
      importDist("runtime-state.js"),
      importDist("session-artifacts.js"),
      importDist("idea-intake.js"),
      importDist("durable-memory.js"),
      importDist("planner.js"),
      importDist("transport-protocol.js"),
      importDist("app-server-runtime.js")
    ]);

    const runtimePaths = runtimeStatePathsForRun(fixture.runDirectory);
    const idea = await readIdeaBrief(fixture.paths.ideaPath);
    const durableMemory = await loadDurableMemoryContext(idea);
    const scenario = buildScenarioFromIdea(idea);
    const plan = buildLoopPlan({
      scenario,
      rubric: await readJsonFile(fixture.paths.generatedRubricPath),
      maxRounds: 4,
      idea
    });
    const executionPlanPath = join(fixture.runDirectory, "docs", "EXECUTION_PLAN.md");
    const summaryPath = join(fixture.runDirectory, "summary.json");

    await writeJsonFile(summaryPath, { run_id: "run-001" });
    await writeSessionPreparationArtifacts({
      runId: "run-001",
      runDirectory: fixture.runDirectory,
      rootDirectory: fixture.workspaceRoot,
      buildBriefPath: runtimePaths.buildBriefPath,
      runContractPath: runtimePaths.runContractPath,
      openQuestionsPath: runtimePaths.openQuestionsPath,
      sessionStatusPath: runtimePaths.sessionStatusPath,
      sessionStatusEventsPath: runtimePaths.sessionStatusEventsPath,
      sessionStreamPath: runtimePaths.sessionStreamPath,
      operatorSurfacePath: runtimePaths.operatorSurfacePath,
      executionPlanPath,
      transportMode: "app-server",
      appServerSessionEventsPath: runtimePaths.appServerSessionEventsPath,
      idea,
      durableMemory: durableMemory.context,
      scenario,
      plan,
      workspaceMode: "worktree",
      targetFamily: "dashboard"
    });

    const protocolPath = await writeTransportProtocol({
      runDirectory: fixture.runDirectory,
      transportMode: "app-server",
      summary: {
        run_id: "run-001",
        controller_mode: "attached",
        transport_mode: "app-server",
        transport_state_path: runtimePaths.transportStatePath,
        resume_identity_path: join(fixture.runDirectory, "resume-identity.json"),
        runtime_round_phase_path: runtimePaths.roundPhasePath
      },
      activeRound: 1,
      activePhase: "planning",
      activeStatus: "in_progress",
      notes: ["App Server session stream validator."]
    });

    const controller = await startAppServerTransport({
      runId: "run-001",
      controllerMode: "attached",
      transportStatePath: runtimePaths.transportStatePath,
      summaryPath,
      protocolPath,
      dashboardPath: runtimePaths.operatorSurfaceMarkdownPath,
      sessionStatusPath: runtimePaths.sessionStatusPath,
      sessionStatusEventsPath: runtimePaths.sessionStatusEventsPath,
      sessionStreamPath: runtimePaths.sessionStreamPath,
      mirroredSessionEventsPath: runtimePaths.appServerSessionEventsPath,
      initialRound: 1,
      initialPhase: "planning",
      initialStatus: "in_progress",
      initialNotes: ["App Server session stream validator."],
      threadName: "validate-app-server-session-stream 쨌 attached-loop",
      defaultTaskTimeoutMs: 30_000,
      requestTimeoutMs: 5_000
    });

    try {
      const [transportState, sessionStream, mirroredEvents] = await Promise.all([
        readJsonFile(runtimePaths.transportStatePath),
        readJsonFile(runtimePaths.sessionStreamPath),
        readJsonLinesFile(runtimePaths.appServerSessionEventsPath)
      ]);

      assert.equal(
        transportState.ui_surface?.session_stream_path,
        runtimePaths.sessionStreamPath
      );
      assert.equal(
        sessionStream.preferred_delivery,
        "app_server_notification_jsonl"
      );
      assert.equal(
        sessionStream.app_server_events_path,
        "runtime/app-server-session-events.jsonl"
      );
      assert.equal(mirroredEvents.length, 1);
      assert.equal(mirroredEvents[0].method, "harness/session.changed");
      assert.equal(mirroredEvents[0].params.sequence, 1);
      assert.equal(mirroredEvents[0].params.session.session_status, "ready_to_start");

      await writeSessionPreparationArtifacts({
        runId: "run-001",
        runDirectory: fixture.runDirectory,
        rootDirectory: fixture.workspaceRoot,
        buildBriefPath: runtimePaths.buildBriefPath,
        runContractPath: runtimePaths.runContractPath,
        openQuestionsPath: runtimePaths.openQuestionsPath,
        sessionStatusPath: runtimePaths.sessionStatusPath,
        sessionStatusEventsPath: runtimePaths.sessionStatusEventsPath,
        sessionStreamPath: runtimePaths.sessionStreamPath,
        operatorSurfacePath: runtimePaths.operatorSurfacePath,
        executionPlanPath,
        transportMode: "app-server",
        appServerSessionEventsPath: runtimePaths.appServerSessionEventsPath,
        idea,
        durableMemory: durableMemory.context,
        scenario,
        plan,
        workspaceMode: "worktree",
        targetFamily: "dashboard",
        sessionStatus: "needs_steering",
        currentObjective: "Resolve review feedback before continuing.",
        reviewFeedback: ["Tighten queue ownership wording."],
        latestRound: 2,
        latestStopReason: "awaiting_human_input"
      });

      await controller.syncPhase({
        round: 2,
        phase: "evaluation",
        status: "awaiting_human_input",
        notes: ["Mirror the updated session status."]
      });

      const refreshedMirroredEvents = await readJsonLinesFile(
        runtimePaths.appServerSessionEventsPath
      );
      assert.equal(refreshedMirroredEvents.length, 2);
      assert.equal(refreshedMirroredEvents[1].params.sequence, 2);
      assert.equal(
        refreshedMirroredEvents[1].params.session.session_status,
        "needs_steering"
      );
      assert.ok(
        refreshedMirroredEvents[1].params.changedFields.includes("session_status")
      );
      assert.equal(
        refreshedMirroredEvents[1].params.contractPath,
        runtimePaths.sessionStreamPath
      );
    } finally {
      await controller.stop({
        stopReason: "contract_completed",
        notes: ["App Server session stream validator complete."]
      });
    }

    console.log("validate:app-server-session-stream passed");
  } finally {
    if (previousBin === undefined) {
      delete process.env.HARNESS_APP_SERVER_BIN;
    } else {
      process.env.HARNESS_APP_SERVER_BIN = previousBin;
    }
    if (previousArgs === undefined) {
      delete process.env.HARNESS_APP_SERVER_BIN_ARGS;
    } else {
      process.env.HARNESS_APP_SERVER_BIN_ARGS = previousArgs;
    }
    await cleanupTempRoot(tempRoot);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
