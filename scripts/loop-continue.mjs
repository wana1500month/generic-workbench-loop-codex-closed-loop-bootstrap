import { access, mkdir, readFile, rename } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const usage = () => {
  console.error(
    "Usage: npm run loop:continue -- --run-dir <evals/runs/run-###> [--json] [--hop-limit <n>]"
  );
};

const parseArgs = (argv) => {
  const result = {
    json: false,
    hopLimit: 8
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") {
      result.json = true;
      continue;
    }
    if (value === "--run-dir") {
      result.runDirectory = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--hop-limit") {
      const parsed = Number(argv[index + 1]);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`Invalid --hop-limit value '${argv[index + 1] ?? "missing"}'.`);
      }
      result.hopLimit = parsed;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument '${value}'.`);
  }

  if (!result.runDirectory) {
    throw new Error("Missing required --run-dir argument.");
  }

  result.runDirectory = resolve(repoRoot, result.runDirectory);
  return result;
};

const runPackageScript = async (scriptName, scriptArgs = []) =>
  new Promise((resolvePromise, rejectPromise) => {
    const args = [
      "run",
      scriptName,
      "--silent",
      ...(scriptArgs.length > 0 ? ["--", ...scriptArgs] : [])
    ];
    const invocation = process.env.npm_execpath
      ? {
          command: process.execPath,
          args: [process.env.npm_execpath, ...args],
          shell: false
        }
      : {
          command: "npm",
          args,
          shell: process.platform === "win32"
        };
    const child = spawn(invocation.command, invocation.args, {
      cwd: repoRoot,
      env: process.env,
      shell: invocation.shell,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({
        code: code ?? 1,
        stdout,
        stderr
      });
    });
  });

const readJsonIfExists = async (path) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
};

const fileExists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const buildProgressSignature = (statusReport) =>
  JSON.stringify({
    effective_execution_state: statusReport.effective_execution_state,
    stop_reason: statusReport.stop_reason,
    round_count: statusReport.round_count,
    terminal_round: statusReport.terminal_round,
    phase: statusReport.active?.phase,
    phase_status: statusReport.active?.phase_status,
    checkpoint_kind: statusReport.active?.checkpoint_kind,
    attention_required: statusReport.active?.attention_required,
    scores: statusReport.scores
  });

const buildResumeCommand = (runDirectory) =>
  `npm run loop:resume -- --run-dir ${runDirectory} --json`;

const uiVisibilityForContractState = (state) =>
  state === "codex_checkpoint" ? "internal_checkpoint" : "user_boundary";

const foregroundOwnerForContractState = (state) => {
  if (state === "codex_checkpoint") {
    return "codex";
  }
  if (state === "external_stop") {
    return "external";
  }
  return "human";
};

const buildContract = (input) => ({
  state: input.state,
  run_id: input.statusReport.run_id,
  run_directory: input.statusReport.run_directory,
  worker: input.statusReport.active?.worker_skill ?? "loop-control",
  recovery_skill: input.statusReport.active?.recovery_skill ?? "attached-loop",
  ...(input.statusReport.active?.checkpoint_id
    ? { checkpoint_id: input.statusReport.active.checkpoint_id }
    : {}),
  ...(input.statusReport.active?.checkpoint_seq !== undefined
    ? { checkpoint_seq: input.statusReport.active.checkpoint_seq }
    : {}),
  ...(input.statusReport.active?.checkpoint_kind
    ? { checkpoint_kind: input.statusReport.active.checkpoint_kind }
    : {}),
  ...(input.statusReport.active?.attention_required
    ? { attention_required: input.statusReport.active.attention_required }
    : {}),
  ui_visibility: uiVisibilityForContractState(input.state),
  foreground_owner: foregroundOwnerForContractState(input.state),
  ...(input.statusReport.active?.active_prompt_path
    ? { active_prompt_path: input.statusReport.active.active_prompt_path }
    : {}),
  ...(input.statusReport.active?.active_response_path
    ? { active_response_path: input.statusReport.active.active_response_path }
    : {}),
  ...(input.recommendedSkill ? { recommended_skill: input.recommendedSkill } : {}),
  resume_command: buildResumeCommand(input.statusReport.run_directory),
  ...(input.statusReport.stop_reason ? { stop_reason: input.statusReport.stop_reason } : {}),
  user_visible_pause:
    input.userVisiblePause ??
    (input.state === "codex_checkpoint" ? false : true),
  hop_limit: input.hopLimit,
  hop_index: input.hopIndex,
  ...(input.repeatedCheckpointCount !== undefined
    ? { repeated_checkpoint_count: input.repeatedCheckpointCount }
    : {}),
  ...(input.guardReason ? { guard_reason: input.guardReason } : {}),
  ...(input.notes?.length ? { notes: input.notes } : {})
});

const quarantineCheckpointResponse = async (input) => {
  const staleDirectory = join(
    input.runDirectory,
    "runtime",
    "stale-checkpoint-responses"
  );
  await mkdir(staleDirectory, { recursive: true });
  const targetPath = join(
    staleDirectory,
    `${basename(input.responsePath, ".json")}-${Date.now()}.json`
  );
  await rename(input.responsePath, targetPath);
  return targetPath;
};

const readStatusReport = async (runDirectory) => {
  const execution = await runPackageScript("loop:status", ["--run-dir", runDirectory, "--json"]);
  if (execution.code !== 0) {
    throw new Error(
      `loop:status failed for ${runDirectory}.\nSTDOUT:\n${execution.stdout}\nSTDERR:\n${execution.stderr}`
    );
  }
  return JSON.parse(execution.stdout);
};

const resumeRun = async (runDirectory) => {
  const execution = await runPackageScript("loop:resume", ["--run-dir", runDirectory, "--json"]);
  if (execution.code !== 0) {
    throw new Error(
      `loop:resume failed for ${runDirectory}.\nSTDOUT:\n${execution.stdout}\nSTDERR:\n${execution.stderr}`
    );
  }
  return JSON.parse(execution.stdout);
};

const renderContract = (contract) => {
  if (contract.state === "codex_checkpoint") {
    return [
      `State: ${contract.state}`,
      `Run: ${contract.run_id}`,
      `Worker: $${contract.worker}`,
      `Recovery skill: $${contract.recovery_skill}`,
      `Checkpoint: ${contract.checkpoint_kind ?? "none"} / ${contract.checkpoint_id ?? "none"}`,
      `Prompt: ${contract.active_prompt_path ?? "none"}`,
      `Response: ${contract.active_response_path ?? "none"}`,
      `Resume command: ${contract.resume_command}`
    ].join("\n");
  }

  return [
    `State: ${contract.state}`,
    `Run: ${contract.run_id}`,
    `Stop reason: ${contract.stop_reason ?? "none"}`,
    ...(contract.notes?.map((note) => `- ${note}`) ?? [])
  ].join("\n");
};

const main = async () => {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    usage();
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  let hopIndex = 0;
  let repeatedCheckpointCount = 0;
  let previousCheckpointId;
  let previousProgressSignature;
  let statusReport = await readStatusReport(args.runDirectory);

  while (true) {
    const attentionRequired = statusReport.active?.attention_required;
    if (
      statusReport.effective_execution_state === "completed" ||
      statusReport.effective_execution_state === "failed" ||
      attentionRequired === "none"
    ) {
      const contract = buildContract({
        state: "terminal",
        statusReport,
        recommendedSkill: statusReport.active?.recommended_skill,
        hopLimit: args.hopLimit,
        hopIndex,
        notes: statusReport.operator_surface?.notes ?? []
      });
      console.log(args.json ? JSON.stringify(contract, null, 2) : renderContract(contract));
      return;
    }

    if (attentionRequired === "human") {
      const contract = buildContract({
        state: "human_stop",
        statusReport,
        recommendedSkill: statusReport.active?.recommended_skill,
        hopLimit: args.hopLimit,
        hopIndex,
        notes: statusReport.operator_surface?.notes ?? []
      });
      console.log(args.json ? JSON.stringify(contract, null, 2) : renderContract(contract));
      return;
    }

    if (attentionRequired === "external") {
      const contract = buildContract({
        state: "external_stop",
        statusReport,
        recommendedSkill: statusReport.active?.recommended_skill,
        hopLimit: args.hopLimit,
        hopIndex,
        notes: statusReport.operator_surface?.notes ?? []
      });
      console.log(args.json ? JSON.stringify(contract, null, 2) : renderContract(contract));
      return;
    }

    if (attentionRequired !== "codex") {
      const contract = buildContract({
        state: "human_stop",
        statusReport,
        recommendedSkill: statusReport.active?.recommended_skill,
        hopLimit: args.hopLimit,
        hopIndex,
        guardReason: "checkpoint_no_progress",
        notes: [
          `Unexpected same-thread continuation state '${attentionRequired ?? "none"}'.`
        ]
      });
      console.log(args.json ? JSON.stringify(contract, null, 2) : renderContract(contract));
      return;
    }

    const checkpointId = statusReport.active?.checkpoint_id;
    const progressSignature = buildProgressSignature(statusReport);
    if (checkpointId && checkpointId === previousCheckpointId) {
      repeatedCheckpointCount += 1;
    } else {
      repeatedCheckpointCount = 0;
    }

    if (repeatedCheckpointCount >= 2) {
      const contract = buildContract({
        state: "human_stop",
        statusReport,
        recommendedSkill: statusReport.active?.recommended_skill,
        hopLimit: args.hopLimit,
        hopIndex,
        repeatedCheckpointCount,
        guardReason: "checkpoint_loop_detected",
        notes: [
          `Checkpoint '${checkpointId ?? "missing"}' repeated without forward progress.`
        ]
      });
      console.log(args.json ? JSON.stringify(contract, null, 2) : renderContract(contract));
      return;
    }

    const responsePath = statusReport.active?.active_response_path;
    if (!responsePath || !(await fileExists(responsePath))) {
      const contract = buildContract({
        state: "codex_checkpoint",
        statusReport,
        hopLimit: args.hopLimit,
        hopIndex,
        repeatedCheckpointCount
      });
      console.log(args.json ? JSON.stringify(contract, null, 2) : renderContract(contract));
      return;
    }

    const parsedResponse = await readJsonIfExists(responsePath);
    if (
      checkpointId &&
      (!parsedResponse ||
        typeof parsedResponse !== "object" ||
        parsedResponse.checkpoint_id !== checkpointId)
    ) {
      const quarantinedPath = await quarantineCheckpointResponse({
        runDirectory: statusReport.run_directory,
        responsePath
      });
      const contract = buildContract({
        state: "human_stop",
        statusReport,
        recommendedSkill: statusReport.active?.recommended_skill,
        hopLimit: args.hopLimit,
        hopIndex,
        guardReason: "stale_checkpoint_response",
        notes: [
          `Quarantined stale or mismatched checkpoint response to ${quarantinedPath}.`,
          `Expected checkpoint_id '${checkpointId}'.`
        ]
      });
      console.log(args.json ? JSON.stringify(contract, null, 2) : renderContract(contract));
      return;
    }

    if (hopIndex >= args.hopLimit) {
      const contract = buildContract({
        state: "human_stop",
        statusReport,
        recommendedSkill: statusReport.active?.recommended_skill,
        hopLimit: args.hopLimit,
        hopIndex,
        repeatedCheckpointCount,
        guardReason: "hop_limit_reached",
        notes: [
          `Same-thread autocontinue hit hop limit ${args.hopLimit} before reaching a user-visible boundary.`
        ]
      });
      console.log(args.json ? JSON.stringify(contract, null, 2) : renderContract(contract));
      return;
    }

    previousCheckpointId = checkpointId;
    previousProgressSignature = progressSignature;
    hopIndex += 1;
    statusReport = await resumeRun(args.runDirectory);

    if (
      statusReport.active?.attention_required === "codex" &&
      buildProgressSignature(statusReport) === previousProgressSignature
    ) {
      const contract = buildContract({
        state: "human_stop",
        statusReport,
        recommendedSkill: statusReport.active?.recommended_skill,
        hopLimit: args.hopLimit,
        hopIndex,
        repeatedCheckpointCount,
        guardReason: "checkpoint_no_progress",
        notes: [
          `Autocontinue resumed '${previousCheckpointId ?? "missing"}' without changing the progress signature.`
        ]
      });
      console.log(args.json ? JSON.stringify(contract, null, 2) : renderContract(contract));
      return;
    }
  }
};

await main();
