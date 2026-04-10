import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  cleanupTempRoot,
  createTempRoot,
  ensureBuild,
  importDist,
  readJsonFile
} from "./testing/bootstrap-validator-helpers.mjs";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const expectedBrowserRunCommand =
  "npm run dev -- --host 127.0.0.1 --port 3000 --strictPort";

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-bootstrap-runtime-process-management");

  try {
    const workspaceRoot = join(tempRoot, "workspace");
    const targetRoot = join(tempRoot, "target-app");
    const {
      createBootstrapArtifactPaths,
      defaultRunCommandForBootstrap,
      scaffoldBootstrapArtifacts
    } = await importDist("bootstrap.js");

    assert(
      defaultRunCommandForBootstrap("browser-app", "new") === expectedBrowserRunCommand,
      "browser-app bootstrap should default to a fixed strict-port Vite command"
    );
    assert(
      defaultRunCommandForBootstrap("dashboard", "existing") === expectedBrowserRunCommand,
      "dashboard bootstrap should default to a fixed strict-port Vite command"
    );
    assert(
      defaultRunCommandForBootstrap("fullstack-app", "new") === "npm run dev",
      "fullstack bootstrap should keep the generic dev default"
    );
    assert(
      defaultRunCommandForBootstrap("api-service", "existing") === "npm run start",
      "existing API bootstrap should keep the start command default"
    );

    const paths = createBootstrapArtifactPaths(workspaceRoot);
    await scaffoldBootstrapArtifacts(
      {
        title: "Runtime Process Fixture",
        summary: "A fixture app for validating bootstrap runtime process management.",
        targetUsers: ["operator"],
        coreFeatures: ["boot target"],
        referenceApps: [],
        finishLine: "The harness can reuse an already-running dev server.",
        targetFamily: "browser-app",
        goalLevel: "usable",
        targetScore: 0.9,
        maxRounds: 2,
        targetRoot,
        projectMode: "new",
        frameworkHint: "Vite + React",
        packageManager: "npm",
        runCommand: expectedBrowserRunCommand,
        checkCommand: "npm test",
        readyUrl: "http://127.0.0.1:3000/",
        appUrl: "http://127.0.0.1:3000/",
        constraints: [],
        qualityBar: ["Reuse the existing dev server when it is already healthy."],
        notes: "runtime process management validator"
      },
      paths
    );

    const runtimeConfig = await readJsonFile(paths.generatedRuntimeConfigPath);
    const runtimeHelpers = await readFile(
      join(paths.generatedScriptsRoot, "runtime-helpers.mjs"),
      "utf8"
    );
    const runTarget = await readFile(
      join(paths.generatedScriptsRoot, "run-target.mjs"),
      "utf8"
    );

    assert(
      runtimeConfig.run_command === expectedBrowserRunCommand,
      "runtime-config.json should preserve the strict-port browser run command"
    );
    assert(
      runtimeHelpers.includes('windowsHide: options.windowsHide ?? true'),
      "runtime helpers should hide spawned windows by default"
    );
    assert(
      runtimeHelpers.includes('const stdoutFd = openSync(logPath, "a");') &&
        runtimeHelpers.includes('const stderrFd = openSync(logPath, "a");'),
      "runtime helpers should write detached output directly to log files"
    );
    assert(
      runtimeHelpers.includes('export const isProcessAlive = (pid) =>'),
      "runtime helpers should expose process liveness checks"
    );
    assert(
      runtimeHelpers.includes('export const stopProcessTree = async (pid) =>') &&
        runtimeHelpers.includes('spawn("taskkill", ["/PID", String(pid), "/T", "/F"]'),
      "runtime helpers should stop Windows process trees with taskkill"
    );
    assert(
      !runtimeHelpers.includes("createWriteStream"),
      "runtime helpers should no longer keep detached logs alive through parent-side streams"
    );
    assert(
      runTarget.includes('const existingProbe = await waitForUrl(config.ready_url, 1500);'),
      "run_target should probe for an existing ready target before restarting it"
    );
    assert(
      runTarget.includes('await stopProcessTree(previousPid);'),
      "run_target should kill the previous tracked process tree before restart"
    );
    assert(
      runTarget.includes('summary: "Reused existing target at " + config.ready_url + "."') &&
        runTarget.includes("adopted_existing_server: !trackedProcessAlive"),
      "run_target should record explicit reuse metadata when it adopts or reuses a live target"
    );
    assert(
      runTarget.includes('...(config.run_command ? ["artifacts/run-target.log"] : [])'),
      "run_target should only claim a run-target log when it actually started the command"
    );

    console.log("Validated bootstrap runtime process management.");
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
