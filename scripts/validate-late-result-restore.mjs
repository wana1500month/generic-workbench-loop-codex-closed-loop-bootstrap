import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  cleanupTempRoot,
  createBootstrapFixture,
  createTempRoot,
  ensureBuild,
  importDist,
  readJsonFile,
  writeJsonFile
} from "./testing/bootstrap-validator-helpers.mjs";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const pathExists = async (path) => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-late-result-restore");

  try {
    const fixture = await createBootstrapFixture(tempRoot);
    const { loadAdapterContract, restoreAdapterCapabilityExecution } =
      await importDist("adapter-runtime.js");

    const loadedAdapter = await loadAdapterContract(fixture.paths.adapterPath);
    assert(loadedAdapter, "Expected generated adapter contract to load.");

    const executionId = "late-timeout-execution";
    const roundContractPath = join(fixture.roundDirectory, "round-contract.json");
    const generatorPlanPath = join(fixture.roundDirectory, "generator-plan.json");
    const stdoutPath = join(fixture.adapterDirectory, "apply_change-stdout.log");
    const stderrPath = join(fixture.adapterDirectory, "apply_change-stderr.log");
    const attemptPath = join(fixture.adapterDirectory, "apply_change-attempt.json");

    await writeJsonFile(roundContractPath, {
      round: 1,
      contract_mode: "initial_build"
    });
    await writeJsonFile(generatorPlanPath, {
      round: 1,
      summary: "late result restore fixture"
    });
    await writeJsonFile(fixture.inputPath, {
      adapter_id: loadedAdapter.contract.adapter_id,
      capability: "apply_change",
      execution_id: executionId,
      run_id: "run-late-result",
      round: 1,
      run_directory: fixture.runDirectory,
      round_directory: fixture.roundDirectory,
      runtime_directory: fixture.runtimeDirectory,
      target_root: fixture.targetRoot,
      round_contract_path: roundContractPath,
      generator_plan_path: generatorPlanPath
    });
    await writeJsonFile(attemptPath, {
      capability: "apply_change",
      execution_id: executionId,
      status: "timed_out",
      started_at: "2026-04-12T00:00:00.000Z",
      updated_at: "2026-04-12T00:10:00.000Z",
      timed_out_at: "2026-04-12T00:10:00.000Z",
      finished_at: "2026-04-12T00:10:00.000Z",
      timeout_ms: 1,
      packet_path: fixture.inputPath,
      result_path: fixture.outputPath,
      stdout_path: stdoutPath,
      stderr_path: stderrPath,
      command: "node",
      args: [fixture.applyChangeScriptPath],
      exit_code: null
    });
    await writeJsonFile(fixture.outputPath, {
      capability: "apply_change",
      ok: true,
      summary: "Late orphaned apply_change result that should be quarantined.",
      findings: [],
      evidence_paths: [],
      metadata: {
        execution_id: executionId
      }
    });

    const restored = await restoreAdapterCapabilityExecution({
      loadedAdapter,
      capability: "apply_change",
      roundDirectory: fixture.roundDirectory
    });

    assert(restored === undefined, "Timed-out late result should not be restored.");
    assert(!(await pathExists(fixture.outputPath)), "Late result should be moved away from the canonical result path.");

    const lateResultsDirectory = join(fixture.adapterDirectory, "late-results");
    const lateResultEntries = await readdir(lateResultsDirectory);
    assert(
      lateResultEntries.includes("apply_change-late-timeout-execution-late-result.json"),
      `Expected quarantined late result file, found: ${lateResultEntries.join(", ")}`
    );

    const quarantinedResult = await readJsonFile(
      join(lateResultsDirectory, "apply_change-late-timeout-execution-late-result.json")
    );
    assert(
      quarantinedResult.metadata?.execution_id === executionId,
      "Quarantined late result should preserve execution metadata."
    );

    console.log("Validated timed-out late result restore quarantine.");
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
