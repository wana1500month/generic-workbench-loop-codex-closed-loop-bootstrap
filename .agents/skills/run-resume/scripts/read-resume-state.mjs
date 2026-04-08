import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const runDirectoryArg = process.argv[2];

if (!runDirectoryArg) {
  console.error(
    "Usage: node .agents/skills/run-resume/scripts/read-resume-state.mjs <evals/runs/run-###>"
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
    const resumeIdentity = await readJsonIfExists(join(runDirectory, "resume-identity.json"));
    const resumeDecision = await readJsonIfExists(join(runDirectory, "resume-decision.json"));
    const latestRoundDirectory = await detectLatestRoundDirectory(summary);
    const patchRequest = latestRoundDirectory
      ? await readJsonIfExists(join(latestRoundDirectory, "patch-request.json"))
      : undefined;
    const trajectoryDecision = latestRoundDirectory
      ? await readJsonIfExists(join(latestRoundDirectory, "trajectory-decision.json"))
      : undefined;

    process.stdout.write(
      `${JSON.stringify(
        {
          run_directory: runDirectory,
          latest_round: latestRoundDirectory ? basename(latestRoundDirectory) : undefined,
          stop_reason: summary?.stop_reason,
          executor_mode: summary?.executor_mode,
          target_family: summary?.target_family,
          validation_lane: summary?.validation_lane,
          resume_identity: resumeIdentity
            ? {
                target_family: resumeIdentity.target_family,
                validation_lane: resumeIdentity.validation_lane,
                executor_mode: resumeIdentity.executor_mode
              }
            : undefined,
          resume_decision: resumeDecision?.decision,
          patch_request_next_action: patchRequest?.next_action,
          trajectory: trajectoryDecision?.trajectory,
          restart_anchor: trajectoryDecision?.restart_anchor
        },
        null,
        2
      )}\n`
    );
  } catch (error) {
    console.error("Run resume summary failed.");
    console.error(error);
    process.exitCode = 1;
  }
}
