import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  cleanupTempRoot,
  createTempRoot,
  ensureBuild,
  importDist,
  runCommand
} from "./testing/bootstrap-validator-helpers.mjs";

const parseJson = (text, label) => {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Could not parse ${label} as JSON.\n${error}\n${text}`);
  }
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const parseJsonlEvents = (text) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });

const assertCodexEventStream = (eventsText, label) => {
  const events = parseJsonlEvents(eventsText);
  assert(
    events.some((event) => event.type === "thread.started"),
    `${label} JSONL event stream did not include thread.started.`
  );
  assert(
    events.some((event) => event.type === "turn.completed"),
    `${label} JSONL event stream did not include turn.completed.`
  );
};

const strictMode = process.env.HARNESS_CODEX_REAL_SMOKE_STRICT === "1";
const latestResultPath = join(process.cwd(), ".tmp", "codex-real-smoke", "latest-result.json");

const writeLatestResult = async (result) => {
  await mkdir(join(process.cwd(), ".tmp", "codex-real-smoke"), { recursive: true });
  await writeFile(
    latestResultPath,
    JSON.stringify(
      {
        validated_at: new Date().toISOString(),
        strict_mode: strictMode,
        ...result
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
};

const main = async () => {
  if (process.env.HARNESS_DISABLE_CODEX_AGENTS === "1") {
    if (strictMode) {
      throw new Error(
        "Codex real smoke strict mode failed: HARNESS_DISABLE_CODEX_AGENTS=1 prevents real Codex execution."
      );
    }
    console.log(
      "Codex real smoke environment_blocked: HARNESS_DISABLE_CODEX_AGENTS=1 prevents real Codex execution."
    );
    await writeLatestResult({
      status: "environment_blocked",
      reason: "HARNESS_DISABLE_CODEX_AGENTS=1 prevents real Codex execution."
    });
    return;
  }

  await ensureBuild();

  const { resolveCodexCliLaunch } = await importDist("codex-cli.js");
  const { repoRoot, checkCodexAuth, runCodexCommand } = await importDist("codex-runtime.js");
  const codexLaunch = resolveCodexCliLaunch();
  const authPreflight = await checkCodexAuth({
    strict: strictMode,
    requireChatgpt: true,
    requireFileBacked: strictMode,
    cwd: repoRoot
  });
  if (!authPreflight.ok) {
    const reason = authPreflight.blockedReason ?? "Codex auth preflight failed.";
    if (strictMode) {
      throw new Error(`Codex real smoke strict mode failed: ${reason}`);
    }
    console.log(`Codex real smoke environment_blocked: ${reason}`);
    await writeLatestResult({
      status: "environment_blocked",
      reason,
      auth_preflight: {
        mode: authPreflight.mode,
        auth_file_present: authPreflight.authFilePresent,
        has_refresh_token: authPreflight.hasRefreshToken,
        file_backed: authPreflight.fileBacked,
        timed_out: authPreflight.timedOut === true
      }
    });
    return;
  }

  const codexVersion = await runCommand(codexLaunch.command, [...codexLaunch.args, "--version"], {
    shell: false
  }).catch(() => ({ code: 1, stdout: "", stderr: "" }));
  if (codexVersion.code !== 0) {
    if (strictMode) {
      throw new Error(
        `Codex real smoke strict mode failed: could not read Codex version.\n${codexVersion.stderr}`
      );
    }
    console.log(
      "Codex real smoke environment_blocked: could not read Codex version after auth preflight."
    );
    await writeLatestResult({
      status: "environment_blocked",
      reason: "could not read Codex version after auth preflight",
      codex_version_stderr: codexVersion.stderr
    });
    return;
  }

  const tempRoot = await createTempRoot("codex-real-smoke");

  try {
    const artifactRoot = join(tempRoot, "artifacts");
    const fresh = await runCodexCommand({
      name: "real-smoke-fresh",
      prompt: [
        "Return JSON only.",
        'Respond with {"status":"ok","note":"real smoke"}'
      ].join("\n"),
      cwd: repoRoot,
      artifactDirectory: artifactRoot,
      profile: "readonly_agent",
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", const: "ok" },
          note: { type: "string" }
        },
        required: ["status", "note"]
      },
      sandboxMode: "read-only",
      metadata: {
        smoke: "real",
        stage: "fresh"
      }
    });

    assert(fresh.code === 0 && !fresh.error, `Fresh Codex exec failed: ${fresh.error ?? fresh.stderr}`);
    assert(fresh.responseWritten, "Fresh Codex exec did not write a response file.");
    assert(typeof fresh.threadId === "string", "Fresh Codex exec did not emit a thread id.");
    assertCodexEventStream(fresh.eventsText, "Fresh Codex exec");
    const freshResponse = parseJson(fresh.responseText ?? "", "fresh response");
    assert(freshResponse.status === "ok", "Fresh Codex exec returned the wrong payload.");

    const resumed = await runCodexCommand({
      name: "real-smoke-resume",
      prompt: [
        "Return JSON only.",
        'Respond with {"status":"resumed","note":"real smoke resume"}'
      ].join("\n"),
      cwd: repoRoot,
      artifactDirectory: join(tempRoot, "resume-artifacts"),
      profile: "readonly_agent",
      sessionId: fresh.threadId,
      metadata: {
        smoke: "real",
        stage: "resume"
      }
    });

    assert(resumed.code === 0 && !resumed.error, `Resume Codex exec failed: ${resumed.error ?? resumed.stderr}`);
    assert(resumed.usedResume, "Resume Codex exec did not record usedResume.");
    assert(resumed.threadId === fresh.threadId, "Resume Codex exec did not preserve the thread id.");
    assert(resumed.responseWritten, "Resume Codex exec did not write a response file.");
    const resumedResponse = parseJson(resumed.responseText ?? "", "resume response");
    assert(
      resumedResponse.status === "resumed",
      "Resume Codex exec returned the wrong payload."
    );
    const resumedLast = await runCodexCommand({
      name: "real-smoke-resume-last",
      prompt: [
        "Return JSON only.",
        'Respond with {"status":"resumed_last","note":"real smoke resume last"}'
      ].join("\n"),
      cwd: repoRoot,
      artifactDirectory: join(tempRoot, "resume-last-artifacts"),
      profile: "readonly_agent",
      resumeLast: true,
      metadata: {
        smoke: "real",
        stage: "resume_last"
      }
    });

    assert(
      resumedLast.code === 0 && !resumedLast.error,
      `Resume --last Codex exec failed: ${resumedLast.error ?? resumedLast.stderr}`
    );
    assert(resumedLast.usedResume, "Resume --last Codex exec did not record usedResume.");
    assert(resumedLast.responseWritten, "Resume --last Codex exec did not write a response file.");
    const resumedLastResponse = parseJson(
      resumedLast.responseText ?? "",
      "resume --last response"
    );
    assert(
      resumedLastResponse.status === "resumed_last",
      "Resume --last Codex exec returned the wrong payload."
    );

    const targetRoot = join(tempRoot, "external-target-root");
    await mkdir(targetRoot, { recursive: true });
    const mutation = await runCodexCommand({
      name: "real-smoke-mutation",
      prompt: [
        "Create a file named codex-real-smoke.txt in the working directory.",
        "Write the exact text 'codex real smoke' into that file.",
        'Return JSON only as {"status":"mutated","file":"codex-real-smoke.txt"}'
      ].join("\n"),
      cwd: targetRoot,
      artifactDirectory: join(tempRoot, "mutation-artifacts"),
      configOverrides: {
        approval_policy: "never",
        sandbox_mode: "workspace-write",
        "sandbox_workspace_write.network_access": false
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", const: "mutated" },
          file: { type: "string", const: "codex-real-smoke.txt" }
        },
        required: ["status", "file"]
      },
      metadata: {
        smoke: "real",
        stage: "mutation"
      }
    });

    assert(
      mutation.code === 0 && !mutation.error,
      `Mutation Codex exec failed: ${mutation.error ?? mutation.stderr}`
    );
    assert(mutation.responseWritten, "Mutation Codex exec did not write a response file.");
    const mutationResponse = parseJson(mutation.responseText ?? "", "mutation response");
    assert(
      mutationResponse.file === "codex-real-smoke.txt",
      "Mutation Codex exec returned the wrong file payload."
    );

    const writtenFilePath = join(targetRoot, "codex-real-smoke.txt");
    const writtenFile = await readFile(writtenFilePath, "utf8");
    assert(
      writtenFile.trim() === "codex real smoke",
      "Mutation Codex exec did not write the expected file contents."
    );

    const metadata = parseJson(
      await readFile(join(tempRoot, "mutation-artifacts", "real-smoke-mutation-metadata.json"), "utf8"),
      "mutation metadata"
    );
    assert(
      metadata.config_overrides?.sandbox_mode === "workspace-write",
      "Mutation metadata did not record config overrides."
    );
    const mutationResume = await runCodexCommand({
      name: "real-smoke-mutation-resume",
      prompt: [
        "Create a file named codex-real-smoke-resume.txt in the working directory.",
        "Write the exact text 'codex real smoke resume' into that file.",
        'Return JSON only as {"status":"mutated","file":"codex-real-smoke-resume.txt"}'
      ].join("\n"),
      cwd: targetRoot,
      artifactDirectory: join(tempRoot, "mutation-resume-artifacts"),
      configOverrides: {
        approval_policy: "never",
        sandbox_mode: "workspace-write",
        "sandbox_workspace_write.network_access": false
      },
      sessionId: mutation.threadId,
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", const: "mutated" },
          file: { type: "string", const: "codex-real-smoke-resume.txt" }
        },
        required: ["status", "file"]
      },
      metadata: {
        smoke: "real",
        stage: "mutation_resume"
      }
    });

    assert(
      mutationResume.code === 0 && !mutationResume.error,
      `Resumed mutation Codex exec failed: ${mutationResume.error ?? mutationResume.stderr}`
    );
    assert(mutationResume.usedResume, "Resumed mutation did not record usedResume.");
    assert(
      mutationResume.threadId === mutation.threadId,
      "Resumed mutation did not preserve the mutation thread id."
    );
    assert(
      mutationResume.responseWritten,
      "Resumed mutation Codex exec did not write a response file."
    );
    const mutationResumeResponse = parseJson(
      mutationResume.responseText ?? "",
      "mutation resume response"
    );
    assert(
      mutationResumeResponse.file === "codex-real-smoke-resume.txt",
      "Resumed mutation Codex exec returned the wrong file payload."
    );
    const resumedWrittenFilePath = join(targetRoot, "codex-real-smoke-resume.txt");
    const resumedWrittenFile = await readFile(resumedWrittenFilePath, "utf8");
    assert(
      resumedWrittenFile.trim() === "codex real smoke resume",
      "Resumed mutation Codex exec did not write the expected file contents."
    );
    const resumedMutationMetadata = parseJson(
      await readFile(
        join(
          tempRoot,
          "mutation-resume-artifacts",
          "real-smoke-mutation-resume-metadata.json"
        ),
        "utf8"
      ),
      "mutation resume metadata"
    );
    assert(
      Array.isArray(resumedMutationMetadata.args) &&
        resumedMutationMetadata.args.includes("--skip-git-repo-check"),
      "Resumed mutation metadata did not record --skip-git-repo-check."
    );
    const resumedExecIndex = Array.isArray(resumedMutationMetadata.args)
      ? resumedMutationMetadata.args.indexOf("exec")
      : -1;
    assert(
      resumedExecIndex >= 0 &&
        resumedMutationMetadata.args[resumedExecIndex + 1] === "resume",
      "Resumed mutation metadata did not record exec resume ordering."
    );
    assert(
      !resumedMutationMetadata.args.includes("--output-schema"),
      "Resumed mutation metadata should not include unsupported --output-schema."
    );
    assert(
      resumedMutationMetadata.effective_policy?.used_resume === true,
      "Resumed mutation metadata must record effective_policy.used_resume."
    );
    assert(
      resumedMutationMetadata.effective_policy?.sandbox_mode === "workspace-write",
      "Resumed mutation metadata must record workspace-write sandbox mode."
    );
    assert(
      resumedMutationMetadata.effective_policy?.network_access === false,
      "Resumed mutation metadata must record disabled network access."
    );
    assert(
      resumedMutationMetadata.effective_policy?.output_schema_requested === true,
      "Resumed mutation metadata must record that output schema was requested."
    );
    assert(
      resumedMutationMetadata.effective_policy?.output_schema_passed_to_cli === false,
      "Resume metadata must record that output schema was intentionally not passed to CLI."
    );

    const result = {
      status: "passed",
      codex_version: codexVersion.stdout.trim() || codexVersion.stderr.trim(),
      auth_preflight: {
        mode: authPreflight.mode,
        auth_file_present: authPreflight.authFilePresent,
        has_refresh_token: authPreflight.hasRefreshToken,
        file_backed: authPreflight.fileBacked
      },
      thread_id: fresh.threadId,
      fresh_response_path: fresh.responsePath,
      resume_response_path: resumed.responsePath,
      resume_last_response_path: resumedLast.responsePath,
      mutation_response_path: mutation.responsePath,
      mutation_resume_response_path: mutationResume.responsePath,
      mutated_file_path: writtenFilePath,
      resumed_mutated_file_path: resumedWrittenFilePath
    };
    await writeFile(
      join(tempRoot, "real-smoke-result.json"),
      JSON.stringify(result, null, 2) + "\n",
      "utf8"
    );
    await writeLatestResult(result);

    console.log(`Validated real Codex smoke in ${tempRoot}.`);
  } finally {
    if (process.env.HARNESS_KEEP_REAL_SMOKE_ARTIFACTS !== "1") {
      await cleanupTempRoot(tempRoot);
    }
  }
};

main().catch(async (error) => {
  console.error("Codex real smoke failed.");
  console.error(error);
  await writeLatestResult({
    status: "failed",
    reason: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
});
