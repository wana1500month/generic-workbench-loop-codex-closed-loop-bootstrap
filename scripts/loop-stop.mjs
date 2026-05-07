import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { stopProcessTree } from "./process-tree.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runsRoot = join(repoRoot, "evals", "runs");

const readJsonIfExists = async (path) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
};

const writeJson = async (path, value) =>
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");

const usage = () => {
  console.error("Usage: node ./scripts/loop-stop.mjs --run-dir <run-dir> [--json]");
  console.error("   or: node ./scripts/loop-stop.mjs --all [--json]");
};

const parseArgs = (argv) => {
  let runDirectory;
  let stopAll = false;
  let json = false;
  const errors = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--run-dir") {
      runDirectory = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--all") {
      stopAll = true;
      continue;
    }
    if (value === "--json") {
      json = true;
      continue;
    }
    errors.push(`Unknown option: ${value}`);
  }

  if (!stopAll && !runDirectory) {
    errors.push("loop:stop requires --run-dir <run-dir> or --all.");
  }
  if (stopAll && runDirectory) {
    errors.push("Choose either --run-dir or --all, not both.");
  }

  return {
    runDirectory,
    stopAll,
    json,
    errors
  };
};

const listRunDirectories = async () => {
  try {
    const entries = await readdir(runsRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /^run-\d+$/.test(entry.name))
      .map((entry) => join(runsRoot, entry.name));
  } catch {
    return [];
  }
};

const stopRun = async (runDirectory) => {
  const resolvedRunDirectory = resolve(repoRoot, runDirectory);
  const runtimeDirectory = join(resolvedRunDirectory, "runtime");
  const summaryPath = join(resolvedRunDirectory, "summary.json");
  const controllerLeasePath = join(runtimeDirectory, "controller-lease.json");
  const transportStatePath = join(runtimeDirectory, "transport-state.json");
  const supervisorStatePath = join(runtimeDirectory, "supervisor-state.json");

  const [summary, controllerLease, transportState, supervisorState] = await Promise.all([
    readJsonIfExists(summaryPath),
    readJsonIfExists(controllerLeasePath),
    readJsonIfExists(transportStatePath),
    readJsonIfExists(supervisorStatePath)
  ]);

  const candidatePids = [
    supervisorState?.child_pid,
    supervisorState?.owner_pid,
    controllerLease?.owner_pid,
    transportState?.app_server?.server_pid
  ]
    .filter((pid) => typeof pid === "number" && Number.isFinite(pid) && pid > 0)
    .filter((pid, index, values) => values.indexOf(pid) === index);

  const stoppedPids = [];
  for (const pid of candidatePids) {
    if (await stopProcessTree(pid)) {
      stoppedPids.push(pid);
    }
  }

  if (supervisorState) {
    await writeJson(supervisorStatePath, {
      ...supervisorState,
      status: "paused",
      updated_at: new Date().toISOString(),
      last_error: "Stopped by operator via loop:stop."
    });
  }

  return {
    run_directory: resolvedRunDirectory,
    run_id: summary?.run_id ?? supervisorState?.run_id ?? controllerLease?.run_id ?? null,
    stopped_pids: stoppedPids,
    notes:
      stoppedPids.length > 0
        ? [`Stopped ${stoppedPids.length} process tree(s).`]
        : ["No live controller or supervisor pid was recorded for this run."]
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.errors.length > 0) {
    console.error(args.errors.join("\n"));
    usage();
    process.exitCode = 1;
    return;
  }

  const runDirectories = args.stopAll
    ? await listRunDirectories()
    : [resolve(repoRoot, args.runDirectory)];
  const results = await Promise.all(runDirectories.map((runDirectory) => stopRun(runDirectory)));

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  for (const result of results) {
    console.log(`Run: ${result.run_directory}`);
    console.log(`Run id: ${result.run_id ?? "unknown"}`);
    console.log(
      result.stopped_pids.length > 0
        ? `Stopped pids: ${result.stopped_pids.join(", ")}`
        : "Stopped pids: none"
    );
    for (const note of result.notes) {
      console.log(`- ${note}`);
    }
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
