import { strict as assert } from "node:assert";
import { join } from "node:path";

import {
  cleanupTempRoot,
  createTempRoot,
  readJsonFile,
  runCommand
} from "./testing/bootstrap-validator-helpers.mjs";

const isolatedEnvFor = (tempRoot, name, summaryPath) => {
  const env = {
    ...process.env,
    HARNESS_RUNS_DIRECTORY: join(tempRoot, `${name}-runs`),
    HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY: join(
      tempRoot,
      `${name}-front-door-sessions`
    ),
    HARNESS_VALIDATION_SUMMARY_PATH: summaryPath
  };
  delete env.CODEX_THREAD_ID;
  delete env.HARNESS_THREAD_BINDING_STATE;
  delete env.HARNESS_LAUNCH_ORIGIN;
  return env;
};

const tempRoot = await createTempRoot("validate-validation-batch-isolation");

try {
  const standaloneSummaryPath = join(tempRoot, "standalone-summary.json");
  const batchSummaryPath = join(tempRoot, "batch-summary.json");

  const standalone = await runCommand(
    "npm",
    ["run", "validate:korean-ambiguous-document-followup", "--silent"],
    {
      env: isolatedEnvFor(tempRoot, "standalone", standaloneSummaryPath)
    }
  );
  if (standalone.code !== 0) {
    throw new Error(
      [
        "standalone ambiguous follow-up validation failed.",
        standalone.stdout,
        standalone.stderr
      ].join("\n")
    );
  }

  const batch = await runCommand(
    process.execPath,
    ["./scripts/run-validation-batch.mjs", "isolation-smoke"],
    {
      env: isolatedEnvFor(tempRoot, "batch", batchSummaryPath)
    }
  );
  if (batch.code !== 0) {
    throw new Error(
      [
        "batch ambiguous follow-up validation failed.",
        batch.stdout,
        batch.stderr
      ].join("\n")
    );
  }

  assert.deepEqual(
    await readJsonFile(batchSummaryPath),
    await readJsonFile(standaloneSummaryPath)
  );
} finally {
  await cleanupTempRoot(tempRoot);
}

console.log("validate:validation-batch-isolation passed");
