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

const assertEvidencePathsExist = (fixture, evidencePaths) => {
  for (const relativePath of evidencePaths) {
    const absolutePath = join(fixture.roundDirectory, relativePath);
    assert(existsSync(absolutePath), `missing evidence path: ${absolutePath}`);
  }
};

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-bootstrap-evidence");

  try {
    const fakeCodexPath = join(repoRoot, "scripts", "testing", "fake-codex.mjs");

    const disabledFixture = await createBootstrapFixture(join(tempRoot, "disabled"));
    await runApplyChange(
      disabledFixture,
      applyChangeEnv(disabledFixture, {
        HARNESS_DISABLE_CODEX_AGENTS: "1",
        HARNESS_CODEX_BIN: process.execPath,
        HARNESS_CODEX_BIN_ARGS: JSON.stringify([fakeCodexPath])
      })
    );
    const disabledResult = await readJsonFile(disabledFixture.outputPath);
    const disabledMetadata = JSON.parse(
      await readFile(
        join(disabledFixture.roundDirectory, "artifacts", "generator-metadata.json"),
        "utf8"
      )
    );
    assert(disabledMetadata.response_written === false, "disabled response_written must be false");
    assertEvidencePathsExist(disabledFixture, disabledResult.evidence_paths);
    assert(
      !disabledResult.evidence_paths.some((path) => path.endsWith("generator-response.json")),
      "disabled run must not advertise a missing response artifact"
    );

    const unavailableFixture = await createBootstrapFixture(join(tempRoot, "unavailable"));
    await runApplyChange(
      unavailableFixture,
      applyChangeEnv(unavailableFixture, {
        HARNESS_CODEX_BIN: join(tempRoot, "missing-codex.exe")
      })
    );
    const unavailableResult = await readJsonFile(unavailableFixture.outputPath);
    const unavailableMetadata = JSON.parse(
      await readFile(
        join(unavailableFixture.roundDirectory, "artifacts", "generator-metadata.json"),
        "utf8"
      )
    );
    assert(
      unavailableMetadata.response_written === false,
      "unavailable response_written must be false"
    );
    assertEvidencePathsExist(unavailableFixture, unavailableResult.evidence_paths);
    assert(
      !unavailableResult.evidence_paths.some((path) => path.endsWith("generator-response.json")),
      "unavailable run must not advertise a missing response artifact"
    );

    const missingResponseFixture = await createBootstrapFixture(join(tempRoot, "missing-response"));
    await runApplyChange(
      missingResponseFixture,
      applyChangeEnv(missingResponseFixture, {
        HARNESS_CODEX_BIN: process.execPath,
        HARNESS_CODEX_BIN_ARGS: JSON.stringify([fakeCodexPath]),
        FAKE_CODEX_MODE: "missing-response"
      })
    );
    const missingResponseResult = await readJsonFile(missingResponseFixture.outputPath);
    const missingResponseMetadata = JSON.parse(
      await readFile(
        join(missingResponseFixture.roundDirectory, "artifacts", "generator-metadata.json"),
        "utf8"
      )
    );
    assert(
      missingResponseMetadata.response_written === false,
      "missing-response response_written must be false"
    );
    assertEvidencePathsExist(missingResponseFixture, missingResponseResult.evidence_paths);
    assert(
      !missingResponseResult.evidence_paths.some((path) => path.endsWith("generator-response.json")),
      "missing-response run must not advertise a missing response artifact"
    );

    const successFixture = await createBootstrapFixture(join(tempRoot, "success"));
    const recordPath = join(tempRoot, "success-record.json");
    const successRun = await runApplyChange(
      successFixture,
      applyChangeEnv(successFixture, {
        HARNESS_CODEX_BIN: process.execPath,
        HARNESS_CODEX_BIN_ARGS: JSON.stringify([fakeCodexPath]),
        FAKE_CODEX_MODE: "success",
        FAKE_CODEX_RECORD_PATH: recordPath,
        FAKE_CODEX_RESPONSE: "{\"status\":\"ok\"}"
      })
    );
    assert(successRun.code === 0, "successful fake-codex run should exit zero");
    const successResult = await readJsonFile(successFixture.outputPath);
    const successMetadata = JSON.parse(
      await readFile(
        join(successFixture.roundDirectory, "artifacts", "generator-metadata.json"),
        "utf8"
      )
    );
    assert(successMetadata.response_written === true, "success response_written must be true");
    assertEvidencePathsExist(successFixture, successResult.evidence_paths);
    assert(
      successResult.evidence_paths.some((path) => path.endsWith("generator-response.json")),
      "successful run should include response artifact evidence"
    );

    console.log("Validated bootstrap Codex evidence integrity.");
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
