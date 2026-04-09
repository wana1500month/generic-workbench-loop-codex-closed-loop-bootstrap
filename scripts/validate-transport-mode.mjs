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
    expectAppServerScaffold
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

  const [transportState, resumeIdentity] = await Promise.all([
    readJsonFile(summary.transport_state_path),
    readJsonFile(summary.resume_identity_path)
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
    resumeIdentity.transport_mode === expectedTransportMode,
    `Expected resume identity transport_mode '${expectedTransportMode}', received '${resumeIdentity.transport_mode ?? "missing"}'.`
  );
  assert(
    summary.round_history?.[0]?.transport_mode === expectedTransportMode,
    `Expected round_history[0].transport_mode '${expectedTransportMode}', received '${summary.round_history?.[0]?.transport_mode ?? "missing"}'.`
  );

  if (expectAppServerScaffold) {
    assert(
      transportState.app_server?.implemented === false,
      "Expected app-server transport state to remain scaffold-only."
    );
    assert(
      transportState.app_server?.thread_status === "not_started",
      `Expected app-server thread_status 'not_started', received '${transportState.app_server?.thread_status ?? "missing"}'.`
    );
    assert(
      transportState.app_server?.turn_status === "not_started",
      `Expected app-server turn_status 'not_started', received '${transportState.app_server?.turn_status ?? "missing"}'.`
    );
    for (const method of ["thread/start", "thread/resume", "turn/start", "turn/steer"]) {
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

const main = async () => {
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
      "Current-thread transport keeps the stock Codex session as the operator surface",
    expectAppServerScaffold: false
  });

  const appServerExecution = await runLoop(
    ["--single", "--controller-mode", "attached", "--transport", "app-server"],
    { silent: true }
  );
  if (appServerExecution.code !== 0) {
    throw new Error(
      `Attached app-server validation run failed.\n${appServerExecution.stdout}\n${appServerExecution.stderr}`
    );
  }
  const appServerRunDirectory = extractRunDirectory(appServerExecution.stdout);
  await assertTransportSurface(appServerRunDirectory, {
    expectedControllerMode: "attached",
    expectedTransportMode: "app-server",
    expectedTransportStatus: "scaffold_only",
    expectedWarning: "App Server transport is scaffolded only.",
    expectAppServerScaffold: true
  });

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
