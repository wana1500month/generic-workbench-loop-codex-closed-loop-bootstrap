import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  cleanupTempRoot,
  createTempRoot,
  ensureBuild,
  importDist,
  runCommand
} from "./testing/bootstrap-validator-helpers.mjs";

const parseJson = (text, label) => {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Could not parse ${label} as JSON.\n${error}\n${text}`);
  }
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const strictMode = process.env.HARNESS_APP_SERVER_REAL_SMOKE_STRICT === "1";

const main = async () => {
  if (process.env.HARNESS_DISABLE_CODEX_AGENTS === "1") {
    if (strictMode) {
      throw new Error(
        "App Server real smoke strict mode failed: HARNESS_DISABLE_CODEX_AGENTS=1 prevents real Codex execution."
      );
    }
    console.log(
      "App Server real smoke environment_blocked: HARNESS_DISABLE_CODEX_AGENTS=1 prevents real Codex execution."
    );
    return;
  }

  await ensureBuild();

  const { resolveCodexCliLaunch } = await importDist("codex-cli.js");
  const { repoRoot, checkCodexAuth } = await importDist("codex-runtime.js");
  const { startAppServerTransport } = await importDist("app-server-runtime.js");
  const { writeTransportProtocol } = await importDist("transport-protocol.js");
  const codexLaunch = resolveCodexCliLaunch();
  const appServerLaunch = resolveCodexCliLaunch({
    commandEnvKeys: ["HARNESS_APP_SERVER_BIN", "HARNESS_CODEX_BIN"],
    argsEnvKeys: ["HARNESS_APP_SERVER_BIN_ARGS", "HARNESS_CODEX_BIN_ARGS"],
    tailArgs: ["app-server"]
  });

  const authPreflight = await checkCodexAuth({
    strict: strictMode,
    requireChatgpt: true,
    requireFileBacked: strictMode,
    cwd: repoRoot
  });
  if (!authPreflight.ok) {
    const reason = authPreflight.blockedReason ?? "Codex auth preflight failed.";
    if (strictMode) {
      throw new Error(`App Server real smoke strict mode failed: ${reason}`);
    }
    console.log(`App Server real smoke environment_blocked: ${reason}`);
    return;
  }

  const codexVersion = await runCommand(codexLaunch.command, [...codexLaunch.args, "--version"], {
    shell: false
  }).catch(() => ({ code: 1, stdout: "", stderr: "" }));
  if (codexVersion.code !== 0) {
    if (strictMode) {
      throw new Error(
        `App Server real smoke strict mode failed: could not read Codex version.\n${codexVersion.stderr}`
      );
    }
    console.log(
      "App Server real smoke environment_blocked: could not read Codex version after auth preflight."
    );
    return;
  }
  const helpCheck = await runCommand(appServerLaunch.command, [...appServerLaunch.args, "--help"], {
    shell: false
  }).catch(() => ({ code: 1, stdout: "", stderr: "" }));
  if (helpCheck.code !== 0) {
    if (strictMode) {
      throw new Error(
        `App Server real smoke strict mode failed: could not launch codex app-server --help.\n${helpCheck.stderr}`
      );
    }
    console.log(
      "App Server real smoke environment_blocked: could not launch codex app-server."
    );
    return;
  }

  const tempRoot = await createTempRoot("app-server-real-smoke");

  try {
    const runDirectory = join(tempRoot, "run");
    const runtimeDirectory = join(runDirectory, "runtime");
    const summaryPath = join(runDirectory, "summary.json");
    const transportStatePath = join(runtimeDirectory, "transport-state.json");
    const dashboardPath = join(runtimeDirectory, "operator-surface.md");
    const sessionStatusPath = join(runtimeDirectory, "session-status.json");
    const sessionStatusEventsPath = join(
      runtimeDirectory,
      "session-status-events.jsonl"
    );
    const sessionStreamPath = join(runtimeDirectory, "session-stream.json");
    const mirroredSessionEventsPath = join(
      runtimeDirectory,
      "app-server-session-events.jsonl"
    );
    const targetRoot = join(tempRoot, "target-root");
    const responsePath = join(runtimeDirectory, "real-app-server-response.json");
    const targetFilePath = join(targetRoot, "app-server-real-smoke.txt");

    await Promise.all([
      mkdir(runDirectory, { recursive: true }),
      mkdir(runtimeDirectory, { recursive: true }),
      mkdir(targetRoot, { recursive: true })
    ]);
    await writeFile(
      summaryPath,
      JSON.stringify({ run_id: "real-app-server-smoke" }, null, 2) + "\n"
    );

    const protocolPath = await writeTransportProtocol({
      runDirectory,
      transportMode: "app-server",
      summary: {
        run_id: "real-app-server-smoke",
        controller_mode: "attached",
        transport_mode: "app-server",
        transport_state_path: transportStatePath,
        resume_identity_path: join(runDirectory, "resume-identity.json"),
        runtime_round_phase_path: join(runtimeDirectory, "round-phase.json")
      },
      activeRound: 1,
      activePhase: "pre_verification",
      activeStatus: "in_progress",
      notes: ["Real app-server smoke validation."]
    });

    const controller = await startAppServerTransport({
      runId: "real-app-server-smoke",
      controllerMode: "attached",
      transportStatePath,
      summaryPath,
      protocolPath,
      dashboardPath,
      sessionStatusPath,
      sessionStatusEventsPath,
      sessionStreamPath,
      mirroredSessionEventsPath,
      initialRound: 1,
      initialPhase: "pre_verification",
      initialStatus: "in_progress",
      initialNotes: ["Real app-server smoke validation."],
      startInitialTurn: false,
      threadName: "real-app-server-smoke · attached-loop",
      defaultTaskTimeoutMs: 180_000,
      requestTimeoutMs: 60_000
    });

    try {
      const taskResult = await controller.runTask({
        round: 1,
        phase: "pre_verification",
        taskLabel: "real app-server smoke",
        completionTimeoutMs: 180_000,
        taskCwd: targetRoot,
        writableRoots: [targetRoot, runDirectory],
        networkAccess: false,
        prompt: [
          "Use the live App Server turn to mutate the workspace.",
          `APP_SERVER_SMOKE_RESPONSE_PATH: ${responsePath}`,
          `APP_SERVER_SMOKE_FILE_PATH: ${targetFilePath}`,
          "APP_SERVER_SMOKE_FILE_CONTENT: app server real smoke",
          "",
          "Create the file at APP_SERVER_SMOKE_FILE_PATH with the exact APP_SERVER_SMOKE_FILE_CONTENT text.",
          "Write a JSON object to APP_SERVER_SMOKE_RESPONSE_PATH with:",
          '{"status":"applied","summary":"...","changed_files":["app-server-real-smoke.txt"],"generated_at":"ISO-8601"}'
        ].join("\n")
      });

      assert(
        taskResult.status === "completed" || taskResult.status === "interrupted",
        `Expected live App Server task to complete, received '${taskResult.status}'.`
      );
    } finally {
      await controller.stop({
        stopReason: "contract_completed",
        notes: ["Real App Server smoke complete."]
      });
    }

    const [transportState, responseArtifact, targetFile] = await Promise.all([
      parseJson(await readFile(transportStatePath, "utf8"), "transport state"),
      parseJson(await readFile(responsePath, "utf8"), "response artifact"),
      readFile(targetFilePath, "utf8")
    ]);

    assert(
      transportState.status === "completed",
      `Expected App Server transport state to be completed after shutdown, received '${transportState.status ?? "missing"}'.`
    );
    assert(
      transportState.app_server?.implemented === true,
      "Expected App Server transport state to record implemented=true."
    );
    assert(
      typeof transportState.app_server?.thread_id === "string",
      "Expected App Server transport state to persist a thread id."
    );
    assert(
      typeof transportState.app_server?.turn_id === "string",
      "Expected App Server transport state to persist a turn id."
    );
    assert(
      transportState.app_server?.thread_lifecycle === "closed",
      `Expected App Server thread lifecycle 'closed', received '${transportState.app_server?.thread_lifecycle ?? "missing"}'.`
    );
    assert(
      (transportState.app_server?.event_cursor ?? 0) > 0,
      "Expected App Server transport state to advance an event cursor."
    );
    assert(
      responseArtifact.status === "applied",
      "Expected App Server response artifact to report applied status."
    );
    assert(
      targetFile.trim() === "app server real smoke",
      "Expected App Server smoke target file to contain the requested content."
    );

    await writeFile(
      join(tempRoot, "app-server-real-smoke-result.json"),
      JSON.stringify(
        {
          validated_at: new Date().toISOString(),
          codex_version: codexVersion.stdout.trim() || codexVersion.stderr.trim(),
          auth_preflight: {
            mode: authPreflight.mode,
            auth_file_present: authPreflight.authFilePresent,
            has_refresh_token: authPreflight.hasRefreshToken,
            file_backed: authPreflight.fileBacked
          },
          thread_id: transportState.app_server?.thread_id,
          turn_id: transportState.app_server?.turn_id,
          event_cursor: transportState.app_server?.event_cursor,
          transport_state_path: transportStatePath,
          response_path: responsePath,
          target_file_path: targetFilePath
        },
        null,
        2
      ) + "\n",
      "utf8"
    );

    console.log(`Validated real App Server smoke in ${tempRoot}.`);
  } finally {
    if (process.env.HARNESS_KEEP_REAL_SMOKE_ARTIFACTS !== "1") {
      await cleanupTempRoot(tempRoot);
    }
  }
};

main().catch((error) => {
  console.error("App Server real smoke failed.");
  console.error(error);
  process.exitCode = 1;
});
