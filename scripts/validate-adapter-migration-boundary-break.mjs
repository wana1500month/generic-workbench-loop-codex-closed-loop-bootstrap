import { strict as assert } from "node:assert";

import {
  ensureBuild,
  importDist,
  readJsonFile
} from "./testing/bootstrap-validator-helpers.mjs";
import {
  extractRunDirectory,
  readSummary,
  runLoop
} from "./validation-utils.mjs";

console.log("[validate-adapter-migration-boundary-break] external contract drift");
await ensureBuild();

const execution = await runLoop(
  [
    "--single",
    "--adapter",
    "./.tmp/semantic-validation/no-verifier/adapter.json",
    "--evaluator-profile",
    "./.tmp/semantic-validation/verification-profile.json",
    "--max-rounds",
    "1"
  ],
  { silent: true }
);
if (execution.code !== 0) {
  throw new Error(
    `Boundary-break fixture failed.\nSTDOUT:\n${execution.stdout}\nSTDERR:\n${execution.stderr}`
  );
}

const runDirectory = extractRunDirectory(execution.stdout);
const summary = await readSummary(runDirectory);
const driftReport = await readJsonFile(summary.round_history?.[0]?.adapter_drift_report_path);
const { buildAdapterMigrationProposal } = await importDist("adapter-migration.js");
const { loadAdapterContract } = await importDist("adapter-runtime.js");
const loadedAdapter = await loadAdapterContract(summary.adapter_contract_path);
if (!loadedAdapter) {
  throw new Error("Expected the external adapter fixture to load successfully.");
}

const proposal = await buildAdapterMigrationProposal({
  runId: summary.run_id,
  round: 2,
  sourceAdapterDriftReportPath: summary.round_history?.[0]?.adapter_drift_report_path,
  loadedAdapter,
  adapterDriftReport: driftReport
});

assert.equal(proposal.adapter_origin, "external_contract");
assert.equal(proposal.migration_class, "boundary_break");
assert.equal(proposal.apply_mode, "new_run_required");
assert.equal(proposal.same_run_eligible, false);
assert.equal(proposal.autoapply_eligible, false);
assert.equal(proposal.requires_operator_acceptance, true);
assert.equal(proposal.force_new_run, true);

console.log("[validate-adapter-migration-boundary-break] complete");
