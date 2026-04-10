import { readdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

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

const configureSemanticBootstrapAdapter = async (fixture) => {
  const adapterContract = await readJsonFile(fixture.paths.adapterPath);
  const semanticExecutorPath = join(
    process.cwd(),
    ".tmp",
    "semantic-validation",
    "executor.cjs"
  );
  const semanticVerifierPath = join(
    process.cwd(),
    ".tmp",
    "semantic-validation",
    "verifier.cjs"
  );

  adapterContract.target_root = relative(fixture.workspaceRoot, fixture.targetRoot);
  adapterContract.capabilities.prepare_target.command =
    `node "${semanticExecutorPath}" patch-only-success`;
  adapterContract.capabilities.run_target.command =
    `node "${semanticExecutorPath}" patch-only-success`;
  adapterContract.verification_provider.capabilities.capture_evidence.command =
    `node "${semanticVerifierPath}" patch-only-success`;
  adapterContract.verification_provider.capabilities.run_checks.command =
    `node "${semanticVerifierPath}" patch-only-success`;
  adapterContract.verification_provider.capabilities.grade_round.command =
    `node "${semanticVerifierPath}" patch-only-success`;

  await writeFile(
    fixture.paths.adapterPath,
    JSON.stringify(adapterContract, null, 2) + "\n",
    "utf8"
  );
};

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-app-server-interrupted-generator");

  try {
    const fixture = await createBootstrapFixture(tempRoot, {
      targetFamily: "api-service",
      frameworkHint: "Node.js API",
      runCommand: "npm run start",
      readyUrl: "http://127.0.0.1:3000/health",
      appUrl: undefined,
      healthUrl: "http://127.0.0.1:3000/health",
      apiBaseUrl: "http://127.0.0.1:3000/api"
    });
    await configureSemanticBootstrapAdapter(fixture);
    const fakeAppServerPath = join(process.cwd(), "scripts", "testing", "fake-app-server.mjs");
    const fakeAppServerStatePath = join(tempRoot, "fake-app-server-state.json");
    const apiServiceProfilePath = join(
      process.cwd(),
      "evals",
      "verification-profiles",
      "api-service.profile.json"
    );
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
        apiServiceProfilePath,
        "--target-family",
        "api-service"
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
      interruptedTransportState.status === "closed",
      `Expected interrupted generator transport status 'closed', received '${interruptedTransportState.status ?? "missing"}'.`
    );
    assert(
      interruptedTransportState.app_server?.thread_lifecycle === "closed",
      `Expected interrupted generator thread_lifecycle 'closed', received '${interruptedTransportState.app_server?.thread_lifecycle ?? "missing"}'.`
    );
    assert(
      interruptedTransportState.app_server?.turn_status === "interrupted",
      `Expected interrupted generator turn_status 'interrupted', received '${interruptedTransportState.app_server?.turn_status ?? "missing"}'.`
    );
    assert(
      interruptedTransportState.app_server?.last_request_method === "thread/unsubscribe",
      `Expected interrupted generator cleanup to unsubscribe the App Server thread, received '${interruptedTransportState.app_server?.last_request_method ?? "missing"}'.`
    );
    await Promise.all([
      rm(join(runDirectory, "planned-scenario.json"), { force: true }),
      rm(join(runDirectory, "plan.json"), { force: true })
    ]);

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
        apiServiceProfilePath,
        "--target-family",
        "api-service"
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

    const [summary, attachedGeneratorResponse, resumedTransportState, resumedScenario, resumedPlan] = await Promise.all([
      readJsonFile(join(runDirectory, "summary.json")),
      readJsonFile(
        join(runDirectory, "round-001", "runtime", "attached-generator-response.json")
      ),
      readJsonFile(join(runDirectory, "runtime", "transport-state.json")),
      readJsonFile(join(runDirectory, "planned-scenario.json")),
      readJsonFile(join(runDirectory, "plan.json"))
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
    assert(
      (summary.runtime_warnings ?? []).some((warning) =>
        warning.includes("incomplete planning initialization")
      ),
      "Expected resumed summary to record partial-init rebuild warning."
    );
    assert(
      typeof resumedScenario.scenario_id === "string" && resumedScenario.scenario_id.length > 0,
      "Expected resumed App Server run to recreate planned-scenario.json."
    );
    assert(
      typeof resumedPlan.attempt_strategy === "string" && resumedPlan.attempt_strategy.length > 0,
      "Expected resumed App Server run to recreate plan.json."
    );

    console.log("Validated App Server interrupted generator repair.");
  } finally {
    await cleanupTempRoot(tempRoot).catch((error) => {
      if (error?.code === "EBUSY" || error?.code === "EPERM") {
        console.warn(
          `[validate-app-server-interrupted-generator] cleanup skipped: ${error.code}`
        );
        return;
      }
      throw error;
    });
  }
};

main().catch((error) => {
  console.error("App Server interrupted generator validation failed.");
  console.error(error);
  process.exitCode = 1;
});
