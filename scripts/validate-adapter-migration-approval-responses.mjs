import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  assertRuntimeEventCode,
  extractRunDirectory,
  readJsonFile,
  readSummary,
  runLoop
} from "./validation-utils.mjs";

const startApprovalRun = async () => {
  const execution = await runLoop(
    [
      "--adapter",
      "./.tmp/semantic-validation/hidden-app-url/adapter.json",
      "--evaluator-profile",
      "./.tmp/semantic-validation/verification-profile.json",
      "--max-rounds",
      "2"
    ],
    { silent: true }
  );
  if (execution.code !== 0) {
    throw new Error(
      `Approval-lane fixture failed.\nSTDOUT:\n${execution.stdout}\nSTDERR:\n${execution.stderr}`
    );
  }

  const runDirectory = extractRunDirectory(execution.stdout);
  const summary = await readSummary(runDirectory);
  assert.equal(summary.stop_reason, "awaiting_human_input");
  const proposalPath = join(runDirectory, "round-002", "adapter-migration-proposal.json");
  const responsePath = join(runDirectory, "round-002", "adapter-migration-response.json");
  const proposal = await readJsonFile(proposalPath);
  return {
    runDirectory,
    proposal,
    responsePath
  };
};

const resumeRun = async (runDirectory) => {
  const execution = await runLoop(
    ["--resume-run", runDirectory],
    { silent: true }
  );
  if (execution.code !== 0) {
    throw new Error(
      `Resume failed for ${runDirectory}.\nSTDOUT:\n${execution.stdout}\nSTDERR:\n${execution.stderr}`
    );
  }
  return readSummary(runDirectory);
};

console.log("[validate-adapter-migration-approval-responses] accept -> external");
{
  const { runDirectory, proposal, responsePath } = await startApprovalRun();
  await writeFile(
    responsePath,
    JSON.stringify(
      {
        proposal_id: proposal.proposal_id,
        decision: "accept",
        note: "validated accept path"
      },
      null,
      2
    ),
    "utf8"
  );
  const summary = await resumeRun(runDirectory);
  assert.equal(summary.stop_reason, "awaiting_external_condition");
  assertRuntimeEventCode(summary, "adapter.migration_accepted");
  const operatorSurface = await readJsonFile(summary.operator_surface_path);
  assert.equal(operatorSurface.attention_required, "external");
  assert.equal(operatorSurface.checkpoint_kind, "adapter-migration-approval");
  assert.equal(
    operatorSurface.decision_options,
    undefined,
    "Accepted adapter migration should clear decision options once the run waits on external apply."
  );
}

console.log("[validate-adapter-migration-approval-responses] reject -> terminal");
{
  const { runDirectory, proposal, responsePath } = await startApprovalRun();
  await writeFile(
    responsePath,
    JSON.stringify(
      {
        proposal_id: proposal.proposal_id,
        decision: "reject",
        note: "validated reject path"
      },
      null,
      2
    ),
    "utf8"
  );
  const summary = await resumeRun(runDirectory);
  assert.equal(summary.stop_reason, "adapter_migration_rejected");
  assertRuntimeEventCode(summary, "adapter.migration_rejected");
}

console.log("[validate-adapter-migration-approval-responses] open_new_run -> terminal");
{
  const { runDirectory, proposal, responsePath } = await startApprovalRun();
  await writeFile(
    responsePath,
    JSON.stringify(
      {
        proposal_id: proposal.proposal_id,
        decision: "open_new_run",
        note: "validated new-run branch"
      },
      null,
      2
    ),
    "utf8"
  );
  const summary = await resumeRun(runDirectory);
  assert.equal(summary.stop_reason, "new_run_required");
  assertRuntimeEventCode(summary, "adapter.migration_new_run_requested");
}

console.log("[validate-adapter-migration-approval-responses] complete");
