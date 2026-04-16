import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  cleanupTempRoot,
  createBootstrapFixture,
  createTempRoot,
  ensureBuild,
  importDist,
  readJsonFile
} from "./testing/bootstrap-validator-helpers.mjs";

const readJsonLinesFile = async (path) =>
  (await readFile(path, "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-session-status-event-stream");

  try {
    const fixture = await createBootstrapFixture(tempRoot, {
      title: "Session Stream Fixture",
      summary: "A fixture run for validating incremental session status events.",
      targetUsers: ["operator"],
      coreFeatures: ["watch session readiness"],
      referenceApps: ["Linear"],
      finishLine: "Attached clients can react to session changes without polling mixed snapshots.",
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
      { buildScenarioFromIdea, buildLoopPlan }
    ] = await Promise.all([
      importDist("runtime-state.js"),
      importDist("session-artifacts.js"),
      importDist("idea-intake.js"),
      importDist("durable-memory.js"),
      importDist("planner.js")
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

    const baseInput = {
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
      idea,
      durableMemory: durableMemory.context,
      scenario,
      plan,
      workspaceMode: "worktree",
      targetFamily: "dashboard"
    };

    await writeSessionPreparationArtifacts(baseInput);
    let events = await readJsonLinesFile(runtimePaths.sessionStatusEventsPath);
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, "session_initialized");
    assert.ok(events[0].changed_fields.includes("session_status"));
    assert.equal(events[0].session.session_status, "ready_to_start");

    await writeSessionPreparationArtifacts(baseInput);
    events = await readJsonLinesFile(runtimePaths.sessionStatusEventsPath);
    assert.equal(
      events.length,
      1,
      "Expected unchanged session refresh to avoid duplicate event emission."
    );

    await writeSessionPreparationArtifacts({
      ...baseInput,
      sessionStatus: "needs_steering",
      currentObjective: "Resolve review feedback before continuing the run.",
      reviewFeedback: ["Make the queue state explicit in the operator UI."],
      latestRound: 2,
      latestStopReason: "awaiting_human_input"
    });
    const [sessionStatus, changedEvents] = await Promise.all([
      readJsonFile(runtimePaths.sessionStatusPath),
      readJsonLinesFile(runtimePaths.sessionStatusEventsPath)
    ]);

    assert.equal(changedEvents.length, 2);
    assert.equal(changedEvents[1].event_type, "session_changed");
    assert.equal(changedEvents[1].sequence, 2);
    assert.ok(changedEvents[1].changed_fields.includes("session_status"));
    assert.ok(changedEvents[1].changed_fields.includes("readiness"));
    assert.ok(changedEvents[1].changed_fields.includes("attention_kind"));
    assert.ok(changedEvents[1].changed_fields.includes("objective"));
    assert.ok(changedEvents[1].changed_fields.includes("review_feedback_count"));
    assert.ok(changedEvents[1].changed_fields.includes("latest_round"));
    assert.ok(changedEvents[1].changed_fields.includes("latest_stop_reason"));
    assert.equal(
      changedEvents[1].session.session_status,
      sessionStatus.session_status
    );
    assert.equal(changedEvents[1].session.readiness, sessionStatus.readiness);
    assert.equal(
      changedEvents[1].session.next_attention,
      sessionStatus.next_attention
    );

    console.log("validate:session-status-event-stream passed");
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
