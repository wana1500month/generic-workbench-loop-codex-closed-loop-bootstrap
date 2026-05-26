import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  cleanupTempRoot,
  createTempRoot,
  importDist
} from "./testing/bootstrap-validator-helpers.mjs";

const main = async () => {
  const tempRoot = await createTempRoot("validate-non-web-target");

  try {
    const targetRoot = join(tempRoot, "cli-tool");
    await mkdir(targetRoot, { recursive: true });
    const [{ buildReadinessReport }, { buildEvaluationPolicy }] = await Promise.all([
      importDist("readiness-doctor.js"),
      importDist("evaluation-policy.js")
    ]);
    const intake = {
      product_summary: "Build a CLI log analyzer.",
      project_kind: "cli_tool",
      evidence_surfaces: ["cli", "file", "test"],
      verification_surfaces: ["cli", "file", "test"],
      target_root: targetRoot,
      project_mode: "existing",
      run_command: "node ./bin/log-analyzer.js sample.log",
      core_features: ["parse a log file"]
    };
    const readiness = await buildReadinessReport({
      runId: "cli-ready",
      runDirectory: join(tempRoot, "runs", "cli-ready"),
      isProductBuild: true,
      sourceIntake: intake
    });
    assert.equal(readiness.ready, true);
    assert.equal(
      readiness.blockers.some((blocker) => blocker.code === "READY_URL_MISSING"),
      false
    );

    const policy = buildEvaluationPolicy({ intake });
    assert.equal(policy.project_kind, "cli_tool");
    assert.deepEqual(policy.evidence_surfaces.slice(0, 3), [
      "cli",
      "file",
      "test"
    ]);
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

await main();
console.log("validate:non-web-target passed");
