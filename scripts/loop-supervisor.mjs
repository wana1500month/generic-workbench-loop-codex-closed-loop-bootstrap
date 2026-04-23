import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runCommand, runPinnedTypeScriptBuild } from "./lib/front-door-build.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distCliPath = join(repoRoot, "packages", "loop-orchestrator", "dist", "cli.js");
const runtimeHealthPath = join(
  repoRoot,
  "packages",
  "loop-orchestrator",
  "dist",
  "runtime-health.js"
);
const npmExecutable = "npm";
const runnerCliImport =
  "process.argv=[process.argv[0],'./packages/loop-orchestrator/dist/cli.js',...process.argv.slice(1)]; await import('./packages/loop-orchestrator/dist/cli.js')";

const parsePositiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const pathForRunState = (runDirectory) =>
  join(runDirectory, "runtime", "supervisor-state.json");
const runsDirectory = join(repoRoot, "evals", "runs");
const supervisorPollMs = 5_000;

let runtimeHealthModule;

const readJsonIfExists = async (path) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
};

const listRunDirectories = async () => {
  try {
    const entries = await readdir(runsDirectory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /^run-\d+$/.test(entry.name))
      .map((entry) => join(runsDirectory, entry.name))
      .sort();
  } catch {
    return [];
  }
};

const discoverNewRunDirectory = async (knownRunDirectories) => {
  const known = new Set(knownRunDirectories);
  const createdRuns = (await listRunDirectories()).filter(
    (runDirectory) => !known.has(runDirectory)
  );
  return createdRuns.at(-1);
};

const writeJsonFile = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
};

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

const runBuild = async () => {
  const primaryExitCode = await runCommand(repoRoot, npmExecutable, ["run", "build", "--silent"], {
    shell: process.platform === "win32"
  });
  if (primaryExitCode === 0) {
    return 0;
  }

  return runPinnedTypeScriptBuild(repoRoot, ["--force"]);
};

const loadRuntimeHealthModule = async () =>
  import(pathToFileURL(runtimeHealthPath).href);

const findOptionValue = (args, option) => {
  const index = args.indexOf(option);
  if (index >= 0 && typeof args[index + 1] === "string") {
    return args[index + 1];
  }
  return undefined;
};

const removeOption = (args, option) => {
  const nextArgs = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === option) {
      if (args[index + 1] && !args[index + 1].startsWith("--")) {
        index += 1;
      }
      continue;
    }
    nextArgs.push(args[index]);
  }
  return nextArgs;
};

const ensureResumeArgs = (controllerArgs, runDirectory) => {
  const nextArgs = removeOption(controllerArgs, "--resume-run").filter(
    (value) => value !== "--repair"
  );
  return [...nextArgs, "--resume-run", runDirectory];
};

const parseSupervisorArgs = (argv) => {
  let detach = false;
  let supervisorRun = false;
  let maxRestarts = 3;
  let restartDelayMs = 1_000;
  let logPath;
  let noSupervisor = false;
  const controllerArgs = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--detach") {
      detach = true;
      continue;
    }
    if (value === "--supervisor-run") {
      supervisorRun = true;
      continue;
    }
    if (value === "--max-restarts") {
      maxRestarts = parsePositiveNumber(argv[index + 1], maxRestarts);
      index += 1;
      continue;
    }
    if (value === "--restart-delay-ms") {
      restartDelayMs = parsePositiveNumber(argv[index + 1], restartDelayMs);
      index += 1;
      continue;
    }
    if (value === "--log-path") {
      logPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--no-supervisor") {
      noSupervisor = true;
      continue;
    }
    controllerArgs.push(value);
  }

  return {
    detach,
    supervisorRun,
    maxRestarts,
    restartDelayMs,
    logPath,
    noSupervisor,
    controllerArgs
  };
};

const spawnController = ({ controllerArgs, onRunDirectory, env }) => {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", runnerCliImport, "--", ...controllerArgs],
    {
      cwd: repoRoot,
      env,
      shell: false,
      windowsHide: true
    }
  );

  let stdout = "";
  let stderr = "";
  let stdoutBuffer = "";

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    stdout += text;
    process.stdout.write(text);
    stdoutBuffer += text;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const match = line.match(/^Run created:\s+(.+)$/);
      if (match) {
        onRunDirectory(resolve(repoRoot, match[1].trim()));
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderr += text;
    process.stderr.write(text);
  });

  const completion = new Promise((resolvePromise, rejectPromise) => {
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({
        code: code ?? 1,
        stdout,
        stderr,
        pid: child.pid
      });
    });
  });

  return { child, completion };
};

const readRuntimeHealth = async (runDirectory) => {
  const runtimeDirectory = join(runDirectory, "runtime");
  const [liveState, roundPhase, controllerLease, transportState] = await Promise.all([
    readJsonIfExists(join(runtimeDirectory, "live-state.json")),
    readJsonIfExists(join(runtimeDirectory, "round-phase.json")),
    readJsonIfExists(join(runtimeDirectory, "controller-lease.json")),
    readJsonIfExists(join(runtimeDirectory, "transport-state.json"))
  ]);

  const health = runtimeHealthModule.assessRuntimeHealth({
    liveState,
    roundPhase,
    controllerLease,
    transportState
  });

  return {
    liveState,
    roundPhase,
    controllerLease,
    transportState,
    health
  };
};

const waitForChildClose = (child) =>
  new Promise((resolvePromise) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolvePromise();
      return;
    }
    child.once("close", () => resolvePromise());
  });

const terminateController = async (child) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill();
  const gracefulExit = await Promise.race([
    waitForChildClose(child).then(() => true),
    sleep(2_000).then(() => false)
  ]);
  if (gracefulExit || !child.pid || process.platform !== "win32") {
    return;
  }

  await runCommand(repoRoot, "taskkill", ["/PID", String(child.pid), "/T", "/F"], {
    shell: false
  }).catch(() => 1);
  await waitForChildClose(child);
};

const runSupervisor = async (options) => {
  const controllerMode = findOptionValue(options.controllerArgs, "--controller-mode");
  const transportMode = findOptionValue(options.controllerArgs, "--transport");
  const supervisorSessionId = `supervisor-${process.pid}-${Date.now()}`;
  const discoveryMarkerPath = join(
    repoRoot,
    ".tmp",
    `${supervisorSessionId}.run.json`
  );
  let runDirectory = (() => {
    const configuredRun = findOptionValue(options.controllerArgs, "--resume-run");
    return configuredRun ? resolve(repoRoot, configuredRun) : undefined;
  })();
  let restartCount = 0;
  let lastExitCode;
  await writeJsonFile(discoveryMarkerPath, {
    supervisor_session_id: supervisorSessionId,
    created_at: new Date().toISOString()
  });

  const writeState = async (input) => {
    if (!runDirectory) {
      return;
    }
    const summary = await readJsonIfExists(join(runDirectory, "summary.json"));
    await writeJsonFile(pathForRunState(runDirectory), {
      status: input.status,
      launched_at: input.launchedAt,
      updated_at: new Date().toISOString(),
      owner_pid: process.pid,
      controller_mode: controllerMode,
      transport_mode: transportMode,
      run_id: summary?.run_id,
      run_directory: runDirectory,
      resume_run_path: runDirectory,
      child_pid: input.childPid,
      restart_count: restartCount,
      max_restarts: options.maxRestarts,
      last_exit_code: lastExitCode,
      ...(input.executionState ? { execution_state: input.executionState } : {}),
      ...(input.heartbeatAgeMs !== undefined
        ? { heartbeat_age_ms: input.heartbeatAgeMs }
        : {}),
      ...(input.progressAgeMs !== undefined
        ? { progress_age_ms: input.progressAgeMs }
        : {}),
      ...(input.lastError ? { last_error: input.lastError } : {}),
      ...(options.logPath ? { log_path: options.logPath } : {}),
      ...(summary?.stop_reason ? { stop_reason: summary.stop_reason } : {}),
      ...(summary?.summary_path ? { summary_path: summary.summary_path } : {})
    });
  };

  const launchedAt = new Date().toISOString();
  while (true) {
    const previousKnownRunDirectory = runDirectory;
    const runDirectoriesBeforeStart =
      restartCount === 0 && !runDirectory ? await listRunDirectories() : [];
    const childArgs =
      restartCount === 0 || !runDirectory
        ? options.controllerArgs
        : ensureResumeArgs(options.controllerArgs, runDirectory);
    const childEnv = {
      ...process.env,
      HARNESS_RUN_DISCOVERY_MARKER: discoveryMarkerPath,
      HARNESS_SUPERVISOR_SESSION_ID: supervisorSessionId
    };
    const controller = spawnController({
      controllerArgs: childArgs,
      env: childEnv,
      onRunDirectory: (nextRunDirectory) => {
        runDirectory = nextRunDirectory;
      }
    });
    let restartReason;
    let execution;

    await writeState({
      status: "launching",
      launchedAt,
      childPid: controller.child.pid
    });

    while (true) {
      const outcome = await Promise.race([
        controller.completion.then((result) => ({ kind: "completion", result })),
        sleep(supervisorPollMs).then(() => ({ kind: "poll" }))
      ]);

      if (outcome.kind === "completion") {
        execution = outcome.result;
        break;
      }

      if (!runDirectory) {
        continue;
      }

      const runtime = await readRuntimeHealth(runDirectory);
      await writeState({
        status: "watching",
        launchedAt,
        childPid: controller.child.pid,
        executionState: runtime.health.execution_state,
        heartbeatAgeMs: runtime.health.heartbeat_age_ms,
        progressAgeMs: runtime.health.progress_age_ms
      });

      if (!runtime.health.should_restart) {
        continue;
      }

      restartReason = `Supervisor detected ${runtime.health.execution_state}: ${runtime.health.summary}`;
      await writeState({
        status: "restarting",
        launchedAt,
        childPid: controller.child.pid,
        executionState: runtime.health.execution_state,
        heartbeatAgeMs: runtime.health.heartbeat_age_ms,
        progressAgeMs: runtime.health.progress_age_ms,
        lastError: restartReason
      });
      await terminateController(controller.child);
    }

    lastExitCode = execution.code;
    if (!runDirectory) {
      const discoveryMarker = await readJsonIfExists(discoveryMarkerPath);
      const markerRunDirectory =
        typeof discoveryMarker?.run_directory === "string"
          ? resolve(repoRoot, discoveryMarker.run_directory)
          : undefined;
      if (markerRunDirectory) {
        runDirectory = markerRunDirectory;
      }
    }
    if (!runDirectory) {
      const createdRunDirectory = await discoverNewRunDirectory(
        runDirectoriesBeforeStart
      );
      if (
        createdRunDirectory &&
        createdRunDirectory !== previousKnownRunDirectory
      ) {
        runDirectory = createdRunDirectory;
      }
    }

    const summary =
      runDirectory &&
      (await readJsonIfExists(join(runDirectory, "summary.json")));
    const terminal = Boolean(summary?.stop_reason);

    if (terminal) {
      await writeState({
        status: runtimeHealthModule.pausedStopReasons.has(summary.stop_reason)
          ? "paused"
          : "completed",
        launchedAt,
        childPid: execution.pid
      });
      return 0;
    }

    if (!runDirectory || restartCount >= options.maxRestarts) {
      await writeState({
        status: "failed",
        launchedAt,
        childPid: execution.pid,
        lastError:
          !runDirectory
            ? "Controller exited before a run directory was recorded."
            : restartReason
              ? `Restart budget exhausted after '${restartReason}'.`
              : `Restart budget exhausted after exit code ${execution.code}.`
      });
      return execution.code === 0 ? 1 : execution.code;
    }

    restartCount += 1;
    await writeState({
      status: "restarting",
      launchedAt,
      childPid: execution.pid,
      lastError: restartReason ??
        `Controller exited with code ${execution.code}; supervisor will resume the run.`
    });
    await sleep(options.restartDelayMs);
  }
};

const main = async () => {
  const options = parseSupervisorArgs(process.argv.slice(2));

  if (options.detach && !options.supervisorRun) {
    const detachedLogPath =
      options.logPath ??
      join(
        repoRoot,
        ".tmp",
        `loop-supervisor-${Date.now()}.log`
      );
    await mkdir(dirname(detachedLogPath), { recursive: true });
    const logFd = openSync(detachedLogPath, "a");
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(import.meta.url),
        "--supervisor-run",
        "--log-path",
        detachedLogPath,
        "--max-restarts",
        String(options.maxRestarts),
        "--restart-delay-ms",
        String(options.restartDelayMs),
        ...options.controllerArgs
      ],
      {
        cwd: repoRoot,
        env: process.env,
        detached: true,
        stdio: ["ignore", logFd, logFd],
        windowsHide: true
      }
    );
    child.unref();
    console.log(`Detached loop supervisor started with pid ${child.pid}.`);
    console.log(`Supervisor log: ${detachedLogPath}`);
    return;
  }

  const buildExitCode = await runBuild();
  if (buildExitCode !== 0) {
    process.exitCode = buildExitCode;
    return;
  }
  runtimeHealthModule = await loadRuntimeHealthModule();

  if (options.noSupervisor) {
    const controller = spawnController({
      controllerArgs: options.controllerArgs,
      env: process.env,
      onRunDirectory: () => {}
    });
    const execution = await controller.completion;
    process.exitCode = execution.code;
    return;
  }

  const exitCode = await runSupervisor(options);
  process.exitCode = exitCode;
};

main().catch((error) => {
  console.error("Loop supervisor failed.");
  console.error(error);
  process.exitCode = 1;
});
