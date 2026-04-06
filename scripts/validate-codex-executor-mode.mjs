import { join } from "node:path";

import {
  assertRuntimeWarningContains,
  assertRuntimeWarningMissing,
  extractRunDirectory,
  readJsonFile,
  readSummary,
  readTextFile,
  runLoop
} from "./validation-utils.mjs";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const main = async () => {
  const fakeCodexPath = join(process.cwd(), "scripts", "testing", "fake-codex.mjs");
  const execution = await runLoop(["--single", "--executor-mode", "subagents-experimental"], {
    silent: true,
    env: {
      ...process.env,
      HARNESS_CODEX_BIN: process.execPath,
      HARNESS_CODEX_BIN_ARGS: JSON.stringify([fakeCodexPath]),
      HARNESS_DISABLE_CODEX_PLANNER: "1",
      HARNESS_DISABLE_CODEX_EVALUATOR: "1"
    }
  });

  if (execution.code !== 0) {
    throw new Error(`loop:single failed\n${execution.stdout}\n${execution.stderr}`);
  }

  const runDirectory = extractRunDirectory(execution.stdout);
  const summary = await readSummary(runDirectory);
  assert(
    summary.executor_mode === "subagents-experimental",
    `Expected executor_mode 'subagents-experimental', received '${summary.executor_mode ?? "missing"}'.`
  );
  assertRuntimeWarningContains(
    summary,
    "manifest-backed prompt orchestration"
  );
  assertRuntimeWarningContains(
    summary,
    "HARNESS_DISABLE_CODEX_PLANNER=1"
  );
  assertRuntimeWarningContains(
    summary,
    "HARNESS_DISABLE_CODEX_EVALUATOR=1"
  );
  assertRuntimeWarningMissing(
    summary,
    "HARNESS_DISABLE_CODEX_CONTRACT_REVIEW=1"
  );
  assertRuntimeWarningMissing(
    summary,
    "HARNESS_DISABLE_CODEX_GENERATOR_PLAN=1"
  );

  const resumeIdentity = await readJsonFile(join(runDirectory, "resume-identity.json"));
  assert(
    resumeIdentity.executor_mode === "subagents-experimental",
    "resume identity did not persist executor_mode"
  );

  const generatorPrompt = await readTextFile(
    join(runDirectory, "round-001", "codex-agents", "generator-plan-prompt.md")
  );
  assert(
    generatorPrompt.includes("Executor mode: subagents-experimental"),
    "generator-plan prompt did not include experimental executor preamble"
  );
  assert(
    generatorPrompt.includes("Developer instructions:"),
    "generator-plan prompt did not include manifest developer instructions"
  );

  console.log("Validated executor-mode wiring and stage ablation flags.");
};

main().catch((error) => {
  console.error("Codex executor-mode validation failed.");
  console.error(error);
  process.exitCode = 1;
});
