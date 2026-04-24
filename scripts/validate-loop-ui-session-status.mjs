import { strict as assert } from "node:assert";
import { join } from "node:path";

import {
  cleanupTempRoot,
  createBootstrapFixture,
  createTempRoot,
  ensureBuild,
  importDist,
  readJsonFile,
  runCommand,
  writeJsonFile
} from "./testing/bootstrap-validator-helpers.mjs";

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-loop-ui-session-status");

  try {
    const fixture = await createBootstrapFixture(tempRoot, {
      title: "Loop UI Session Fixture",
      summary: "A fixture run for validating loop-ui session status projection.",
      targetUsers: ["operator"],
      coreFeatures: ["inspect session surface"],
      referenceApps: ["Linear"],
      finishLine: "The operator can see session readiness without inferring it from mixed control-plane state.",
      targetFamily: "dashboard",
      goalLevel: "mvp",
      targetScore: 0.8,
      maxRounds: 4,
      projectMode: "new",
      frameworkHint: "Next.js",
      packageManager: "npm",
      runCommand: "npm run dev",
      checkCommand: "npm run lint",
      qualityBar: ["The runtime dashboard should show an honest session status."]
    });

    const [
      { runtimeStatePathsForRun },
      { writeSessionPreparationArtifacts, buildOperatorSurfaceSessionProjection },
      { readIdeaBrief },
      { loadDurableMemoryContext },
      { buildScenarioFromIdea, buildLoopPlan },
      { buildOperatorSurfaceArtifact }
    ] = await Promise.all([
      importDist("runtime-state.js"),
      importDist("session-artifacts.js"),
      importDist("idea-intake.js"),
      importDist("durable-memory.js"),
      importDist("planner.js"),
      importDist("operator-surface.js")
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
      transportMode: "current-thread",
      threadBindingState: "bound",
      threadId: "thread-ui-123",
      idea,
      durableMemory: durableMemory.context,
      scenario,
      plan,
      workspaceMode: "worktree",
      targetFamily: "dashboard",
      currentObjective: "Hold at the explicit start gate before running implementation."
    });

    const staleOperatorSurface = buildOperatorSurfaceArtifact({
      runId: "run-001",
      controllerMode: "attached",
      transportMode: "current-thread",
      executionState: "paused",
      round: 3,
      phase: "evaluation",
      phaseStatus: "awaiting_human_input",
      attentionRequired: "human",
      threadId: "thread-123",
      threadName: "Loop UI Session Fixture",
      workspaceSurface: "worktree",
      handoffState: "worktree",
      userVisiblePause: true,
      autoResumeEligible: false,
      activePromptPath: runtimePaths.openQuestionsPath,
      sessionStatusPath: runtimePaths.sessionStatusPath,
      sessionStatusEventsPath: runtimePaths.sessionStatusEventsPath,
      sessionStreamPath: runtimePaths.sessionStreamPath,
      session: {
        objective: "stale operator surface objective",
        session_status: "running",
        readiness: "running",
        next_attention: "codex",
        attention_kind: "none",
        deferred_question_count: 99,
        steering_note_count: 0,
        review_feedback_count: 0,
        external_blocker_count: 0,
        session_binding: {
          surface: "manual-protocol",
          binding_state: "degraded"
        },
        latest_round: 1,
        latest_stop_reason: "awaiting_codex_checkpoint"
      },
      notes: ["operator surface note"]
    });

    const now = new Date().toISOString();
    await Promise.all([
      writeJsonFile(runtimePaths.operatorSurfacePath, staleOperatorSurface),
      writeJsonFile(runtimePaths.transportStatePath, {
        run_id: "run-001",
        controller_mode: "attached",
        transport_mode: "current-thread",
        presentation_mode: "foreground-thread",
        launch_origin: "codex-app-thread",
        surface_owner: "stock-codex-thread",
        thread_binding_state: "bound",
        entrypoint: "skill",
        app_visibility: "visible-in-stock-app",
        updated_at: now,
        status: "idle"
      }),
      writeJsonFile(runtimePaths.liveStatePath, {
        run_id: "run-001",
        controller_mode: "attached",
        transport_mode: "current-thread",
        updated_at: now,
        heartbeat_at: now,
        execution_state: "paused",
        round_count: 3,
        active_round: 3,
        active_phase: "evaluation",
        active_phase_status: "awaiting_human_input",
        round_phase_path: runtimePaths.roundPhasePath,
        controller_lease_path: runtimePaths.controllerLeasePath
      }),
      writeJsonFile(runtimePaths.roundPhasePath, {
        run_id: "run-001",
        round: 3,
        controller_mode: "attached",
        transport_mode: "current-thread",
        phase: "evaluation",
        status: "awaiting_human_input",
        updated_at: now,
        heartbeat_at: now
      }),
      writeJsonFile(runtimePaths.controllerLeasePath, {
        run_id: "run-001",
        controller_mode: "attached",
        transport_mode: "current-thread",
        status: "paused",
        updated_at: now,
        heartbeat_at: now,
        round: 3,
        phase: "evaluation",
        phase_status: "awaiting_human_input"
      })
    ]);
    const sessionStatusArtifact = await readJsonFile(runtimePaths.sessionStatusPath);
    const startGateSurface = buildOperatorSurfaceArtifact({
      runId: "run-001",
      controllerMode: "attached",
      transportMode: "current-thread",
      executionState: "configured",
      threadId: "thread-ui-123",
      threadName: "Loop UI Session Fixture",
      workspaceSurface: "worktree",
      sessionStatusPath: runtimePaths.sessionStatusPath,
      sessionStatusEventsPath: runtimePaths.sessionStatusEventsPath,
      sessionStreamPath: runtimePaths.sessionStreamPath,
      session: buildOperatorSurfaceSessionProjection(sessionStatusArtifact)
    });
    assert.equal(startGateSurface.attention_required, "human");
    assert.equal(startGateSurface.ui_visibility, "user_boundary");
    assert.equal(startGateSurface.foreground_owner, "human");
    assert.equal(startGateSurface.recommended_skill, "loop-control");
    assert.equal(startGateSurface.user_visible_pause, true);
    assert.match(startGateSurface.next_action, /waiting at ready_to_start/);
    assert.equal(
      startGateSurface.recommended_command,
      "npm run loop:start:codex -- --json"
    );

    const uiRun = await runCommand("node", [
      "./scripts/loop-ui.mjs",
      fixture.runDirectory,
      "--once",
      "--json"
    ]);
    if (uiRun.code !== 0) {
      throw new Error(`loop-ui failed:\n${uiRun.stdout}\n${uiRun.stderr}`);
    }

    const snapshot = JSON.parse(uiRun.stdout);
    assert.equal(snapshot.banner, "READY_TO_START");
    assert.equal(snapshot.run_id, "run-001");
    assert.equal(snapshot.session.source, "session-status");
    assert.equal(
      snapshot.session.session_status,
      sessionStatusArtifact.session_status
    );
    assert.equal(snapshot.session.readiness, sessionStatusArtifact.readiness);
    assert.equal(
      snapshot.session.next_attention,
      sessionStatusArtifact.next_attention
    );
    assert.equal(
      snapshot.session.attention_kind,
      sessionStatusArtifact.attention_kind
    );
    assert.equal(
      snapshot.session.ui_visibility,
      sessionStatusArtifact.ui_visibility
    );
    assert.equal(
      snapshot.session.foreground_owner,
      sessionStatusArtifact.foreground_owner
    );
    assert.equal(snapshot.session.objective, sessionStatusArtifact.objective);
    assert.equal(
      snapshot.session.deferred_question_count,
      sessionStatusArtifact.deferred_question_count
    );
    assert.equal(
      snapshot.session.steering_note_count,
      sessionStatusArtifact.steering_note_count
    );
    assert.equal(
      snapshot.session.review_feedback_count,
      sessionStatusArtifact.review_feedback_count
    );
    assert.equal(
      snapshot.session.external_blocker_count,
      sessionStatusArtifact.external_blocker_count
    );
    assert.equal(snapshot.session.latest_round, sessionStatusArtifact.latest_round);
    assert.equal(
      snapshot.session.latest_stop_reason,
      sessionStatusArtifact.latest_stop_reason
    );
    assert.equal(
      snapshot.session.session_binding.surface,
      sessionStatusArtifact.session_binding.surface
    );
    assert.equal(
      snapshot.session.session_binding.binding_state,
      sessionStatusArtifact.session_binding.binding_state
    );
    assert.equal(
      snapshot.session.session_binding.thread_id,
      sessionStatusArtifact.session_binding.thread_id
    );
    assert.equal(
      snapshot.session.active_checkpoint,
      sessionStatusArtifact.active_checkpoint
    );
    assert.notEqual(snapshot.session.objective, "stale operator surface objective");
    assert.notEqual(snapshot.session.session_status, "running");
    assert.equal(snapshot.session.session_status, "ready_to_start");
    assert.equal(snapshot.session.next_attention, "human");
    assert.equal(snapshot.session.attention_kind, "decision");
    assert.equal(snapshot.session.ui_visibility, "user_boundary");
    assert.equal(snapshot.session.foreground_owner, "human");
    assert.equal(snapshot.paths.session_status_path, runtimePaths.sessionStatusPath);
    assert.equal(
      snapshot.paths.session_status_events_path,
      runtimePaths.sessionStatusEventsPath
    );
    assert.ok(Array.isArray(snapshot.recent_session_events));
    assert.ok(snapshot.recent_session_events.length >= 1);
    assert.equal(snapshot.recent_session_events.at(-1).session.session_status, "ready_to_start");

    console.log("validate:loop-ui-session-status passed");
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
