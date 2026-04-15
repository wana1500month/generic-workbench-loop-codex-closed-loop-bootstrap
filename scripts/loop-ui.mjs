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

const readJsonTailLines = async (path, count) => {
  try {
    const text = await readFile(path, "utf8");
    return text
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-count)
      .map((line) => JSON.parse(line));
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

const parseArgs = (argv) => {
  let runDirectory;
  let once = false;
  let json = false;

  for (const token of argv) {
    if (token === "--once") {
      once = true;
      continue;
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (!runDirectory) {
      runDirectory = token;
      continue;
    }
    throw new Error(`Unexpected argument: ${token}`);
  }

  return { runDirectory, once, json };
};

const sessionSnapshotFromOperatorSurface = (operatorSurface) => {
  if (!operatorSurface?.session) {
    return undefined;
  }

  return {
    source: "operator-surface",
    objective: operatorSurface.session.objective,
    session_status: operatorSurface.session.session_status,
    readiness: operatorSurface.session.readiness,
    next_attention: operatorSurface.session.next_attention,
    deferred_question_count: operatorSurface.session.deferred_question_count ?? 0,
    steering_note_count: operatorSurface.session.steering_note_count ?? 0,
    review_feedback_count: operatorSurface.session.review_feedback_count ?? 0,
    external_blocker_count: operatorSurface.session.external_blocker_count ?? 0,
    ...(operatorSurface.session.latest_round !== undefined
      ? { latest_round: operatorSurface.session.latest_round }
      : {}),
    ...(operatorSurface.session.latest_stop_reason
      ? { latest_stop_reason: operatorSurface.session.latest_stop_reason }
      : {})
  };
};

const selectSessionSnapshot = (sessionStatus, operatorSurface) => {
  if (sessionStatus) {
    return {
      source: "session-status",
      objective: sessionStatus.objective,
      session_status: sessionStatus.session_status,
      readiness: sessionStatus.readiness,
      next_attention: sessionStatus.next_attention,
      deferred_question_count: sessionStatus.deferred_question_count ?? 0,
      steering_note_count: sessionStatus.steering_note_count ?? 0,
      review_feedback_count: sessionStatus.review_feedback_count ?? 0,
      external_blocker_count: sessionStatus.external_blocker_count ?? 0,
      ...(sessionStatus.latest_round !== undefined
        ? { latest_round: sessionStatus.latest_round }
        : {}),
      ...(sessionStatus.latest_stop_reason
        ? { latest_stop_reason: sessionStatus.latest_stop_reason }
        : {})
    };
  }
  return sessionSnapshotFromOperatorSurface(operatorSurface);
};

export const buildLoopUiSnapshot = async (runDirectory) => {
  const runtimeDirectory = join(runDirectory, "runtime");
  const [
    operatorSurface,
    sessionStatus,
    sessionStream,
    transportState,
    liveState,
    roundPhase,
    controllerLease,
    recentEvents,
    recentSessionEvents,
    runtimeHealth
  ] = await Promise.all([
    readJsonIfExists(join(runtimeDirectory, "operator-surface.json")),
    readJsonIfExists(join(runtimeDirectory, "session-status.json")),
    readJsonIfExists(join(runtimeDirectory, "session-stream.json")),
    readJsonIfExists(join(runtimeDirectory, "transport-state.json")),
    readJsonIfExists(join(runtimeDirectory, "live-state.json")),
    readJsonIfExists(join(runtimeDirectory, "round-phase.json")),
    readJsonIfExists(join(runtimeDirectory, "controller-lease.json")),
    readTailLines(join(runtimeDirectory, "app-server-events.jsonl"), 20),
    readJsonTailLines(join(runtimeDirectory, "session-status-events.jsonl"), 10),
    ensureRuntimeHealthModule()
  ]);

  const health = runtimeHealth.assessRuntimeHealth({
    liveState,
    roundPhase,
    controllerLease,
    transportState
  });
  const session = selectSessionSnapshot(sessionStatus, operatorSurface);

  return {
    banner: bannerFor(health.execution_state),
    run_directory: runDirectory,
    run_id:
      sessionStatus?.run_id ??
      operatorSurface?.run_id ??
      transportState?.run_id ??
      liveState?.run_id ??
      "unknown",
    presentation_mode:
      operatorSurface?.presentation_mode ??
      transportState?.presentation_mode ??
      "unknown",
    launch_origin:
      operatorSurface?.launch_origin ??
      transportState?.launch_origin ??
      "unknown",
    surface_owner:
      operatorSurface?.surface_owner ??
      transportState?.surface_owner ??
      "unknown",
    thread_binding_state:
      operatorSurface?.thread_binding_state ??
      transportState?.thread_binding_state ??
      "unknown",
    app_visibility:
      operatorSurface?.app_visibility ??
      transportState?.app_visibility ??
      "unknown",
    transport: {
      mode: transportState?.transport_mode ?? "unknown",
      status: transportState?.status ?? "unknown"
    },
    workspace_surface: operatorSurface?.workspace_surface ?? "unknown",
    handoff: {
      state: operatorSurface?.handoff_state ?? "unknown",
      worker_skill: operatorSurface?.worker_skill ?? "unknown",
      recovery_skill:
        operatorSurface?.recovery_skill ??
        operatorSurface?.resume_skill ??
        "unknown",
      requires_codex_app:
        operatorSurface?.requires_codex_app === undefined
          ? "unknown"
          : operatorSurface.requires_codex_app
            ? "yes"
            : "no"
    },
    worktree: {
      id: operatorSurface?.worktree_id ?? "none",
      path: operatorSurface?.worktree_path ?? "none"
    },
    thread: {
      id:
        operatorSurface?.thread_id ??
        transportState?.app_server?.thread_id ??
        "none",
      turn_id: transportState?.app_server?.turn_id ?? "none"
    },
    active: {
      round:
        operatorSurface?.round ??
        session?.latest_round ??
        roundPhase?.round ??
        liveState?.active_round,
      phase:
        operatorSurface?.phase ??
        roundPhase?.phase ??
        liveState?.active_phase ??
        "none",
      phase_status:
        operatorSurface?.phase_status ??
        roundPhase?.status ??
        liveState?.active_phase_status ??
        "none"
    },
    execution_state: operatorSurface?.execution_state ?? health.execution_state,
    health: {
      summary: health.summary,
      heartbeat_age_ms: health.heartbeat_age_ms,
      progress_age_ms: health.progress_age_ms,
      transport_event_age_ms: health.transport_event_age_ms
    },
    session,
    session_stream: sessionStream
      ? {
          preferred_delivery: sessionStream.preferred_delivery,
          event_type: sessionStream.event_type,
          source_events_path: sessionStream.source_events_path,
          app_server_events_path: sessionStream.app_server_events_path ?? "none"
        }
      : undefined,
    paths: {
      operator_surface_path: join(runtimeDirectory, "operator-surface.json"),
      session_status_path: join(runtimeDirectory, "session-status.json"),
      session_status_events_path: join(runtimeDirectory, "session-status-events.jsonl"),
      session_stream_path: join(runtimeDirectory, "session-stream.json")
    },
    next_action: operatorSurface?.next_action ?? "none",
    resume_command: operatorSurface?.resume_command ?? "none",
    active_prompt_path: operatorSurface?.active_prompt_path ?? "none",
    active_response_path: operatorSurface?.active_response_path ?? "none",
    notes:
      Array.isArray(operatorSurface?.notes) && operatorSurface.notes.length > 0
        ? operatorSurface.notes
        : [],
    recent_events: recentEvents,
    recent_session_events: recentSessionEvents
  };
};

export const renderLoopUiSnapshot = (snapshot) =>
  [
    `Banner: ${snapshot.banner}`,
    `Run: ${snapshot.run_id}`,
    `Presentation: ${snapshot.presentation_mode}`,
    `Origin: ${snapshot.launch_origin} / Owner: ${snapshot.surface_owner}`,
    `Binding: ${snapshot.thread_binding_state} / Visibility: ${snapshot.app_visibility}`,
    `Transport: ${snapshot.transport.mode} (${snapshot.transport.status})`,
    `Workspace: ${snapshot.workspace_surface}`,
    `Handoff: ${snapshot.handoff.state} / Worker: ${snapshot.handoff.worker_skill} / Recovery: ${snapshot.handoff.recovery_skill} / Requires Codex app: ${snapshot.handoff.requires_codex_app}`,
    `Worktree: ${snapshot.worktree.id} / ${snapshot.worktree.path}`,
    `Thread: ${snapshot.thread.id} / Turn: ${snapshot.thread.turn_id}`,
    `Round: ${snapshot.active.round ?? "none"} / Phase: ${snapshot.active.phase} (${snapshot.active.phase_status})`,
    `Execution: ${snapshot.execution_state}`,
    snapshot.session
      ? `Session: ${snapshot.session.session_status} / ${snapshot.session.readiness} / attention ${snapshot.session.next_attention} / source ${snapshot.session.source}`
      : "Session: none",
    snapshot.session
      ? `Session objective: ${snapshot.session.objective}`
      : "Session objective: none",
    snapshot.session
      ? `Session counts: questions ${snapshot.session.deferred_question_count} / steering ${snapshot.session.steering_note_count} / review ${snapshot.session.review_feedback_count} / blockers ${snapshot.session.external_blocker_count}`
      : "Session counts: none",
    snapshot.session
      ? `Session latest: round ${snapshot.session.latest_round ?? "none"} / stop ${snapshot.session.latest_stop_reason ?? "none"}`
      : "Session latest: none",
    `Heartbeat age: ${formatAge(snapshot.health.heartbeat_age_ms)}`,
    `Progress age: ${formatAge(snapshot.health.progress_age_ms)}`,
    `Transport event age: ${formatAge(snapshot.health.transport_event_age_ms)}`,
    `Health: ${snapshot.health.summary}`,
    `Session status path: ${snapshot.paths.session_status_path}`,
    `Session status events: ${snapshot.paths.session_status_events_path}`,
    `Session stream contract: ${snapshot.paths.session_stream_path}`,
    snapshot.session_stream
      ? `Session stream: ${snapshot.session_stream.preferred_delivery} / ${snapshot.session_stream.event_type} / app-server ${snapshot.session_stream.app_server_events_path}`
      : "Session stream: none",
    `Operator surface path: ${snapshot.paths.operator_surface_path}`,
    `Next action: ${snapshot.next_action}`,
    `Resume command: ${snapshot.resume_command}`,
    `Active prompt: ${snapshot.active_prompt_path}`,
    `Active response: ${snapshot.active_response_path}`,
    "",
    "Operator notes:",
    ...(snapshot.notes.length > 0
      ? snapshot.notes.map((note) => `- ${note}`)
      : ["- none"]),
    "",
    "Recent events:",
    ...(snapshot.recent_events.length > 0 ? snapshot.recent_events : ["- none"]),
    "",
    "Recent session events:",
    ...(snapshot.recent_session_events.length > 0
      ? snapshot.recent_session_events.map(
          (event) =>
            `- #${event.sequence} ${event.event_type} [${(event.changed_fields ?? []).join(", ") || "none"}] -> ${event.session?.session_status ?? "unknown"} / ${event.session?.readiness ?? "unknown"}`
        )
      : ["- none"])
  ].join("\n");

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const runDirectory = await resolveRunDirectory(args.runDirectory);
  await ensureRuntimeHealthModule();

  if (args.once || args.json) {
    const snapshot = await buildLoopUiSnapshot(runDirectory);
    if (args.json) {
      console.log(JSON.stringify(snapshot, null, 2));
      return;
    }
    console.log(renderLoopUiSnapshot(snapshot));
    return;
  }

  console.log(`Watching ${runDirectory}`);
  while (true) {
    const snapshot = await buildLoopUiSnapshot(runDirectory);
    process.stdout.write("\x1bc");
    console.log(renderLoopUiSnapshot(snapshot));
    await sleep(1000);
  }
};

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath === modulePath) {
  main().catch((error) => {
    console.error("loop-ui failed.");
    console.error(error);
    process.exitCode = 1;
  });
}
