import { relative } from "node:path";

import { repoRoot } from "../../packages/loop-orchestrator/dist/file-system.js";
import {
  runClosedLoop,
  runSingleIteration
} from "../../packages/loop-orchestrator/dist/index.js";

const parsePositiveNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const parseTargetScore = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : undefined;
};

const controllerModes = new Set(["attached", "detached"]);
const transportModes = new Set(["codex-exec", "current-thread", "app-server"]);
const controllerRoundPhases = new Set([
  "planning",
  "negotiation",
  "pre_verification",
  "core_probes",
  "post_verification",
  "evaluation",
  "round_commit",
  "run_finalize"
]);

const parsePositiveTimeoutMs = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const parsePhaseTimeouts = (value) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const overrides = {};
  for (const entry of value.split(",")) {
    const [phase, timeout] = entry.split("=", 2).map((token) => token?.trim());
    if (!controllerRoundPhases.has(phase)) {
      throw new Error(`Invalid resume phase: ${phase ?? ""}`);
    }
    const timeoutMs = parsePositiveTimeoutMs(timeout);
    if (timeoutMs === undefined) {
      throw new Error(`Invalid phase timeout: ${timeout ?? ""}`);
    }
    overrides[phase] = timeoutMs;
  }
  return overrides;
};

const parseArgs = (argv) => {
  let adapterPath;
  let rubricPath;
  let evaluatorProfilePath;
  let targetFamily;
  let resumeRunPath;
  let allowResumeMigration = false;
  let forceReopenTerminal = false;
  let controllerMode;
  let transportMode;
  let appServerTaskTimeoutMs;
  let appServerRequestTimeoutMs;
  let phaseTimeouts;
  let repairOnly = false;
  let resumePhase;
  let executorMode;
  let mode = "loop";
  let maxRounds;
  let targetScore;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      const parsedRounds = parsePositiveNumber(value);
      if (parsedRounds !== undefined && maxRounds === undefined) {
        maxRounds = parsedRounds;
        continue;
      }
      const parsedTargetScore = parseTargetScore(value);
      if (parsedTargetScore !== undefined && targetScore === undefined) {
        targetScore = parsedTargetScore;
        continue;
      }
      throw new Error(`Unexpected positional argument: ${value}`);
    }

    switch (value) {
      case "--single":
        mode = "single";
        break;
      case "--adapter":
        adapterPath = argv[++index];
        break;
      case "--rubric":
        rubricPath = argv[++index];
        break;
      case "--evaluator-profile":
        evaluatorProfilePath = argv[++index];
        break;
      case "--target-family":
        targetFamily = argv[++index];
        break;
      case "--resume-run":
        resumeRunPath = argv[++index];
        break;
      case "--executor-mode":
        executorMode = argv[++index];
        if (
          executorMode !== "harness" &&
          executorMode !== "subagents-experimental"
        ) {
          throw new Error(`Invalid executor mode: ${executorMode ?? ""}`);
        }
        break;
      case "--controller-mode":
        controllerMode = argv[++index];
        if (!controllerModes.has(controllerMode)) {
          throw new Error(`Invalid controller mode: ${controllerMode ?? ""}`);
        }
        break;
      case "--transport":
        transportMode = argv[++index];
        if (!transportModes.has(transportMode)) {
          throw new Error(`Invalid transport mode: ${transportMode ?? ""}`);
        }
        break;
      case "--app-server-task-timeout-ms":
        appServerTaskTimeoutMs = parsePositiveTimeoutMs(argv[++index]);
        if (appServerTaskTimeoutMs === undefined) {
          throw new Error(`Invalid app-server task timeout: ${argv[index] ?? ""}`);
        }
        break;
      case "--app-server-request-timeout-ms":
        appServerRequestTimeoutMs = parsePositiveTimeoutMs(argv[++index]);
        if (appServerRequestTimeoutMs === undefined) {
          throw new Error(`Invalid app-server request timeout: ${argv[index] ?? ""}`);
        }
        break;
      case "--phase-timeout-ms":
        phaseTimeouts = parsePhaseTimeouts(argv[++index]);
        break;
      case "--repair":
        repairOnly = true;
        break;
      case "--resume-phase":
        resumePhase = argv[++index];
        if (!controllerRoundPhases.has(resumePhase)) {
          throw new Error(`Invalid resume phase: ${resumePhase ?? ""}`);
        }
        break;
      case "--allow-resume-migration":
        allowResumeMigration = true;
        break;
      case "--force-reopen-terminal":
        forceReopenTerminal = true;
        break;
      case "--max-rounds":
      case "--max-iterations":
        maxRounds = parsePositiveNumber(argv[++index]);
        if (maxRounds === undefined) {
          throw new Error(`Invalid round count: ${argv[index] ?? ""}`);
        }
        break;
      case "--target-score":
        targetScore = parseTargetScore(argv[++index]);
        if (targetScore === undefined) {
          throw new Error(`Invalid target score: ${argv[index] ?? ""}`);
        }
        break;
      default:
        throw new Error(`Unknown option: ${value}`);
    }
  }

  return {
    adapterPath,
    rubricPath,
    evaluatorProfilePath,
    targetFamily,
    resumeRunPath,
    allowResumeMigration,
    forceReopenTerminal,
    controllerMode,
    transportMode,
    appServerTaskTimeoutMs,
    appServerRequestTimeoutMs,
    phaseTimeouts,
    repairOnly,
    resumePhase,
    executorMode,
    mode,
    maxRounds,
    targetScore
  };
};

const args = parseArgs(process.argv.slice(2));
const result =
  args.mode === "single"
    ? await runSingleIteration({
        adapterPath: args.adapterPath,
        rubricPath: args.rubricPath,
        evaluatorProfilePath: args.evaluatorProfilePath,
        targetFamily: args.targetFamily,
        resumeRunPath: args.resumeRunPath,
        allowResumeMigration: args.allowResumeMigration,
        forceReopenTerminal: args.forceReopenTerminal,
        controllerMode: args.controllerMode,
        transportMode: args.transportMode,
        phaseTimeouts: args.phaseTimeouts,
        appServerTaskTimeoutMs: args.appServerTaskTimeoutMs,
        appServerRequestTimeoutMs: args.appServerRequestTimeoutMs,
        repairOnly: args.repairOnly,
        resumePhase: args.resumePhase,
        executorMode: args.executorMode,
        targetScore: args.targetScore
      })
    : await runClosedLoop({
        adapterPath: args.adapterPath,
        rubricPath: args.rubricPath,
        evaluatorProfilePath: args.evaluatorProfilePath,
        targetFamily: args.targetFamily,
        resumeRunPath: args.resumeRunPath,
        allowResumeMigration: args.allowResumeMigration,
        forceReopenTerminal: args.forceReopenTerminal,
        controllerMode: args.controllerMode,
        transportMode: args.transportMode,
        phaseTimeouts: args.phaseTimeouts,
        appServerTaskTimeoutMs: args.appServerTaskTimeoutMs,
        appServerRequestTimeoutMs: args.appServerRequestTimeoutMs,
        repairOnly: args.repairOnly,
        resumePhase: args.resumePhase,
        executorMode: args.executorMode,
        maxRounds: args.maxRounds,
        targetScore: args.targetScore
      });

const summary = result.summary;
console.log(`Run created: ${relative(repoRoot, result.runDirectory)}`);
console.log(`Idea: ${relative(repoRoot, summary.idea_path ?? "")}`);
console.log(`Rubric: ${summary.rubric_id}`);
console.log(`Controller mode: ${summary.controller_mode ?? "detached"}`);
console.log(`Transport: ${summary.transport_mode ?? "codex-exec"}`);
console.log(`Executor mode: ${summary.executor_mode ?? "harness"}`);
if (summary.target_family) {
  console.log(`Target family: ${summary.target_family}`);
}
if (summary.validation_lane) {
  console.log(`Validation lane: ${summary.validation_lane}`);
}
if (summary.evaluator_profile_path) {
  console.log(`Evaluator bundle: ${relative(repoRoot, summary.evaluator_profile_path)}`);
}
console.log(`Adapter: ${summary.adapter_attached ? summary.adapter_id : "none"}`);
if (summary.adapter_attached) {
  console.log(`Verifier: ${summary.verification_provider_id ?? "none"}`);
}
console.log(`Terminal control-plane score: ${summary.control_plane_score}`);
console.log(`Terminal proof score: ${summary.proof_score}`);
console.log(`Terminal release score: ${summary.release_score}`);
console.log(`Attempts written: ${summary.round_count}`);
if (summary.terminal_round !== undefined) {
  console.log(`Terminal attempt: ${summary.terminal_round}`);
}
if (summary.best_round !== undefined) {
  console.log(`Best-scoring attempt: ${summary.best_round}`);
}
if (
  summary.best_round !== undefined &&
  summary.best_round !== summary.terminal_round
) {
  console.log(
    `Best-scoring release score: ${summary.best_scoring_release_score ?? summary.release_score}`
  );
}
if (summary.stop_reason) {
  console.log(`Stop reason: ${summary.stop_reason}`);
}
if (summary.runtime_warnings?.length) {
  console.log("Runtime warnings:");
  for (const warning of summary.runtime_warnings) {
    console.log(`- ${warning}`);
  }
}
if (summary.codex_handoff_path) {
  console.log(`Codex handoff: ${relative(repoRoot, summary.codex_handoff_path)}`);
}
