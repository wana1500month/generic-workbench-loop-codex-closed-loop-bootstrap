import { readdir } from "node:fs/promises";
import { join } from "node:path";

import {
  cleanupTempRoot,
  createBootstrapFixture,
  createTempRoot,
  ensureBuild,
  readJsonFile,
  repoRoot
} from "./testing/bootstrap-validator-helpers.mjs";
import { runLoop } from "./validation-utils.mjs";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const listRunDirectories = async () => {
  const runsDirectory = join(repoRoot, "evals", "runs");
  const entries = await readdir(runsDirectory, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && /^run-\d+$/.test(entry.name))
    .map((entry) => join(runsDirectory, entry.name))
    .sort();
};

const discoverNewRunDirectory = async (knownRunDirectories) => {
  const known = new Set(knownRunDirectories);
  const createdRunDirectory = (await listRunDirectories())
    .filter((runDirectory) => !known.has(runDirectory))
    .at(-1);
  if (!createdRunDirectory) {
    throw new Error("No run directory was created for interrupted generator validation.");
  }
  return createdRunDirectory;
};

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-app-server-interrupted-generator");

  try {
    const fixture = await createBootstrapFixture(tempRoot);
    const fakeAppServerPath = join(process.cwd(), "scripts", "testing", "fake-app-server.mjs");
    const fakeAppServerStatePath = join(tempRoot, "fake-app-server-state.json");
    const runDirectoriesBeforeFirstAttempt = await listRunDirectories();

    const firstRun = await runLoop(
      [
        "--single",
        "--controller-mode",
        "attached",
        "--transport",
        "app-server",
        "--app-server-task-timeout-ms",
        "200",
        "--adapter",
        fixture.paths.adapterPath,
        "--rubric",
        fixture.paths.generatedRubricPath,
        "--evaluator-profile",
        fixture.paths.generatedVerificationProfilePath,
        "--target-family",
        "browser-app"
      ],
      {
        silent: true,
        env: {
          ...process.env,
          HARNESS_APP_SERVER_BIN: process.execPath,
          HARNESS_APP_SERVER_BIN_ARGS: JSON.stringify([fakeAppServerPath]),
          FAKE_APP_SERVER_STATE_PATH: fakeAppServerStatePath,
          FAKE_APP_SERVER_LEAVE_TURN_ACTIVE: "1"
        }
      }
    );
    assert(firstRun.code !== 0, "Expected first interrupted generator run to fail on timeout.");

    const runDirectory = await discoverNewRunDirectory(
      runDirectoriesBeforeFirstAttempt
    );
    const interruptedTransportState = await readJsonFile(
      join(runDirectory, "runtime", "transport-state.json")
    );
    assert(
      interruptedTransportState.app_server?.thread_runtime_status === "active" ||
        interruptedTransportState.status === "live",
      "Expected interrupted generator transport state to persist an active App Server thread."
    );
    assert(
      interruptedTransportState.app_server?.turn_status === "inProgress",
      `Expected interrupted generator turn_status 'inProgress', received '${interruptedTransportState.app_server?.turn_status ?? "missing"}'.`
    );

    const resumedRun = await runLoop(
      [
        "--single",
        "--resume-run",
        runDirectory,
        "--controller-mode",
        "attached",
        "--transport",
        "app-server",
        "--app-server-task-timeout-ms",
        "5000",
        "--adapter",
        fixture.paths.adapterPath,
        "--rubric",
        fixture.paths.generatedRubricPath,
        "--evaluator-profile",
        fixture.paths.generatedVerificationProfilePath,
        "--target-family",
        "browser-app"
      ],
      {
        silent: true,
        env: {
          ...process.env,
          HARNESS_APP_SERVER_BIN: process.execPath,
          HARNESS_APP_SERVER_BIN_ARGS: JSON.stringify([fakeAppServerPath]),
          FAKE_APP_SERVER_STATE_PATH: fakeAppServerStatePath
        }
      }
    );
    if (resumedRun.code !== 0) {
      throw new Error(
        `App Server interrupted generator resume failed.\n${resumedRun.stdout}\n${resumedRun.stderr}`
      );
    }

    const [summary, attachedGeneratorResponse, resumedTransportState] = await Promise.all([
      readJsonFile(join(runDirectory, "summary.json")),
      readJsonFile(
        join(runDirectory, "round-001", "runtime", "attached-generator-response.json")
      ),
      readJsonFile(join(runDirectory, "runtime", "transport-state.json"))
    ]);

    assert(
      attachedGeneratorResponse.status === "applied",
      "Expected resumed App Server generator to write an applied response artifact."
    );
    assert(
      summary.transport_mode === "app-server",
      `Expected resumed summary transport_mode 'app-server', received '${summary.transport_mode ?? "missing"}'.`
    );
    assert(
      resumedTransportState.app_server?.thread_lifecycle === "closed",
      `Expected resumed App Server lifecycle 'closed', received '${resumedTransportState.app_server?.thread_lifecycle ?? "missing"}'.`
    );
    assert(
      (summary.runtime_warnings ?? []).some((warning) =>
        warning.includes("App Server attached generator completed")
      ),
      "Expected resumed summary to record attached generator completion warning."
    );

    console.log("Validated App Server interrupted generator repair.");
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

main().catch((error) => {
  console.error("App Server interrupted generator validation failed.");
  console.error(error);
  process.exitCode = 1;
});
