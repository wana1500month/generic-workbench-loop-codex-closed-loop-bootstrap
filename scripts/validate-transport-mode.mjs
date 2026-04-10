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
  assertRoundCount(summary, 1);
  assertRuntimeWarningContains(summary, expectedWarning);
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
    transportState.presentation_mode ===
      (expectedTransportMode === "current-thread"
        ? "foreground-thread"
        : expectedTransportMode === "app-server"
          ? "background-automation"
          : "headless"),
    `Unexpected presentation_mode '${transportState.presentation_mode ?? "missing"}' for '${expectedTransportMode}'.`
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
  assert(
    summary.round_history?.[0]?.transport_mode === expectedTransportMode,
    `Expected round_history[0].transport_mode '${expectedTransportMode}', received '${summary.round_history?.[0]?.transport_mode ?? "missing"}'.`
  );
  assert(
    operatorSurface.transport_mode === expectedTransportMode,
    `Expected operator surface transport_mode '${expectedTransportMode}', received '${operatorSurface.transport_mode ?? "missing"}'.`
  );
  assert(
    operatorSurface.presentation_mode === transportState.presentation_mode,
    "Expected operator surface and transport state to agree on presentation_mode."
  );

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
    { silent: true }
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
    expectedWarning:
      "Current-thread transport is the stock Codex foreground-thread surface",
    expectAppServerLive: false
  });

  const attachedDefaultExecution = await runLoop(
    ["--single", "--controller-mode", "attached"],
    { silent: true }
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
    expectedWarning:
      "Current-thread transport is the stock Codex foreground-thread surface",
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
