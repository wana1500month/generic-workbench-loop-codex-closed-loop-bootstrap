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

  process.env.HARNESS_APP_SERVER_BIN = process.execPath;
  process.env.HARNESS_APP_SERVER_BIN_ARGS = JSON.stringify([fakeAppServerPath]);

  try {
    const runDirectory = join(tempRoot, "run");
    const runtimeDirectory = join(runDirectory, "runtime");
    const targetRoot = join(tempRoot, "target-root");
    const transportStatePath = join(runtimeDirectory, "transport-state.json");
    const summaryPath = join(runDirectory, "summary.json");
    const responsePath = join(runtimeDirectory, "attached-generator-response.json");
    const targetFilePath = join(targetRoot, "attached-generator.txt");

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
      initialRound: 1,
      initialPhase: "pre_verification",
      initialStatus: "in_progress",
      initialNotes: ["App Server generator mainline validation."]
    });

    try {
      const result = await controller.runTask({
        round: 1,
        phase: "pre_verification",
        taskLabel: "attached generator",
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

    const [responseArtifact, targetFileContents] = await Promise.all([
      JSON.parse(await readFile(responsePath, "utf8")),
      readFile(targetFilePath, "utf8")
    ]);

    assert(
      responseArtifact.status === "applied",
      "Expected attached generator response artifact to report applied status."
    );
    assert(
      targetFileContents.trim() === "attached generator validation",
      "Expected attached generator mainline to mutate the target file."
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
    await cleanupTempRoot(tempRoot);
  }
};

main().catch((error) => {
  console.error("App Server attached generator mainline validation failed.");
  console.error(error);
  process.exitCode = 1;
});
