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

const expectedBuildBriefKeys = [
  "brief_id",
  "constraints",
  "created_at",
  "defaults_accepted",
  "delivery",
  "execution_context",
  "operator_status_vocabulary",
  "product",
  "source_request",
  "surface",
  "unresolved_questions",
  "updated_at"
];

const expectedRunContractKeys = [
  "approval_boundaries",
  "brief_id",
  "continuation_policy",
  "contract_id",
  "created_at",
  "current_thread_required",
  "derived_attempt_artifacts",
  "discovery_policy",
  "execution_controls",
  "execution_plan_path",
  "non_goals",
  "objective",
  "open_questions_path",
  "operator_surface_path",
  "required_prepare_artifacts",
  "review_boundaries",
  "run_mode",
  "start_gate",
  "steering_triggers",
  "stop_rule",
  "updated_at",
  "validation_strategy",
  "workspace_mode"
];

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-session-preparation");

  try {
    const fixture = await createBootstrapFixture(tempRoot, {
      title: "Foreground Support Desk",
      summary: "A support operations dashboard for triaging and responding to customer issues.",
      targetUsers: ["support lead", "support agent"],
      coreFeatures: ["triage tickets", "reply with internal notes", "track queue health"],
      referenceApps: ["Zendesk", "Plain"],
      finishLine: "Support agents can triage, reply, and track queue health in one reviewable flow.",
      targetFamily: "dashboard",
      goalLevel: "mvp",
      targetScore: 0.8,
      maxRounds: 4,
      projectMode: "new",
      frameworkHint: "Next.js",
      packageManager: "npm",
      runCommand: "npm run dev",
      checkCommand: "npm run lint",
      qualityBar: [
        "Support agents can triage, reply, and track queue health in one reviewable flow.",
        "Seeded data is acceptable for the first reviewable cut."
      ],
      nonGoals: ["do not add billing"],
      notes: "session-preparation validator"
    });
    const [adapterPlan, runtimeConfig, generatedProfile, adapterReviewTask] = await Promise.all([
      readJsonFile(fixture.paths.adapterPlanPath),
      readJsonFile(fixture.paths.generatedRuntimeConfigPath),
      readJsonFile(fixture.paths.generatedVerificationProfilePath),
      readFile(fixture.paths.adapterReviewTaskPath, "utf8")
    ]);
    assert.equal(adapterPlan.target_family, "dashboard");
    assert.deepEqual(adapterPlan.verification_surfaces, ["browser"]);
    assert.ok(adapterPlan.workflow_checks.length >= 3);
    assert.match(adapterReviewTask, /Generated Adapter Review Task/);
    assert.match(adapterReviewTask, /triage tickets/);
    assert.ok(
      generatedProfile.subjective_metrics.some(
        (metric) => metric.metric_id === "adapter_contract_fulfillment"
      ),
      JSON.stringify(generatedProfile.subjective_metrics, null, 2)
    );
    assert.ok(
      runtimeConfig.verification_contract.workflow_selectors.some((selector) =>
        selector.workflow.includes("triage tickets")
      ),
      JSON.stringify(runtimeConfig.verification_contract, null, 2)
    );

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
      threadId: "thread-prepare-001",
      idea,
      durableMemory: durableMemory.context,
      scenario,
      plan,
      workspaceMode: "worktree",
      targetFamily: "dashboard"
    });

    const [
      buildBrief,
      runContract,
      openQuestions,
      sessionStatus,
      sessionEvents,
      sessionStream
    ] = await Promise.all([
      readJsonFile(runtimePaths.buildBriefPath),
      readJsonFile(runtimePaths.runContractPath),
      readJsonFile(runtimePaths.openQuestionsPath),
      readJsonFile(runtimePaths.sessionStatusPath),
      readJsonLinesFile(runtimePaths.sessionStatusEventsPath),
      readJsonFile(runtimePaths.sessionStreamPath)
    ]);
    const executionPlan = await readFile(executionPlanPath, "utf8");

    assert.deepEqual(Object.keys(buildBrief).sort(), expectedBuildBriefKeys);
    assert.equal(buildBrief.product.title, "Foreground Support Desk");
    assert.equal(buildBrief.surface.primary_surface, "dashboard");
    assert.equal(buildBrief.delivery.level, "mvp");
    assert.equal(buildBrief.execution_context.workspace_mode_preference, "worktree");
    assert.deepEqual(
      buildBrief.operator_status_vocabulary,
      [
        "asking",
        "preparing",
        "prepared_with_blockers",
        "ready_to_start",
        "running",
        "needs_steering",
        "blocked_externally",
        "ready_for_review",
        "done"
      ]
    );
    assert.ok(
      buildBrief.defaults_accepted.includes(
        "Defaulted to worktree for a new build session."
      )
    );

    assert.deepEqual(Object.keys(runContract).sort(), expectedRunContractKeys);
    assert.equal(runContract.run_mode, "foreground_same_thread");
    assert.equal(runContract.current_thread_required, true);
    assert.equal(runContract.workspace_mode, "worktree");
    assert.equal(runContract.execution_plan_path, "docs/EXECUTION_PLAN.md");
    assert.equal(runContract.operator_surface_path, "runtime/operator-surface.json");
    assert.equal(runContract.open_questions_path, "runtime/open-questions.json");
    assert.equal(runContract.start_gate.required, true);
    assert.equal(runContract.start_gate.authorized, false);
    assert.equal(runContract.start_gate.authorized_at, null);
    assert.equal(runContract.start_gate.authorized_by, null);
    assert.equal(runContract.execution_controls.target_score, 0.8);
    assert.equal(runContract.execution_controls.max_rounds, 4);
    assert.ok(
      runContract.required_prepare_artifacts.includes("runtime/build-brief.json")
    );
    assert.ok(
      runContract.required_prepare_artifacts.includes("runtime/session-status.json")
    );
    assert.ok(
      runContract.required_prepare_artifacts.includes("runtime/session-status-events.jsonl")
    );
    assert.ok(
      runContract.required_prepare_artifacts.includes("runtime/readiness-report.json")
    );

    assert.ok(Array.isArray(openQuestions.questions));
    assert.ok(openQuestions.questions.length >= 1);
    assert.equal(openQuestions.session_status, "ready_to_start");
    assert.equal(sessionStatus.session_status, "ready_to_start");
    assert.equal(sessionStatus.readiness, "ready_to_run");
    assert.equal(sessionStatus.next_attention, "human");
    assert.equal(sessionStatus.attention_kind, "decision");
    assert.equal(sessionStatus.ui_visibility, "user_boundary");
    assert.equal(sessionStatus.foreground_owner, "human");
    assert.equal(sessionStatus.session_binding.surface, "current-thread");
    assert.equal(sessionStatus.session_binding.binding_state, "bound");
    assert.equal(sessionStatus.session_binding.thread_id, "thread-prepare-001");
    assert.equal(sessionStatus.deferred_question_count, openQuestions.questions.length);
    assert.equal(sessionStatus.artifacts.open_questions_path, "runtime/open-questions.json");
    assert.equal(
      sessionStatus.artifacts.session_status_events_path,
      "runtime/session-status-events.jsonl"
    );
    assert.equal(sessionEvents.length, 1);
    assert.equal(sessionEvents[0].event_type, "session_initialized");
    assert.equal(sessionEvents[0].session.session_status, "ready_to_start");
    assert.equal(sessionStream.preferred_delivery, "file_tail_jsonl");
    assert.equal(sessionStream.snapshot_path, "runtime/session-status.json");
    assert.equal(sessionStream.source_events_path, "runtime/session-status-events.jsonl");
    assert.equal(sessionStream.event_type, "harness/session.changed");
    assert.equal(sessionStream.latest_source_sequence, 1);
    assert.match(executionPlan, /# Execution Plan/);
    assert.match(executionPlan, /runtime\/build-brief\.json/);
    assert.match(executionPlan, /runtime\/session-status\.json/);
    assert.match(executionPlan, /runtime\/session-status-events\.jsonl/);
    assert.match(executionPlan, /Start gate: preparation is complete/);
    assert.match(executionPlan, /Controller Strategy/);
    assert.match(executionPlan, /Foreground Support Desk/);

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
      threadId: "thread-prepare-001",
      idea,
      durableMemory: durableMemory.context,
      scenario,
      plan,
      workspaceMode: "worktree",
      targetFamily: "dashboard",
      sessionStatus: "needs_steering",
      currentObjective: "Revise the support queue workflow to satisfy operator review feedback.",
      steeringNotes: ["Confirm whether inbox triage should split by team before continuing."],
      reviewFeedback: ["Tighten the queue filters and make the triage flow explicit."],
      externalBlockers: ["Access to the real ticket feed is still unavailable."],
      scopeGuardrails: ["do not expand into billing or admin settings"],
      latestRound: 2,
      latestStopReason: "awaiting_human_input",
      checkpointKind: "generator-plan",
      checkpointId: "checkpoint-generator-plan-001",
      checkpointPromptPath: runtimePaths.openQuestionsPath,
      checkpointResponsePath: runtimePaths.runContractPath,
      checkpointSkill: "loop-control"
    });

    const [
      refreshedRunContract,
      refreshedOpenQuestions,
      refreshedSessionStatus,
      refreshedSessionEvents,
      refreshedSessionStream
    ] = await Promise.all([
      readJsonFile(runtimePaths.runContractPath),
      readJsonFile(runtimePaths.openQuestionsPath),
      readJsonFile(runtimePaths.sessionStatusPath),
      readJsonLinesFile(runtimePaths.sessionStatusEventsPath),
      readJsonFile(runtimePaths.sessionStreamPath)
    ]);
    const refreshedExecutionPlan = await readFile(executionPlanPath, "utf8");

    assert.equal(
      refreshedRunContract.objective,
      "Revise the support queue workflow to satisfy operator review feedback."
    );
    assert.equal(refreshedRunContract.start_gate.required, true);
    assert.equal(refreshedRunContract.start_gate.authorized, true);
    assert.match(refreshedRunContract.start_gate.authorized_at, /\d{4}-\d{2}-\d{2}T/);
    assert.equal(refreshedRunContract.start_gate.authorized_by, "loop-control");
    assert.ok(
      refreshedRunContract.non_goals.includes(
        "do not expand into billing or admin settings"
      )
    );
    assert.equal(refreshedOpenQuestions.session_status, "needs_steering");
    assert.equal(refreshedSessionStatus.session_status, "needs_steering");
    assert.equal(refreshedSessionStatus.readiness, "needs_input");
    assert.equal(refreshedSessionStatus.next_attention, "human");
    assert.equal(refreshedSessionStatus.attention_kind, "steering");
    assert.equal(refreshedSessionStatus.ui_visibility, "user_boundary");
    assert.equal(refreshedSessionStatus.foreground_owner, "human");
    assert.equal(refreshedSessionStatus.session_binding.surface, "current-thread");
    assert.equal(refreshedSessionStatus.session_binding.binding_state, "bound");
    assert.equal(refreshedSessionStatus.session_binding.thread_id, "thread-prepare-001");
    assert.equal(refreshedSessionStatus.active_checkpoint.kind, "generator-plan");
    assert.equal(
      refreshedSessionStatus.active_checkpoint.checkpoint_id,
      "checkpoint-generator-plan-001"
    );
    assert.equal(refreshedSessionStatus.active_checkpoint.skill, "loop-control");
    assert.equal(
      refreshedSessionStatus.objective,
      "Revise the support queue workflow to satisfy operator review feedback."
    );
    assert.equal(refreshedOpenQuestions.latest_round, 2);
    assert.equal(refreshedOpenQuestions.latest_stop_reason, "awaiting_human_input");
    assert.equal(refreshedSessionStatus.latest_round, 2);
    assert.equal(refreshedSessionStatus.latest_stop_reason, "awaiting_human_input");
    assert.ok(
      refreshedOpenQuestions.steering_notes.includes(
        "Confirm whether inbox triage should split by team before continuing."
      )
    );
    assert.equal(refreshedSessionStatus.steering_note_count, 1);
    assert.equal(refreshedSessionStatus.review_feedback_count, 1);
    assert.equal(refreshedSessionStatus.external_blocker_count, 1);
    assert.equal(refreshedSessionEvents.length, 2);
    assert.equal(refreshedSessionEvents[1].event_type, "session_changed");
    assert.ok(refreshedSessionEvents[1].changed_fields.includes("session_status"));
    assert.ok(refreshedSessionEvents[1].changed_fields.includes("readiness"));
    assert.ok(refreshedSessionEvents[1].changed_fields.includes("attention_kind"));
    assert.ok(refreshedSessionEvents[1].changed_fields.includes("latest_round"));
    assert.equal(refreshedSessionStream.latest_source_sequence, 2);
    assert.equal(
      refreshedSessionStream.latest_session.session_status,
      refreshedSessionStatus.session_status
    );
    assert.equal(
      refreshedSessionStream.latest_session.attention_kind,
      refreshedSessionStatus.attention_kind
    );
    assert.equal(
      refreshedSessionStream.latest_session.ui_visibility,
      refreshedSessionStatus.ui_visibility
    );
    assert.equal(
      refreshedSessionStream.latest_session.foreground_owner,
      refreshedSessionStatus.foreground_owner
    );
    assert.ok(
      refreshedOpenQuestions.review_feedback.includes(
        "Tighten the queue filters and make the triage flow explicit."
      )
    );
    assert.ok(
      refreshedOpenQuestions.external_blockers.includes(
        "Access to the real ticket feed is still unavailable."
      )
    );
    assert.ok(
      refreshedOpenQuestions.questions.some(
        (question) =>
          question.source === "steering" &&
          question.prompt.includes("split by team")
      )
    );
    assert.ok(
      refreshedOpenQuestions.questions.some(
        (question) =>
          question.source === "review" &&
          question.prompt.includes("queue filters")
      )
    );
    assert.ok(
      refreshedOpenQuestions.questions.some(
        (question) =>
          question.source === "external" &&
          question.prompt.includes("ticket feed")
      )
    );
    assert.match(refreshedExecutionPlan, /Session status: needs_steering/);
    assert.match(refreshedExecutionPlan, /Live Review Context/);
    assert.match(refreshedExecutionPlan, /External Blockers/);
    assert.match(
      refreshedExecutionPlan,
      /Revise the support queue workflow to satisfy operator review feedback\./
    );

    console.log("validate:session-preparation-artifacts passed");
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
