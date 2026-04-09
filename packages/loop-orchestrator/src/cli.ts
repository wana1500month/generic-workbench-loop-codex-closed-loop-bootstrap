import { relative } from "node:path";

import { runInteractiveBootstrap } from "./bootstrap.js";
import {
  defaultControllerMode,
  isControllerMode,
  isControllerRoundPhase
} from "./controller-mode.js";
import { defaultExecutorMode, isExecutorMode } from "./executor-mode.js";
import { repoRoot } from "./file-system.js";
import { runClosedLoop } from "./loop.js";
import { runSingleIteration } from "./run-single-iteration.js";
import {
  defaultTransportModeForControllerMode,
  isTransportMode
} from "./transport-mode.js";

const parseArgs = (
  argv: readonly string[]
): {
  adapterPath?: string;
  bootstrap?: boolean;
  rubricPath?: string;
  evaluatorProfilePath?: string;
  targetFamily?: string;
  resumeRunPath?: string;
  allowResumeMigration?: boolean;
  forceReopenTerminal?: boolean;
  controllerMode?: "attached" | "detached";
  transportMode?: "codex-exec" | "current-thread" | "app-server";
  repairOnly?: boolean;
  resumePhase?: 
    | "negotiation"
    | "pre_verification"
    | "core_probes"
    | "post_verification"
    | "evaluation"
    | "round_commit"
    | "run_finalize";
  executorMode?: "harness" | "subagents-experimental";
  mode: "loop" | "single";
  maxRounds?: number;
  targetScore?: number;
  errors: string[];
} => {
  let adapterPath: string | undefined;
  let bootstrap = false;
  let rubricPath: string | undefined;
  let evaluatorProfilePath: string | undefined;
  let targetFamily: string | undefined;
  let resumeRunPath: string | undefined;
  let allowResumeMigration = false;
  let forceReopenTerminal = false;
  let controllerMode: "attached" | "detached" | undefined;
  let transportMode: "codex-exec" | "current-thread" | "app-server" | undefined;
  let repairOnly = false;
  let resumePhase:
    | "negotiation"
    | "pre_verification"
    | "core_probes"
    | "post_verification"
    | "evaluation"
    | "round_commit"
    | "run_finalize"
    | undefined;
  let executorMode: "harness" | "subagents-experimental" | undefined;
  let mode: "loop" | "single" = "loop";
  let maxRounds: number | undefined;
  let targetScore: number | undefined;
  const errors: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (!value.startsWith("--")) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0 && maxRounds === undefined) {
        maxRounds = parsed;
      } else {
        errors.push(`Unexpected positional argument: ${value}`);
      }
      continue;
    }

    if (value === "--rubric") {
      rubricPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--adapter") {
      adapterPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--bootstrap") {
      bootstrap = true;
      continue;
    }

    if (value === "--evaluator-profile") {
      evaluatorProfilePath = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--target-family") {
      targetFamily = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--resume-run") {
      resumeRunPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--allow-resume-migration") {
      allowResumeMigration = true;
      continue;
    }

    if (value === "--force-reopen-terminal") {
      forceReopenTerminal = true;
      continue;
    }

    if (value === "--controller-mode") {
      const candidate = argv[index + 1];
      if (isControllerMode(candidate)) {
        controllerMode = candidate;
      } else {
        errors.push(`Invalid controller mode: ${candidate ?? ""}`);
      }
      index += 1;
      continue;
    }

    if (value === "--transport") {
      const candidate = argv[index + 1];
      if (isTransportMode(candidate)) {
        transportMode = candidate;
      } else {
        errors.push(`Invalid transport mode: ${candidate ?? ""}`);
      }
      index += 1;
      continue;
    }

    if (value === "--repair") {
      repairOnly = true;
      continue;
    }

    if (value === "--resume-phase") {
      const candidate = argv[index + 1];
      if (isControllerRoundPhase(candidate)) {
        resumePhase = candidate;
      } else {
        errors.push(`Invalid resume phase: ${candidate ?? ""}`);
      }
      index += 1;
      continue;
    }

    if (value === "--executor-mode") {
      const candidate = argv[index + 1];
      if (isExecutorMode(candidate)) {
        executorMode = candidate;
      } else {
        errors.push(`Invalid executor mode: ${candidate ?? ""}`);
      }
      index += 1;
      continue;
    }

    if (value === "--single") {
      mode = "single";
      continue;
    }

    if (value === "--max-rounds" || value === "--max-iterations") {
      const parsed = Number(argv[index + 1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        maxRounds = parsed;
      } else {
        errors.push(`Invalid round count: ${argv[index + 1] ?? ""}`);
      }
      index += 1;
      continue;
    }

    if (value === "--target-score") {
      const parsed = Number(argv[index + 1]);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
        targetScore = parsed;
      } else {
        errors.push(`Invalid target score: ${argv[index + 1] ?? ""}`);
      }
      index += 1;
      continue;
    }

    errors.push(`Unknown option: ${value}`);
  }

  return {
    adapterPath,
    bootstrap,
    rubricPath,
    evaluatorProfilePath,
    targetFamily,
    resumeRunPath,
    allowResumeMigration,
    forceReopenTerminal,
    controllerMode,
    transportMode,
    repairOnly,
    resumePhase,
    executorMode,
    mode,
    maxRounds,
    targetScore,
    errors
  };
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));

  if (args.errors.length > 0) {
    console.error(args.errors.join("\n"));
    console.error("Usage: npm run loop:single");
    console.error("       npm run loop:run");
    console.error("       npm run loop:bootstrap");
    console.error("       npm run loop:run -- 3");
    console.error(
      "       npm run loop:run -- --adapter <path> --target-family <family> --rubric <path> --evaluator-profile <path> --executor-mode harness --max-rounds 2"
    );
    console.error(
      "       node ./packages/loop-orchestrator/dist/cli.js --controller-mode attached --transport current-thread --single"
    );
    console.error(
      "       node ./packages/loop-orchestrator/dist/cli.js --resume-run <run-dir> --max-rounds 3"
    );
    console.error(
      "       node ./packages/loop-orchestrator/dist/cli.js --resume-run <run-dir> --allow-resume-migration --target-family api-service"
    );
    console.error(
      "       node ./packages/loop-orchestrator/dist/cli.js --resume-run <run-dir> --force-reopen-terminal"
    );
    console.error(
      "       node ./packages/loop-orchestrator/dist/cli.js --resume-run <run-dir> --repair --resume-phase evaluation --controller-mode detached"
    );
    process.exitCode = 1;
    return;
  }

  let adapterPath = args.adapterPath;
  let rubricPath = args.rubricPath;
  let evaluatorProfilePath = args.evaluatorProfilePath;
  let targetFamily = args.targetFamily;
  let targetScore = args.targetScore;
  let maxRounds = args.maxRounds;
  const controllerMode =
    args.controllerMode ??
    (isControllerMode(process.env.HARNESS_CONTROLLER_MODE)
      ? process.env.HARNESS_CONTROLLER_MODE
      : undefined) ??
    defaultControllerMode;
  const transportMode =
    args.transportMode ??
    (isTransportMode(process.env.HARNESS_TRANSPORT)
      ? process.env.HARNESS_TRANSPORT
      : undefined) ??
    defaultTransportModeForControllerMode(controllerMode);
  const executorMode =
    args.executorMode ??
    (isExecutorMode(process.env.HARNESS_EXECUTOR_MODE)
      ? process.env.HARNESS_EXECUTOR_MODE
      : undefined) ??
    defaultExecutorMode;
  if (args.bootstrap) {
    const bootstrap = await runInteractiveBootstrap();
    adapterPath = bootstrap.adapterPath;
    rubricPath = rubricPath ?? bootstrap.rubricPath;
    evaluatorProfilePath = evaluatorProfilePath ?? bootstrap.evaluatorProfilePath;
    targetFamily = bootstrap.targetFamily;
    targetScore = bootstrap.targetScore;
    maxRounds = bootstrap.maxRounds;
    console.log(
      `Bootstrap completed: ${relative(repoRoot, bootstrap.adapterPath)}`
    );
    console.log(`Idea updated: ${relative(repoRoot, bootstrap.ideaPath)}`);
    console.log(`Intake saved: ${relative(repoRoot, bootstrap.intakePath)}`);
    console.log(
      `Feature ledger: ${relative(repoRoot, bootstrap.featureListPath)}`
    );
    console.log(`Progress log: ${relative(repoRoot, bootstrap.progressPath)}`);
    console.log(
      `Progress journal: ${relative(repoRoot, bootstrap.progressLogPath)}`
    );
    console.log(`Done-when: ${relative(repoRoot, bootstrap.doneWhenPath)}`);
    console.log(`Init script: ${relative(repoRoot, bootstrap.initScriptPath)}`);
    console.log(
      `Generated rubric: ${relative(repoRoot, bootstrap.rubricPath)}`
    );
    console.log(
      `Generated evaluator bundle: ${relative(repoRoot, bootstrap.evaluatorProfilePath)}`
    );
    console.log(`Target score: ${bootstrap.targetScore}`);
    console.log(`Max rounds: ${bootstrap.maxRounds}`);
  }

  const result =
    args.mode === "single"
      ? await runSingleIteration({
          adapterPath,
          rubricPath,
          evaluatorProfilePath,
          targetFamily,
          resumeRunPath: args.resumeRunPath,
          allowResumeMigration: args.allowResumeMigration,
          forceReopenTerminal: args.forceReopenTerminal,
          controllerMode,
          transportMode,
          repairOnly: args.repairOnly,
          resumePhase: args.resumePhase,
          executorMode,
          targetScore
        })
      : await runClosedLoop({
          adapterPath,
          rubricPath,
          evaluatorProfilePath,
          targetFamily,
          resumeRunPath: args.resumeRunPath,
          allowResumeMigration: args.allowResumeMigration,
          forceReopenTerminal: args.forceReopenTerminal,
          controllerMode,
          transportMode,
          repairOnly: args.repairOnly,
          resumePhase: args.resumePhase,
          executorMode,
          maxRounds,
          targetScore
        });

  const runPath = relative(repoRoot, result.runDirectory);
  const summary = result.summary;

  console.log(`Run created: ${runPath}`);
  console.log(`Idea: ${relative(repoRoot, summary.idea_path ?? "")}`);
  if (summary.feature_list_path) {
    console.log(`Feature ledger: ${relative(repoRoot, summary.feature_list_path)}`);
  }
  if (summary.progress_path) {
    console.log(`Progress log: ${relative(repoRoot, summary.progress_path)}`);
  }
  if (summary.progress_log_path) {
    console.log(`Progress journal: ${relative(repoRoot, summary.progress_log_path)}`);
  }
  if (summary.done_when_path) {
    console.log(`Done-when: ${relative(repoRoot, summary.done_when_path)}`);
  }
  if (summary.init_script_path) {
    console.log(`Init script: ${relative(repoRoot, summary.init_script_path)}`);
  }
  console.log(`Rubric: ${summary.rubric_id}`);
  console.log(`Controller mode: ${summary.controller_mode ?? controllerMode}`);
  console.log(`Transport: ${summary.transport_mode ?? transportMode}`);
  console.log(`Executor mode: ${summary.executor_mode ?? executorMode}`);
  if (summary.target_family) {
    console.log(`Target family: ${summary.target_family}`);
  }
  if (summary.validation_lane) {
    console.log(`Validation lane: ${summary.validation_lane}`);
  }
  if (summary.evaluator_profile_path) {
    console.log(
      `Evaluator bundle: ${relative(repoRoot, summary.evaluator_profile_path)}`
    );
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
  if (summary.resume_migration_path) {
    console.log(
      `Resume migration: ${relative(repoRoot, summary.resume_migration_path)}`
    );
  }
  if (summary.codex_handoff_path) {
    console.log(`Codex handoff: ${relative(repoRoot, summary.codex_handoff_path)}`);
  }
};

main().catch((error: unknown) => {
  console.error("Loop run failed.");
  console.error(error);
  process.exitCode = 1;
});
