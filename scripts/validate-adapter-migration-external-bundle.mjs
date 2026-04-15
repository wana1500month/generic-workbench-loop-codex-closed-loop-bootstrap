import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  assertRuntimeEventCode,
  assertRuntimeWarningContains,
  assertTextContains,
  extractRunDirectory,
  isCurrentThreadCheckpointStopReason,
  readJsonFile,
  readSummary,
  readTextFile,
  runLoop
} from "./validation-utils.mjs";

const boundCurrentThreadEnv = {
  ...process.env,
  CODEX_THREAD_ID: "thread_validate_adapter_migration_external_bundle"
};

const continueRun = async (runDirectory) => {
  const execution = await runLoop(["--resume-run", runDirectory], {
    env: boundCurrentThreadEnv,
    silent: true
  });
  if (execution.code !== 0) {
    throw new Error(
      `Resume failed for ${runDirectory}.\nSTDOUT:\n${execution.stdout}\nSTDERR:\n${execution.stderr}`
    );
  }
  return readSummary(runDirectory);
};

const writeExternalProposalBundle = async (input) => {
  const beforeAdapter = await readJsonFile(input.adapterPath);
  const afterAdapter = {
    ...beforeAdapter,
    notes: [
      ...(Array.isArray(beforeAdapter.notes) ? beforeAdapter.notes : []),
      `Proposal bundle ${input.proposalId}: update run_target so the external adapter publishes app_url before this run resumes.`
    ]
  };
  const beforeText = `${JSON.stringify(beforeAdapter, null, 2)}\n`;
  const afterText = `${JSON.stringify(afterAdapter, null, 2)}\n`;

  const patchWorkspace = join(input.tempRoot, "external-migration-patch");
  const beforeFile = join(patchWorkspace, "before", "adapter.json");
  const afterFile = join(patchWorkspace, "after", "adapter.json");
  await mkdir(dirname(beforeFile), { recursive: true });
  await mkdir(dirname(afterFile), { recursive: true });
  await writeFile(beforeFile, beforeText, "utf8");
  await writeFile(afterFile, afterText, "utf8");

  const diffResult = spawnSync(
    "git",
    [
      "diff",
      "--no-index",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "before/adapter.json",
      "after/adapter.json"
    ],
    {
      cwd: patchWorkspace,
      encoding: "utf8",
      windowsHide: true
    }
  );
  if (![0, 1].includes(diffResult.status ?? 1)) {
    throw new Error(
      `git diff failed while authoring external adapter migration bundle.\n${diffResult.stdout}\n${diffResult.stderr}`
    );
  }
  const patchText = String(diffResult.stdout)
    .replaceAll("before/adapter.json", "adapter.json")
    .replaceAll("after/adapter.json", "adapter.json");
  await writeFile(input.patchPath, patchText, "utf8");
};

console.log("[validate-adapter-migration-external-bundle] current-thread external proposal bundle");

const execution = await runLoop(
  [
    "--controller-mode",
    "attached",
    "--transport",
    "current-thread",
    "--adapter",
    "./.tmp/semantic-validation/hidden-app-url/adapter.json",
    "--evaluator-profile",
    "./.tmp/semantic-validation/verification-profile.json",
    "--max-rounds",
    "2"
  ],
  {
    env: boundCurrentThreadEnv,
    silent: true
  }
);
if (execution.code !== 0) {
  throw new Error(
    `External proposal bundle fixture failed.\nSTDOUT:\n${execution.stdout}\nSTDERR:\n${execution.stderr}`
  );
}

const runDirectory = extractRunDirectory(execution.stdout);
const tempRoot = join(runDirectory, "runtime", "external-bundle-validator");
let summary = await readSummary(runDirectory);
let sawAuthoringCheckpoint = false;
let wroteApproval = false;

for (let hop = 0; hop < 20; hop += 1) {
  if (summary.stop_reason === "awaiting_external_condition") {
    break;
  }

  if (isCurrentThreadCheckpointStopReason(summary.stop_reason)) {
    const operatorSurface = await readJsonFile(summary.operator_surface_path);
    const responsePath = operatorSurface.active_response_path;
    assert.equal(operatorSurface.transport_mode, "current-thread");
    assert.equal(operatorSurface.attention_required, "codex");
    if (operatorSurface.checkpoint_kind === "adapter-migration-authoring") {
      sawAuthoringCheckpoint = true;
      const roundDirectory = dirname(dirname(responsePath));
      const patchPath = join(dirname(responsePath), "adapter-migration.patch");
      const proposal = await readJsonFile(
        join(roundDirectory, "adapter-migration-proposal.json")
      );
      await writeExternalProposalBundle({
        tempRoot,
        adapterPath: "./.tmp/semantic-validation/hidden-app-url/adapter.json",
        patchPath,
        proposalId: proposal.proposal_id
      });
      await writeFile(
        responsePath,
        `${JSON.stringify(
          {
            checkpoint_id: operatorSurface.checkpoint_id,
            status: "authored",
            summary:
              "Author an advisory bundle that documents the external adapter follow-up for publishing app_url.",
            patch_bundle_path: patchPath,
            changed_files: ["adapter.json"],
            notes: ["validated external proposal bundle authoring"],
            generated_at: new Date().toISOString()
          },
          null,
          2
        )}\n`,
        "utf8"
      );
    } else if (operatorSurface.checkpoint_kind === "attached-generator") {
      await writeFile(
        responsePath,
        `${JSON.stringify(
          {
            checkpoint_id: operatorSurface.checkpoint_id,
            status: "noop",
            summary: "No generator mutation required for external migration validation.",
            changed_files: [],
            generated_at: new Date().toISOString()
          },
          null,
          2
        )}\n`,
        "utf8"
      );
    } else {
      await writeFile(
        responsePath,
        `${JSON.stringify(
          {
            checkpoint_id: operatorSurface.checkpoint_id
          },
          null,
          2
        )}\n`,
        "utf8"
      );
    }
    summary = await continueRun(runDirectory);
    continue;
  }

  if (summary.stop_reason === "awaiting_human_input") {
    const operatorSurface = await readJsonFile(summary.operator_surface_path);
    assert.equal(operatorSurface.checkpoint_kind, "adapter-migration-approval");
    const roundDirectory = dirname(operatorSurface.active_response_path);
    const proposal = await readJsonFile(join(roundDirectory, "adapter-migration-proposal.json"));
    const proposalMd = await readTextFile(join(roundDirectory, "adapter-migration-proposal.md"));
    const approvalPrompt = await readTextFile(
      join(roundDirectory, "adapter-migration-approval-prompt.md")
    );
    const instructions = await readTextFile(
      join(roundDirectory, "adapter-migration-instructions.md")
    );

    assert.equal(sawAuthoringCheckpoint, true);
    assert.equal(proposal.adapter_origin, "external_contract");
    assert.equal(proposal.apply_mode, "proposal_only");
    assert.equal(proposal.same_run_eligible, false);
    assert.equal(proposal.requires_operator_acceptance, true);
    assert.equal(typeof proposal.patch_bundle_path, "string");
    assert.equal(
      proposal.expected_post_apply_identity.adapter_contract_path,
      proposal.current_identity.adapter_contract_path
    );
    assertTextContains(
      proposalMd,
      "## Expected Post-Apply Identity",
      "adapter migration proposal markdown"
    );
    assertTextContains(
      proposalMd,
      "## Decision Semantics",
      "adapter migration proposal markdown"
    );
    assertTextContains(
      approvalPrompt,
      "## Decision semantics",
      "adapter migration approval prompt"
    );
    assertTextContains(
      approvalPrompt,
      "external/manual apply",
      "adapter migration approval prompt"
    );
    assertTextContains(
      instructions,
      "Proposal-only external bundles are advisory",
      "adapter migration instructions"
    );
    assertTextContains(
      instructions,
      "verify the expected post-apply identity",
      "adapter migration instructions"
    );

    await writeFile(
      operatorSurface.active_response_path,
      `${JSON.stringify(
        {
          proposal_id: proposal.proposal_id,
          decision: "accept",
          note: "validated external proposal bundle lane"
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    wroteApproval = true;
    summary = await continueRun(runDirectory);
    continue;
  }

  break;
}

assert.equal(sawAuthoringCheckpoint, true);
assert.equal(wroteApproval, true);
assert.equal(summary.stop_reason, "awaiting_external_condition");
assertRuntimeEventCode(summary, "adapter.migration_accepted");
assertRuntimeWarningContains(
  summary,
  "still requires external or manual apply work before same-run continuation can resume"
);
assert.equal(summary.adapter_migration_applied_path, undefined);

const operatorSurface = await readJsonFile(summary.operator_surface_path);
assert.equal(operatorSurface.attention_required, "external");
assert.equal(operatorSurface.checkpoint_kind, "adapter-migration-approval");
assert.equal(operatorSurface.decision_options, undefined);

console.log("[validate-adapter-migration-external-bundle] complete");
