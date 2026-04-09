import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runsDirectory = join(repoRoot, "evals", "runs");

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

const render = async (runDirectory) => {
  const runtimeDirectory = join(runDirectory, "runtime");
  const [transportState, liveState, roundPhase, recentEvents] = await Promise.all([
    readJsonIfExists(join(runtimeDirectory, "transport-state.json")),
    readJsonIfExists(join(runtimeDirectory, "live-state.json")),
    readJsonIfExists(join(runtimeDirectory, "round-phase.json")),
    readTailLines(join(runtimeDirectory, "app-server-events.jsonl"), 20)
  ]);

  process.stdout.write("\x1bc");
  console.log(`Run: ${transportState?.run_id ?? liveState?.run_id ?? "unknown"}`);
  console.log(
    `Transport: ${transportState?.transport_mode ?? "unknown"} (${transportState?.status ?? "unknown"})`
  );
  console.log(
    `Thread: ${transportState?.app_server?.thread_id ?? "none"} / Turn: ${transportState?.app_server?.turn_id ?? "none"}`
  );
  console.log(
    `Round: ${roundPhase?.round ?? liveState?.active_round ?? "none"} / Phase: ${roundPhase?.phase ?? liveState?.active_phase ?? "none"} (${roundPhase?.status ?? liveState?.active_phase_status ?? "none"})`
  );
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
