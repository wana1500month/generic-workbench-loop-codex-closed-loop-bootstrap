import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  cleanupTempRoot,
  createTempRoot,
  ensureBuild,
  importDist
} from "./testing/bootstrap-validator-helpers.mjs";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const main = async () => {
  await ensureBuild();

  const { startAppServerTransport } = await importDist("app-server-runtime.js");
  const { writeTransportProtocol } = await importDist("transport-protocol.js");

  const tempRoot = await createTempRoot("validate-app-server-generator-mainline");
  const fakeAppServerPath = join(process.cwd(), "scripts", "testing", "fake-app-server.mjs");
  const previousBin = process.env.HARNESS_APP_SERVER_BIN;
  const previousArgs = process.env.HARNESS_APP_SERVER_BIN_ARGS;
  const previousRecordPath = process.env.FAKE_APP_SERVER_RECORD_PATH;

  process.env.HARNESS_APP_SERVER_BIN = process.execPath;
  process.env.HARNESS_APP_SERVER_BIN_ARGS = JSON.stringify([fakeAppServerPath]);

  try {
    const runDirectory = join(tempRoot, "run");
    const runtimeDirectory = join(runDirectory, "runtime");
    const targetRoot = join(tempRoot, "target-root");
    const transportStatePath = join(runtimeDirectory, "transport-state.json");
    const summaryPath = join(runDirectory, "summary.json");
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
    const responsePath = join(runtimeDirectory, "attached-generator-response.json");
    const targetFilePath = join(targetRoot, "attached-generator.txt");
    const recordPath = join(runtimeDirectory, "fake-app-server-record.json");
    process.env.FAKE_APP_SERVER_RECORD_PATH = recordPath;

    await Promise.all([
      mkdir(runtimeDirectory, { recursive: true }),
      mkdir(targetRoot, { recursive: true })
    ]);

    const protocolPath = await writeTransportProtocol({
      runDirectory,
      transportMode: "app-server",
      summary: {
        run_id: "validate-app-server-generator-mainline",
        controller_mode: "attached",
        transport_mode: "app-server",
        transport_state_path: transportStatePath,
        resume_identity_path: join(runDirectory, "resume-identity.json"),
        runtime_round_phase_path: join(runtimeDirectory, "round-phase.json")
      },
      activeRound: 1,
      activePhase: "pre_verification",
      activeStatus: "in_progress",
      notes: ["App Server generator mainline validation."]
    });

    const controller = await startAppServerTransport({
      runId: "validate-app-server-generator-mainline",
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
      initialNotes: ["App Server generator mainline validation."],
      threadName: "validate-app-server-generator-mainline · attached-loop",
      defaultTaskTimeoutMs: 30_000,
      requestTimeoutMs: 5_000
    });

    try {
      const result = await controller.runTask({
        round: 1,
        phase: "pre_verification",
        taskLabel: "attached generator",
        taskCwd: targetRoot,
        writableRoots: [targetRoot, runDirectory],
        networkAccess: false,
        prompt: [
          "Perform attached generator work on the live App Server turn.",
          `ATTACHED_GENERATOR_RESPONSE_PATH: ${responsePath}`,
          `ATTACHED_GENERATOR_SIMULATED_FILE: ${targetFilePath}`,
          "ATTACHED_GENERATOR_SIMULATED_CONTENT: attached generator validation",
          "",
          "Write the simulated file and complete the task."
        ].join("\n")
      });
      assert(
        result.status === "completed",
        `Expected attached generator task status 'completed', received '${result.status}'.`
      );
    } finally {
      await controller.stop({
        stopReason: "contract_completed",
        notes: ["App Server generator mainline validation complete."]
      });
    }

    const [responseArtifact, targetFileContents, fakeRecord] = await Promise.all([
      JSON.parse(await readFile(responsePath, "utf8")),
      readFile(targetFilePath, "utf8"),
      JSON.parse(await readFile(recordPath, "utf8"))
    ]);

    assert(
      responseArtifact.status === "applied",
      "Expected attached generator response artifact to report applied status."
    );
    assert(
      targetFileContents.trim() === "attached generator validation",
      "Expected attached generator mainline to mutate the target file."
    );
    const incomingRequests = fakeRecord
      .filter((entry) => entry.direction === "in")
      .map((entry) => entry.message);
    const generatorTurn = incomingRequests.find(
      (message) =>
        message.method === "turn/start" &&
        message.params?.sandboxPolicy?.type === "workspaceWrite"
    );
    assert(generatorTurn, "Expected a workspaceWrite turn/start request for the attached generator task.");
    assert(
      generatorTurn.params?.approvalPolicy === "never",
      `Expected attached generator task approvalPolicy 'never', received '${generatorTurn.params?.approvalPolicy ?? "missing"}'.`
    );
    const statusTurn = incomingRequests.find(
      (message) =>
        message.method === "turn/start" &&
        message.params?.sandboxPolicy?.type === "readOnly"
    );
    assert(statusTurn, "Expected a readOnly status turn before the attached generator task.");
    assert(
      statusTurn.params?.approvalPolicy === "never",
      `Expected status turn approvalPolicy 'never', received '${statusTurn.params?.approvalPolicy ?? "missing"}'.`
    );

    console.log("Validated App Server attached generator mainline.");
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
    if (previousRecordPath === undefined) {
      delete process.env.FAKE_APP_SERVER_RECORD_PATH;
    } else {
      process.env.FAKE_APP_SERVER_RECORD_PATH = previousRecordPath;
    }
    await cleanupTempRoot(tempRoot);
  }
};

main().catch((error) => {
  console.error("App Server attached generator mainline validation failed.");
  console.error(error);
  process.exitCode = 1;
});
