import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  cleanupTempRoot,
  createTempRoot,
  ensureBuild,
  importDist
} from "./testing/bootstrap-validator-helpers.mjs";

await ensureBuild();

const { runCodexCommand, checkCodexAuth } = await importDist("codex-runtime.js");
const repoRoot = resolve(".");
const tempRoot = await createTempRoot("codex-timeout");
const fakeCodexPath = resolve(repoRoot, "scripts", "testing", "fake-codex.mjs");
const previousEnv = {
  HARNESS_CODEX_BIN: process.env.HARNESS_CODEX_BIN,
  HARNESS_CODEX_BIN_ARGS: process.env.HARNESS_CODEX_BIN_ARGS,
  HARNESS_CODEX_COMMAND_TIMEOUT_MS: process.env.HARNESS_CODEX_COMMAND_TIMEOUT_MS,
  FAKE_CODEX_MODE: process.env.FAKE_CODEX_MODE,
  FAKE_CODEX_HANG_MS: process.env.FAKE_CODEX_HANG_MS
};

const restoreEnv = () => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

try {
  process.env.HARNESS_CODEX_BIN = process.execPath;
  process.env.HARNESS_CODEX_BIN_ARGS = JSON.stringify([fakeCodexPath]);
  process.env.FAKE_CODEX_HANG_MS = "600000";

  process.env.FAKE_CODEX_MODE = "hang";
  const wallClock = await runCodexCommand({
    name: "wall-clock-timeout",
    prompt: "Hang until the harness kills this process.",
    cwd: tempRoot,
    artifactDirectory: join(tempRoot, "wall"),
    timeoutMs: 250,
    staleOutputTimeoutMs: 1000
  });
  assert.equal(wallClock.code, 124);
  assert.equal(wallClock.timedOut, true);
  assert.equal(wallClock.timeoutReason, "wall_clock_timeout");
  const wallMetadata = JSON.parse(
    await readFile(join(tempRoot, "wall", "wall-clock-timeout-metadata.json"), "utf8")
  );
  assert.equal(wallMetadata.timed_out, true);
  assert.equal(wallMetadata.timeout_reason, "wall_clock_timeout");

  process.env.FAKE_CODEX_MODE = "stale-after-start";
  const stale = await runCodexCommand({
    name: "stale-output-timeout",
    prompt: "Emit one event, then stop producing output.",
    cwd: tempRoot,
    artifactDirectory: join(tempRoot, "stale"),
    timeoutMs: 2000,
    staleOutputTimeoutMs: 250
  });
  assert.equal(stale.code, 124);
  assert.equal(stale.timedOut, true);
  assert.equal(stale.timeoutReason, "stale_output_timeout");

  process.env.FAKE_CODEX_MODE = "hang-login";
  process.env.HARNESS_CODEX_COMMAND_TIMEOUT_MS = "250";
  const auth = await checkCodexAuth({
    strict: false,
    requireChatgpt: true,
    requireFileBacked: false,
    cwd: tempRoot
  });
  assert.equal(auth.ok, false);
  assert.equal(auth.statusCode, 124);
  assert.equal(auth.timedOut, true);

  console.log("[validate-codex-timeout] complete");
} finally {
  restoreEnv();
  if (process.env.HARNESS_KEEP_VALIDATION_TMP !== "1") {
    await cleanupTempRoot(tempRoot);
  }
}
