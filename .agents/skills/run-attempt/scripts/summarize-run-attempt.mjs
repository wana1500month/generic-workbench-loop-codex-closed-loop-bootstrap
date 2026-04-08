import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const runDirectoryArg = process.argv[2];

if (!runDirectoryArg) {
  console.error(
    "Usage: node .agents/skills/run-attempt/scripts/summarize-run-attempt.mjs <evals/runs/run-###>"
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

  try {
    const entries = await readdir(runDirectory, { withFileTypes: true });
    const roundDirectories = entries
      .filter((entry) => entry.isDirectory() && /^round-\d+$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    const latestRound = roundDirectories.at(-1);

    if (!latestRound) {
      throw new Error("No round directory exists for this run yet.");
    }

    const latestRoundDirectory = join(runDirectory, latestRound);
    const roundContract = await readJsonIfExists(join(latestRoundDirectory, "round-contract.json"));
    const generatorPlan = await readJsonIfExists(join(latestRoundDirectory, "generator-plan.json"));
    const patchRequest = await readJsonIfExists(join(latestRoundDirectory, "patch-request.json"));
    const qualityCritique = await readJsonIfExists(join(latestRoundDirectory, "quality-critique.json"));
    const trajectoryDecision = await readJsonIfExists(
      join(latestRoundDirectory, "trajectory-decision.json")
    );

    process.stdout.write(
      `${JSON.stringify(
        {
          run_directory: runDirectory,
          latest_round: basename(latestRoundDirectory),
          round_contract_scope: roundContract?.implementation_slice ?? roundContract?.scope,
          generator_deliverables: generatorPlan?.deliverables ?? [],
          patch_request_next_action: patchRequest?.next_action,
          must_fix_count: Array.isArray(patchRequest?.must_fix) ? patchRequest.must_fix.length : 0,
          quality_findings: Array.isArray(qualityCritique?.findings)
            ? qualityCritique.findings.length
            : 0,
          trajectory: trajectoryDecision?.trajectory
        },
        null,
        2
      )}\n`
    );
  } catch (error) {
    console.error("Run attempt summary failed.");
    console.error(error);
    process.exitCode = 1;
  }
}
