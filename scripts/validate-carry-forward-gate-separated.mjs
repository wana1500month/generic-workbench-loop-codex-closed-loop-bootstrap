import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ensureBuild,
  importDist,
  repoRoot
} from "./testing/bootstrap-validator-helpers.mjs";
import { assert, fixtureEvalReport } from "./testing/evaluator-blind-fixtures.mjs";

const assertEvaluatorScoringDoesNotOwnCarryForward = async () => {
  const evalReportSource = await readFile(
    join(
      repoRoot,
      "packages",
      "loop-orchestrator",
      "src",
      "round-evaluator",
      "eval-report.ts"
    ),
    "utf8"
  );
  assert(
    !/previousPatchTargetCheckIds|previousPatchRequestAddressed/.test(evalReportSource),
    "buildEvalReport must not accept previous patch request state."
  );
  assert(
    !/previous_patch_request_(addressed|resolved)/.test(evalReportSource),
    "Eval report scoring must not emit previous patch request addressed/resolved checks."
  );

  const evaluatorStepSource = await readFile(
    join(repoRoot, "packages", "loop-orchestrator", "src", "loop", "evaluator-step.ts"),
    "utf8"
  );
  assert(
    evaluatorStepSource.includes("buildCarryForwardGateArtifact"),
    "Evaluator step must compute previous patch resolution through carry_forward_gate."
  );
  assert(
    evaluatorStepSource.includes("carryForwardGateArtifact.resolved"),
    "Round result previous_patch_request_resolved must come from carry_forward_gate."
  );
};

const main = async () => {
  await ensureBuild();
  await assertEvaluatorScoringDoesNotOwnCarryForward();
  const { buildCarryForwardGateArtifact } = await importDist("carry-forward-gate.js");
  const evalReport = fixtureEvalReport(2, {
    total_score: 0.91,
    release_score: 0.91,
    check_results: [
      {
        check_id: "release_blockers_recorded",
        status: "fail",
        detail: "Current blind eval still reports a release blocker."
      },
      {
        check_id: "round_contract_written",
        status: "pass",
        detail: "Current round contract exists."
      }
    ],
    resolved_check_ids: ["round_contract_written"],
    unresolved_check_ids: ["release_blockers_recorded"]
  });
  const gate = buildCarryForwardGateArtifact({
    round: 2,
    previousPatchTargetCheckIds: [
      "release_blockers_recorded",
      "previous_patch_request_resolved",
      "missing_carried_check"
    ],
    previousPatchRequestAddressed: true,
    evalReport
  });

  assert(gate.artifact_type === "carry_forward_gate", "Gate artifact type should be explicit.");
  assert(
    gate.resolution_source === "carry_forward_gate",
    "Gate resolution source should be carry_forward_gate."
  );
  assert(gate.addressed === true, "Gate should preserve addressed state separately.");
  assert(
    gate.actionable_target_check_ids.includes("release_blockers_recorded"),
    "Gate should evaluate actionable carried check ids."
  );
  assert(
    !gate.actionable_target_check_ids.includes("previous_patch_request_resolved"),
    "Gate should ignore derived previous-patch checks as non-actionable."
  );
  assert(
    gate.missing_target_check_ids.includes("missing_carried_check"),
    "Gate should report carried checks missing from the current blind eval report."
  );
  assert(gate.resolved === false, "Gate should fail unresolved carried checks separately.");
  assert(
    evalReport.total_score === 0.91,
    "Carry-forward gate must not mutate evaluator scoring."
  );
  assert(
    evalReport.check_results.every(
      (result) => !result.check_id.startsWith("previous_patch_request_")
    ),
    "Blind eval report check_results must not contain previous patch request checks."
  );

  console.log("validate:carry-forward-gate-separated passed");
};

main().catch((error) => {
  console.error("Carry-forward gate separation validation failed.");
  console.error(error);
  process.exitCode = 1;
});
