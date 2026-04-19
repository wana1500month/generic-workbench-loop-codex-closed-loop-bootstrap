import { resolve } from "node:path";

import {
  isControllerMode
} from "./controller-mode.js";
import { repoRoot } from "./file-system.js";
import { prepareSessionRun } from "./prepare-session.js";
import { isTransportMode } from "./transport-mode.js";
import type {
  ControllerMode,
  OperatorWorkspaceSurface,
  TargetFamily,
  TransportMode
} from "./types.js";

type PrepareArgs = {
  runDirectory?: string;
  rubricPath?: string;
  targetFamily?: TargetFamily;
  targetScore?: number;
  maxRounds?: number;
  workspaceMode?: OperatorWorkspaceSurface;
  transportMode?: TransportMode;
  controllerMode?: ControllerMode;
  json: boolean;
  errors: string[];
};

const usage = [
  "Usage: npm run loop:prepare -- [--run-dir <run-dir>] [--target-family <family>] [--target-score <score>] [--max-rounds <count>] [--workspace-mode <local|worktree>] [--transport <transport>] [--controller-mode <attached|detached>] [--json]",
  "",
  "Writes runtime/build-brief.json, runtime/run-contract.json, runtime/operator-surface.json, runtime/open-questions.json, runtime/session-status.json, runtime/session-status-events.jsonl, runtime/session-stream.json, and docs/EXECUTION_PLAN.md without starting the loop."
].join("\n");

const isWorkspaceMode = (
  value: string | undefined
): value is OperatorWorkspaceSurface =>
  value === "local" || value === "worktree";

const parsePositiveInteger = (value: string | undefined): number | undefined => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const parseTargetScore = (value: string | undefined): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : undefined;
};

const parseArgs = (argv: readonly string[]): PrepareArgs => {
  let runDirectory: string | undefined;
  let rubricPath: string | undefined;
  let targetFamily: TargetFamily | undefined;
  let targetScore: number | undefined;
  let maxRounds: number | undefined;
  let workspaceMode: OperatorWorkspaceSurface | undefined;
  let transportMode: TransportMode | undefined;
  let controllerMode: ControllerMode | undefined;
  let json = false;
  const errors: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") {
      json = true;
      continue;
    }
    if (value === "--run-dir") {
      runDirectory = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--rubric") {
      rubricPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--target-family") {
      targetFamily = argv[index + 1] as TargetFamily | undefined;
      index += 1;
      continue;
    }
    if (value === "--target-score") {
      targetScore = parseTargetScore(argv[index + 1]);
      if (targetScore === undefined) {
        errors.push(`Invalid target score: ${argv[index + 1] ?? ""}`);
      }
      index += 1;
      continue;
    }
    if (value === "--max-rounds") {
      maxRounds = parsePositiveInteger(argv[index + 1]);
      if (maxRounds === undefined) {
        errors.push(`Invalid max rounds: ${argv[index + 1] ?? ""}`);
      }
      index += 1;
      continue;
    }
    if (value === "--workspace-mode") {
      const candidate = argv[index + 1];
      if (isWorkspaceMode(candidate)) {
        workspaceMode = candidate;
      } else {
        errors.push(`Invalid workspace mode: ${candidate ?? ""}`);
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

    errors.push(`Unexpected argument: ${value}`);
  }

  return {
    runDirectory,
    rubricPath,
    targetFamily,
    targetScore,
    maxRounds,
    workspaceMode,
    transportMode,
    controllerMode,
    json,
    errors
  };
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  if (args.errors.length > 0) {
    console.error(args.errors.join("\n"));
    console.log(usage);
    process.exitCode = 1;
    return;
  }

  const result = await prepareSessionRun({
    ...(args.runDirectory ? { runDirectory: resolve(repoRoot, args.runDirectory) } : {}),
    ...(args.rubricPath ? { rubricPath: args.rubricPath } : {}),
    ...(args.targetFamily ? { targetFamily: args.targetFamily } : {}),
    ...(args.targetScore !== undefined ? { targetScore: args.targetScore } : {}),
    ...(args.maxRounds !== undefined ? { maxRounds: args.maxRounds } : {}),
    ...(args.workspaceMode ? { workspaceMode: args.workspaceMode } : {}),
    ...(args.transportMode ? { transportMode: args.transportMode } : {}),
    ...(args.controllerMode ? { controllerMode: args.controllerMode } : {})
  });

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          run_id: result.runId,
          run_directory: result.runDirectory,
          build_brief_path: result.buildBriefPath,
          run_contract_path: result.runContractPath,
          open_questions_path: result.openQuestionsPath,
          session_status_path: result.sessionStatusPath,
          session_status_events_path: result.sessionStatusEventsPath,
          session_stream_path: result.sessionStreamPath,
          operator_surface_path: result.operatorSurfacePath,
          execution_plan_path: result.executionPlanPath,
          ...(result.adapterPath ? { adapter_path: result.adapterPath } : {}),
          ...(result.rubricPath ? { rubric_path: result.rubricPath } : {}),
          ...(result.evaluatorProfilePath
            ? { evaluator_profile_path: result.evaluatorProfilePath }
            : {})
        },
        null,
        2
      )
    );
    return;
  }

  console.log(`Prepared run: ${result.runDirectory}`);
  console.log(`Build brief: ${result.buildBriefPath}`);
  console.log(`Run contract: ${result.runContractPath}`);
  console.log(`Session status: ${result.sessionStatusPath}`);
  console.log(`Operator surface: ${result.operatorSurfacePath}`);
  console.log(`Execution plan: ${result.executionPlanPath}`);
  if (result.adapterPath) {
    console.log(`Prepared adapter: ${result.adapterPath}`);
  }
  if (result.rubricPath) {
    console.log(`Prepared rubric: ${result.rubricPath}`);
  }
  if (result.evaluatorProfilePath) {
    console.log(`Prepared evaluator bundle: ${result.evaluatorProfilePath}`);
  }
};

main().catch((error: unknown) => {
  console.error("Session prepare failed.");
  console.error(error);
  process.exitCode = 1;
});
