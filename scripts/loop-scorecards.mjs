import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const parseArgs = (argv) => {
  const result = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") {
      result.json = true;
      continue;
    }
    if (value === "--run-dir") {
      result.runDirectory = argv[index + 1];
      index += 1;
    }
  }
  return result;
};

const runsDirectory = () =>
  process.env.HARNESS_RUNS_DIRECTORY
    ? resolve(process.env.HARNESS_RUNS_DIRECTORY)
    : join(repoRoot, "evals", "runs");

const latestRunDirectory = async () => {
  const entries = await readdir(runsDirectory(), { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(runsDirectory(), entry.name))
    .sort();
  return directories.at(-1);
};

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const roundDirectoryNamePattern = /^round-\d+$/u;

const collectRoundDirectories = async (parentDirectory) => {
  if (!existsSync(parentDirectory)) {
    return [];
  }
  const entries = await readdir(parentDirectory, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() && roundDirectoryNamePattern.test(entry.name)
    )
    .map((entry) => join(parentDirectory, entry.name));
};

const findRoundDirectories = async (runDirectory) => {
  const candidates = [
    ...(await collectRoundDirectories(runDirectory)),
    ...(await collectRoundDirectories(join(runDirectory, "rounds")))
  ];
  return [...new Map(candidates.map((path) => [resolve(path), path])).values()].sort(
    (left, right) => basename(left).localeCompare(basename(right))
  );
};

const findScorecards = async (runDirectory) => {
  const roundDirectories = await findRoundDirectories(runDirectory);
  const scorecards = [];
  for (const roundDirectory of roundDirectories) {
    const scorecardPath = join(roundDirectory, "scorecard.json");
    if (existsSync(scorecardPath)) {
      scorecards.push({
        path: scorecardPath,
        scorecard: await readJson(scorecardPath)
      });
    }
  }
  return scorecards;
};

const renderScorecards = (runDirectory, entries) => [
  `Run: ${runDirectory}`,
  `Scorecards: ${entries.length}`,
  "",
  ...entries.flatMap(({ path, scorecard }) => [
    `Round ${scorecard.round}: ${scorecard.target_reached ? "pass" : "fail"} / total ${scorecard.total_score} / target ${scorecard.target_total_score}`,
    `Path: ${path}`,
    "Required failures:",
    ...(scorecard.blocking_reasons?.length
      ? scorecard.blocking_reasons.map(
          (reason) =>
            `- ${reason.dimension_id}: ${reason.score} < ${reason.minimum_score}`
        )
      : ["- none"]),
    ""
  ])
].join("\n");

const args = parseArgs(process.argv.slice(2));
const runDirectory = args.runDirectory
  ? resolve(repoRoot, args.runDirectory)
  : await latestRunDirectory();

if (!runDirectory) {
  console.error("No run directory found.");
  process.exit(1);
}

const scorecards = await findScorecards(runDirectory);
if (args.json) {
  console.log(
    JSON.stringify(
      {
        run_id: basename(runDirectory),
        run_directory: runDirectory,
        scorecards: scorecards.map(({ path, scorecard }) => ({
          path,
          scorecard
        }))
      },
      null,
      2
    )
  );
} else {
  console.log(renderScorecards(runDirectory, scorecards));
}
