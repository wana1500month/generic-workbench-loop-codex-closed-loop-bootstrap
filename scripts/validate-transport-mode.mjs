import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  assertRoundCount,
  assertRuntimeWarningContains,
  extractRunDirectory,
  readJsonFile,
  readSummary,
  runLoop
} from "./validation-utils.mjs";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertTransportSurface = async (
  runDirectory,
  {
    expectedControllerMode,
    expectedTransportMode,
    expectedTransportStatus,
    expectedRoundCount,
    expectedPresentationMode,
    expectedLaunchOrigin,
    expectedThreadBindingState,
    expectedUiBindingMode,
    expectedAppVisibility,
    expectedWorkspaceSurface,
    expectedHandoffState,
    expectedResumeSkill,
    expectedAttentionRequired,
    expectedCheckpointKind,
    expectedAutoResumeEligible,
    expectedRecommendedSkill,
    expectedRequiresCodexApp,
    expectedWorktreeId,
    expectedWorktreePath,
    expectedThreadId,
    expectedResumeCommandState,
    expectedNextActionIncludes,
    expectedBindingWarning,
    expectedWarning,
    expectAppServerLive
  }
) => {
  const summary = await readSummary(runDirectory);
  assert(
    summary.controller_mode === expectedControllerMode,
    `Expected controller_mode '${expectedControllerMode}', received '${summary.controller_mode ?? "missing"}'.`
  );
  assert(
    summary.transport_mode === expectedTransportMode,
    `Expected transport_mode '${expectedTransportMode}', received '${summary.transport_mode ?? "missing"}'.`
  );
  assertRoundCount(summary, expectedRoundCount);
  assertRuntimeWarningContains(summary, expectedWarning);
  if (expectedBindingWarning !== undefined) {
    assertRuntimeWarningContains(summary, expectedBindingWarning);
  }
  assert(
    typeof summary.transport_state_path === "string",
    "Expected summary.transport_state_path to be present."
  );
  assert(
    typeof summary.transport_protocol_path === "string",
    "Expected summary.transport_protocol_path to be present."
  );
  assert(
    typeof summary.operator_surface_path === "string",
    "Expected summary.operator_surface_path to be present."
  );

  const [transportState, resumeIdentity, operatorSurface] = await Promise.all([
    readJsonFile(summary.transport_state_path),
    readJsonFile(summary.resume_identity_path),
    readJsonFile(summary.operator_surface_path)
  ]);
  assert(
    transportState.controller_mode === expectedControllerMode,
    `Expected transport-state controller_mode '${expectedControllerMode}', received '${transportState.controller_mode ?? "missing"}'.`
  );
  assert(
    transportState.transport_mode === expectedTransportMode,
    `Expected transport-state transport_mode '${expectedTransportMode}', received '${transportState.transport_mode ?? "missing"}'.`
  );
  assert(
    transportState.status === expectedTransportStatus,
    `Expected transport-state status '${expectedTransportStatus}', received '${transportState.status ?? "missing"}'.`
  );
  assert(
    transportState.presentation_mode === expectedPresentationMode,
    `Expected presentation_mode '${expectedPresentationMode}', received '${transportState.presentation_mode ?? "missing"}'.`
  );
  assert(
    transportState.launch_origin === expectedLaunchOrigin,
    `Expected launch_origin '${expectedLaunchOrigin}', received '${transportState.launch_origin ?? "missing"}'.`
  );
  assert(
    transportState.thread_binding_state === expectedThreadBindingState,
    `Expected thread_binding_state '${expectedThreadBindingState}', received '${transportState.thread_binding_state ?? "missing"}'.`
  );
  assert(
    transportState.ui_binding_mode === expectedUiBindingMode,
    `Expected ui_binding_mode '${expectedUiBindingMode}', received '${transportState.ui_binding_mode ?? "missing"}'.`
  );
  assert(
    transportState.app_visibility === expectedAppVisibility,
    `Expected app_visibility '${expectedAppVisibility}', received '${transportState.app_visibility ?? "missing"}'.`
  );
  assert(
    transportState.ui_surface?.dashboard_path === summary.operator_surface_path.replace(
      "operator-surface.json",
      "operator-surface.md"
    ),
    "Expected transport-state ui_surface.dashboard_path to point at operator-surface.md."
  );
  assert(
    resumeIdentity.transport_mode === expectedTransportMode,
    `Expected resume identity transport_mode '${expectedTransportMode}', received '${resumeIdentity.transport_mode ?? "missing"}'.`
  );
  if (expectedRoundCount > 0) {
    assert(
      summary.round_history?.[0]?.transport_mode === expectedTransportMode,
      `Expected round_history[0].transport_mode '${expectedTransportMode}', received '${summary.round_history?.[0]?.transport_mode ?? "missing"}'.`
    );
  } else {
    assert(
      (summary.round_history ?? []).length === 0,
      `Expected no round_history entries before current-thread planning handoff, received ${(summary.round_history ?? []).length}.`
    );
  }
  assert(
    operatorSurface.transport_mode === expectedTransportMode,
    `Expected operator surface transport_mode '${expectedTransportMode}', received '${operatorSurface.transport_mode ?? "missing"}'.`
  );
  assert(
    operatorSurface.presentation_mode === transportState.presentation_mode,
    "Expected operator surface and transport state to agree on presentation_mode."
  );
  assert(
    operatorSurface.launch_origin === transportState.launch_origin,
    "Expected operator surface and transport state to agree on launch_origin."
  );
  assert(
    operatorSurface.thread_binding_state === transportState.thread_binding_state,
    "Expected operator surface and transport state to agree on thread_binding_state."
  );
  assert(
    operatorSurface.app_visibility === transportState.app_visibility,
    "Expected operator surface and transport state to agree on app_visibility."
  );
  if (expectedWorkspaceSurface !== undefined) {
    assert(
      operatorSurface.workspace_surface === expectedWorkspaceSurface,
      `Expected operator surface workspace_surface '${expectedWorkspaceSurface}', received '${operatorSurface.workspace_surface ?? "missing"}'.`
    );
  }
  if (expectedHandoffState !== undefined) {
    assert(
      operatorSurface.handoff_state === expectedHandoffState,
      `Expected operator surface handoff_state '${expectedHandoffState}', received '${operatorSurface.handoff_state ?? "missing"}'.`
    );
  }
  if (expectedResumeSkill !== undefined) {
    assert(
      operatorSurface.resume_skill === expectedResumeSkill,
      `Expected operator surface resume_skill '${expectedResumeSkill}', received '${operatorSurface.resume_skill ?? "missing"}'.`
    );
  }
  if (expectedAttentionRequired !== undefined) {
    assert(
      operatorSurface.attention_required === expectedAttentionRequired,
      `Expected operator surface attention_required '${expectedAttentionRequired}', received '${operatorSurface.attention_required ?? "missing"}'.`
    );
  }
  if (expectedCheckpointKind !== undefined) {
    assert(
      operatorSurface.checkpoint_kind === expectedCheckpointKind,
      `Expected operator surface checkpoint_kind '${expectedCheckpointKind}', received '${operatorSurface.checkpoint_kind ?? "missing"}'.`
    );
  }
  if (expectedAutoResumeEligible !== undefined) {
    assert(
      operatorSurface.auto_resume_eligible === expectedAutoResumeEligible,
      `Expected operator surface auto_resume_eligible '${expectedAutoResumeEligible}', received '${operatorSurface.auto_resume_eligible ?? "missing"}'.`
    );
  }
  if (expectedRecommendedSkill !== undefined) {
    assert(
      operatorSurface.recommended_skill === expectedRecommendedSkill,
      `Expected operator surface recommended_skill '${expectedRecommendedSkill}', received '${operatorSurface.recommended_skill ?? "missing"}'.`
    );
  }
  if (expectedRequiresCodexApp !== undefined) {
    assert(
      operatorSurface.requires_codex_app === expectedRequiresCodexApp,
      `Expected operator surface requires_codex_app '${expectedRequiresCodexApp}', received '${operatorSurface.requires_codex_app ?? "missing"}'.`
    );
  }
  if (expectedWorktreeId !== undefined) {
    assert(
      operatorSurface.worktree_id === expectedWorktreeId,
      `Expected operator surface worktree_id '${expectedWorktreeId}', received '${operatorSurface.worktree_id ?? "missing"}'.`
    );
  }
  if (expectedWorktreePath !== undefined) {
    assert(
      operatorSurface.worktree_path === expectedWorktreePath,
      `Expected operator surface worktree_path '${expectedWorktreePath}', received '${operatorSurface.worktree_path ?? "missing"}'.`
    );
  }
  if (expectedThreadId !== undefined) {
    assert(
      operatorSurface.thread_id === expectedThreadId,
      `Expected operator surface thread_id '${expectedThreadId}', received '${operatorSurface.thread_id ?? "missing"}'.`
    );
  }
  if (expectedResumeCommandState === "present") {
    assert(
      typeof operatorSurface.resume_command === "string",
      "Expected operator surface to publish resume_command."
    );
  }
  if (expectedResumeCommandState === "absent") {
    assert(
      operatorSurface.resume_command === undefined,
      `Expected operator surface resume_command to be omitted, received '${operatorSurface.resume_command ?? "present"}'.`
    );
  }
  if (expectedNextActionIncludes !== undefined) {
    assert(
      typeof operatorSurface.next_action === "string" &&
        operatorSurface.next_action.includes(expectedNextActionIncludes),
      `Expected operator surface next_action to contain '${expectedNextActionIncludes}', received '${operatorSurface.next_action ?? "missing"}'.`
    );
  }

  if (expectAppServerLive) {
    assert(
      transportState.app_server?.implemented === true,
      "Expected app-server transport state to be implemented."
    );
    assert(
      transportState.app_server?.thread_lifecycle === "closed",
      `Expected app-server thread_lifecycle 'closed', received '${transportState.app_server?.thread_lifecycle ?? "missing"}'.`
    );
    assert(
      transportState.app_server?.thread_runtime_status === "notLoaded",
      `Expected app-server thread_runtime_status 'notLoaded', received '${transportState.app_server?.thread_runtime_status ?? "missing"}'.`
    );
    assert(
      transportState.status === "completed",
      `Expected completed top-level transport status after shutdown, received '${transportState.status ?? "missing"}'.`
    );
    assert(
      transportState.app_server?.turn_status === "interrupted" ||
        transportState.app_server?.turn_status === "completed",
      `Expected app-server turn_status 'interrupted' or 'completed', received '${transportState.app_server?.turn_status ?? "missing"}'.`
    );
    assert(
      typeof transportState.app_server?.thread_id === "string",
      "Expected app-server transport to persist thread_id."
    );
    assert(
      typeof transportState.app_server?.turn_id === "string",
      "Expected app-server transport to persist turn_id."
    );
    assert(
      (transportState.app_server?.event_cursor ?? 0) > 0,
      "Expected app-server transport to advance an event cursor."
    );
    for (const method of [
      "thread/start",
      "thread/read",
      "thread/name/set",
      "thread/resume",
      "turn/start",
      "turn/steer",
      "turn/interrupt",
      "review/start"
    ]) {
      assert(
        transportState.app_server?.required_methods?.includes(method),
        `Expected app-server required_methods to include '${method}'.`
      );
    }
  } else {
    assert(
      transportState.app_server === undefined,
      "Expected non-app-server transport state to omit app_server scaffold metadata."
    );
  }
};

const expectInvalidCombination = async (args, expectedMessage) => {
  const execution = await runLoop(args, { silent: true });
  if (execution.code === 0) {
    throw new Error(
      `Expected transport/controller combination ${args.join(" ")} to fail, but it succeeded.`
    );
  }

  const combinedOutput = `${execution.stdout}\n${execution.stderr}`;
  assert(
    combinedOutput.includes(expectedMessage),
    `Expected failure output to contain '${expectedMessage}', but received:\n${combinedOutput}`
  );
};

const runAttachedAppServerValidation = async (fakeAppServerPath, attempt) => {
  const recordDirectory = join(process.cwd(), ".tmp", "validate-transport-mode");
  const recordPath = join(recordDirectory, `fake-app-server-record-${attempt}.json`);
  await mkdir(recordDirectory, { recursive: true });
  const appServerExecution = await runLoop(
    ["--single", "--controller-mode", "attached", "--transport", "app-server"],
    {
      silent: true,
      env: {
        ...process.env,
        HARNESS_APP_SERVER_BIN: process.execPath,
        HARNESS_APP_SERVER_BIN_ARGS: JSON.stringify([fakeAppServerPath]),
        FAKE_APP_SERVER_RECORD_PATH: recordPath
      }
    }
  );
  if (appServerExecution.code !== 0) {
    throw new Error(
      `Attached app-server validation run ${attempt} failed.\n${appServerExecution.stdout}\n${appServerExecution.stderr}`
    );
  }
  const appServerRunDirectory = extractRunDirectory(appServerExecution.stdout);
  await assertTransportSurface(appServerRunDirectory, {
    expectedControllerMode: "attached",
    expectedTransportMode: "app-server",
    expectedTransportStatus: "completed",
    expectedRoundCount: 1,
    expectedPresentationMode: "background-automation",
    expectedLaunchOrigin: "embedded-client",
    expectedThreadBindingState: "bound",
    expectedUiBindingMode: "embedded-app-server",
    expectedAppVisibility: "embedded-only",
    expectedWorkspaceSurface: "local",
    expectedHandoffState: "none",
    expectedResumeSkill: "run-resume",
    expectedRequiresCodexApp: false,
    expectedWarning:
      "App Server transport is an embedded background-automation surface",
    expectAppServerLive: true
  });
  const fakeRecord = JSON.parse(await readFile(recordPath, "utf8"));
  const incomingRequests = fakeRecord
    .filter((entry) => entry.direction === "in")
    .map((entry) => entry.message);
  assert(
    incomingRequests.some((message) => message.method === "review/start"),
    "Expected attached app-server loop to issue at least one review/start request."
  );
  assert(
    incomingRequests.some(
      (message) =>
        message.method === "turn/start" &&
        Array.isArray(message.params?.input) &&
        message.params.input.some(
          (item) => item?.type === "skill" && item?.name === "round-enhancement"
        )
    ),
    "Expected attached app-server loop to issue at least one round-enhancement skill turn."
  );
  await rm(recordPath, { force: true });
};

const main = async () => {
  const fakeAppServerPath = join(process.cwd(), "scripts", "testing", "fake-app-server.mjs");
  const currentThreadExecution = await runLoop(
    ["--single", "--controller-mode", "attached", "--transport", "current-thread"],
    {
      silent: true,
      env: {
        ...process.env,
        CODEX_THREAD_ID: "",
        HARNESS_LAUNCH_ORIGIN: "shell",
        HARNESS_THREAD_BINDING_STATE: "unbound",
        HARNESS_SURFACE_OWNER: "external-controller",
        HARNESS_ENTRYPOINT: "shell",
        HARNESS_APP_VISIBILITY: "not-visible-in-stock-app"
      }
    }
  );
  if (currentThreadExecution.code !== 0) {
    throw new Error(
      `Attached current-thread validation run failed.\n${currentThreadExecution.stdout}\n${currentThreadExecution.stderr}`
    );
  }
  const currentThreadRunDirectory = extractRunDirectory(currentThreadExecution.stdout);
  await assertTransportSurface(currentThreadRunDirectory, {
    expectedControllerMode: "attached",
    expectedTransportMode: "current-thread",
    expectedTransportStatus: "configured",
    expectedRoundCount: 0,
    expectedPresentationMode: "manual-protocol",
    expectedLaunchOrigin: "shell",
    expectedThreadBindingState: "unbound",
    expectedUiBindingMode: "none",
    expectedAppVisibility: "not-visible-in-stock-app",
    expectedWorkspaceSurface: "local",
    expectedHandoffState: "manual",
    expectedResumeSkill: "attached-loop",
    expectedAttentionRequired: "human",
    expectedCheckpointKind: "planner",
    expectedAutoResumeEligible: false,
    expectedRecommendedSkill: "loop-control",
    expectedResumeCommandState: "present",
    expectedBindingWarning:
      "When no Codex thread binding is present, current-thread degrades to manual-protocol instead of claiming foreground-thread ownership.",
    expectedRequiresCodexApp: false,
    expectedWarning:
      "Current-thread transport keeps the controller on the active operator surface",
    expectAppServerLive: false
  });

  const assumedCurrentThreadExecution = await runLoop(
    ["--single", "--controller-mode", "attached", "--transport", "current-thread"],
    {
      silent: true,
      env: {
        ...process.env,
        CODEX_THREAD_ID: "",
        HARNESS_LAUNCH_ORIGIN: "codex-app-thread",
        HARNESS_THREAD_BINDING_STATE: "bound",
        HARNESS_SURFACE_OWNER: "stock-codex-thread",
        HARNESS_ENTRYPOINT: "skill",
        HARNESS_APP_VISIBILITY: "visible-in-stock-app"
      }
    }
  );
  if (assumedCurrentThreadExecution.code !== 0) {
    throw new Error(
      `Assumed current-thread validation run failed.\n${assumedCurrentThreadExecution.stdout}\n${assumedCurrentThreadExecution.stderr}`
    );
  }
  const assumedCurrentThreadRunDirectory = extractRunDirectory(assumedCurrentThreadExecution.stdout);
  await assertTransportSurface(assumedCurrentThreadRunDirectory, {
    expectedControllerMode: "attached",
    expectedTransportMode: "current-thread",
    expectedTransportStatus: "configured",
    expectedRoundCount: 0,
    expectedPresentationMode: "manual-protocol",
    expectedLaunchOrigin: "codex-app-thread",
    expectedThreadBindingState: "assumed",
    expectedUiBindingMode: "none",
    expectedAppVisibility: "not-visible-in-stock-app",
    expectedWorkspaceSurface: "local",
    expectedHandoffState: "manual",
    expectedResumeSkill: "attached-loop",
    expectedAttentionRequired: "human",
    expectedCheckpointKind: "planner",
    expectedAutoResumeEligible: false,
    expectedRecommendedSkill: "loop-control",
    expectedResumeCommandState: "present",
    expectedBindingWarning:
      "When no Codex thread binding is present, current-thread degrades to manual-protocol instead of claiming foreground-thread ownership.",
    expectedRequiresCodexApp: false,
    expectedWarning:
      "Current-thread transport keeps the controller on the active operator surface",
    expectAppServerLive: false
  });

  const attachedDefaultExecution = await runLoop(
    ["--single", "--controller-mode", "attached"],
    {
      silent: true,
      env: {
        ...process.env,
        CODEX_THREAD_ID: "thread_validate_current"
      }
    }
  );
  if (attachedDefaultExecution.code !== 0) {
    throw new Error(
      `Attached default transport validation run failed.\n${attachedDefaultExecution.stdout}\n${attachedDefaultExecution.stderr}`
    );
  }
  const attachedDefaultRunDirectory = extractRunDirectory(attachedDefaultExecution.stdout);
  await assertTransportSurface(attachedDefaultRunDirectory, {
    expectedControllerMode: "attached",
    expectedTransportMode: "current-thread",
    expectedTransportStatus: "configured",
    expectedRoundCount: 0,
    expectedPresentationMode: "foreground-thread",
    expectedLaunchOrigin: "codex-app-thread",
    expectedThreadBindingState: "bound",
    expectedUiBindingMode: "stock-current-thread",
    expectedAppVisibility: "visible-in-stock-app",
    expectedWorkspaceSurface: "local",
    expectedHandoffState: "local",
    expectedResumeSkill: "attached-loop",
    expectedAttentionRequired: "codex",
    expectedCheckpointKind: "planner",
    expectedAutoResumeEligible: true,
    expectedRecommendedSkill: "loop-control",
    expectedResumeCommandState: "absent",
    expectedNextActionIncludes: "$loop-control",
    expectedBindingWarning:
      "Current-thread transport is bound to the active Codex thread and remains visible in the stock app.",
    expectedRequiresCodexApp: true,
    expectedThreadId: "thread_validate_current",
    expectedWarning:
      "Current-thread transport keeps the controller on the active operator surface",
    expectAppServerLive: false
  });

  const worktreePath = join(process.cwd(), ".tmp", "validate-transport-mode", "worktree-current");
  const attachedWorktreeExecution = await runLoop(
    ["--single", "--controller-mode", "attached", "--transport", "current-thread"],
    {
      silent: true,
      env: {
        ...process.env,
        CODEX_THREAD_ID: "thread_validate_worktree",
        HARNESS_WORKSPACE_SURFACE: "worktree",
        HARNESS_WORKTREE_ID: "wt-validate",
        HARNESS_WORKTREE_PATH: worktreePath
      }
    }
  );
  if (attachedWorktreeExecution.code !== 0) {
    throw new Error(
      `Attached worktree transport validation run failed.\n${attachedWorktreeExecution.stdout}\n${attachedWorktreeExecution.stderr}`
    );
  }
  const attachedWorktreeRunDirectory = extractRunDirectory(attachedWorktreeExecution.stdout);
  await assertTransportSurface(attachedWorktreeRunDirectory, {
    expectedControllerMode: "attached",
    expectedTransportMode: "current-thread",
    expectedTransportStatus: "configured",
    expectedRoundCount: 0,
    expectedPresentationMode: "foreground-thread",
    expectedLaunchOrigin: "codex-app-thread",
    expectedThreadBindingState: "bound",
    expectedUiBindingMode: "stock-current-thread",
    expectedAppVisibility: "visible-in-stock-app",
    expectedWorkspaceSurface: "worktree",
    expectedHandoffState: "worktree",
    expectedResumeSkill: "attached-loop",
    expectedAttentionRequired: "codex",
    expectedCheckpointKind: "planner",
    expectedAutoResumeEligible: true,
    expectedRecommendedSkill: "loop-control",
    expectedResumeCommandState: "absent",
    expectedBindingWarning:
      "Current-thread transport is bound to the active Codex thread and remains visible in the stock app.",
    expectedRequiresCodexApp: true,
    expectedWorktreeId: "wt-validate",
    expectedWorktreePath: worktreePath,
    expectedThreadId: "thread_validate_worktree",
    expectedWarning:
      "Current-thread transport keeps the controller on the active operator surface",
    expectAppServerLive: false
  });

  for (const attempt of [1, 2, 3]) {
    await runAttachedAppServerValidation(fakeAppServerPath, attempt);
  }

  await expectInvalidCombination(
    ["--single", "--controller-mode", "detached", "--transport", "current-thread"],
    "Detached controller mode requires transport 'codex-exec'; received 'current-thread'."
  );
  await expectInvalidCombination(
    ["--single", "--controller-mode", "attached", "--transport", "codex-exec"],
    "Attached controller mode requires transport 'current-thread' or 'app-server'."
  );

  console.log("Validated controller-mode and transport-mode separation.");
};

main().catch((error) => {
  console.error("Transport-mode validation failed.");
  console.error(error);
  process.exitCode = 1;
});
