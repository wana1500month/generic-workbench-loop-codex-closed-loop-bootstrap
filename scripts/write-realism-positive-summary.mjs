import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runsDirectory = join(repoRoot, "evals", "runs");
const latestStatePath = join(runsDirectory, "latest-realism-state.json");
const latestPositiveStatePath = join(runsDirectory, "latest-positive-realism-state.json");
const positiveSummaryPath = join(runsDirectory, "realism-positive-summary.json");
const positiveSummaryMarkdownPath = join(
  runsDirectory,
  "realism-positive-summary.md"
);
const latestStateRelativePath = "evals/runs/latest-realism-state.json";
const targetFamilies = [
  "browser-app",
  "browser-editor",
  "fullstack-app",
  "dashboard"
];

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const workflowRunUrl =
  process.env.GITHUB_SERVER_URL &&
  process.env.GITHUB_REPOSITORY &&
  process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : undefined;

const listCandidateRuns = async (targetFamily) => {
  const entries = await readdir(runsDirectory, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("run-")) {
      continue;
    }
    const summaryPath = join(runsDirectory, entry.name, "summary.json");
    try {
      const [summary, summaryStat] = await Promise.all([
        readJson(summaryPath),
        stat(summaryPath)
      ]);
      if (
        summary.target_family === targetFamily &&
        summary.validation_lane === "environment_integration"
      ) {
        candidates.push({
          runDirectory: join(runsDirectory, entry.name),
          summaryPath,
          summary,
          mtimeMs: summaryStat.mtimeMs
        });
      }
    } catch {
      continue;
    }
  }

  return candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
};

const summarizeCandidate = (candidate, targetFamily) => {
  if (!candidate) {
    return {
      target_family: targetFamily,
      validation_lane: "environment_integration",
      found: false
    };
  }

  const latestRound =
    candidate.summary.round_history?.[candidate.summary.round_history.length - 1];
  return {
    target_family: targetFamily,
    validation_lane: candidate.summary.validation_lane,
    found: true,
    stop_reason: candidate.summary.stop_reason,
    round_count: candidate.summary.round_count,
    run_directory: candidate.runDirectory,
    summary_path: candidate.summaryPath,
    controller_decision_path: latestRound?.controller_decision_path,
    failure_lineage_path: latestRound?.failure_lineage_path,
    evidence_paths: latestRound?.evidence_paths ?? []
  };
};

const buildArtifact = ({ artifactName, families, latestStatePointer }) => ({
  generated_at: new Date().toISOString(),
  artifact_name: artifactName,
  uploaded_with: "realism-positive-runs",
  ...(workflowRunUrl ? { workflow_run_url: workflowRunUrl } : {}),
  ...(process.env.GITHUB_SHA ? { workflow_sha: process.env.GITHUB_SHA } : {}),
  ...(latestStatePointer ? { latest_state_path: latestStatePointer } : {}),
  families
});

const families = [];
const positiveFamilies = [];
for (const targetFamily of targetFamilies) {
  const candidates = await listCandidateRuns(targetFamily);
  const latest = candidates[0];
  const latestPositive = candidates.find(
    (candidate) => candidate.summary.stop_reason === "target_reached"
  );
  families.push(summarizeCandidate(latest, targetFamily));
  positiveFamilies.push(summarizeCandidate(latestPositive, targetFamily));
}

const latestStateArtifact = buildArtifact({
  artifactName: "latest-realism-state",
  families
});
const latestPositiveArtifact = buildArtifact({
  artifactName: "latest-positive-realism-state",
  families: positiveFamilies,
  latestStatePointer: latestStateRelativePath
});
const positiveSummaryArtifact = buildArtifact({
  artifactName: "realism-positive-summary",
  families: positiveFamilies,
  latestStatePointer: latestStateRelativePath
});

const markdown = [
  "# Realism Positive Summary",
  "",
  workflowRunUrl ? `Workflow run: ${workflowRunUrl}` : "Workflow run: local",
  "",
  "## Latest Environment State",
  ...families.map((family) =>
    family.found
      ? `- ${family.target_family}: ${family.stop_reason} (${family.run_directory})`
      : `- ${family.target_family}: no environment_integration run found`
  ),
  "",
  "## Latest Positive Environment State",
  ...positiveFamilies.map((family) =>
    family.found
      ? `- ${family.target_family}: target_reached (${family.run_directory})`
      : `- ${family.target_family}: no target_reached environment run recorded yet`
  )
].join("\n");

await Promise.all([
  writeFile(latestStatePath, `${JSON.stringify(latestStateArtifact, null, 2)}\n`, "utf8"),
  writeFile(
    latestPositiveStatePath,
    `${JSON.stringify(latestPositiveArtifact, null, 2)}\n`,
    "utf8"
  ),
  writeFile(
    positiveSummaryPath,
    `${JSON.stringify(positiveSummaryArtifact, null, 2)}\n`,
    "utf8"
  ),
  writeFile(positiveSummaryMarkdownPath, `${markdown}\n`, "utf8")
]);

console.log(`[write-realism-positive-summary] wrote ${latestStatePath}`);
console.log(`[write-realism-positive-summary] wrote ${latestPositiveStatePath}`);
console.log(`[write-realism-positive-summary] wrote ${positiveSummaryPath}`);
console.log(`[write-realism-positive-summary] wrote ${positiveSummaryMarkdownPath}`);
