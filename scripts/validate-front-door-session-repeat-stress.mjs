import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  cleanupTempRoot,
  createTempRoot,
  ensureBuild,
  repoRoot,
  runCommand,
  writeJsonFile
} from "./testing/bootstrap-validator-helpers.mjs";

const requestedIterations = Number.parseInt(
  process.env.HARNESS_FRONT_DOOR_SESSION_REPEAT_STRESS_ITERATIONS ?? "20",
  10
);
const iterations = Math.max(
  20,
  Number.isFinite(requestedIterations) ? requestedIterations : 20
);

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const tempRoot = await createTempRoot("front-door-session-repeat-stress");
const failureRoot = join(
  repoRoot,
  ".tmp",
  "front-door-session-repeat-stress-failures",
  timestamp
);

const writeFallbackFailureArtifacts = async (input) => {
  await mkdir(input.artifactRoot, { recursive: true });
  await Promise.all([
    writeJsonFile(join(input.artifactRoot, "fixture-input.json"), {
      validator: "validate:front-door-session-repeat-stress",
      iteration: input.iteration,
      command: "npm run validate:front-door-session --silent",
      temp_root: input.iterationRoot,
      sessions_directory: input.sessionsDirectory,
      runs_directory: input.runsDirectory
    }),
    writeJsonFile(join(input.artifactRoot, "expected-summary.json"), {
      validator_status: "pass",
      isolated_iterations: iterations,
      browser_only_surface_invariant: {
        verification_surfaces: ["browser"],
        evidence_surfaces: ["browser"],
        forbidden_extra_surfaces: ["db"]
      }
    }),
    writeJsonFile(join(input.artifactRoot, "actual-summary.json"), {
      exit_code: input.result.code,
      stdout: input.result.stdout,
      stderr: input.result.stderr
    }),
    writeJsonFile(join(input.artifactRoot, "surface-summary.json"), [])
  ]);
};

try {
  await ensureBuild();
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const iterationLabel = String(iteration).padStart(2, "0");
    const iterationRoot = join(tempRoot, `iteration-${iterationLabel}`);
    const sessionsDirectory = join(iterationRoot, "front-door-sessions");
    const runsDirectory = join(iterationRoot, "runs");
    const artifactRoot = join(failureRoot, `iteration-${iterationLabel}`);
    const env = {
      ...process.env,
      HARNESS_VALIDATE_FRONT_DOOR_SESSION_SKIP_BUILD: "1",
      HARNESS_FRONT_DOOR_SESSION_VALIDATE_TEMP_ROOT: iterationRoot,
      HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY: sessionsDirectory,
      HARNESS_RUNS_DIRECTORY: runsDirectory,
      HARNESS_FRONT_DOOR_SESSION_FAILURE_ARTIFACT_DIR: artifactRoot
    };
    delete env.CODEX_THREAD_ID;
    delete env.HARNESS_THREAD_BINDING_STATE;
    delete env.HARNESS_LAUNCH_ORIGIN;

    await mkdir(iterationRoot, { recursive: true });
    const result = await runCommand(
      "npm",
      ["run", "validate:front-door-session", "--silent"],
      { env }
    );
    if (result.code !== 0) {
      await writeFallbackFailureArtifacts({
        iteration,
        iterationRoot,
        sessionsDirectory,
        runsDirectory,
        artifactRoot,
        result
      });
      throw new Error(
        [
          `validate:front-door-session failed on stress iteration ${iteration}.`,
          `Failure artifacts: ${artifactRoot}`,
          result.stdout,
          result.stderr
        ].join("\n")
      );
    }
  }
} finally {
  await cleanupTempRoot(tempRoot);
}

console.log(
  `validate:front-door-session-repeat-stress passed (${iterations} isolated iterations)`
);
