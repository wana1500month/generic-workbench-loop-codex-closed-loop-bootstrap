import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  applyChangeEnv,
  cleanupTempRoot,
  createBootstrapFixture,
  createTempRoot,
  ensureBuild,
  readJsonFile,
  repoRoot,
  runCommand
} from "./testing/bootstrap-validator-helpers.mjs";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const runApplyChange = async (fixture, env) =>
  runCommand(process.execPath, [fixture.applyChangeScriptPath], {
    cwd: fixture.workspaceRoot,
    env,
    shell: false
  });

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-bootstrap-fail-closed");

  try {
    const fixture = await createBootstrapFixture(tempRoot);
    const fakeCodexPath = join(repoRoot, "scripts", "testing", "fake-codex.mjs");

    const disabledRun = await runApplyChange(
      fixture,
      applyChangeEnv(fixture, {
        HARNESS_DISABLE_CODEX_AGENTS: "1",
        HARNESS_CODEX_BIN: process.execPath,
        HARNESS_CODEX_BIN_ARGS: JSON.stringify([fakeCodexPath])
      })
    );
    assert(disabledRun.code !== 0, "disabled generator run should exit non-zero");

    const disabledResult = await readJsonFile(fixture.outputPath);
    assert(disabledResult.ok === false, "disabled generator run must not report success");
    assert(
      String(disabledResult.summary).includes("disabled"),
      "disabled generator summary should mention disabled state"
    );
    const disabledRegistry = existsSync(fixture.sessionRegistryPath)
      ? await readJsonFile(fixture.sessionRegistryPath)
      : {};
    assert(
      disabledRegistry.generator === undefined,
      "disabled generator run must not write a generator session"
    );

    const unavailableFixture = await createBootstrapFixture(join(tempRoot, "unavailable"));
    const unavailableRun = await runApplyChange(
      unavailableFixture,
      applyChangeEnv(unavailableFixture, {
        HARNESS_CODEX_BIN: join(tempRoot, "missing-codex.exe")
      })
    );
    assert(unavailableRun.code !== 0, "unavailable generator run should exit non-zero");

    const unavailableResult = await readJsonFile(unavailableFixture.outputPath);
    assert(
      unavailableResult.ok === false,
      "unavailable generator run must not report success"
    );
    assert(
      String(unavailableResult.summary).includes("unavailable"),
      "unavailable generator summary should mention unavailable state"
    );
    assert(
      Array.isArray(unavailableResult.findings) &&
        unavailableResult.findings.some((entry) =>
          String(entry).toLowerCase().includes("spawn")
        ),
      "unavailable generator findings should mention spawn failure"
    );
    const unavailableRegistry = existsSync(unavailableFixture.sessionRegistryPath)
      ? await readJsonFile(unavailableFixture.sessionRegistryPath)
      : {};
    assert(
      unavailableRegistry.generator === undefined,
      "unavailable generator run must not write a generator session"
    );

    const disabledMetadata = JSON.parse(
      await readFile(join(fixture.roundDirectory, "artifacts", "generator-metadata.json"), "utf8")
    );
    assert(disabledMetadata.disabled === true, "disabled metadata should record disabled=true");

    console.log("Validated bootstrap generator fail-closed behavior.");
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
