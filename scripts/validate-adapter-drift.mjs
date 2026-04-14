import { strict as assert } from "node:assert";
import { join } from "node:path";

import {
  extractRunDirectory,
  readJsonFile,
  readSummary,
  runLoop
} from "./validation-utils.mjs";

console.log("[validate-adapter-drift] static adapter contract drift");
const staticResult = await runLoop(
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
if (staticResult.code !== 0) {
  throw new Error(
    `Static adapter drift fixture failed.\nSTDOUT:\n${staticResult.stdout}\nSTDERR:\n${staticResult.stderr}`
  );
}

const staticSummary = await readSummary(extractRunDirectory(staticResult.stdout));
assert.equal(
  staticSummary.stop_reason,
  "adapter_contract_invalid",
  "Static adapter contract drift should still fail closed as adapter_contract_invalid."
);
const staticRound = staticSummary.round_history?.[0];
assert.equal(
  typeof staticRound?.adapter_drift_report_path,
  "string",
  "Static adapter drift round should persist adapter_drift_report_path."
);
const [staticDriftReport, staticPatchRequest] = await Promise.all([
  readJsonFile(staticRound.adapter_drift_report_path),
  readJsonFile(staticRound.patch_request_path)
]);
assert.equal(staticDriftReport.kind, "contract");
assert(staticDriftReport.signals.includes("static_contract_blockers"));
assert.equal(staticDriftReport.recommended_action, "recontract_adapter");
assert.equal(staticPatchRequest.next_action, "recontract_adapter");
assert.equal(staticPatchRequest.adapter_drift_kind, "contract");
assert.equal(
  staticPatchRequest.adapter_drift_summary,
  staticDriftReport.summary,
  "Static patch request should echo the adapter drift summary."
);

console.log("[validate-adapter-drift] runtime manifest drift");
const runtimeResult = await runLoop(
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
if (runtimeResult.code !== 0) {
  throw new Error(
    `Runtime adapter drift fixture failed.\nSTDOUT:\n${runtimeResult.stdout}\nSTDERR:\n${runtimeResult.stderr}`
  );
}

const runtimeSummary = await readSummary(extractRunDirectory(runtimeResult.stdout));
const runtimeRoundOne = runtimeSummary.round_history?.[0];
assert.equal(
  typeof runtimeRoundOne?.adapter_drift_report_path,
  "string",
  "Runtime drift round should persist adapter_drift_report_path."
);
const [runtimeDriftReport, runtimePatchRequest] = await Promise.all([
  readJsonFile(runtimeRoundOne.adapter_drift_report_path),
  readJsonFile(runtimeRoundOne.patch_request_path)
]);
assert.equal(runtimeDriftReport.kind, "runtime");
assert(runtimeDriftReport.signals.includes("missing_target_manifest_keys"));
assert(runtimeDriftReport.missing_target_manifest_keys.includes("app_url"));
assert.equal(runtimePatchRequest.next_action, "recontract_adapter");
assert.equal(runtimePatchRequest.adapter_drift_kind, "runtime");
assert.equal(
  runtimeSummary.stop_reason,
  "awaiting_human_input",
  "External runtime drift should pause for adapter migration approval."
);
const runtimeOperatorSurface = await readJsonFile(runtimeSummary.operator_surface_path);
assert.equal(runtimeOperatorSurface.attention_required, "human");
assert.equal(runtimeOperatorSurface.checkpoint_kind, "adapter-migration-approval");
assert.deepEqual(runtimeOperatorSurface.decision_options, [
  "accept",
  "reject",
  "open_new_run"
]);
const runtimeRoundTwoProposalPath = join(
  extractRunDirectory(runtimeResult.stdout),
  "round-002",
  "adapter-migration-proposal.json"
);
const runtimeRoundTwoProposal = await readJsonFile(runtimeRoundTwoProposalPath);
assert.equal(runtimeRoundTwoProposal.adapter_origin, "external_contract");
assert.equal(runtimeRoundTwoProposal.apply_mode, "proposal_only");
assert.equal(runtimeRoundTwoProposal.requires_operator_acceptance, true);
assert.equal(runtimeRoundTwoProposal.force_new_run, false);

console.log("[validate-adapter-drift] complete");
