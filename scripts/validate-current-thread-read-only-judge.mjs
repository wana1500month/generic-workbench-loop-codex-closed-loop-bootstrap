import { join } from "node:path";

import {
  cleanupTempRoot,
  createTempRoot,
  ensureBuild,
  importDist,
  readJsonFile,
  repoRoot
} from "./testing/bootstrap-validator-helpers.mjs";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const restoreEnv = (key, value) => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
};

const validateTransport = async ({ runCodexCommand, tempRoot, transportMode }) => {
  process.env.HARNESS_TRANSPORT = transportMode;

  const blockedExecution = await runCodexCommand({
    name: `${transportMode}-blocked-generator`,
    prompt: "blocked nested generator",
    cwd: repoRoot,
    artifactDirectory: join(tempRoot, transportMode, "blocked-generator")
  });
  assert(
    blockedExecution.disabled === true,
    `${transportMode}: ordinary nested Codex execution should remain blocked.`
  );
  assert(
    blockedExecution.error?.includes("Current-thread transports forbid nested Codex command execution"),
    `${transportMode}: blocked execution should explain the current-thread transport restriction.`
  );

  const blockedMetadata = await readJsonFile(blockedExecution.metadataPath);
  assert(
    blockedMetadata.current_thread_transport_blocked === true,
    `${transportMode}: blocked execution metadata should mark current_thread_transport_blocked.`
  );
  assert(
    blockedMetadata.allow_current_thread_read_only_judge === false,
    `${transportMode}: blocked execution metadata should record that the judge exception was not enabled.`
  );

  const narrowBlockedExecution = await runCodexCommand({
    name: `${transportMode}-blocked-non-judge`,
    prompt: "allow flag without judge metadata should still block",
    cwd: repoRoot,
    artifactDirectory: join(tempRoot, transportMode, "blocked-non-judge"),
    allowCurrentThreadReadOnlyJudge: true,
    configOverrides: {
      approval_policy: "never",
      sandbox_mode: "read-only"
    },
    metadata: {
      role: "generator",
      capability: "apply_change"
    }
  });
  assert(
    narrowBlockedExecution.disabled === true,
    `${transportMode}: the read-only judge exception must stay narrow.`
  );

  const recordPath = join(tempRoot, transportMode, "judge-records.json");
  process.env.FAKE_CODEX_RECORD_PATH = recordPath;
  process.env.FAKE_CODEX_RESPONSE = JSON.stringify({
    metrics: [
      {
        metric_id: "interaction_clarity",
        score_out_of_ten: 9.1,
        rationale: "Synthetic validator response."
      }
    ]
  });

  const allowedJudgeExecution = await runCodexCommand({
    name: `${transportMode}-subjective-quality-judge`,
    prompt: "read-only judge",
    cwd: repoRoot,
    artifactDirectory: join(tempRoot, transportMode, "read-only-judge"),
    allowCurrentThreadReadOnlyJudge: true,
    configOverrides: {
      approval_policy: "never",
      sandbox_mode: "read-only",
      "sandbox_read_only.network_access": false
    },
    metadata: {
      role: "judge",
      capability: "grade_round"
    }
  });
  assert(
    allowedJudgeExecution.disabled === false,
    `${transportMode}: read-only subjective judge should be allowed to run.`
  );
  assert(
    allowedJudgeExecution.code === 0,
    `${transportMode}: read-only subjective judge should exit successfully.`
  );

  const judgeMetadata = await readJsonFile(allowedJudgeExecution.metadataPath);
  assert(
    judgeMetadata.current_thread_transport_blocked !== true,
    `${transportMode}: allowed judge metadata should not report a transport block.`
  );

  const judgeRecords = await readJsonFile(recordPath);
  assert(
    Array.isArray(judgeRecords) && judgeRecords.length === 1,
    `${transportMode}: fake codex should be invoked exactly once for the allowed judge path.`
  );
  assert(
    judgeRecords[0]?.used_resume === false,
    `${transportMode}: allowed judge path should execute a fresh read-only Codex command.`
  );
};

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-current-thread-read-only-judge");
  const previousEnv = {
    HARNESS_TRANSPORT: process.env.HARNESS_TRANSPORT,
    HARNESS_CODEX_BIN: process.env.HARNESS_CODEX_BIN,
    HARNESS_CODEX_BIN_ARGS: process.env.HARNESS_CODEX_BIN_ARGS,
    FAKE_CODEX_MODE: process.env.FAKE_CODEX_MODE,
    FAKE_CODEX_RECORD_PATH: process.env.FAKE_CODEX_RECORD_PATH,
    FAKE_CODEX_RESPONSE: process.env.FAKE_CODEX_RESPONSE
  };

  try {
    process.env.HARNESS_CODEX_BIN = process.execPath;
    process.env.HARNESS_CODEX_BIN_ARGS = JSON.stringify([
      join(repoRoot, "scripts", "testing", "fake-codex.mjs")
    ]);
    process.env.FAKE_CODEX_MODE = "success";

    const { runCodexCommand } = await importDist("codex-runtime.js");

    await validateTransport({
      runCodexCommand,
      tempRoot,
      transportMode: "current-thread"
    });
    await validateTransport({
      runCodexCommand,
      tempRoot,
      transportMode: "app-server"
    });

    console.log("Validated current-thread/app-server read-only judge transport exception.");
  } finally {
    restoreEnv("HARNESS_TRANSPORT", previousEnv.HARNESS_TRANSPORT);
    restoreEnv("HARNESS_CODEX_BIN", previousEnv.HARNESS_CODEX_BIN);
    restoreEnv("HARNESS_CODEX_BIN_ARGS", previousEnv.HARNESS_CODEX_BIN_ARGS);
    restoreEnv("FAKE_CODEX_MODE", previousEnv.FAKE_CODEX_MODE);
    restoreEnv("FAKE_CODEX_RECORD_PATH", previousEnv.FAKE_CODEX_RECORD_PATH);
    restoreEnv("FAKE_CODEX_RESPONSE", previousEnv.FAKE_CODEX_RESPONSE);
    await cleanupTempRoot(tempRoot);
  }
};

main().catch((error) => {
  console.error("Current-thread read-only judge validation failed.");
  console.error(error);
  process.exitCode = 1;
});
