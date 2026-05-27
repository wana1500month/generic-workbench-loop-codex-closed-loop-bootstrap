import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { repoRoot } from "./testing/bootstrap-validator-helpers.mjs";

const resultRoot = join(repoRoot, ".tmp", "codex-real-smoke");
const paths = {
  binary: join(resultRoot, "binary-preflight-result.json"),
  codex: join(resultRoot, "latest-result.json"),
  appServer: join(resultRoot, "app-server-latest-result.json"),
  summary: join(resultRoot, "live-smoke-summary.json"),
  markdown: join(resultRoot, "live-smoke-results.md")
};

const readJson = async (path, label) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Live smoke result '${label}' is missing or invalid at ${path}.\n${error}`
    );
  }
};

const assertPassed = (result, label) => {
  if (result.status !== "passed") {
    throw new Error(
      `Live smoke result '${label}' did not pass: ${JSON.stringify(result, null, 2)}`
    );
  }
};

const [binary, codex, appServer] = await Promise.all([
  readJson(paths.binary, "binary preflight"),
  readJson(paths.codex, "codex exec"),
  readJson(paths.appServer, "app-server")
]);

assertPassed(binary, "binary preflight");
assertPassed(codex, "codex exec");
assertPassed(appServer, "app-server");

const summary = {
  validated_at: new Date().toISOString(),
  status: "passed",
  codex_version: codex.codex_version ?? binary.codex_version,
  binary_preflight: {
    path: paths.binary,
    resolved_launch: binary.resolved_launch
  },
  codex_exec: {
    path: paths.codex,
    thread_id: codex.thread_id,
    fresh_response_path: codex.fresh_response_path,
    resume_response_path: codex.resume_response_path,
    resume_last_response_path: codex.resume_last_response_path,
    mutation_response_path: codex.mutation_response_path,
    mutation_resume_response_path: codex.mutation_resume_response_path
  },
  app_server: {
    path: paths.appServer,
    thread_id: appServer.thread_id,
    turn_id: appServer.turn_id,
    event_cursor: appServer.event_cursor,
    transport_state_path: appServer.transport_state_path,
    response_path: appServer.response_path,
    target_file_path: appServer.target_file_path
  }
};

await mkdir(resultRoot, { recursive: true });
await writeFile(paths.summary, JSON.stringify(summary, null, 2) + "\n", "utf8");
await writeFile(
  paths.markdown,
  [
    "# Live Smoke Results",
    "",
    `- Status: ${summary.status}`,
    `- Validated at: ${summary.validated_at}`,
    `- Codex version: ${summary.codex_version ?? "unknown"}`,
    `- Binary preflight: ${paths.binary}`,
    `- Codex exec result: ${paths.codex}`,
    `- App Server result: ${paths.appServer}`,
    `- Summary JSON: ${paths.summary}`,
    "",
    "## Threads",
    "",
    `- Codex exec thread: ${summary.codex_exec.thread_id ?? "unknown"}`,
    `- App Server thread: ${summary.app_server.thread_id ?? "unknown"}`,
    `- App Server turn: ${summary.app_server.turn_id ?? "unknown"}`,
    ""
  ].join("\n"),
  "utf8"
);

console.log(`validate:live-smoke-results passed: ${paths.summary}`);
