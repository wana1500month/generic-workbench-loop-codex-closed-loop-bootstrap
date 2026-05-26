import { relative, resolve } from "node:path";
import { runInteractiveBootstrap } from "./bootstrap.js";
import { controllerRoundPhases, defaultControllerMode, isControllerMode, isControllerRoundPhase } from "./controller-mode.js";
import { defaultExecutorMode, isExecutorMode } from "./executor-mode.js";
import { repoRoot } from "./file-system.js";
import { runClosedLoop } from "./loop.js";
import { restoreRunState } from "./resume-state.js";
import { assessRuntimeHealth, pausedStopReasons } from "./runtime-health.js";
import { normalizeRunStopReason } from "./stop-reason.js";
import { readOperatorSurfaceArtifact, readSupervisorStateArtifact, runtimeStatePathsForRun } from "./runtime-state.js";
import { resolveOperatorSurfaceContext } from "./operator-surface.js";
import { runSingleIteration } from "./run-single-iteration.js";
import { defaultTransportModeForControllerMode, isTransportMode } from "./transport-mode.js";
const helpTokens = new Set(["help", "--help", "-h"]);
const manualProtocolSeedFlag = "--allow-manual-protocol-seed";
const codexAppForegroundFlag = "--codex-app-foreground";
const shellResumeDowngradeFlag = "--allow-shell-resume-downgrade";
const externalTargetRootFlag = "--allow-external-target-root";
const phaseAliasMap = new Map([
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
    "  npm run loop:prepare",
    "  npm run loop:prepare -- --json",
    "  npm run loop:start:codex",
    `  npm run loop:start:codex -- --json [--run-id <prepared-run-id>] [${codexAppForegroundFlag}]`,
    "  npm run loop:start:bg",
    "  npm run loop:start:manual",
    "  npm run loop:start:manual -- --json",
    "  npm run loop:stop -- --run-dir <run-dir>",
    "  npm run loop:bootstrap",
    `  node ./scripts/loop-runner.mjs --controller-mode attached --transport current-thread --single ${manualProtocolSeedFlag}`,
    "  npm run loop:status -- --run-dir <run-dir> [--json]",
    `  npm run loop:resume -- --run-dir <run-dir> [--json] [--force-reopen-terminal] [--repair] [--resume-phase <phase>] [${shellResumeDowngradeFlag}]`,
    `  npm run loop:phase -- <phase> --run-dir <run-dir> [--json] [--force-reopen-terminal] [--repair] [${shellResumeDowngradeFlag}]`,
    "  node ./scripts/loop-runner.mjs --controller-mode attached --single",
    "  node ./scripts/loop-runner.mjs resume --run-dir <run-dir> --json",
    "  node ./scripts/loop-runner.mjs phase planning --run-dir <run-dir> --json",
    "  node ./scripts/loop-runner.mjs status --run-dir <run-dir> --json",
    "",
    "Phase aliases:",
    `  ${["open", "negotiate", "pre-verify", "core-probes", "post-verify", "evaluate", "commit", "finalize"].join(", ")}`,
    "",
    "Notes:",
    "  loop:prepare writes the session-level build brief, run contract, operator surface, session status, session stream, and execution plan without starting the loop.",
    "  loop:start:codex is the Codex-owned current-thread start. loop:start:bg is the detached supervisor surface. loop:start:manual is the intentional shell-owned manual-protocol start.",
    "  Deprecated aliases remain available: loop:run -> loop:start:bg, loop:single:codex -> loop:start:codex, loop:single:manual -> loop:start:manual, loop:single -> detached single-attempt seed.",
    `  shell-launched attached/current-thread seeds require a bound Codex thread id unless you intentionally pass ${manualProtocolSeedFlag}; Codex app skills without CODEX_THREAD_ID may pass ${codexAppForegroundFlag} with --run-id.`,
    `  adapter target_root values outside this repository require ${externalTargetRootFlag} or HARNESS_ALLOW_EXTERNAL_TARGET_ROOT=1.`,
    "  resume/phase preserve the existing run controller and transport unless you override them explicitly.",
    `  app-visible current-thread runs must continue from the same Codex thread unless you intentionally pass ${shellResumeDowngradeFlag}.`,
    "  phase re-enters from the named phase and runs until the next persisted checkpoint or terminal stop.",
    "  current-thread planning/negotiation/evaluation checkpoints remain file-backed through operator-surface.json."
];
const subcommandUsage = {
    status: [
        "Usage: node ./scripts/loop-runner.mjs status --run-dir <run-dir> [--json]",
        "Reads persisted summary/runtime/operator-surface artifacts without starting a new controller."
    ],
    resume: [
        `Usage: node ./scripts/loop-runner.mjs resume --run-dir <run-dir> [--json] [--force-reopen-terminal] [--repair] [--resume-phase <phase>] [${shellResumeDowngradeFlag}]`,
        `Re-enters a persisted run using the stored controller/transport defaults unless overridden. App-visible current-thread runs require the same bound Codex thread unless ${shellResumeDowngradeFlag} is supplied.`
    ],
    phase: [
        `Usage: node ./scripts/loop-runner.mjs phase <phase> --run-dir <run-dir> [--json] [--force-reopen-terminal] [--repair] [${shellResumeDowngradeFlag}]`,
        `Friendly phase aliases such as 'open', 'negotiate', 'pre-verify', 'evaluate', and 'finalize' are accepted. App-visible current-thread runs require the same bound Codex thread unless ${shellResumeDowngradeFlag} is supplied.`
    ]
};
const parsePositiveTimeoutMs = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};
const parsePhaseTimeouts = (value) => {
    if (!value?.trim()) {
        return undefined;
    }
    const overrides = {};
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
const parseRunArgs = (argv) => {
    let adapterPath;
    let bootstrap = false;
    let rubricPath;
    let evaluatorProfilePath;
    let targetFamily;
    let preparedRunId;
    let resumeRunPath;
    let allowResumeMigration = false;
    let allowManualProtocolSeed = false;
    let codexAppForeground = false;
    let allowShellResumeDowngrade = false;
    let allowExternalTargetRoot = false;
    let forceReopenTerminal = false;
    let controllerMode;
    let transportMode;
    let appServerTaskTimeoutMs;
    let appServerRequestTimeoutMs;
    let phaseTimeouts;
    let supervised = false;
    let noSupervisor = false;
    let repairOnly = false;
    let resumePhase;
    let executorMode;
    let mode = "loop";
    let maxRounds;
    let targetScore;
    let json = false;
    const errors = [];
    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index];
        if (!value.startsWith("--")) {
            const parsed = Number(value);
            if (Number.isFinite(parsed) && parsed > 0 && maxRounds === undefined) {
                maxRounds = parsed;
            }
            else {
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
        if (value === "--run-id" || value === "--prepared-run-id") {
            preparedRunId = argv[index + 1];
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
        if (value === codexAppForegroundFlag) {
            codexAppForeground = true;
            continue;
        }
        if (value === shellResumeDowngradeFlag) {
            allowShellResumeDowngrade = true;
            continue;
        }
        if (value === externalTargetRootFlag) {
            allowExternalTargetRoot = true;
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
            }
            else {
                errors.push(`Invalid controller mode: ${candidate ?? ""}`);
            }
            index += 1;
            continue;
        }
        if (value === "--transport") {
            const candidate = argv[index + 1];
            if (isTransportMode(candidate)) {
                transportMode = candidate;
            }
            else {
                errors.push(`Invalid transport mode: ${candidate ?? ""}`);
            }
            index += 1;
            continue;
        }
        if (value === "--app-server-task-timeout-ms") {
            const parsed = parsePositiveTimeoutMs(argv[index + 1]);
            if (parsed) {
                appServerTaskTimeoutMs = parsed;
            }
            else {
                errors.push(`Invalid app-server task timeout: ${argv[index + 1] ?? ""}`);
            }
            index += 1;
            continue;
        }
        if (value === "--app-server-request-timeout-ms") {
            const parsed = parsePositiveTimeoutMs(argv[index + 1]);
            if (parsed) {
                appServerRequestTimeoutMs = parsed;
            }
            else {
                errors.push(`Invalid app-server request timeout: ${argv[index + 1] ?? ""}`);
            }
            index += 1;
            continue;
        }
        if (value === "--phase-timeout-ms") {
            const parsed = parsePhaseTimeouts(argv[index + 1]);
            if (parsed) {
                phaseTimeouts = parsed;
            }
            else {
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
            }
            else {
                errors.push(`Invalid resume phase: ${candidate ?? ""}`);
            }
            index += 1;
            continue;
        }
        if (value === "--executor-mode") {
            const candidate = argv[index + 1];
            if (isExecutorMode(candidate)) {
                executorMode = candidate;
            }
            else {
                errors.push(`Invalid executor mode: ${candidate ?? ""}`);
            }
            index += 1;
            continue;
        }
        if (value === "--single") {
            mode = "single";
            continue;
        }
        if (value === "--json") {
            json = true;
            continue;
        }
        if (value === "--max-rounds" || value === "--max-iterations") {
            const parsed = Number(argv[index + 1]);
            if (Number.isFinite(parsed) && parsed > 0) {
                maxRounds = parsed;
            }
            else {
                errors.push(`Invalid round count: ${argv[index + 1] ?? ""}`);
            }
            index += 1;
            continue;
        }
        if (value === "--target-score") {
            const parsed = Number(argv[index + 1]);
            if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
                targetScore = parsed;
            }
            else {
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
        preparedRunId,
        resumeRunPath,
        allowResumeMigration,
        allowManualProtocolSeed,
        codexAppForeground,
        allowShellResumeDowngrade,
        allowExternalTargetRoot,
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
        json,
        errors
    };
};
const isHelpToken = (value) => typeof value === "string" && helpTokens.has(value);
const resolvePhaseName = (value) => {
    if (!value) {
        return undefined;
    }
    return phaseAliasMap.get(value) ?? phaseAliasMap.get(value.toLowerCase());
};
const parseStatusCommand = (argv) => {
    let runDirectory;
    let json = false;
    const errors = [];
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
const parseRunSubcommand = (kind, argv) => {
    const normalizedArgs = [];
    const errors = [];
    let phaseFromCommand;
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
        errors.push("phase does not support --single. It re-enters the named phase using the persisted run budget.");
    }
    return {
        kind: "run",
        args: {
            ...parsed,
            errors: [...parsed.errors, ...errors]
        }
    };
};
const parseCommand = (argv) => {
    if (argv.length === 0) {
        return {
            kind: "run",
            args: parseRunArgs(argv)
        };
    }
    if (isHelpToken(argv[0])) {
        const topic = argv[1] === "status" || argv[1] === "resume" || argv[1] === "phase"
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
const printUsage = (topic) => {
    const lines = topic ? subcommandUsage[topic] : usageLines;
    for (const line of lines) {
        console.log(line);
    }
};
const displayPath = (path) => path ? relative(repoRoot, resolve(path)) : undefined;
const effectiveStatusFor = (input) => {
    const normalizedSummaryStopReason = normalizeRunStopReason(input.summary.stop_reason);
    const normalizedSupervisorStopReason = normalizeRunStopReason(input.supervisorState?.stop_reason);
    if (normalizedSummaryStopReason) {
        return {
            executionState: pausedStopReasons.has(normalizedSummaryStopReason)
                ? "paused"
                : "completed",
            summary: `Run stop reason: ${normalizedSummaryStopReason}.`,
            source: "summary_stop_reason"
        };
    }
    if (input.supervisorState) {
        if (input.supervisorState.status === "failed") {
            return {
                executionState: "failed",
                summary: input.supervisorState.last_error ??
                    "Supervisor reported a failed runtime state.",
                source: "supervisor_state"
            };
        }
        if (input.supervisorState.status === "paused") {
            return {
                executionState: "paused",
                summary: input.supervisorState.last_error ??
                    "Supervisor paused the run and expects operator input.",
                source: "supervisor_state"
            };
        }
        if (input.supervisorState.status === "completed") {
            return {
                executionState: "completed",
                summary: normalizedSupervisorStopReason
                    ? `Supervisor completed the run with stop reason '${normalizedSupervisorStopReason}'.`
                    : "Supervisor completed the run.",
                source: "supervisor_state"
            };
        }
    }
    return {
        executionState: input.runtimeHealth.execution_state,
        summary: input.runtimeHealth.summary,
        source: "runtime_health"
    };
};
const buildStatusReport = async (runDirectory) => {
    const restoredRun = await restoreRunState(runDirectory);
    const runtimePaths = runtimeStatePathsForRun(restoredRun.runDirectory);
    const [operatorSurface, supervisorState] = await Promise.all([
        readOperatorSurfaceArtifact(runtimePaths.operatorSurfacePath),
        readSupervisorStateArtifact(runtimePaths.supervisorStatePath)
    ]);
    const runtimeHealth = assessRuntimeHealth({
        liveState: restoredRun.runtimeLiveState,
        roundPhase: restoredRun.runtimeRoundPhase,
        controllerLease: restoredRun.controllerLease,
        transportState: restoredRun.transportState
    });
    const effectiveStatus = effectiveStatusFor({
        summary: restoredRun.summary,
        runtimeHealth,
        supervisorState: supervisorState ?? undefined
    });
    const summary = restoredRun.summary;
    const normalizedStopReason = normalizeRunStopReason(summary.stop_reason);
    const activeRound = operatorSurface?.round ??
        restoredRun.runtimeRoundPhase?.round ??
        restoredRun.interruptedRound?.round;
    const activePhase = operatorSurface?.phase ??
        restoredRun.runtimeRoundPhase?.phase ??
        restoredRun.interruptedRound?.resumeFromPhase;
    const activePhaseStatus = operatorSurface?.phase_status ??
        restoredRun.runtimeRoundPhase?.status ??
        restoredRun.interruptedRound?.phaseStatus;
    const resumeRunDir = resolve(restoredRun.runDirectory);
    const shellDowngradeSuffix = operatorSurface?.transport_mode === "current-thread" &&
        operatorSurface?.app_visibility === "visible-in-stock-app"
        ? ` ${shellResumeDowngradeFlag}`
        : "";
    const phaseResumeCommand = activePhase
        ? `npm run loop:phase -- ${activePhase} --run-dir "${resumeRunDir}"${shellDowngradeSuffix}`
        : undefined;
    const fallbackResumeCommand = operatorSurface?.resume_command ??
        (effectiveStatus.executionState === "completed"
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
        ...(normalizedStopReason ? { stop_reason: normalizedStopReason } : {}),
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
            ...(operatorSurface?.attention_required
                ? { attention_required: operatorSurface.attention_required }
                : {}),
            ui_visibility: operatorSurface?.ui_visibility,
            foreground_owner: operatorSurface?.foreground_owner,
            ...(operatorSurface?.checkpoint_kind
                ? { checkpoint_kind: operatorSurface.checkpoint_kind }
                : {}),
            ...(operatorSurface?.checkpoint_id
                ? { checkpoint_id: operatorSurface.checkpoint_id }
                : {}),
            ...(operatorSurface?.checkpoint_seq !== undefined
                ? { checkpoint_seq: operatorSurface.checkpoint_seq }
                : {}),
            ...(operatorSurface?.auto_resume_eligible !== undefined
                ? { auto_resume_eligible: operatorSurface.auto_resume_eligible }
                : {}),
            ...(operatorSurface?.user_visible_pause !== undefined
                ? { user_visible_pause: operatorSurface.user_visible_pause }
                : {}),
            ...(operatorSurface?.worker_skill
                ? { worker_skill: operatorSurface.worker_skill }
                : {}),
            ...(operatorSurface?.recovery_skill
                ? { recovery_skill: operatorSurface.recovery_skill }
                : {}),
            ...(operatorSurface?.next_action
                ? { next_action: operatorSurface.next_action }
                : {}),
            ...(operatorSurface?.active_prompt_path
                ? { active_prompt_path: operatorSurface.active_prompt_path }
                : {}),
            ...(operatorSurface?.active_response_path
                ? { active_response_path: operatorSurface.active_response_path }
                : {}),
            ...(operatorSurface?.recommended_skill
                ? { recommended_skill: operatorSurface.recommended_skill }
                : {}),
            ...(operatorSurface?.recommended_command
                ? { recommended_command: operatorSurface.recommended_command }
                : {})
        },
        runtime_health: runtimeHealth,
        effective_execution_state: effectiveStatus.executionState,
        status_summary: effectiveStatus.summary,
        status_source: effectiveStatus.source,
        ...(operatorSurface ? { operator_surface: operatorSurface } : {}),
        ...(supervisorState ? { supervisor_state: supervisorState } : {}),
        repair_notes: restoredRun.repairNotes,
        ...(restoredRun.interruptedRound
            ? { interrupted_round: restoredRun.interruptedRound }
            : {}),
        paths: {
            summary_path: joinRunPath(restoredRun.runDirectory, "summary.json"),
            operator_surface_path: runtimePaths.operatorSurfacePath,
            operator_surface_markdown_path: runtimePaths.operatorSurfaceMarkdownPath,
            session_status_path: runtimePaths.sessionStatusPath,
            session_status_events_path: runtimePaths.sessionStatusEventsPath,
            session_stream_path: runtimePaths.sessionStreamPath,
            live_state_path: runtimePaths.liveStatePath,
            round_phase_path: runtimePaths.roundPhasePath,
            controller_lease_path: runtimePaths.controllerLeasePath,
            transport_state_path: runtimePaths.transportStatePath,
            supervisor_state_path: runtimePaths.supervisorStatePath
        },
        resume_commands: {
            resume: fallbackResumeCommand,
            ...(phaseResumeCommand ? { phase: phaseResumeCommand } : {})
        }
    };
};
const joinRunPath = (runDirectory, fileName) => resolve(runDirectory, fileName);
const requiresCodexThreadContinuation = (operatorSurface) => operatorSurface?.transport_mode === "current-thread" &&
    operatorSurface.app_visibility === "visible-in-stock-app" &&
    operatorSurface.requires_codex_app === true &&
    operatorSurface.handoff_state !== "automation" &&
    operatorSurface.handoff_state !== "headless";
const trimOptionalString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
const resolveCurrentInvocationCodexThreadContext = (input) => resolveOperatorSurfaceContext(input);
const currentInvocationOwnsCodexThread = (context) => (context.presentationMode === "foreground-thread" &&
    context.appVisibility === "visible-in-stock-app" &&
    context.surfaceOwner === "stock-codex-thread" &&
    context.threadBindingState === "bound" &&
    typeof context.threadId === "string");
const validateResumeOwnership = async (input) => {
    const restoredRun = await restoreRunState(input.resumeRunPath);
    const runtimePaths = runtimeStatePathsForRun(restoredRun.runDirectory);
    const operatorSurface = (await readOperatorSurfaceArtifact(runtimePaths.operatorSurfacePath)) ?? undefined;
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
    const recoverySkill = operatorSurface?.recovery_skill ??
        operatorSurface?.resume_skill ??
        "attached-loop";
    const persistedThreadId = trimOptionalString(operatorSurface?.thread_id);
    if (!currentInvocationOwnsCodexThread(currentContext)) {
        if (input.allowShellResumeDowngrade) {
            return undefined;
        }
        return [
            `Run '${restoredRun.runId}' is currently owned by a visible Codex thread.`,
            `Recover it from the Codex app with $${recoverySkill} instead of reopening it from a shell.`,
            `If you intentionally want to downgrade this run to manual-protocol, rerun with ${shellResumeDowngradeFlag}.`
        ].join(" ");
    }
    if (!persistedThreadId) {
        return [
            `Run '${restoredRun.runId}' requires same-thread Codex continuation, but its persisted operator surface has no thread_id.`,
            `Recover it from the original Codex thread with $${recoverySkill} so the run can stay bound.`
        ].join(" ");
    }
    if (trimOptionalString(currentContext.threadId) !== persistedThreadId) {
        return [
            `Run '${restoredRun.runId}' is owned by Codex thread '${persistedThreadId}'.`,
            `Recover it from that same Codex thread with $${recoverySkill} instead of continuing from '${currentContext.threadId ?? "unknown"}'.`
        ].join(" ");
    }
    return undefined;
};
const validateSeedOwnership = (input) => {
    if (input.controllerMode !== "attached" ||
        input.transportMode !== "current-thread" ||
        currentInvocationOwnsCodexThread(resolveCurrentInvocationCodexThreadContext({
            controllerMode: "attached",
            transportMode: "current-thread"
        }))) {
        return undefined;
    }
    if (input.allowManualProtocolSeed) {
        return undefined;
    }
    const assumedAppForeground = input.codexAppForeground ||
        process.env.HARNESS_CODEX_APP_FOREGROUND === "1";
    if (assumedAppForeground && input.preparedRunId) {
        return undefined;
    }
    if (assumedAppForeground && !input.preparedRunId) {
        return [
            `Assumed Codex app foreground starts require --run-id <prepared-run-id> with ${codexAppForegroundFlag}.`,
            "This prevents an unbound app shell from consuming the wrong ready_to_start session."
        ].join(" ");
    }
    return [
        "Shell-launched attached/current-thread seeds require a bound Codex thread id.",
        "Start this run from the Codex app so $loop-control can launch the Codex-owned foreground thread,",
        `pass ${codexAppForegroundFlag} with --run-id from a Codex app skill when CODEX_THREAD_ID is unavailable,`,
        `or rerun with ${manualProtocolSeedFlag} if you intentionally want a manual-protocol shell seed.`
    ].join(" ");
};
const printRunResult = (summary, runDirectory, defaults, statusReport) => {
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
    if (summary.best_round !== undefined &&
        summary.best_round !== summary.terminal_round) {
        console.log(`Best-scoring release score: ${summary.best_scoring_release_score ?? summary.release_score}`);
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
        console.log(`Resume migration: ${relative(repoRoot, summary.resume_migration_path)}`);
    }
    if (summary.codex_handoff_path) {
        console.log(`Codex handoff: ${relative(repoRoot, summary.codex_handoff_path)}`);
    }
    if (statusReport?.active.attention_required) {
        console.log(`Attention: ${statusReport.active.attention_required}`);
    }
    if (statusReport?.active.ui_visibility || statusReport?.active.foreground_owner) {
        console.log(`Foreground: ${statusReport.active.foreground_owner ?? "none"} / ${statusReport.active.ui_visibility ?? "none"}`);
    }
    if (statusReport?.active.checkpoint_kind) {
        console.log(`Checkpoint: ${statusReport.active.checkpoint_kind}`);
    }
    if (statusReport?.active.checkpoint_id) {
        console.log(`Checkpoint id: ${statusReport.active.checkpoint_id}`);
    }
    if (statusReport?.active.auto_resume_eligible !== undefined) {
        console.log(`Auto resume: ${statusReport.active.auto_resume_eligible ? "yes" : "no"}`);
    }
    const foregroundCurrentThread = statusReport?.operator_surface?.transport_mode === "current-thread" &&
        statusReport.operator_surface.app_visibility === "visible-in-stock-app";
    if (foregroundCurrentThread) {
        if (statusReport?.active.worker_skill) {
            console.log(`Worker: $${statusReport.active.worker_skill}`);
        }
        if (statusReport?.active.recovery_skill) {
            console.log(`Recovery: $${statusReport.active.recovery_skill}`);
        }
        console.log(`CLI fallback: ${statusReport?.resume_commands.resume ?? "no command"}`);
    }
    else if (statusReport?.active.recommended_skill) {
        console.log(`Recommended continuation: $${statusReport.active.recommended_skill}`);
    }
    else if (statusReport?.active.recommended_command) {
        console.log(`Recommended continuation: ${statusReport.active.recommended_command}`);
    }
    if (statusReport?.active.attention_required === "codex") {
        console.log("This is a Codex-owned checkpoint, not a user-facing pause.");
    }
    if (statusReport?.operator_surface?.session) {
        console.log(`Session kind: ${statusReport.operator_surface.session.attention_kind}`);
        console.log(`Session binding: ${statusReport.operator_surface.session.session_binding.surface} / ${statusReport.operator_surface.session.session_binding.binding_state} / ${statusReport.operator_surface.session.session_binding.thread_id ?? "none"} / ${statusReport.operator_surface.session.session_binding.turn_id ?? "none"}`);
        if (statusReport.operator_surface.session.active_checkpoint) {
            console.log(`Session checkpoint: ${statusReport.operator_surface.session.active_checkpoint.kind} / ${statusReport.operator_surface.session.active_checkpoint.checkpoint_id ?? "none"} / ${statusReport.operator_surface.session.active_checkpoint.skill}`);
        }
    }
};
const printStatusReport = (report) => {
    console.log(`Run: ${displayPath(report.run_directory) ?? report.run_directory}`);
    console.log(`Controller: ${report.controller_mode ?? "unknown"} / ${report.transport_mode ?? "unknown"} / ${report.executor_mode ?? "unknown"}`);
    if (report.target_family) {
        console.log(`Target family: ${report.target_family}`);
    }
    if (report.validation_lane) {
        console.log(`Validation lane: ${report.validation_lane}`);
    }
    if (report.operator_surface) {
        console.log(`Surface: ${report.operator_surface.presentation_mode} (${report.operator_surface.launch_origin}, ${report.operator_surface.surface_owner}, ${report.operator_surface.thread_binding_state})`);
        console.log(`Visibility: ${report.operator_surface.app_visibility} via ${report.operator_surface.entrypoint}`);
        console.log(`Foreground: ${report.operator_surface.foreground_owner} / ${report.operator_surface.ui_visibility}`);
        console.log(`Handoff: ${report.operator_surface.handoff_state} / Worker: ${report.operator_surface.worker_skill ?? "none"} / Recovery: ${report.operator_surface.recovery_skill ?? report.operator_surface.resume_skill} / Requires Codex app: ${report.operator_surface.requires_codex_app ? "yes" : "no"}`);
        if (report.operator_surface.worktree_id || report.operator_surface.worktree_path) {
            console.log(`Worktree: ${report.operator_surface.worktree_id ?? "none"} / ${report.operator_surface.worktree_path ?? "none"}`);
        }
        if (report.operator_surface.session) {
            console.log(`Session: ${report.operator_surface.session.session_status} / ${report.operator_surface.session.readiness} / attention ${report.operator_surface.session.next_attention} / visibility ${report.operator_surface.session.ui_visibility} / owner ${report.operator_surface.session.foreground_owner} / kind ${report.operator_surface.session.attention_kind} / questions ${report.operator_surface.session.deferred_question_count}`);
            console.log(`Session objective: ${report.operator_surface.session.objective}`);
            console.log(`Session binding: ${report.operator_surface.session.session_binding.surface} / ${report.operator_surface.session.session_binding.binding_state} / ${report.operator_surface.session.session_binding.thread_id ?? "none"} / ${report.operator_surface.session.session_binding.turn_id ?? "none"}`);
            if (report.operator_surface.session.active_checkpoint) {
                console.log(`Session checkpoint: ${report.operator_surface.session.active_checkpoint.kind} / ${report.operator_surface.session.active_checkpoint.checkpoint_id ?? "none"} / ${report.operator_surface.session.active_checkpoint.skill}`);
            }
        }
    }
    if (report.supervisor_state) {
        console.log(`Supervisor: ${report.supervisor_state.status} / restarts ${report.supervisor_state.restart_count}/${report.supervisor_state.max_restarts}`);
        if (report.supervisor_state.last_error) {
            console.log(`Supervisor note: ${report.supervisor_state.last_error}`);
        }
    }
    console.log(`Execution: ${report.effective_execution_state} - ${report.status_summary} (${report.status_source})`);
    if (report.active.round !== undefined || report.active.phase) {
        console.log(`Active: round ${report.active.round ?? "none"} / ${report.active.phase ?? "none"} / ${report.active.phase_status ?? "none"}`);
    }
    if (report.active.attention_required ||
        report.active.checkpoint_kind ||
        report.active.auto_resume_eligible !== undefined) {
        console.log(`Attention: ${report.active.attention_required ?? "none"} / Foreground: ${report.active.foreground_owner ?? "none"} / Visibility: ${report.active.ui_visibility ?? "none"} / Checkpoint: ${report.active.checkpoint_kind ?? "none"} / Auto resume: ${report.active.auto_resume_eligible ? "yes" : "no"}`);
    }
    if (report.active.checkpoint_id) {
        console.log(`Checkpoint id: ${report.active.checkpoint_id}`);
    }
    console.log(`Scores: total ${report.scores.total}, control-plane ${report.scores.control_plane}, proof ${report.scores.proof}, release ${report.scores.release}`);
    console.log(`Attempts written: ${report.round_count}`);
    if (report.stop_reason) {
        console.log(`Stop reason: ${report.stop_reason}`);
    }
    if (report.operator_surface?.next_action) {
        console.log(`Next action: ${report.operator_surface.next_action}`);
    }
    const foregroundCurrentThread = report.operator_surface?.transport_mode === "current-thread" &&
        report.operator_surface.app_visibility === "visible-in-stock-app";
    if (foregroundCurrentThread) {
        if (report.active.worker_skill) {
            console.log(`Worker: $${report.active.worker_skill}`);
        }
        if (report.active.recovery_skill) {
            console.log(`Recovery: $${report.active.recovery_skill}`);
        }
    }
    else if (report.active.recommended_skill || report.active.recommended_command) {
        console.log(`Recommended continuation: ${report.active.recommended_skill ? `$${report.active.recommended_skill}` : "none"} / ${report.active.recommended_command ?? "no command"}`);
    }
    if (report.active.active_prompt_path) {
        console.log(`Active prompt: ${displayPath(report.active.active_prompt_path) ?? report.active.active_prompt_path}`);
    }
    if (report.active.active_response_path) {
        console.log(`Active response: ${displayPath(report.active.active_response_path) ?? report.active.active_response_path}`);
    }
    console.log(`Summary: ${displayPath(report.paths.summary_path) ?? report.paths.summary_path}`);
    console.log(`Operator surface: ${displayPath(report.paths.operator_surface_path) ?? report.paths.operator_surface_path}`);
    console.log(`Session status: ${displayPath(report.paths.session_status_path) ?? report.paths.session_status_path}`);
    console.log(`Session status events: ${displayPath(report.paths.session_status_events_path) ?? report.paths.session_status_events_path}`);
    console.log(`Session stream: ${displayPath(report.paths.session_stream_path) ?? report.paths.session_stream_path}`);
    console.log(`Supervisor state: ${displayPath(report.paths.supervisor_state_path) ?? report.paths.supervisor_state_path}`);
    if (foregroundCurrentThread) {
        console.log(`CLI fallback: ${report.resume_commands.resume}`);
        if (report.resume_commands.phase) {
            console.log(`CLI phase fallback: ${report.resume_commands.phase}`);
        }
    }
    else {
        console.log(`Resume: ${report.operator_surface?.resume_command ?? report.resume_commands.resume}`);
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
const main = async () => {
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
        const statusReport = await buildStatusReport(command.runDirectory);
        if (command.json) {
            console.log(JSON.stringify(statusReport, null, 2));
        }
        else {
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
    if (args.allowExternalTargetRoot) {
        process.env.HARNESS_ALLOW_EXTERNAL_TARGET_ROOT = "1";
    }
    const envControllerMode = isControllerMode(process.env.HARNESS_CONTROLLER_MODE)
        ? process.env.HARNESS_CONTROLLER_MODE
        : undefined;
    const envTransportMode = isTransportMode(process.env.HARNESS_TRANSPORT)
        ? process.env.HARNESS_TRANSPORT
        : undefined;
    const envExecutorMode = isExecutorMode(process.env.HARNESS_EXECUTOR_MODE)
        ? process.env.HARNESS_EXECUTOR_MODE
        : undefined;
    const controllerMode = args.controllerMode ??
        envControllerMode ??
        (args.resumeRunPath ? undefined : defaultControllerMode);
    const transportMode = args.transportMode ??
        envTransportMode ??
        (controllerMode
            ? defaultTransportModeForControllerMode(controllerMode)
            : undefined);
    const executorMode = args.executorMode ??
        envExecutorMode ??
        (args.resumeRunPath ? undefined : defaultExecutorMode);
    if (args.codexAppForeground) {
        process.env.HARNESS_CODEX_APP_FOREGROUND = "1";
        process.env.HARNESS_LAUNCH_ORIGIN = "codex-app-thread";
        process.env.HARNESS_THREAD_BINDING_STATE =
            process.env.CODEX_THREAD_ID?.trim() ? "bound" : "assumed";
        process.env.HARNESS_SURFACE_OWNER = "stock-codex-thread";
        process.env.HARNESS_ENTRYPOINT = "skill";
        process.env.HARNESS_APP_VISIBILITY = "visible-in-stock-app";
    }
    if (!args.resumeRunPath) {
        const seedOwnershipError = validateSeedOwnership({
            controllerMode,
            transportMode,
            allowManualProtocolSeed: args.allowManualProtocolSeed ?? false,
            codexAppForeground: args.codexAppForeground ?? false,
            preparedRunId: args.preparedRunId
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
        console.log(`Bootstrap completed: ${relative(repoRoot, bootstrap.adapterPath)}`);
        console.log(`Idea updated: ${relative(repoRoot, bootstrap.ideaPath)}`);
        console.log(`Intake saved: ${relative(repoRoot, bootstrap.intakePath)}`);
        console.log(`Feature ledger: ${relative(repoRoot, bootstrap.featureListPath)}`);
        console.log(`Progress log: ${relative(repoRoot, bootstrap.progressPath)}`);
        console.log(`Progress journal: ${relative(repoRoot, bootstrap.progressLogPath)}`);
        console.log(`Done-when: ${relative(repoRoot, bootstrap.doneWhenPath)}`);
        console.log(`Init script: ${relative(repoRoot, bootstrap.initScriptPath)}`);
        console.log(`Generated rubric: ${relative(repoRoot, bootstrap.rubricPath)}`);
        console.log(`Generated evaluator bundle: ${relative(repoRoot, bootstrap.evaluatorProfilePath)}`);
        console.log(`Target score: ${bootstrap.targetScore}`);
        console.log(`Max rounds: ${bootstrap.maxRounds}`);
    }
    const result = args.mode === "single"
        ? await runSingleIteration({
            adapterPath,
            rubricPath,
            evaluatorProfilePath,
            targetFamily,
            preparedRunId: args.preparedRunId,
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
            preparedRunId: args.preparedRunId,
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
    const resolvedControllerMode = controllerMode ?? result.summary.controller_mode ?? defaultControllerMode;
    const resolvedTransportMode = transportMode ??
        result.summary.transport_mode ??
        defaultTransportModeForControllerMode(resolvedControllerMode);
    const resolvedExecutorMode = executorMode ?? result.summary.executor_mode ?? defaultExecutorMode;
    const statusReport = await buildStatusReport(result.runDirectory);
    if (args.json) {
        console.log(JSON.stringify({
            run_id: result.summary.run_id,
            run_directory: statusReport.run_directory,
            stop_reason: result.summary.stop_reason,
            controller_mode: result.summary.controller_mode ?? resolvedControllerMode,
            transport_mode: result.summary.transport_mode ?? resolvedTransportMode,
            executor_mode: result.summary.executor_mode ?? resolvedExecutorMode,
            active: statusReport.active,
            operator_surface: statusReport.operator_surface,
            effective_execution_state: statusReport.effective_execution_state,
            runtime_health: statusReport.runtime_health
        }, null, 2));
        return;
    }
    printRunResult(result.summary, result.runDirectory, {
        controllerMode: resolvedControllerMode,
        transportMode: resolvedTransportMode,
        executorMode: resolvedExecutorMode
    }, statusReport);
};
main().catch((error) => {
    console.error("Loop run failed.");
    console.error(error);
    process.exitCode = 1;
});
//# sourceMappingURL=cli.js.map