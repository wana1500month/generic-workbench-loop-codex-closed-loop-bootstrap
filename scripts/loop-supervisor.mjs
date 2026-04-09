import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distCliPath = join(repoRoot, "packages", "loop-orchestrator", "dist", "cli.js");
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

const readJsonIfExists = async (path) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
};

const discoverNewestRunDirectory = async () => {
  try {
    const entries = await readdir(runsDirectory, { withFileTypes: true });
    const runIds = entries
      .filter((entry) => entry.isDirectory() && /^run-\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    const newest = runIds[runIds.length - 1];
    return newest ? join(runsDirectory, newest) : undefined;
  } catch {
    return undefined;
  }
};

const writeJsonFile = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
};

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

const runCommand = async (command, args, options = {}) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: process.env,
      shell: options.shell ?? process.platform === "win32"
    });
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise(code ?? 1);
    });
  });

const runBuild = async () => {
  const primaryExitCode = await runCommand(npmExecutable, ["run", "build", "--silent"]);
  if (primaryExitCode === 0) {
    return 0;
  }

  return runCommand(
    "npx",
    ["-p", "typescript@5.8.3", "tsc", "-b", "--force", "--pretty", "false"]
  );
};

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
    controllerArgs.push(value);
  }

  return {
    detach,
    supervisorRun,
    maxRestarts,
    restartDelayMs,
    logPath,
    controllerArgs
  };
};

const spawnController = ({ controllerArgs, onRunDirectory }) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", runnerCliImport, "--", ...controllerArgs],
      {
        cwd: repoRoot,
        env: process.env,
        shell: false
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

const runSupervisor = async (options) => {
  const controllerMode = findOptionValue(options.controllerArgs, "--controller-mode");
  const transportMode = findOptionValue(options.controllerArgs, "--transport");
  let runDirectory = (() => {
    const configuredRun = findOptionValue(options.controllerArgs, "--resume-run");
    return configuredRun ? resolve(repoRoot, configuredRun) : undefined;
  })();
  let restartCount = 0;
  let lastExitCode;

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
      ...(input.lastError ? { last_error: input.lastError } : {}),
      ...(options.logPath ? { log_path: options.logPath } : {}),
      ...(summary?.stop_reason ? { stop_reason: summary.stop_reason } : {}),
      ...(summary?.summary_path ? { summary_path: summary.summary_path } : {})
    });
  };

  const launchedAt = new Date().toISOString();
  while (true) {
    const previousKnownRunDirectory = runDirectory;
    const newestRunBeforeStart =
      restartCount === 0 && !runDirectory
        ? await discoverNewestRunDirectory()
        : undefined;
    const childArgs =
      restartCount === 0 || !runDirectory
        ? options.controllerArgs
        : ensureResumeArgs(options.controllerArgs, runDirectory);
    const execution = await spawnController({
      controllerArgs: childArgs,
      onRunDirectory: (nextRunDirectory) => {
        runDirectory = nextRunDirectory;
      }
    });
    lastExitCode = execution.code;
    if (!runDirectory) {
      const newestRunAfterExit = await discoverNewestRunDirectory();
      if (
        newestRunAfterExit &&
        newestRunAfterExit !== newestRunBeforeStart &&
        newestRunAfterExit !== previousKnownRunDirectory
      ) {
        runDirectory = newestRunAfterExit;
      }
    }

    const summary =
      runDirectory &&
      (await readJsonIfExists(join(runDirectory, "summary.json")));
    const terminal = Boolean(summary?.stop_reason);

    if (terminal) {
      await writeState({
        status: "completed",
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
            : `Restart budget exhausted after exit code ${execution.code}.`
      });
      return execution.code === 0 ? 1 : execution.code;
    }

    restartCount += 1;
    await writeState({
      status: "restarting",
      launchedAt,
      childPid: execution.pid,
      lastError: `Controller exited with code ${execution.code}; supervisor will resume the run.`
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
        stdio: ["ignore", logFd, logFd]
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

  const exitCode = await runSupervisor(options);
  process.exitCode = exitCode;
};

main().catch((error) => {
  console.error("Loop supervisor failed.");
  console.error(error);
  process.exitCode = 1;
});
