import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const runDirectoryArg = process.argv[2];

if (!runDirectoryArg) {
  console.error(
    "Usage: node .agents/skills/harness-closeout/scripts/summarize-run.mjs <evals/runs/run-###>"
  );
  process.exitCode = 1;
} else {
  const runDirectory = resolve(process.cwd(), runDirectoryArg);

  const readJsonIfExists = async (path) => {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch {
      return undefined;
    }
  };

  const detectLatestRoundDirectory = async (summary) => {
    if (typeof summary?.terminal_round === "number") {
      return join(
        runDirectory,
        `round-${String(summary.terminal_round).padStart(3, "0")}`
      );
    }

    const entries = await readdir(runDirectory, { withFileTypes: true });
    const roundDirectories = entries
      .filter((entry) => entry.isDirectory() && /^round-\d+$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort();

    const latestRound = roundDirectories.at(-1);
    return latestRound ? join(runDirectory, latestRound) : undefined;
  };

  try {
    const summary = await readJsonIfExists(join(runDirectory, "summary.json"));
    const latestRoundDirectory = await detectLatestRoundDirectory(summary);
    const patchRequest = latestRoundDirectory
      ? await readJsonIfExists(join(latestRoundDirectory, "patch-request.json"))
      : undefined;
    const qualityCritique = latestRoundDirectory
      ? await readJsonIfExists(join(latestRoundDirectory, "quality-critique.json"))
      : undefined;
    const trajectoryDecision = latestRoundDirectory
      ? await readJsonIfExists(join(latestRoundDirectory, "trajectory-decision.json"))
      : undefined;
    const evalReport = latestRoundDirectory
      ? await readJsonIfExists(join(latestRoundDirectory, "eval-report.json"))
      : undefined;

    const output = {
      run_directory: runDirectory,
      latest_round: latestRoundDirectory ? basename(latestRoundDirectory) : undefined,
      stop_reason: summary?.stop_reason,
      release_score: summary?.release_score,
      durable_memory: {
        feature_list_path: summary?.feature_list_path,
        progress_path: summary?.progress_path,
        done_when_path: summary?.done_when_path
      },
      patch_request: patchRequest
        ? {
            next_action: patchRequest.next_action,
            must_fix_count: Array.isArray(patchRequest.must_fix)
              ? patchRequest.must_fix.length
              : 0,
            should_fix_count: Array.isArray(patchRequest.should_fix)
              ? patchRequest.should_fix.length
              : 0
          }
        : undefined,
      quality_critique: qualityCritique
        ? {
            finding_count: Array.isArray(qualityCritique.findings)
              ? qualityCritique.findings.length
              : 0,
            strongest_axis: qualityCritique.quality_axis_id
          }
        : undefined,
      trajectory: trajectoryDecision
        ? {
            choice: trajectoryDecision.trajectory,
            restart_anchor: trajectoryDecision.restart_anchor
          }
        : undefined,
      thresholds: evalReport?.threshold_results
    };

    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } catch (error) {
    console.error("Harness closeout summary failed.");
    console.error(error);
    process.exitCode = 1;
  }
}
