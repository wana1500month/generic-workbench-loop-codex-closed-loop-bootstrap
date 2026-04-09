import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

    const attachedFixture = await createBootstrapFixture(join(tempRoot, "attached-current-thread"));
    const attachedResponsePath = join(
      attachedFixture.roundDirectory,
      "runtime",
      "attached-generator-response.json"
    );
    const attachedTaskPath = join(
      attachedFixture.roundDirectory,
      "runtime",
      "attached-generator-task.json"
    );
    await mkdir(join(attachedFixture.roundDirectory, "runtime"), { recursive: true });
    await Promise.all([
      writeFile(
        attachedTaskPath,
        JSON.stringify(
          {
            run_id: "attached-bootstrap",
            round: 1,
            transport_mode: "current-thread"
          },
          null,
          2
        ) + "\n",
        "utf8"
      ),
      writeFile(
        attachedResponsePath,
        JSON.stringify(
          {
            status: "applied",
            summary: "manual attached generator applied the change",
            generated_at: new Date().toISOString()
          },
          null,
          2
        ) + "\n",
        "utf8"
      )
    ]);
    const attachedRun = await runApplyChange(
      attachedFixture,
      applyChangeEnv(attachedFixture, {
        HARNESS_CONTROLLER_MODE: "attached",
        HARNESS_TRANSPORT: "current-thread",
        HARNESS_ATTACHED_GENERATOR_TASK_PATH: attachedTaskPath,
        HARNESS_GENERATOR_RESPONSE_PATH: attachedResponsePath
      })
    );
    assert(attachedRun.code === 0, "attached generator response run should succeed");

    const attachedResult = await readJsonFile(attachedFixture.outputPath);
    assert(attachedResult.ok === true, "attached generator response run must report success");
    assert(
      String(attachedResult.summary).includes("attached generator completed"),
      "attached generator summary should mention same-thread completion"
    );

    console.log("Validated bootstrap generator fail-closed behavior.");
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
