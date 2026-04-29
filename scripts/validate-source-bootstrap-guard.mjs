import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import { ensureDistModule } from "../.agents/skills/lib/ensure-dist.mjs";
import { prepareFrontDoorDist } from "./lib/front-door-build.mjs";
import { repoRoot } from "./testing/bootstrap-validator-helpers.mjs";

const guardedEnvKeys = [
  "HARNESS_ALLOW_SOURCE_BOOTSTRAP",
  "HARNESS_ALLOW_NPX_INSTALL"
];

const withoutBootstrapEnv = async (fn) => {
  const previous = Object.fromEntries(
    guardedEnvKeys.map((key) => [key, process.env[key]])
  );

  for (const key of guardedEnvKeys) {
    delete process.env[key];
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

const main = async () => {
  await mkdir(join(repoRoot, ".tmp"), { recursive: true });
  const tempRoot = await mkdtemp(join(repoRoot, ".tmp", "source-bootstrap-guard-"));

  try {
    await withoutBootstrapEnv(async () => {
      const skillResult = await ensureDistModule(
        tempRoot,
        "packages/loop-orchestrator/dist/intent-gate-cli.js"
      );

      assert.equal(skillResult.ok, false);
      assert.match(skillResult.message, /source archive/i);
      assert.match(skillResult.message, /HARNESS_ALLOW_SOURCE_BOOTSTRAP=1/);

      const frontDoorCode = await prepareFrontDoorDist(
        tempRoot,
        join(tempRoot, "packages", "loop-orchestrator", "dist", "intent-gate-cli.js"),
        [join(tempRoot, "packages", "loop-orchestrator", "src")]
      );

      assert.equal(frontDoorCode, 1);
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

await main();
console.log("validate:source-bootstrap-guard passed");
