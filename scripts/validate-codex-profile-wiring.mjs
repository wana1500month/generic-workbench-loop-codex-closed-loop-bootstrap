import { join } from "node:path";
import { readFile } from "node:fs/promises";

import {
  applyChangeEnv,
  cleanupTempRoot,
  createBootstrapFixture,
  createTempRoot,
  ensureBuild,
  importDist,
  repoRoot,
  readJsonFile,
  runCommand
} from "./testing/bootstrap-validator-helpers.mjs";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-codex-profile");

  try {
    const plannerRecordPath = join(tempRoot, "planner-record.json");
    const bootstrapRecordPath = join(tempRoot, "bootstrap-record.json");
    const fakeCodexPath = join(repoRoot, "scripts", "testing", "fake-codex.mjs");
    const codexAgentsModuleUrl = new URL(
      "../packages/loop-orchestrator/dist/codex-agents.js",
      import.meta.url
    ).href;

    const plannerEnv = {
      ...process.env,
      HARNESS_CODEX_BIN: process.execPath,
      HARNESS_CODEX_BIN_ARGS: JSON.stringify([fakeCodexPath]),
      FAKE_CODEX_MODE: "success",
      FAKE_CODEX_RECORD_PATH: plannerRecordPath,
      FAKE_CODEX_RESPONSE: "{\"planner_notes\":[\"ok\"]}"
    };

    const plannerCall = await runCommand(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
          process.env.HARNESS_CODEX_BIN = ${JSON.stringify(process.execPath)};
          process.env.HARNESS_CODEX_BIN_ARGS = ${JSON.stringify(JSON.stringify([fakeCodexPath]))};
          process.env.FAKE_CODEX_MODE = "success";
          process.env.FAKE_CODEX_RECORD_PATH = ${JSON.stringify(plannerRecordPath)};
          process.env.FAKE_CODEX_RESPONSE = "{\\"planner_notes\\":[\\"ok\\"]}";
          const { enhancePlanWithCodex } = await import(${JSON.stringify(codexAgentsModuleUrl)});
          await enhancePlanWithCodex(${JSON.stringify({
            runDirectory: join(tempRoot, "planner-run-2"),
            idea: {
              title: "Planner Fixture",
              summary: "Planner profile validation fixture",
              user_goals: ["validate planner profile"],
              constraints: [],
              quality_bar: [],
              source_path: "IDEA.md",
              raw_markdown: "# Planner Fixture"
            },
            rubric: {
              rubric_id: "fixture-rubric",
              target_total_score: 0.9,
              minimum_control_plane_score: 1,
              minimum_proof_score: 0.85,
              target_signal_requires_adapter: true,
              target_signal_requires_grade_score: true,
              stop_after_plateau_rounds: 2,
              max_remediation_rounds: 1,
              required_artifacts: [],
              quality_dimensions: []
            },
            scenario: {
              scenario_id: "planner-fixture",
              title: "Planner Fixture",
              description: "Planner profile validation fixture",
              user_goals: ["validate planner profile"],
              acceptance_highlights: ["planner returns a patch"],
              idea_source_path: "IDEA.md",
              planner_notes: []
            },
            plan: {
              scenario_id: "planner-fixture",
              rubric_id: "fixture-rubric",
              target_total_score: 0.9,
              minimum_control_plane_score: 1,
              minimum_proof_score: 0.85,
              target_signal_requires_adapter: true,
              target_signal_requires_grade_score: true,
              stop_after_plateau_rounds: 2,
              max_remediation_rounds: 1,
              max_rounds: 2,
              north_star: "fixture",
              attempt_strategy: "fixture",
              planner_focus_areas: ["planner_clarity", "contract_testability", "qa_rigor"],
              planner_acceptance_checks: [],
              remediation_policy: [],
              planner_notes: []
            }
          })});
        `
      ],
      {
      cwd: tempRoot,
      env: plannerEnv,
      shell: false
      }
    );
    assert(plannerCall.code === 0, "planner profile check should succeed");

    const plannerRecords = await readJsonFile(plannerRecordPath);
    assert(Array.isArray(plannerRecords) && plannerRecords.length > 0, "planner call not recorded");
    assert(
      plannerRecords[0].argv[0] === "exec",
      "planner call must start with the exec subcommand"
    );
    assert(
      plannerRecords[0].argv[1] === "--profile" &&
        plannerRecords[0].argv[2] === "readonly_agent",
      "planner call must use readonly_agent profile"
    );

    const fixture = await createBootstrapFixture(join(tempRoot, "bootstrap"));
    const applyRun = await runCommand(process.execPath, [fixture.applyChangeScriptPath], {
      cwd: fixture.workspaceRoot,
      env: applyChangeEnv(fixture, {
        HARNESS_CODEX_BIN: process.execPath,
        HARNESS_CODEX_BIN_ARGS: JSON.stringify([fakeCodexPath]),
        FAKE_CODEX_MODE: "success",
        FAKE_CODEX_RECORD_PATH: bootstrapRecordPath,
        FAKE_CODEX_RESPONSE: "{\"status\":\"ok\"}"
      }),
      shell: false
    });
    assert(applyRun.code === 0, "bootstrap apply_change should succeed with fake codex");

    const resumedApplyRun = await runCommand(process.execPath, [fixture.applyChangeScriptPath], {
      cwd: fixture.workspaceRoot,
      env: applyChangeEnv(fixture, {
        HARNESS_CODEX_BIN: process.execPath,
        HARNESS_CODEX_BIN_ARGS: JSON.stringify([fakeCodexPath]),
        FAKE_CODEX_MODE: "success",
        FAKE_CODEX_RECORD_PATH: bootstrapRecordPath,
        FAKE_CODEX_RESPONSE: "{\"status\":\"ok\"}",
        FAKE_CODEX_THREAD_ID: "thread_bootstrap_resume"
      }),
      shell: false
    });
    assert(
      resumedApplyRun.code === 0,
      "bootstrap apply_change resume should succeed with fake codex"
    );

    const bootstrapRecords = await readJsonFile(bootstrapRecordPath);
    assert(Array.isArray(bootstrapRecords) && bootstrapRecords.length >= 2, "bootstrap calls not recorded");
    assert(
      bootstrapRecords[0].argv[0] === "exec",
      "bootstrap generator must start with the exec subcommand"
    );
    assert(
      !bootstrapRecords[0].argv.includes("--profile"),
      "bootstrap generator must not depend on project-local profile discovery"
    );
    assert(
      bootstrapRecords[0].argv.some(
        (value) => value === '-c'
      ),
      "bootstrap generator must pass explicit config overrides"
    );
    assert(
      bootstrapRecords[0].argv.includes('-c') &&
        bootstrapRecords[0].argv.includes('approval_policy=\"never\"') &&
        bootstrapRecords[0].argv.includes('sandbox_mode=\"workspace-write\"') &&
        bootstrapRecords[0].argv.includes('sandbox_workspace_write.network_access=false'),
      "bootstrap generator must anchor approval and sandbox config with -c overrides"
    );
    assert(
      !bootstrapRecords[0].argv.includes("--full-auto"),
      "bootstrap generator must not use --full-auto once profile wiring is enabled"
    );
    assert(
      bootstrapRecords[1].used_resume === true,
      "bootstrap generator second call must resume the stored session"
    );
    assert(
      bootstrapRecords[1].argv[0] === "exec" && bootstrapRecords[1].argv[1] === "resume",
      "bootstrap generator second call must use the exec resume subcommand ordering"
    );
    assert(
      bootstrapRecords[1].argv.includes("--skip-git-repo-check"),
      "bootstrap generator resume call must skip git repo checks for external target roots"
    );
    assert(
      !bootstrapRecords[1].argv.includes("--profile"),
      "bootstrap generator resume must not depend on project-local profile discovery"
    );
    assert(
      !bootstrapRecords[1].argv.includes("--output-schema"),
      "bootstrap generator resume must not pass unsupported --output-schema"
    );

    const metadata = JSON.parse(
      await readFile(join(fixture.roundDirectory, "artifacts", "generator-metadata.json"), "utf8")
    );
    assert(
      metadata.config_overrides &&
        metadata.config_overrides.approval_policy === "never" &&
        metadata.config_overrides.sandbox_mode === "workspace-write" &&
        metadata.config_overrides["sandbox_workspace_write.network_access"] === false,
      "metadata must record bootstrap config overrides"
    );

    const runtimeRecordPath = join(tempRoot, "runtime-resume-record.json");
    process.env.HARNESS_CODEX_BIN = process.execPath;
    process.env.HARNESS_CODEX_BIN_ARGS = JSON.stringify([fakeCodexPath]);
    process.env.FAKE_CODEX_MODE = "success";
    process.env.FAKE_CODEX_RECORD_PATH = runtimeRecordPath;
    process.env.FAKE_CODEX_RESPONSE = "{\"status\":\"ok\"}";
    const { runCodexCommand } = await importDist("codex-runtime.js");
    const runtimeArtifactDirectory = join(tempRoot, "runtime-artifacts");
    const initialRuntimeCall = await runCodexCommand({
      name: "runtime-direct",
      prompt: 'Respond with {"status":"ok"}',
      cwd: repoRoot,
      artifactDirectory: runtimeArtifactDirectory,
      profile: "readonly_agent",
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", const: "ok" }
        },
        required: ["status"]
      },
      sandboxMode: "read-only"
    });
    assert(
      initialRuntimeCall.code === 0 && typeof initialRuntimeCall.threadId === "string",
      "direct runtime initial call must produce a resumable thread"
    );
    const resumedRuntimeCall = await runCodexCommand({
      name: "runtime-direct-resume",
      prompt: 'Respond with {"status":"ok"}',
      cwd: repoRoot,
      artifactDirectory: join(tempRoot, "runtime-resume-artifacts"),
      profile: "readonly_agent",
      sessionId: initialRuntimeCall.threadId,
      sandboxMode: "read-only",
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", const: "ok" }
        },
        required: ["status"]
      }
    });
    assert(
      resumedRuntimeCall.code === 0 && resumedRuntimeCall.usedResume,
      "direct runtime resume call must succeed"
    );
    const resumedLastRuntimeCall = await runCodexCommand({
      name: "runtime-direct-resume-last",
      prompt: 'Respond with {"status":"ok"}',
      cwd: repoRoot,
      artifactDirectory: join(tempRoot, "runtime-resume-last-artifacts"),
      profile: "readonly_agent",
      resumeLast: true,
      sandboxMode: "read-only"
    });
    assert(
      resumedLastRuntimeCall.code === 0 && resumedLastRuntimeCall.usedResume,
      "direct runtime resume --last call must succeed"
    );
    const runtimeRecords = await readJsonFile(runtimeRecordPath);
    assert(
      Array.isArray(runtimeRecords) && runtimeRecords.length >= 3,
      "direct runtime resume calls were not recorded"
    );
    assert(
      runtimeRecords[1].argv[0] === "exec" && runtimeRecords[1].argv[1] === "resume",
      "runtime resume call must use exec resume ordering"
    );
    assert(
      runtimeRecords[1].argv.includes("-c") &&
        runtimeRecords[1].argv.includes('sandbox_mode="read-only"'),
      "runtime resume call must reapply sandbox mode through resume-supported config overrides"
    );
    assert(
      !runtimeRecords[1].argv.includes("--output-schema"),
      "runtime resume call must omit unsupported --output-schema"
    );
    assert(
      runtimeRecords[2].used_resume === true &&
        runtimeRecords[2].used_resume_last === true &&
        runtimeRecords[2].argv.includes("--last"),
      "runtime resume --last call must be recorded explicitly"
    );
    const resumedRuntimeMetadata = JSON.parse(
      await readFile(
        join(tempRoot, "runtime-resume-artifacts", "runtime-direct-resume-metadata.json"),
        "utf8"
      )
    );
    assert(
      resumedRuntimeMetadata.effective_policy?.used_resume === true,
      "runtime resume metadata must record effective_policy.used_resume"
    );
    assert(
      resumedRuntimeMetadata.effective_policy?.sandbox_mode === "read-only",
      "runtime resume metadata must record effective sandbox mode"
    );
    assert(
      resumedRuntimeMetadata.effective_policy?.output_schema_requested === true,
      "runtime resume metadata must record requested output schema"
    );
    assert(
      resumedRuntimeMetadata.effective_policy?.output_schema_passed_to_cli === false,
      "runtime resume metadata must record intentionally omitted output schema"
    );

    const fallbackRecordPath = join(tempRoot, "runtime-profile-fallback-record.json");
    process.env.FAKE_CODEX_RECORD_PATH = fallbackRecordPath;
    process.env.FAKE_CODEX_FAIL_MISSING_PROFILE = "readonly_agent";
    const fallbackRuntimeCall = await runCodexCommand({
      name: "runtime-profile-fallback",
      prompt: 'Respond with {"status":"ok"}',
      cwd: repoRoot,
      artifactDirectory: join(tempRoot, "runtime-profile-fallback-artifacts"),
      profile: "readonly_agent",
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", const: "ok" }
        },
        required: ["status"]
      },
      sandboxMode: "read-only"
    });
    delete process.env.FAKE_CODEX_FAIL_MISSING_PROFILE;
    assert(
      fallbackRuntimeCall.code === 0 && fallbackRuntimeCall.responseWritten,
      "direct runtime call must retry when readonly_agent profile is missing"
    );
    const fallbackRecords = await readJsonFile(fallbackRecordPath);
    assert(
      Array.isArray(fallbackRecords) && fallbackRecords.length === 2,
      "profile fallback should record one failed profile call and one retried call"
    );
    assert(
      fallbackRecords[0].argv.includes("--profile") &&
        fallbackRecords[0].argv.includes("readonly_agent"),
      "profile fallback first call must try the requested profile"
    );
    assert(
      !fallbackRecords[1].argv.includes("--profile") &&
        fallbackRecords[1].argv.includes("-c") &&
        fallbackRecords[1].argv.includes('approval_policy="never"') &&
        fallbackRecords[1].argv.includes('sandbox_mode="read-only"'),
      "profile fallback retry must use explicit read-only config overrides"
    );
    const fallbackMetadata = JSON.parse(
      await readFile(
        join(
          tempRoot,
          "runtime-profile-fallback-artifacts",
          "runtime-profile-fallback-metadata.json"
        ),
        "utf8"
      )
    );
    assert(
      fallbackMetadata.profile_fallback_used === true,
      "profile fallback metadata must record fallback usage"
    );

    console.log("Validated Codex profile wiring.");
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
