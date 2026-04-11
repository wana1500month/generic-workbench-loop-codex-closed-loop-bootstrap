import { relative, resolve } from "node:path";

import { runInteractiveBootstrap } from "./bootstrap.js";
import {
  controllerRoundPhases,
  defaultControllerMode,
  isControllerMode,
  isControllerRoundPhase
} from "./controller-mode.js";
import { defaultExecutorMode, isExecutorMode } from "./executor-mode.js";
import { repoRoot } from "./file-system.js";
import { runClosedLoop } from "./loop.js";
import { restoreRunState } from "./resume-state.js";
import { assessRuntimeHealth } from "./runtime-health.js";
import {
  readOperatorSurfaceArtifact,
  runtimeStatePathsForRun
} from "./runtime-state.js";
import { resolveOperatorSurfaceContext } from "./operator-surface.js";
import { runSingleIteration } from "./run-single-iteration.js";
import {
  defaultTransportModeForControllerMode,
  isTransportMode
} from "./transport-mode.js";
import type {
  ControllerMode,
  ControllerRoundPhase,
  LoopRunSummary,
  OperatorSurfaceArtifact,
  TransportMode
} from "./types.js";

type RunCommandArgs = {
  adapterPath?: string;
  bootstrap?: boolean;
  rubricPath?: string;
  evaluatorProfilePath?: string;
  targetFamily?: string;
  resumeRunPath?: string;
  allowResumeMigration?: boolean;
  allowManualProtocolSeed?: boolean;
  allowShellResumeDowngrade?: boolean;
  forceReopenTerminal?: boolean;
  controllerMode?: "attached" | "detached";
  transportMode?: "codex-exec" | "current-thread" | "app-server";
  appServerTaskTimeoutMs?: number;
  appServerRequestTimeoutMs?: number;
  phaseTimeouts?: Partial<Record<ControllerRoundPhase, number>>;
  supervised?: boolean;
  noSupervisor?: boolean;
  repairOnly?: boolean;
  resumePhase?: ControllerRoundPhase;
  executorMode?: "harness" | "subagents-experimental";
  mode: "loop" | "single";
  maxRounds?: number;
  targetScore?: number;
  errors: string[];
};

type ParsedCommand =
  | {
      kind: "run";
      args: RunCommandArgs;
    }
  | {
      kind: "status";
      runDirectory?: string;
      json: boolean;
      errors: string[];
    }
  | {
      kind: "help";
      topic?: "status" | "resume" | "phase";
    };

interface StatusReport {
  run_id: string;
  run_directory: string;
  controller_mode?: string;
  transport_mode?: string;
  executor_mode?: string;
  target_family?: string;
  validation_lane?: string;
  stop_reason?: string;
  round_count: number;
  terminal_round?: number;
  best_round?: number;
  scores: {
    total: number;
    control_plane: number;
    proof: number;
    release: number;
  };
  active: {
    round?: number;
    phase?: ControllerRoundPhase;
    phase_status?: string;
    next_action?: string;
    active_prompt_path?: string;
    active_response_path?: string;
  };
  runtime_health: ReturnType<typeof assessRuntimeHealth>;
  operator_surface?: OperatorSurfaceArtifact;
  repair_notes: string[];
  interrupted_round?: {
    round: number;
    roundDirectory: string;
    resumeFromPhase: ControllerRoundPhase;
    phaseStatus: string;
  };
  paths: {
    summary_path: string;
    operator_surface_path: string;
    operator_surface_markdown_path: string;
    live_state_path: string;
    round_phase_path: string;
    controller_lease_path: string;
    transport_state_path: string;
  };
  resume_commands: {
    resume: string;
    phase?: string;
  };
}

const helpTokens = new Set(["help", "--help", "-h"]);
const manualProtocolSeedFlag = "--allow-manual-protocol-seed";
const shellResumeDowngradeFlag = "--allow-shell-resume-downgrade";
const phaseAliasMap = new Map<string, ControllerRoundPhase>([
  ["planning", "planning"],
  ["open", "planning"],
  ["negotiation", "negotiation"],
  ["negotiate", "negotiation"],
  ["pre_verification", "pre_verification"],
  ["pre-verification", "pre_verification"],
  ["preverify", "pre_verification"],
  ["pre-verify", "pre_verification"],
  ["core_probes", "core_probes"],
  ["core-probes", "core_probes"],
  ["probes", "core_probes"],
  ["post_verification", "post_verification"],
  ["post-verification", "post_verification"],
  ["postverify", "post_verification"],
  ["post-verify", "post_verification"],
  ["evaluation", "evaluation"],
  ["evaluate", "evaluation"],
  ["eval", "evaluation"],
  ["round_commit", "round_commit"],
  ["round-commit", "round_commit"],
  ["commit", "round_commit"],
  ["run_finalize", "run_finalize"],
  ["run-finalize", "run_finalize"],
  ["finalize", "run_finalize"],
  ["finish", "run_finalize"]
]);

const usageLines = [
  "Usage:",
  "  npm run loop:single",
  "  npm run loop:single:codex",
  "  npm run loop:single:manual",
  "  npm run loop:run",
  "  npm run loop:bootstrap",
  `  node ./scripts/loop-runner.mjs --controller-mode attached --transport current-thread --single ${manualProtocolSeedFlag}`,
  "  npm run loop:status -- --run-dir <run-dir> [--json]",
  `  npm run loop:resume -- --run-dir <run-dir> [--force-reopen-terminal] [--repair] [--resume-phase <phase>] [${shellResumeDowngradeFlag}]`,
  `  npm run loop:phase -- <phase> --run-dir <run-dir> [--force-reopen-terminal] [--repair] [${shellResumeDowngradeFlag}]`,
  "  node ./scripts/loop-runner.mjs --controller-mode attached --single",
  "  node ./scripts/loop-runner.mjs resume --run-dir <run-dir>",
  "  node ./scripts/loop-runner.mjs phase planning --run-dir <run-dir>",
  "  node ./scripts/loop-runner.mjs status --run-dir <run-dir> --json",
  "",
  "Phase aliases:",
  `  ${["open", "negotiate", "pre-verify", "core-probes", "post-verify", "evaluate", "commit", "finalize"].join(", ")}`,
  "",
  "Notes:",
  "  loop:single is an explicit detached/headless seed. Use loop:single:codex only from the Codex app, or loop:single:manual when you intentionally want a shell-owned manual-protocol seed.",
  `  shell-launched attached/current-thread seeds require a bound Codex thread id unless you intentionally pass ${manualProtocolSeedFlag}.`,
  "  resume/phase preserve the existing run controller and transport unless you override them explicitly.",
  `  app-visible current-thread runs must continue from the same Codex thread unless you intentionally pass ${shellResumeDowngradeFlag}.`,
  "  phase re-enters from the named phase and runs until the next persisted handoff or terminal stop.",
  "  current-thread planning/negotiation/evaluation handoffs remain file-backed through operator-surface.json."
] as const;

const subcommandUsage = {
    status: [
        "Usage: node ./scripts/loop-runner.mjs status --run-dir <run-dir> [--json]",
        "Reads persisted summary/runtime/operator-surface artifacts without starting a new controller."
    ],
    resume: [
        `Usage: node ./scripts/loop-runner.mjs resume --run-dir <run-dir> [--force-reopen-terminal] [--repair] [--resume-phase <phase>] [${shellResumeDowngradeFlag}]`,
        `Re-enters a persisted run using the stored controller/transport defaults unless overridden. App-visible current-thread runs require the same bound Codex thread unless ${shellResumeDowngradeFlag} is supplied.`
    ],
    phase: [
        `Usage: node ./scripts/loop-runner.mjs phase <phase> --run-dir <run-dir> [--force-reopen-terminal] [--repair] [${shellResumeDowngradeFlag}]`,
        `Friendly phase aliases such as 'open', 'negotiate', 'pre-verify', 'evaluate', and 'finalize' are accepted. App-visible current-thread runs require the same bound Codex thread unless ${shellResumeDowngradeFlag} is supplied.`
    ]
} as const;

const parsePositiveTimeoutMs = (value: string | undefined): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const parsePhaseTimeouts = (
  value: string | undefined
): Partial<Record<ControllerRoundPhase, number>> | undefined => {
  if (!value?.trim()) {
    return undefined;
  }

  const overrides: Record<string, number> = {};
  for (const entry of value.split(",")) {
    const [phase, timeout] = entry.split("=", 2).map((token) => token?.trim());
    if (!phase || !timeout || !isControllerRoundPhase(phase)) {
      return undefined;
    }
    const timeoutMs = parsePositiveTimeoutMs(timeout);
    if (!timeoutMs) {
      return undefined;
    }
    overrides[phase] = timeoutMs;
  }
  return overrides;
};

const parseRunArgs = (argv: readonly string[]): RunCommandArgs => {
  let adapterPath: string | undefined;
  let bootstrap = false;
  let rubricPath: string | undefined;
  let evaluatorProfilePath: string | undefined;
  let targetFamily: string | undefined;
  let resumeRunPath: string | undefined;
  let allowResumeMigration = false;
  let allowManualProtocolSeed = false;
  let allowShellResumeDowngrade = false;
  let forceReopenTerminal = false;
  let controllerMode: "attached" | "detached" | undefined;
  let transportMode: "codex-exec" | "current-thread" | "app-server" | undefined;
  let appServerTaskTimeoutMs: number | undefined;
  let appServerRequestTimeoutMs: number | undefined;
  let phaseTimeouts: Partial<Record<ControllerRoundPhase, number>> | undefined;
  let supervised = false;
  let noSupervisor = false;
  let repairOnly = false;
  let resumePhase: ControllerRoundPhase | undefined;
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

    if (value === manualProtocolSeedFlag) {
      allowManualProtocolSeed = true;
      continue;
    }

    if (value === shellResumeDowngradeFlag) {
      allowShellResumeDowngrade = true;
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

    if (value === "--app-server-task-timeout-ms") {
      const parsed = parsePositiveTimeoutMs(argv[index + 1]);
      if (parsed) {
        appServerTaskTimeoutMs = parsed;
      } else {
        errors.push(`Invalid app-server task timeout: ${argv[index + 1] ?? ""}`);
      }
      index += 1;
      continue;
    }

    if (value === "--app-server-request-timeout-ms") {
      const parsed = parsePositiveTimeoutMs(argv[index + 1]);
      if (parsed) {
        appServerRequestTimeoutMs = parsed;
      } else {
        errors.push(`Invalid app-server request timeout: ${argv[index + 1] ?? ""}`);
      }
      index += 1;
      continue;
    }

    if (value === "--phase-timeout-ms") {
      const parsed = parsePhaseTimeouts(argv[index + 1]);
      if (parsed) {
        phaseTimeouts = parsed;
      } else {
        errors.push(`Invalid phase timeout map: ${argv[index + 1] ?? ""}`);
      }
      index += 1;
      continue;
    }

    if (value === "--supervised") {
      supervised = true;
      continue;
    }

    if (value === "--no-supervisor") {
      noSupervisor = true;
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
    allowManualProtocolSeed,
    allowShellResumeDowngrade,
    forceReopenTerminal,
    controllerMode,
    transportMode,
    appServerTaskTimeoutMs,
    appServerRequestTimeoutMs,
    phaseTimeouts,
    supervised,
    noSupervisor,
    repairOnly,
    resumePhase,
    executorMode,
    mode,
    maxRounds,
    targetScore,
    errors
  };
};

const isHelpToken = (value: string | undefined): boolean =>
  typeof value === "string" && helpTokens.has(value);

const resolvePhaseName = (
  value: string | undefined
): ControllerRoundPhase | undefined => {
  if (!value) {
    return undefined;
  }

  return phaseAliasMap.get(value) ?? phaseAliasMap.get(value.toLowerCase());
};

const parseStatusCommand = (argv: readonly string[]): ParsedCommand => {
  let runDirectory: string | undefined;
  let json = false;
  const errors: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--run-dir" || value === "--resume-run") {
      runDirectory = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--json") {
      json = true;
      continue;
    }
    errors.push(`Unknown option: ${value}`);
  }

  if (!runDirectory) {
    errors.push("status requires --run-dir <run-dir>.");
  }

  return {
    kind: "status",
    runDirectory,
    json,
    errors
  };
};

const parseRunSubcommand = (
  kind: "resume" | "phase",
  argv: readonly string[]
): ParsedCommand => {
  const normalizedArgs: string[] = [];
  const errors: string[] = [];
  let phaseFromCommand: ControllerRoundPhase | undefined;
  let runDirectorySeen = false;

  let startIndex = 0;
  if (kind === "phase") {
    phaseFromCommand = resolvePhaseName(argv[0]);
    if (!phaseFromCommand) {
      return {
        kind: "run",
        args: {
          ...parseRunArgs([]),
          errors: [
            `phase requires a valid phase name. Supported phases: ${controllerRoundPhases.join(", ")}.`
          ]
        }
      };
    }
    startIndex = 1;
  }

  for (let index = startIndex; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--run-dir") {
      normalizedArgs.push("--resume-run", argv[index + 1] ?? "");
      runDirectorySeen = true;
      index += 1;
      continue;
    }
    if (value === "--resume-run") {
      runDirectorySeen = true;
    }
    normalizedArgs.push(value);
  }

  if (kind === "phase" && phaseFromCommand) {
    normalizedArgs.push("--resume-phase", phaseFromCommand);
  }

  const parsed = parseRunArgs(normalizedArgs);
  if (!runDirectorySeen && !parsed.resumeRunPath) {
    errors.push(`${kind} requires --run-dir <run-dir>.`);
  }
  if (kind === "phase" && parsed.mode === "single") {
    errors.push(
      "phase does not support --single. It re-enters the named phase using the persisted run budget."
    );
  }

  return {
    kind: "run",
    args: {
      ...parsed,
      errors: [...parsed.errors, ...errors]
    }
  };
};

const parseCommand = (argv: readonly string[]): ParsedCommand => {
  if (argv.length === 0) {
    return {
      kind: "run",
      args: parseRunArgs(argv)
    };
  }

  if (isHelpToken(argv[0])) {
    const topic =
      argv[1] === "status" || argv[1] === "resume" || argv[1] === "phase"
        ? argv[1]
        : undefined;
    return {
      kind: "help",
      ...(topic ? { topic } : {})
    };
  }

  if (argv[0] === "status") {
    if (isHelpToken(argv[1])) {
      return {
        kind: "help",
        topic: "status"
      };
    }
    return parseStatusCommand(argv.slice(1));
  }

  if (argv[0] === "resume") {
    if (isHelpToken(argv[1])) {
      return {
        kind: "help",
        topic: "resume"
      };
    }
    return parseRunSubcommand("resume", argv.slice(1));
  }

  if (argv[0] === "phase") {
    if (isHelpToken(argv[1])) {
      return {
        kind: "help",
        topic: "phase"
      };
    }
    return parseRunSubcommand("phase", argv.slice(1));
  }

  if (argv.some((value, index) => index === 0 && isHelpToken(value))) {
    return {
      kind: "help"
    };
  }

  return {
    kind: "run",
    args: parseRunArgs(argv)
  };
};

const printUsage = (topic?: "status" | "resume" | "phase"): void => {
  const lines = topic ? subcommandUsage[topic] : usageLines;
  for (const line of lines) {
    console.log(line);
  }
};

const displayPath = (path: string | undefined): string | undefined =>
  path ? relative(repoRoot, resolve(path)) : undefined;

const buildStatusReport = async (runDirectory: string): Promise<StatusReport> => {
  const restoredRun = await restoreRunState(runDirectory);
  const runtimePaths = runtimeStatePathsForRun(restoredRun.runDirectory);
  const operatorSurface =
    (await readOperatorSurfaceArtifact(runtimePaths.operatorSurfacePath)) ?? undefined;
  const runtimeHealth = assessRuntimeHealth({
    liveState: restoredRun.runtimeLiveState,
    roundPhase: restoredRun.runtimeRoundPhase,
    controllerLease: restoredRun.controllerLease,
    transportState: restoredRun.transportState
  });
  const summary = restoredRun.summary;
  const activeRound =
    operatorSurface?.round ??
    restoredRun.runtimeRoundPhase?.round ??
    restoredRun.interruptedRound?.round;
  const activePhase =
    operatorSurface?.phase ??
    restoredRun.runtimeRoundPhase?.phase ??
    restoredRun.interruptedRound?.resumeFromPhase;
  const activePhaseStatus =
    operatorSurface?.phase_status ??
    restoredRun.runtimeRoundPhase?.status ??
    restoredRun.interruptedRound?.phaseStatus;
  const resumeRunDir = resolve(restoredRun.runDirectory);
  const shellDowngradeSuffix =
    operatorSurface?.transport_mode === "current-thread" &&
    operatorSurface?.app_visibility === "visible-in-stock-app"
      ? ` ${shellResumeDowngradeFlag}`
      : "";
  const phaseResumeCommand = activePhase
    ? `npm run loop:phase -- ${activePhase} --run-dir "${resumeRunDir}"${shellDowngradeSuffix}`
    : undefined;
  const fallbackResumeCommand =
    operatorSurface?.resume_command ??
    (runtimeHealth.execution_state === "completed"
      ? `npm run loop:resume -- --run-dir "${resumeRunDir}" --force-reopen-terminal${shellDowngradeSuffix}`
      : phaseResumeCommand ??
        `npm run loop:resume -- --run-dir "${resumeRunDir}"${shellDowngradeSuffix}`);

  return {
    run_id: restoredRun.runId,
    run_directory: restoredRun.runDirectory,
    controller_mode: summary.controller_mode,
    transport_mode: summary.transport_mode,
    executor_mode: summary.executor_mode,
    ...(summary.target_family ? { target_family: summary.target_family } : {}),
    ...(summary.validation_lane ? { validation_lane: summary.validation_lane } : {}),
    ...(summary.stop_reason ? { stop_reason: summary.stop_reason } : {}),
    round_count: summary.round_count,
    ...(summary.terminal_round !== undefined
      ? { terminal_round: summary.terminal_round }
      : {}),
    ...(summary.best_round !== undefined ? { best_round: summary.best_round } : {}),
    scores: {
      total: summary.total_score,
      control_plane: summary.control_plane_score,
      proof: summary.proof_score,
      release: summary.release_score
    },
    active: {
      ...(activeRound !== undefined ? { round: activeRound } : {}),
      ...(activePhase ? { phase: activePhase } : {}),
      ...(activePhaseStatus ? { phase_status: activePhaseStatus } : {}),
      ...(operatorSurface?.next_action
        ? { next_action: operatorSurface.next_action }
        : {}),
      ...(operatorSurface?.active_prompt_path
        ? { active_prompt_path: operatorSurface.active_prompt_path }
        : {}),
      ...(operatorSurface?.active_response_path
        ? { active_response_path: operatorSurface.active_response_path }
        : {})
    },
    runtime_health: runtimeHealth,
    ...(operatorSurface ? { operator_surface: operatorSurface } : {}),
    repair_notes: restoredRun.repairNotes,
    ...(restoredRun.interruptedRound
      ? { interrupted_round: restoredRun.interruptedRound }
      : {}),
    paths: {
      summary_path: joinRunPath(restoredRun.runDirectory, "summary.json"),
      operator_surface_path: runtimePaths.operatorSurfacePath,
      operator_surface_markdown_path: runtimePaths.operatorSurfaceMarkdownPath,
      live_state_path: runtimePaths.liveStatePath,
      round_phase_path: runtimePaths.roundPhasePath,
      controller_lease_path: runtimePaths.controllerLeasePath,
      transport_state_path: runtimePaths.transportStatePath
    },
    resume_commands: {
      resume: fallbackResumeCommand,
      ...(phaseResumeCommand ? { phase: phaseResumeCommand } : {})
    }
  };
};

const joinRunPath = (runDirectory: string, fileName: string): string =>
  resolve(runDirectory, fileName);

const requiresCodexThreadContinuation = (
  operatorSurface: OperatorSurfaceArtifact | undefined
): boolean =>
  operatorSurface?.transport_mode === "current-thread" &&
  operatorSurface.app_visibility === "visible-in-stock-app" &&
  operatorSurface.requires_codex_app === true &&
  operatorSurface.handoff_state !== "automation" &&
  operatorSurface.handoff_state !== "headless";

const trimOptionalString = (value: string | undefined): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const resolveCurrentInvocationCodexThreadContext = (input: {
  controllerMode: ControllerMode;
  transportMode: TransportMode;
}) => resolveOperatorSurfaceContext(input);

const currentInvocationOwnsCodexThread = (
  context: ReturnType<typeof resolveCurrentInvocationCodexThreadContext>
): boolean =>
  (
    context.presentationMode === "foreground-thread" &&
    context.appVisibility === "visible-in-stock-app" &&
    context.surfaceOwner === "stock-codex-thread" &&
    context.threadBindingState === "bound" &&
    typeof context.threadId === "string"
  );

const validateResumeOwnership = async (input: {
  resumeRunPath: string;
  controllerMode?: ControllerMode;
  transportMode?: TransportMode;
  allowShellResumeDowngrade: boolean;
}): Promise<string | undefined> => {
  const restoredRun = await restoreRunState(input.resumeRunPath);
  const runtimePaths = runtimeStatePathsForRun(restoredRun.runDirectory);
  const operatorSurface =
    (await readOperatorSurfaceArtifact(runtimePaths.operatorSurfacePath)) ?? undefined;
  const resumedControllerMode = isControllerMode(restoredRun.summary.controller_mode)
    ? restoredRun.summary.controller_mode
    : defaultControllerMode;
  const effectiveControllerMode = input.controllerMode ?? resumedControllerMode;
  const resumedTransportMode = isTransportMode(restoredRun.summary.transport_mode)
    ? restoredRun.summary.transport_mode
    : defaultTransportModeForControllerMode(effectiveControllerMode);
  const effectiveTransportMode = input.transportMode ?? resumedTransportMode;
  if (!requiresCodexThreadContinuation(operatorSurface)) {
    return undefined;
  }
  const currentContext = resolveCurrentInvocationCodexThreadContext({
    controllerMode: effectiveControllerMode,
    transportMode: effectiveTransportMode
  });
  const resumeSkill = operatorSurface?.resume_skill ?? "attached-loop";
  const persistedThreadId = trimOptionalString(operatorSurface?.thread_id);
  if (!currentInvocationOwnsCodexThread(currentContext)) {
    if (input.allowShellResumeDowngrade) {
      return undefined;
    }
    return [
      `Run '${restoredRun.runId}' is currently owned by a visible Codex thread.`,
      `Resume it from the Codex app with $${resumeSkill} instead of reopening it from a shell.`,
      `If you intentionally want to downgrade this run to manual-protocol, rerun with ${shellResumeDowngradeFlag}.`
    ].join(" ");
  }
  if (!persistedThreadId) {
    return [
      `Run '${restoredRun.runId}' requires same-thread Codex continuation, but its persisted operator surface has no thread_id.`,
      `Reopen it from the original Codex thread with $${resumeSkill} so the run can stay bound.`
    ].join(" ");
  }
  if (trimOptionalString(currentContext.threadId) !== persistedThreadId) {
    return [
      `Run '${restoredRun.runId}' is owned by Codex thread '${persistedThreadId}'.`,
      `Resume it from that same Codex thread with $${resumeSkill} instead of continuing from '${currentContext.threadId ?? "unknown"}'.`
    ].join(" ");
  }
  return undefined;
};

const validateSeedOwnership = (input: {
  controllerMode?: ControllerMode;
  transportMode?: TransportMode;
  allowManualProtocolSeed: boolean;
}): string | undefined => {
  if (
    input.controllerMode !== "attached" ||
    input.transportMode !== "current-thread" ||
    currentInvocationOwnsCodexThread(
      resolveCurrentInvocationCodexThreadContext({
        controllerMode: "attached",
        transportMode: "current-thread"
      })
    )
  ) {
    return undefined;
  }
  if (input.allowManualProtocolSeed) {
    return undefined;
  }
  return [
    "Shell-launched attached/current-thread seeds require a bound Codex thread id.",
    "Start this run from the Codex app so $attached-loop owns the foreground thread,",
    `or rerun with ${manualProtocolSeedFlag} if you intentionally want a manual-protocol shell seed.`
  ].join(" ");
};

const printRunResult = (
  summary: LoopRunSummary,
  runDirectory: string,
  defaults: {
    controllerMode: string;
    transportMode: string;
    executorMode: string;
  }
): void => {
  const runPath = relative(repoRoot, runDirectory);

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
  console.log(`Controller mode: ${summary.controller_mode ?? defaults.controllerMode}`);
  console.log(`Transport: ${summary.transport_mode ?? defaults.transportMode}`);
  console.log(`Executor mode: ${summary.executor_mode ?? defaults.executorMode}`);
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

const printStatusReport = (report: StatusReport): void => {
  console.log(`Run: ${displayPath(report.run_directory) ?? report.run_directory}`);
  console.log(
    `Controller: ${report.controller_mode ?? "unknown"} / ${report.transport_mode ?? "unknown"} / ${report.executor_mode ?? "unknown"}`
  );
  if (report.target_family) {
    console.log(`Target family: ${report.target_family}`);
  }
  if (report.validation_lane) {
    console.log(`Validation lane: ${report.validation_lane}`);
  }
  if (report.operator_surface) {
    console.log(
      `Surface: ${report.operator_surface.presentation_mode} (${report.operator_surface.launch_origin}, ${report.operator_surface.surface_owner}, ${report.operator_surface.thread_binding_state})`
    );
    console.log(
      `Visibility: ${report.operator_surface.app_visibility} via ${report.operator_surface.entrypoint}`
    );
    console.log(
      `Handoff: ${report.operator_surface.handoff_state} / Resume skill: ${report.operator_surface.resume_skill} / Requires Codex app: ${report.operator_surface.requires_codex_app ? "yes" : "no"}`
    );
    if (report.operator_surface.worktree_id || report.operator_surface.worktree_path) {
      console.log(
        `Worktree: ${report.operator_surface.worktree_id ?? "none"} / ${report.operator_surface.worktree_path ?? "none"}`
      );
    }
  }
  console.log(
    `Execution: ${report.runtime_health.execution_state} - ${report.runtime_health.summary}`
  );
  if (report.active.round !== undefined || report.active.phase) {
    console.log(
      `Active: round ${report.active.round ?? "none"} / ${report.active.phase ?? "none"} / ${report.active.phase_status ?? "none"}`
    );
  }
  console.log(
    `Scores: total ${report.scores.total}, control-plane ${report.scores.control_plane}, proof ${report.scores.proof}, release ${report.scores.release}`
  );
  console.log(`Attempts written: ${report.round_count}`);
  if (report.stop_reason) {
    console.log(`Stop reason: ${report.stop_reason}`);
  }
  if (report.operator_surface?.next_action) {
    console.log(`Next action: ${report.operator_surface.next_action}`);
  }
  if (report.active.active_prompt_path) {
    console.log(
      `Active prompt: ${displayPath(report.active.active_prompt_path) ?? report.active.active_prompt_path}`
    );
  }
  if (report.active.active_response_path) {
    console.log(
      `Active response: ${displayPath(report.active.active_response_path) ?? report.active.active_response_path}`
    );
  }
  console.log(
    `Summary: ${displayPath(report.paths.summary_path) ?? report.paths.summary_path}`
  );
  console.log(
    `Operator surface: ${displayPath(report.paths.operator_surface_path) ?? report.paths.operator_surface_path}`
  );
  if (
    report.operator_surface?.app_visibility === "visible-in-stock-app" &&
    report.operator_surface.resume_skill
  ) {
    console.log(`Resume skill: $${report.operator_surface.resume_skill}`);
    console.log(`CLI fallback: ${report.resume_commands.resume}`);
    if (report.resume_commands.phase) {
      console.log(`CLI phase fallback: ${report.resume_commands.phase}`);
    }
  } else {
    console.log(
      `Resume: ${report.operator_surface?.resume_command ?? report.resume_commands.resume}`
    );
    if (report.resume_commands.phase) {
      console.log(`Phase re-entry: ${report.resume_commands.phase}`);
    }
  }
  if (report.repair_notes.length > 0) {
    console.log("Repair notes:");
    for (const note of report.repair_notes) {
      console.log(`- ${note}`);
    }
  }
};

const main = async (): Promise<void> => {
  const command = parseCommand(process.argv.slice(2));

  if (command.kind === "help") {
    printUsage(command.topic);
    return;
  }

  if (command.kind === "status") {
    if (command.errors.length > 0) {
      console.error(command.errors.join("\n"));
      printUsage("status");
      process.exitCode = 1;
      return;
    }
    const statusReport = await buildStatusReport(command.runDirectory!);
    if (command.json) {
      console.log(JSON.stringify(statusReport, null, 2));
    } else {
      printStatusReport(statusReport);
    }
    return;
  }

  const args = command.args;
  if (args.errors.length > 0) {
    console.error(args.errors.join("\n"));
    printUsage();
    process.exitCode = 1;
    return;
  }

  let adapterPath = args.adapterPath;
  let rubricPath = args.rubricPath;
  let evaluatorProfilePath = args.evaluatorProfilePath;
  let targetFamily = args.targetFamily;
  let targetScore = args.targetScore;
  let maxRounds = args.maxRounds;
  const envControllerMode = isControllerMode(process.env.HARNESS_CONTROLLER_MODE)
    ? process.env.HARNESS_CONTROLLER_MODE
    : undefined;
  const envTransportMode = isTransportMode(process.env.HARNESS_TRANSPORT)
    ? process.env.HARNESS_TRANSPORT
    : undefined;
  const envExecutorMode = isExecutorMode(process.env.HARNESS_EXECUTOR_MODE)
    ? process.env.HARNESS_EXECUTOR_MODE
    : undefined;
  const controllerMode =
    args.controllerMode ??
    envControllerMode ??
    (args.resumeRunPath ? undefined : defaultControllerMode);
  const transportMode =
    args.transportMode ??
    envTransportMode ??
    (controllerMode
      ? defaultTransportModeForControllerMode(controllerMode)
      : undefined);
  const executorMode =
    args.executorMode ??
    envExecutorMode ??
    (args.resumeRunPath ? undefined : defaultExecutorMode);
  if (!args.resumeRunPath) {
    const seedOwnershipError = validateSeedOwnership({
      controllerMode,
      transportMode,
      allowManualProtocolSeed: args.allowManualProtocolSeed ?? false
    });
    if (seedOwnershipError) {
      console.error(seedOwnershipError);
      process.exitCode = 1;
      return;
    }
  }
  if (args.resumeRunPath) {
    const resumeOwnershipError = await validateResumeOwnership({
      resumeRunPath: args.resumeRunPath,
      controllerMode,
      transportMode,
      allowShellResumeDowngrade: args.allowShellResumeDowngrade ?? false
    });
    if (resumeOwnershipError) {
      console.error(resumeOwnershipError);
      process.exitCode = 1;
      return;
    }
  }
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
          appServerTaskTimeoutMs: args.appServerTaskTimeoutMs,
          appServerRequestTimeoutMs: args.appServerRequestTimeoutMs,
          phaseTimeouts: args.phaseTimeouts,
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
          appServerTaskTimeoutMs: args.appServerTaskTimeoutMs,
          appServerRequestTimeoutMs: args.appServerRequestTimeoutMs,
          phaseTimeouts: args.phaseTimeouts,
          repairOnly: args.repairOnly,
          resumePhase: args.resumePhase,
          executorMode,
          maxRounds,
          targetScore
        });

  printRunResult(result.summary, result.runDirectory, {
    controllerMode:
      controllerMode ?? result.summary.controller_mode ?? defaultControllerMode,
    transportMode:
      transportMode ??
      result.summary.transport_mode ??
      defaultTransportModeForControllerMode(
        controllerMode ?? result.summary.controller_mode ?? defaultControllerMode
      ),
    executorMode: executorMode ?? result.summary.executor_mode ?? defaultExecutorMode
  });
};

main().catch((error: unknown) => {
  console.error("Loop run failed.");
  console.error(error);
  process.exitCode = 1;
});
