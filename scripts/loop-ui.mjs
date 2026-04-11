import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runsDirectory = join(repoRoot, "evals", "runs");
const runtimeHealthPath = join(
  repoRoot,
  "packages",
  "loop-orchestrator",
  "dist",
  "runtime-health.js"
);

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

const readJsonIfExists = async (path) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
};

const readTailLines = async (path, count) => {
  try {
    const text = await readFile(path, "utf8");
    return text
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-count);
  } catch {
    return [];
  }
};

const runBuild = async () =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("npm", ["run", "build", "--silent"], {
      cwd: repoRoot,
      env: process.env,
      shell: process.platform === "win32",
      windowsHide: true
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise(code ?? 1));
  });

let runtimeHealthModule;
const ensureRuntimeHealthModule = async () => {
  if (!existsSync(runtimeHealthPath)) {
    const buildExitCode = await runBuild();
    if (buildExitCode !== 0) {
      throw new Error("Build the repository before using loop-ui.");
    }
  }

  if (!runtimeHealthModule) {
    runtimeHealthModule = await import(pathToFileURL(runtimeHealthPath).href);
  }
  return runtimeHealthModule;
};

const resolveRunDirectory = async (candidate) => {
  if (candidate) {
    return resolve(repoRoot, candidate);
  }

  const entries = await readdir(runsDirectory, { withFileTypes: true }).catch(() => []);
  const latest = entries
    .filter((entry) => entry.isDirectory() && /^run-\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!latest) {
    throw new Error("No run directories were found under evals/runs.");
  }
  return join(runsDirectory, latest);
};

const formatAge = (ageMs) => {
  if (ageMs === undefined) {
    return "unknown";
  }
  if (ageMs < 1000) {
    return `${ageMs}ms`;
  }
  if (ageMs < 10_000) {
    return `${(ageMs / 1000).toFixed(1)}s`;
  }
  if (ageMs < 120_000) {
    return `${Math.round(ageMs / 1000)}s`;
  }
  return `${(ageMs / 60_000).toFixed(1)}m`;
};

const bannerFor = (executionState) => {
  if (executionState === "stalled") {
    return "STALLED";
  }
  if (executionState === "paused") {
    return "PAUSED";
  }
  if (executionState === "completed") {
    return "COMPLETED";
  }
  if (executionState === "failed") {
    return "FAILED";
  }
  return "RUNNING";
};

const render = async (runDirectory) => {
  const runtimeDirectory = join(runDirectory, "runtime");
  const [
    operatorSurface,
    transportState,
    liveState,
    roundPhase,
    controllerLease,
    recentEvents,
    runtimeHealth
  ] =
    await Promise.all([
      readJsonIfExists(join(runtimeDirectory, "operator-surface.json")),
      readJsonIfExists(join(runtimeDirectory, "transport-state.json")),
      readJsonIfExists(join(runtimeDirectory, "live-state.json")),
      readJsonIfExists(join(runtimeDirectory, "round-phase.json")),
      readJsonIfExists(join(runtimeDirectory, "controller-lease.json")),
      readTailLines(join(runtimeDirectory, "app-server-events.jsonl"), 20),
      ensureRuntimeHealthModule()
    ]);
  const health = runtimeHealth.assessRuntimeHealth({
    liveState,
    roundPhase,
    controllerLease,
    transportState
  });

  process.stdout.write("\x1bc");
  console.log(`Banner: ${bannerFor(health.execution_state)}`);
  console.log(
    `Run: ${operatorSurface?.run_id ?? transportState?.run_id ?? liveState?.run_id ?? "unknown"}`
  );
  console.log(
    `Presentation: ${operatorSurface?.presentation_mode ?? transportState?.presentation_mode ?? "unknown"}`
  );
  console.log(
    `Origin: ${operatorSurface?.launch_origin ?? transportState?.launch_origin ?? "unknown"} / Owner: ${operatorSurface?.surface_owner ?? transportState?.surface_owner ?? "unknown"}`
  );
  console.log(
    `Binding: ${operatorSurface?.thread_binding_state ?? transportState?.thread_binding_state ?? "unknown"} / Visibility: ${operatorSurface?.app_visibility ?? transportState?.app_visibility ?? "unknown"}`
  );
  console.log(
    `Transport: ${transportState?.transport_mode ?? "unknown"} (${transportState?.status ?? "unknown"})`
  );
  console.log(`Workspace: ${operatorSurface?.workspace_surface ?? "unknown"}`);
  console.log(
    `Handoff: ${operatorSurface?.handoff_state ?? "unknown"} / Resume skill: ${operatorSurface?.resume_skill ?? "unknown"} / Requires Codex app: ${operatorSurface?.requires_codex_app === undefined ? "unknown" : operatorSurface.requires_codex_app ? "yes" : "no"}`
  );
  console.log(
    `Worktree: ${operatorSurface?.worktree_id ?? "none"} / ${operatorSurface?.worktree_path ?? "none"}`
  );
  console.log(
    `Thread: ${operatorSurface?.thread_id ?? transportState?.app_server?.thread_id ?? "none"} / Turn: ${transportState?.app_server?.turn_id ?? "none"}`
  );
  console.log(
    `Round: ${operatorSurface?.round ?? roundPhase?.round ?? liveState?.active_round ?? "none"} / Phase: ${operatorSurface?.phase ?? roundPhase?.phase ?? liveState?.active_phase ?? "none"} (${operatorSurface?.phase_status ?? roundPhase?.status ?? liveState?.active_phase_status ?? "none"})`
  );
  console.log(`Execution: ${operatorSurface?.execution_state ?? health.execution_state}`);
  console.log(`Heartbeat age: ${formatAge(health.heartbeat_age_ms)}`);
  console.log(`Progress age: ${formatAge(health.progress_age_ms)}`);
  console.log(`Transport event age: ${formatAge(health.transport_event_age_ms)}`);
  console.log(`Health: ${health.summary}`);
  console.log(`Next action: ${operatorSurface?.next_action ?? "none"}`);
  console.log(`Resume command: ${operatorSurface?.resume_command ?? "none"}`);
  console.log(`Active prompt: ${operatorSurface?.active_prompt_path ?? "none"}`);
  console.log(`Active response: ${operatorSurface?.active_response_path ?? "none"}`);
  console.log("");
  console.log("Operator notes:");
  if (Array.isArray(operatorSurface?.notes) && operatorSurface.notes.length > 0) {
    for (const note of operatorSurface.notes) {
      console.log(`- ${note}`);
    }
  } else {
    console.log("- none");
  }
  console.log("");
  console.log("Recent events:");
  if (recentEvents.length === 0) {
    console.log("- none");
  } else {
    for (const line of recentEvents) {
      console.log(line);
    }
  }
};

const main = async () => {
  const runDirectory = await resolveRunDirectory(process.argv[2]);
  await ensureRuntimeHealthModule();
  console.log(`Watching ${runDirectory}`);
  while (true) {
    await render(runDirectory);
    await sleep(1000);
  }
};

main().catch((error) => {
  console.error("loop-ui failed.");
  console.error(error);
  process.exitCode = 1;
});
