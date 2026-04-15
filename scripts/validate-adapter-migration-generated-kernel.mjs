import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  cleanupTempRoot,
  createBootstrapFixture,
  createTempRoot,
  ensureBuild,
  readJsonFile
} from "./testing/bootstrap-validator-helpers.mjs";
import {
  extractRunDirectory,
  isCurrentThreadCheckpointStopReason,
  readSummary,
  runLoop
} from "./validation-utils.mjs";

const boundCurrentThreadEnv = {
  ...process.env,
  CODEX_THREAD_ID: "thread_validate_adapter_migration_generated_kernel"
};

const continueRun = async (runDirectory) => {
  const execution = await runLoop(
    ["--resume-run", runDirectory],
    {
      env: boundCurrentThreadEnv,
      silent: true
    }
  );
  if (execution.code !== 0) {
    throw new Error(
      `Resume failed for ${runDirectory}.\nSTDOUT:\n${execution.stdout}\nSTDERR:\n${execution.stderr}`
    );
  }
  return readSummary(runDirectory);
};

const writeKernelPatchBundle = async (input) => {
  const brokenAdapter = await readJsonFile(input.adapterPath);
  brokenAdapter.verification_provider.capabilities.run_checks.args = [
    "./.generated/codex-adapter/scripts/run-checks.mjs"
  ];
  const fixedText = `${JSON.stringify(brokenAdapter, null, 2)}\n`;

  const patchWorkspace = join(input.tempRoot, "kernel-migration-patch");
  const beforeFile = join(patchWorkspace, "before", "adapter.generated.json");
  const afterFile = join(patchWorkspace, "after", "adapter.generated.json");
  await mkdir(dirname(beforeFile), { recursive: true });
  await mkdir(dirname(afterFile), { recursive: true });
  await writeFile(beforeFile, await readJsonFile(input.adapterPath).then((value) => `${JSON.stringify(value, null, 2)}\n`), "utf8");
  await writeFile(afterFile, fixedText, "utf8");

  const diffResult = spawnSync(
    "git",
    [
      "diff",
      "--no-index",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "before/adapter.generated.json",
      "after/adapter.generated.json"
    ],
    {
      cwd: patchWorkspace,
      encoding: "utf8",
      windowsHide: true
    }
  );
  if (![0, 1].includes(diffResult.status ?? 1)) {
    throw new Error(
      `git diff failed while authoring adapter migration bundle.\n${diffResult.stdout}\n${diffResult.stderr}`
    );
  }
  const patchText = String(diffResult.stdout)
    .replaceAll("before/adapter.generated.json", "adapter.generated.json")
    .replaceAll("after/adapter.generated.json", "adapter.generated.json");
  await writeFile(input.patchPath, patchText, "utf8");
};

console.log("[validate-adapter-migration-generated-kernel] bootstrap generated kernel drift");
await ensureBuild();

const tempRoot = await createTempRoot("validate-adapter-migration-generated-kernel");

try {
  const fixture = await createBootstrapFixture(tempRoot, {
    title: "Generated Kernel Drift",
    summary: "Validate generated-local kernel wiring migration authoring and same-run apply.",
    targetFamily: "api-service",
    readyUrl: "http://127.0.0.1:40123/healthz",
    appUrl: undefined,
    healthUrl: undefined,
    apiBaseUrl: "http://127.0.0.1:40123/api/",
    checkCommand: "",
    qualityBar: ["The generated adapter should keep verifier wiring separate from executor wiring."]
  });

  const adapterContract = await readJsonFile(fixture.paths.adapterPath);
  adapterContract.verification_provider.capabilities.run_checks.args = [
    "./.generated/codex-adapter/scripts/apply-change.mjs"
  ];
  await writeFile(
    fixture.paths.adapterPath,
    `${JSON.stringify(adapterContract, null, 2)}\n`,
    "utf8"
  );

  const execution = await runLoop(
    [
      "--controller-mode",
      "attached",
      "--transport",
      "current-thread",
      "--adapter",
      fixture.paths.adapterPath,
      "--rubric",
      fixture.paths.generatedRubricPath,
      "--evaluator-profile",
      fixture.paths.generatedVerificationProfilePath,
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
      `Generated kernel migration fixture failed.\nSTDOUT:\n${execution.stdout}\nSTDERR:\n${execution.stderr}`
    );
  }

  const runDirectory = extractRunDirectory(execution.stdout);
  let summary = await readSummary(runDirectory);
  let sawAuthoringCheckpoint = false;
  let wroteApproval = false;

  for (let hop = 0; hop < 20; hop += 1) {
    if (summary.adapter_migration_applied_path) {
      break;
    }

    if (isCurrentThreadCheckpointStopReason(summary.stop_reason)) {
      const operatorSurface = await readJsonFile(summary.operator_surface_path);
      const responsePath = operatorSurface.active_response_path;
      assert.equal(operatorSurface.transport_mode, "current-thread");
      assert.equal(operatorSurface.attention_required, "codex");
      if (operatorSurface.checkpoint_kind === "adapter-migration-authoring") {
        sawAuthoringCheckpoint = true;
        const patchPath = join(
          dirname(dirname(responsePath)),
          "adapter-migration.patch"
        );
        await writeKernelPatchBundle({
          tempRoot,
          adapterPath: fixture.paths.adapterPath,
          patchPath
        });
        await writeFile(
          responsePath,
          `${JSON.stringify(
            {
              checkpoint_id: operatorSurface.checkpoint_id,
              status: "authored",
              summary: "Restore verifier run_checks wiring to the generated run-checks script.",
              patch_bundle_path: patchPath,
              changed_files: ["adapter.generated.json"],
              notes: ["validated same-thread kernel migration authoring"],
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
              summary: "No additional generator mutation required for migration validation.",
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
      const responsePath = operatorSurface.active_response_path;
      const proposal = await readJsonFile(
        join(dirname(responsePath), "adapter-migration-proposal.json")
      );
      assert.equal(sawAuthoringCheckpoint, true);
      await writeFile(
        responsePath,
        `${JSON.stringify(
          {
            proposal_id: proposal.proposal_id,
            decision: "accept",
            note: "validated same-run kernel migration apply"
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
  assert.equal(
    summary.stop_reason === "awaiting_external_condition",
    false,
    "Generated-local accepted kernel migration should not reopen as awaiting_external_condition."
  );
  assert.equal(
    typeof summary.adapter_migration_applied_path,
    "string",
    "Summary should surface adapter_migration_applied_path after same-run apply."
  );

  const proposal = await readJsonFile(
    join(runDirectory, "round-002", "adapter-migration-proposal.json")
  );
  const applied = await readJsonFile(summary.adapter_migration_applied_path);
  const resumeMigration = await readJsonFile(summary.resume_migration_path);
  const finalAdapterContract = await readJsonFile(fixture.paths.adapterPath);

  assert.equal(proposal.adapter_origin, "generated_local");
  assert.equal(proposal.migration_class, "kernel_wiring_patch");
  assert.equal(proposal.apply_mode, "same_run_in_place");
  assert.equal(proposal.same_run_eligible, true);
  assert.equal(proposal.autoapply_eligible, false);
  assert.equal(typeof proposal.patch_bundle_path, "string");

  assert.equal(applied.proposal_id, proposal.proposal_id);
  assert.equal(applied.apply_mode, "same_run_in_place");
  assert.equal(applied.same_run_authorized, true);
  assert(
    applied.changed_files.some((changedFile) =>
      String(changedFile).replace(/\\/g, "/").endsWith("adapter.generated.json")
    ),
    "Applied kernel migration should record adapter.generated.json as a changed file."
  );

  assert.equal(
    finalAdapterContract.verification_provider.capabilities.run_checks.args[0],
    "./.generated/codex-adapter/scripts/run-checks.mjs"
  );
  assert(
    Array.isArray(finalAdapterContract.notes) &&
      finalAdapterContract.notes.some((note) =>
        String(note).includes(`Applied kernel-wiring migration ${proposal.proposal_id}`)
      ),
    "Adapter contract should record the applied kernel-wiring migration note."
  );
  assert.equal(resumeMigration.authorized_adapter_migration, true);
  assert.equal(
    resumeMigration.adapter_migration_proposal_path,
    join(runDirectory, "round-002", "adapter-migration-proposal.json")
  );
  assert(
    (summary.runtime_events ?? []).some((event) => event.code === "adapter.migration_accepted"),
    "Summary should record adapter.migration_accepted."
  );
  assert(
    (summary.runtime_events ?? []).some((event) => event.code === "adapter.migration_applied"),
    "Summary should record adapter.migration_applied."
  );

  console.log("[validate-adapter-migration-generated-kernel] complete");
} finally {
  await cleanupTempRoot(tempRoot);
}
