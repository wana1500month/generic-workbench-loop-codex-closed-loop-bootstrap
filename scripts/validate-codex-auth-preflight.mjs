import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  cleanupTempRoot,
  createTempRoot,
  ensureBuild,
  importDist,
  repoRoot
} from "./testing/bootstrap-validator-helpers.mjs";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot("codex-auth-preflight");
  const previousEnv = {
    HARNESS_CODEX_BIN: process.env.HARNESS_CODEX_BIN,
    HARNESS_CODEX_BIN_ARGS: process.env.HARNESS_CODEX_BIN_ARGS,
    FAKE_CODEX_LOGIN_STATUS: process.env.FAKE_CODEX_LOGIN_STATUS,
    FAKE_CODEX_AUTH_MODE: process.env.FAKE_CODEX_AUTH_MODE,
    CODEX_HOME: process.env.CODEX_HOME
  };

  try {
    const codexHome = join(tempRoot, "codex-home");
    const authFilePath = join(codexHome, "auth.json");
    await mkdir(codexHome, { recursive: true });

    process.env.HARNESS_CODEX_BIN = process.execPath;
    process.env.HARNESS_CODEX_BIN_ARGS = JSON.stringify([
      join(repoRoot, "scripts", "testing", "fake-codex.mjs")
    ]);
    process.env.FAKE_CODEX_LOGIN_STATUS = "ok";
    process.env.FAKE_CODEX_AUTH_MODE = "chatgpt";
    process.env.CODEX_HOME = codexHome;

    const { checkCodexAuth } = await importDist("codex-runtime.js");

    const relaxed = await checkCodexAuth({
      strict: false,
      requireChatgpt: true,
      requireFileBacked: false,
      cwd: repoRoot
    });
    assert(relaxed.ok, `relaxed auth preflight should pass: ${relaxed.blockedReason ?? "unknown"}`);
    assert(relaxed.mode === "chatgpt", "relaxed auth preflight should detect chatgpt auth");

    const strictMissing = await checkCodexAuth({
      strict: true,
      requireChatgpt: true,
      requireFileBacked: true,
      cwd: repoRoot
    });
    assert(!strictMissing.ok, "strict auth preflight should fail when auth.json is missing");
    assert(
      strictMissing.blockedReason?.includes("auth file was not present"),
      "strict auth preflight should explain missing auth.json"
    );

    await writeFile(
      authFilePath,
      JSON.stringify(
        {
          auth_mode: "chatgpt",
          tokens: {
            access_token: "token",
            refresh_token: "refresh-token"
          }
        },
        null,
        2
      ) + "\n",
      "utf8"
    );

    const strictChatgpt = await checkCodexAuth({
      strict: true,
      requireChatgpt: true,
      requireFileBacked: true,
      cwd: repoRoot
    });
    assert(strictChatgpt.ok, `strict auth preflight should pass: ${strictChatgpt.blockedReason ?? "unknown"}`);
    assert(strictChatgpt.authFilePresent, "strict auth preflight should report auth file presence");
    assert(strictChatgpt.hasRefreshToken, "strict auth preflight should require a refresh token");

    await writeFile(
      authFilePath,
      JSON.stringify(
        {
          auth_mode: "api",
          tokens: {
            access_token: "token",
            refresh_token: "refresh-token"
          }
        },
        null,
        2
      ) + "\n",
      "utf8"
    );

    const strictApi = await checkCodexAuth({
      strict: true,
      requireChatgpt: true,
      requireFileBacked: true,
      cwd: repoRoot
    });
    assert(!strictApi.ok, "strict auth preflight should reject API-key auth");
    assert(
      strictApi.blockedReason?.includes("auth_mode must be 'chatgpt'"),
      "strict auth preflight should explain the auth_mode mismatch"
    );

    await writeFile(
      authFilePath,
      JSON.stringify(
        {
          auth_mode: "chatgpt",
          tokens: {
            access_token: "token"
          }
        },
        null,
        2
      ) + "\n",
      "utf8"
    );

    const strictMissingRefresh = await checkCodexAuth({
      strict: true,
      requireChatgpt: true,
      requireFileBacked: true,
      cwd: repoRoot
    });
    assert(!strictMissingRefresh.ok, "strict auth preflight should reject auth without refresh token");
    assert(
      strictMissingRefresh.blockedReason?.includes("refresh token"),
      "strict auth preflight should explain the missing refresh token"
    );

    process.env.FAKE_CODEX_AUTH_MODE = "api";
    await rm(authFilePath, { force: true });
    const relaxedApi = await checkCodexAuth({
      strict: false,
      requireChatgpt: true,
      requireFileBacked: false,
      cwd: repoRoot
    });
    assert(!relaxedApi.ok, "relaxed auth preflight should reject API-key auth when it is detectable");
    assert(
      relaxedApi.blockedReason?.includes("API-key auth"),
      "relaxed auth preflight should explain API-key auth detection"
    );

    process.env.FAKE_CODEX_LOGIN_STATUS = "fail";
    const loginFailure = await checkCodexAuth({
      strict: false,
      requireChatgpt: true,
      requireFileBacked: false,
      cwd: repoRoot
    });
    assert(!loginFailure.ok, "auth preflight should fail when login status fails");

    console.log("Validated Codex auth preflight.");
  } finally {
    const restore = (key, value) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    };

    restore("HARNESS_CODEX_BIN", previousEnv.HARNESS_CODEX_BIN);
    restore("HARNESS_CODEX_BIN_ARGS", previousEnv.HARNESS_CODEX_BIN_ARGS);
    restore("FAKE_CODEX_LOGIN_STATUS", previousEnv.FAKE_CODEX_LOGIN_STATUS);
    restore("FAKE_CODEX_AUTH_MODE", previousEnv.FAKE_CODEX_AUTH_MODE);
    restore("CODEX_HOME", previousEnv.CODEX_HOME);
    await cleanupTempRoot(tempRoot);
  }
};

main().catch((error) => {
  console.error("Codex auth preflight validation failed.");
  console.error(error);
  process.exitCode = 1;
});
