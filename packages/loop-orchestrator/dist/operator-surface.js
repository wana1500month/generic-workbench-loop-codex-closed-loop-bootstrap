import { dirname, relative, resolve } from "node:path";
import { repoRoot, writeJson, writeText } from "./file-system.js";
import { foregroundOwnerForAttention, uiVisibilityForAttention } from "./foreground-surface.js";
const rel = (path) => path ? relative(repoRoot, path) : "unavailable";
const trimString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
const unique = (values) => [...new Set(values)];
const operatorLaunchOrigins = [
    "codex-app-thread",
    "codex-automation",
    "shell",
    "supervisor",
    "embedded-client"
];
const operatorSurfaceOwners = [
    "stock-codex-thread",
    "embedded-app-server",
    "external-controller"
];
const threadBindingStates = [
    "bound",
    "assumed",
    "unbound"
];
const operatorEntrypoints = [
    "skill",
    "plugin",
    "shell",
    "supervisor",
    "automation",
    "cli"
];
const operatorAppVisibilities = [
    "visible-in-stock-app",
    "not-visible-in-stock-app",
    "embedded-only"
];
const operatorHandoffStates = [
    "none",
    "local",
    "worktree",
    "automation",
    "manual",
    "headless"
];
const operatorResumeSkills = [
    "attached-loop",
    "run-resume"
];
const operatorWorkspaceSurfaces = [
    "local",
    "worktree"
];
const isOperatorLaunchOrigin = (value) => typeof value === "string" &&
    operatorLaunchOrigins.includes(value);
const isOperatorSurfaceOwner = (value) => typeof value === "string" &&
    operatorSurfaceOwners.includes(value);
const isThreadBindingState = (value) => typeof value === "string" &&
    threadBindingStates.includes(value);
const isOperatorEntrypoint = (value) => typeof value === "string" &&
    operatorEntrypoints.includes(value);
const isOperatorAppVisibility = (value) => typeof value === "string" &&
    operatorAppVisibilities.includes(value);
const isOperatorHandoffState = (value) => typeof value === "string" &&
    operatorHandoffStates.includes(value);
const isOperatorResumeSkill = (value) => typeof value === "string" &&
    operatorResumeSkills.includes(value);
const isOperatorWorkspaceSurface = (value) => typeof value === "string" &&
    operatorWorkspaceSurfaces.includes(value);
const envValue = (key) => trimString(process.env[key]);
const readLaunchOriginOverride = () => {
    const value = envValue("HARNESS_LAUNCH_ORIGIN");
    return isOperatorLaunchOrigin(value) ? value : undefined;
};
const readSurfaceOwnerOverride = () => {
    const value = envValue("HARNESS_SURFACE_OWNER");
    return isOperatorSurfaceOwner(value) ? value : undefined;
};
const readThreadBindingStateOverride = () => {
    const value = envValue("HARNESS_THREAD_BINDING_STATE");
    return isThreadBindingState(value) ? value : undefined;
};
const readEntrypointOverride = () => {
    const value = envValue("HARNESS_ENTRYPOINT");
    return isOperatorEntrypoint(value) ? value : undefined;
};
const readAppVisibilityOverride = () => {
    const value = envValue("HARNESS_APP_VISIBILITY");
    return isOperatorAppVisibility(value) ? value : undefined;
};
const readWorkspaceSurfaceOverride = () => {
    const value = envValue("HARNESS_WORKSPACE_SURFACE");
    return isOperatorWorkspaceSurface(value) ? value : undefined;
};
const readHandoffStateOverride = () => {
    const value = envValue("HARNESS_HANDOFF_STATE");
    return isOperatorHandoffState(value) ? value : undefined;
};
const readResumeSkillOverride = () => {
    const value = envValue("HARNESS_RESUME_SKILL");
    return isOperatorResumeSkill(value) ? value : undefined;
};
const readWorktreePathOverride = () => envValue("HARNESS_WORKTREE_PATH");
const readWorktreeIdOverride = () => envValue("HARNESS_WORKTREE_ID");
const parseBooleanEnv = (key) => {
    const value = envValue(key)?.toLowerCase();
    if (value === "1" || value === "true" || value === "yes") {
        return true;
    }
    if (value === "0" || value === "false" || value === "no") {
        return false;
    }
    return undefined;
};
const readRequiresCodexAppOverride = () => parseBooleanEnv("HARNESS_REQUIRES_CODEX_APP");
const readCodexAppForegroundOverride = () => parseBooleanEnv("HARNESS_CODEX_APP_FOREGROUND");
const resolveCurrentThreadContext = (input) => {
    const effectiveThreadId = trimString(input.threadId) ?? envValue("CODEX_THREAD_ID");
    const explicitThreadBindingState = input.threadBindingState ?? readThreadBindingStateOverride();
    const launchOrigin = input.launchOrigin ??
        readLaunchOriginOverride() ??
        (effectiveThreadId ? "codex-app-thread" : "shell");
    const threadBindingState = effectiveThreadId
        ? explicitThreadBindingState ?? "bound"
        : explicitThreadBindingState === "bound"
            ? "assumed"
            : explicitThreadBindingState ?? (launchOrigin === "codex-app-thread" ? "assumed" : "unbound");
    const boundForegroundThread = launchOrigin === "codex-app-thread" &&
        threadBindingState === "bound" &&
        typeof effectiveThreadId === "string";
    const assumedForegroundThread = launchOrigin === "codex-app-thread" &&
        threadBindingState === "assumed" &&
        readCodexAppForegroundOverride() === true;
    const foregroundThread = boundForegroundThread || assumedForegroundThread;
    const surfaceOwner = foregroundThread ? "stock-codex-thread" : "external-controller";
    const appVisibility = foregroundThread ? "visible-in-stock-app" : "not-visible-in-stock-app";
    return {
        threadId: effectiveThreadId,
        threadName: trimString(input.threadName),
        presentationMode: foregroundThread ? "foreground-thread" : "manual-protocol",
        launchOrigin,
        surfaceOwner,
        threadBindingState,
        entrypoint: input.entrypoint ??
            readEntrypointOverride() ??
            (foregroundThread ? "skill" : "shell"),
        appVisibility
    };
};
const resolveAppServerContext = (input) => {
    const effectiveThreadId = trimString(input.threadId);
    const launchOrigin = input.launchOrigin ??
        readLaunchOriginOverride() ??
        "embedded-client";
    return {
        threadId: effectiveThreadId,
        threadName: trimString(input.threadName),
        presentationMode: "background-automation",
        launchOrigin,
        surfaceOwner: input.surfaceOwner ??
            readSurfaceOwnerOverride() ??
            "embedded-app-server",
        threadBindingState: input.threadBindingState ??
            readThreadBindingStateOverride() ??
            (effectiveThreadId ? "bound" : "unbound"),
        entrypoint: input.entrypoint ??
            readEntrypointOverride() ??
            (launchOrigin === "codex-automation" ? "automation" : "plugin"),
        appVisibility: input.appVisibility ??
            readAppVisibilityOverride() ??
            "embedded-only"
    };
};
const resolveHeadlessContext = (input) => {
    const launchOrigin = input.launchOrigin ??
        readLaunchOriginOverride() ??
        (input.controllerMode === "detached" ? "supervisor" : "shell");
    return {
        presentationMode: "headless",
        launchOrigin,
        surfaceOwner: input.surfaceOwner ??
            readSurfaceOwnerOverride() ??
            "external-controller",
        threadBindingState: "unbound",
        entrypoint: input.entrypoint ??
            readEntrypointOverride() ??
            (launchOrigin === "supervisor" ? "supervisor" : "cli"),
        appVisibility: input.appVisibility ??
            readAppVisibilityOverride() ??
            "not-visible-in-stock-app"
    };
};
export const resolveOperatorSurfaceContext = (input) => {
    if (input.transportMode === "current-thread") {
        return resolveCurrentThreadContext(input);
    }
    if (input.transportMode === "app-server") {
        return resolveAppServerContext(input);
    }
    return resolveHeadlessContext(input);
};
export const operatorPresentationModeForTransport = (input) => {
    return resolveOperatorSurfaceContext(input).presentationMode;
};
const defaultAttentionRequiredFor = (input) => {
    if (input.executionState === "completed" ||
        input.executionState === "failed") {
        return "none";
    }
    switch (input.phaseStatus) {
        case "awaiting_codex_work":
            return "codex";
        case "awaiting_human_input":
            return "human";
        case "awaiting_external_condition":
            return "external";
        case "awaiting_input":
            return input.transportMode === "current-thread" ? "codex" : "human";
        default:
            return "none";
    }
};
const defaultAutoResumeEligibleFor = (input) => input.transportMode === "current-thread" &&
    input.attentionRequired === "codex";
const defaultWorkerSkillFor = (input) => input.transportMode === "current-thread" ? "loop-control" : undefined;
const defaultRecoverySkillFor = (resumeSkill) => resumeSkill;
const defaultRecommendedSkillFor = (input) => input.transportMode === "current-thread" &&
    input.attentionRequired === "codex"
    ? "loop-control"
    : input.resumeSkill;
const defaultUserVisiblePauseFor = (input) => !(input.transportMode === "current-thread" &&
    input.attentionRequired === "codex");
const defaultNextActionForTransport = (input) => {
    if (input.executionState === "completed") {
        if (input.transportMode === "current-thread" &&
            input.appVisibility === "visible-in-stock-app") {
            return "Run completed. Review the persisted summary on the current Codex thread and close out this run; no resume is required.";
        }
        return "Run completed. Review the persisted summary and close out this run; no resume is required.";
    }
    if (input.executionState === "failed") {
        return "Inspect the persisted failure artifacts before attempting a repair or reopen.";
    }
    if (input.executionState === "stalled") {
        return "Inspect the stalled phase artifacts before resuming or repairing this run.";
    }
    if (input.session?.session_status === "ready_to_start" &&
        input.attentionRequired === "human") {
        return "Preparation is complete. The session is waiting at ready_to_start. Say '루프 시작' or 'start loop' to begin running on the same Codex thread.";
    }
    if (input.handoffState === "worktree" && input.worktreePath) {
        return `Continue this run from the linked worktree at ${input.worktreePath}, then resume from the persisted phase surface.`;
    }
    if (input.handoffState === "automation") {
        return "Treat this run as background automation. Inspect the persisted runtime surface before resuming or triaging it.";
    }
    if (input.attentionRequired === "codex") {
        const checkpointLabel = input.checkpointKind
            ? `${input.checkpointKind} checkpoint`
            : "active checkpoint";
        if (input.transportMode === "current-thread" &&
            input.presentationMode === "foreground-thread") {
            return `This run stays on the current Codex thread. $${input.workerSkill ?? input.recommendedSkill} should keep the same-thread autocontinue chain moving by consuming the ${checkpointLabel}${input.autoResumeEligible ? " automatically" : ""}.`;
        }
        return input.recommendedCommand
            ? `Codex continuation stays on the current operator surface. Consume the ${checkpointLabel}, then continue with ${input.recommendedCommand}.`
            : `Codex continuation stays on the current operator surface. Consume the ${checkpointLabel}, then resume from persisted artifacts.`;
    }
    if (input.attentionRequired === "human") {
        return "Your decision is required before the run can continue.";
    }
    if (input.attentionRequired === "external") {
        return "An environment fix is required before the run can continue.";
    }
    if (input.transportMode === "current-thread" &&
        input.presentationMode === "manual-protocol") {
        return "This run is using current-thread as a manual protocol. Reattach through a Codex thread or resume from the same shell before continuing.";
    }
    if (input.transportMode === "current-thread" &&
        input.appVisibility === "visible-in-stock-app") {
        return `Continue this run on the current Codex thread with $${input.resumeSkill}.`;
    }
    if (input.transportMode === "app-server") {
        return "Resume or inspect the embedded App Server transport from persisted runtime state.";
    }
    if (input.transportMode === "codex-exec") {
        return "Inspect persisted controller artifacts or supervisor state before restarting detached execution.";
    }
    return undefined;
};
const defaultHandoffStateFor = (input) => {
    if (input.executionState === "completed") {
        return "none";
    }
    if (input.transportMode === "app-server" ||
        input.entrypoint === "automation" ||
        input.launchOrigin === "codex-automation") {
        return "automation";
    }
    if (input.workspaceSurface === "worktree") {
        return "worktree";
    }
    if (input.presentationMode === "manual-protocol") {
        return "manual";
    }
    if (input.presentationMode === "headless") {
        return "headless";
    }
    return "local";
};
const defaultResumeSkillFor = (transportMode) => transportMode === "current-thread" ? "attached-loop" : "run-resume";
const defaultRequiresCodexAppFor = (input) => input.appVisibility === "visible-in-stock-app" ||
    input.handoffState === "worktree";
const defaultResumeCommandFor = (input) => {
    if (!input.runDirectory || input.executionState === "completed") {
        return undefined;
    }
    if (input.transportMode === "current-thread" &&
        input.appVisibility === "visible-in-stock-app" &&
        input.handoffState !== "automation" &&
        input.handoffState !== "headless") {
        return undefined;
    }
    const resolvedRunDirectory = resolve(input.runDirectory);
    if (input.transportMode === "current-thread" &&
        input.phase &&
        input.handoffState !== "automation" &&
        input.handoffState !== "headless") {
        return `npm run loop:phase -- ${input.phase} --run-dir "${resolvedRunDirectory}"`;
    }
    return `npm run loop:resume -- --run-dir "${resolvedRunDirectory}"`;
};
export const buildOperatorSurfaceArtifact = (input) => {
    const context = resolveOperatorSurfaceContext({
        controllerMode: input.controllerMode,
        transportMode: input.transportMode,
        threadId: input.threadId,
        threadName: input.threadName,
        launchOrigin: input.launchOrigin,
        surfaceOwner: input.surfaceOwner,
        threadBindingState: input.threadBindingState,
        entrypoint: input.entrypoint,
        appVisibility: input.appVisibility
    });
    const worktreePath = trimString(input.worktreePath) ?? readWorktreePathOverride();
    const worktreeId = trimString(input.worktreeId) ?? readWorktreeIdOverride();
    const workspaceSurface = input.workspaceSurface ??
        readWorkspaceSurfaceOverride() ??
        (worktreePath ||
            worktreeId ||
            context.launchOrigin === "codex-automation"
            ? "worktree"
            : "local");
    const handoffState = input.handoffState ??
        readHandoffStateOverride() ??
        defaultHandoffStateFor({
            executionState: input.executionState,
            transportMode: input.transportMode,
            presentationMode: context.presentationMode,
            launchOrigin: context.launchOrigin,
            entrypoint: context.entrypoint,
            workspaceSurface
        });
    const resumeSkill = input.resumeSkill ??
        readResumeSkillOverride() ??
        defaultResumeSkillFor(input.transportMode);
    const workerSkill = input.workerSkill ??
        defaultWorkerSkillFor({
            transportMode: input.transportMode
        });
    const recoverySkill = input.recoverySkill ??
        defaultRecoverySkillFor(resumeSkill);
    const requiresCodexApp = input.requiresCodexApp ??
        readRequiresCodexAppOverride() ??
        defaultRequiresCodexAppFor({
            appVisibility: context.appVisibility,
            handoffState
        });
    const startGateReady = input.session?.session_status === "ready_to_start";
    const attentionRequired = input.attentionRequired ??
        (startGateReady
            ? "human"
            : defaultAttentionRequiredFor({
                executionState: input.executionState,
                transportMode: input.transportMode,
                phaseStatus: input.phaseStatus
            }));
    const uiVisibility = uiVisibilityForAttention(attentionRequired);
    const foregroundOwner = foregroundOwnerForAttention(attentionRequired);
    const startGateDecisionSurface = startGateReady && attentionRequired === "human";
    const autoResumeEligible = input.autoResumeEligible ??
        (startGateDecisionSurface
            ? false
            : defaultAutoResumeEligibleFor({
                transportMode: input.transportMode,
                attentionRequired
            }));
    const runDirectory = trimString(input.runDirectory) ??
        (input.summaryPath ? dirname(input.summaryPath) : undefined);
    const resumeCommand = input.resumeCommand ??
        defaultResumeCommandFor({
            runDirectory,
            executionState: input.executionState,
            transportMode: input.transportMode,
            phase: input.phase,
            handoffState,
            appVisibility: context.appVisibility
        });
    const recommendedSkill = input.recommendedSkill ??
        (startGateDecisionSurface
            ? "loop-control"
            : defaultRecommendedSkillFor({
                transportMode: input.transportMode,
                attentionRequired,
                resumeSkill
            }));
    const userVisiblePause = input.userVisiblePause ??
        (startGateDecisionSurface
            ? true
            : defaultUserVisiblePauseFor({
                transportMode: input.transportMode,
                attentionRequired
            }));
    const recommendedCommand = input.recommendedCommand ??
        (startGateDecisionSurface
            ? "npm run loop:start:codex -- --json"
            : resumeCommand);
    const normalizedNotes = input.executionState === "completed"
        ? []
        : unique((input.notes ?? [])
            .map((note) => trimString(note))
            .filter((note) => typeof note === "string"));
    const nextAction = input.nextAction ??
        defaultNextActionForTransport({
            executionState: input.executionState,
            transportMode: input.transportMode,
            presentationMode: context.presentationMode,
            appVisibility: context.appVisibility,
            handoffState,
            resumeSkill,
            attentionRequired,
            session: input.session,
            checkpointKind: input.checkpointKind,
            autoResumeEligible,
            workerSkill,
            recommendedSkill,
            recommendedCommand,
            worktreePath,
            phase: input.phase,
            phaseStatus: input.phaseStatus
        });
    return {
        run_id: input.runId,
        controller_mode: input.controllerMode,
        transport_mode: input.transportMode,
        presentation_mode: context.presentationMode,
        launch_origin: context.launchOrigin,
        surface_owner: context.surfaceOwner,
        thread_binding_state: context.threadBindingState,
        entrypoint: context.entrypoint,
        app_visibility: context.appVisibility,
        workspace_surface: workspaceSurface,
        handoff_state: handoffState,
        resume_skill: resumeSkill,
        ...(workerSkill ? { worker_skill: workerSkill } : {}),
        ...(recoverySkill ? { recovery_skill: recoverySkill } : {}),
        requires_codex_app: requiresCodexApp,
        updated_at: input.updatedAt ?? new Date().toISOString(),
        execution_state: input.executionState,
        ...(input.round !== undefined ? { round: input.round } : {}),
        ...(input.phase ? { phase: input.phase } : {}),
        ...(input.phaseStatus ? { phase_status: input.phaseStatus } : {}),
        ...(attentionRequired !== "none"
            ? { attention_required: attentionRequired }
            : {}),
        ui_visibility: uiVisibility,
        foreground_owner: foregroundOwner,
        ...(input.checkpointKind ? { checkpoint_kind: input.checkpointKind } : {}),
        ...(input.checkpointId ? { checkpoint_id: input.checkpointId } : {}),
        ...(input.checkpointSeq !== undefined
            ? { checkpoint_seq: input.checkpointSeq }
            : {}),
        ...(autoResumeEligible !== undefined
            ? { auto_resume_eligible: autoResumeEligible }
            : {}),
        ...(userVisiblePause !== undefined ? { user_visible_pause: userVisiblePause } : {}),
        ...(input.decisionOptions?.length
            ? { decision_options: unique(input.decisionOptions) }
            : {}),
        ...(input.summaryPath ? { summary_path: input.summaryPath } : {}),
        ...(input.transportStatePath ? { transport_state_path: input.transportStatePath } : {}),
        ...(input.transportProtocolPath ? { transport_protocol_path: input.transportProtocolPath } : {}),
        ...(input.sessionStatusPath ? { session_status_path: input.sessionStatusPath } : {}),
        ...(input.sessionStatusEventsPath
            ? { session_status_events_path: input.sessionStatusEventsPath }
            : {}),
        ...(input.sessionStreamPath ? { session_stream_path: input.sessionStreamPath } : {}),
        ...(input.activePromptPath ? { active_prompt_path: input.activePromptPath } : {}),
        ...(input.activeResponsePath ? { active_response_path: input.activeResponsePath } : {}),
        ...(input.dashboardPath ? { dashboard_path: input.dashboardPath } : {}),
        ...(input.adapterPlanPath ? { adapter_plan_path: input.adapterPlanPath } : {}),
        ...(input.adapterContractPath ? { adapter_contract_path: input.adapterContractPath } : {}),
        ...(input.evaluatorProfilePath ? { evaluator_profile_path: input.evaluatorProfilePath } : {}),
        ...(input.adapterReviewTaskPath
            ? { adapter_review_task_path: input.adapterReviewTaskPath }
            : {}),
        ...(context.threadId ? { thread_id: context.threadId } : {}),
        ...(context.threadName ? { thread_name: context.threadName } : {}),
        ...(worktreeId ? { worktree_id: worktreeId } : {}),
        ...(worktreePath ? { worktree_path: worktreePath } : {}),
        ...(recommendedSkill ? { recommended_skill: recommendedSkill } : {}),
        ...(recommendedCommand ? { recommended_command: recommendedCommand } : {}),
        ...(resumeCommand ? { resume_command: resumeCommand } : {}),
        ...(nextAction ? { next_action: nextAction } : {}),
        ...(input.session ? { session: input.session } : {}),
        ...(normalizedNotes.length > 0 ? { notes: normalizedNotes } : {})
    };
};
export const renderOperatorSurfaceMarkdown = (artifact) => `# Operator Surface

## Run

- Run id: ${artifact.run_id}
- Controller mode: ${artifact.controller_mode}
- Transport mode: ${artifact.transport_mode}
- Presentation mode: ${artifact.presentation_mode}
- Launch origin: ${artifact.launch_origin}
- Surface owner: ${artifact.surface_owner}
- Thread binding: ${artifact.thread_binding_state}
- Entrypoint: ${artifact.entrypoint}
- App visibility: ${artifact.app_visibility}
- Workspace surface: ${artifact.workspace_surface}
- Handoff state: ${artifact.handoff_state}
- Worker skill: ${artifact.worker_skill ?? "none"}
- Recovery skill: ${artifact.recovery_skill ?? "none"}
- Resume skill (legacy alias): ${artifact.resume_skill}
- Requires Codex app: ${artifact.requires_codex_app ? "yes" : "no"}
- Execution state: ${artifact.execution_state}
- Round: ${artifact.round ?? "none"}
- Phase: ${artifact.phase ?? "none"}
- Phase status: ${artifact.phase_status ?? "none"}
- Attention required: ${artifact.attention_required ?? "none"}
- UI visibility: ${artifact.ui_visibility}
- Foreground owner: ${artifact.foreground_owner}
- Checkpoint kind: ${artifact.checkpoint_kind ?? "none"}
- Checkpoint id: ${artifact.checkpoint_id ?? "none"}
- Checkpoint seq: ${artifact.checkpoint_seq ?? "none"}
- Auto resume eligible: ${artifact.auto_resume_eligible ? "yes" : "no"}
- User visible pause: ${artifact.user_visible_pause === false ? "no" : "yes"}
- Decision options: ${artifact.decision_options?.join(", ") ?? "none"}
- Summary: ${rel(artifact.summary_path)}
- Transport state: ${rel(artifact.transport_state_path)}
- Transport protocol: ${rel(artifact.transport_protocol_path)}
- Session status: ${rel(artifact.session_status_path)}
- Session status events: ${rel(artifact.session_status_events_path)}
- Session stream contract: ${rel(artifact.session_stream_path)}
- Active prompt: ${rel(artifact.active_prompt_path)}
- Active response: ${rel(artifact.active_response_path)}
- Adapter plan: ${rel(artifact.adapter_plan_path)}
- Adapter contract: ${rel(artifact.adapter_contract_path)}
- Evaluator profile: ${rel(artifact.evaluator_profile_path)}
- Adapter review task: ${rel(artifact.adapter_review_task_path)}
- Thread id: ${artifact.thread_id ?? "none"}
- Thread name: ${artifact.thread_name ?? "none"}
- Worktree id: ${artifact.worktree_id ?? "none"}
- Worktree path: ${artifact.worktree_path ?? "none"}
- Recommended skill (legacy alias): ${artifact.recommended_skill ?? "none"}
- Recommended command: ${artifact.recommended_command ?? "none"}
- Resume command: ${artifact.resume_command ?? "none"}
- Next action: ${artifact.next_action ?? "none"}

## Session

- Objective: ${artifact.session?.objective ?? "none"}
- Status: ${artifact.session?.session_status ?? "none"}
- Readiness: ${artifact.session?.readiness ?? "none"}
- Next attention: ${artifact.session?.next_attention ?? "none"}
- Attention kind: ${artifact.session?.attention_kind ?? "none"}
- UI visibility: ${artifact.session?.ui_visibility ?? "none"}
- Foreground owner: ${artifact.session?.foreground_owner ?? "none"}
- Deferred questions: ${artifact.session?.deferred_question_count ?? 0}
- Steering notes: ${artifact.session?.steering_note_count ?? 0}
- Review feedback: ${artifact.session?.review_feedback_count ?? 0}
- External blockers: ${artifact.session?.external_blocker_count ?? 0}
- Binding surface: ${artifact.session?.session_binding.surface ?? "none"}
- Binding state: ${artifact.session?.session_binding.binding_state ?? "none"}
- Session thread id: ${artifact.session?.session_binding.thread_id ?? "none"}
- Session turn id: ${artifact.session?.session_binding.turn_id ?? "none"}
- Active checkpoint: ${artifact.session?.active_checkpoint?.kind ?? "none"}
- Active checkpoint id: ${artifact.session?.active_checkpoint?.checkpoint_id ?? "none"}
- Active checkpoint skill: ${artifact.session?.active_checkpoint?.skill ?? "none"}
- Active checkpoint prompt: ${artifact.session?.active_checkpoint?.prompt_path ?? "none"}
- Active checkpoint response: ${artifact.session?.active_checkpoint?.response_path ?? "none"}
- Latest round: ${artifact.session?.latest_round ?? "none"}
- Latest stop reason: ${artifact.session?.latest_stop_reason ?? "none"}

## Generated Adapter

- Adapter plan: ${rel(artifact.adapter_plan_path)}
- Adapter contract: ${rel(artifact.adapter_contract_path)}
- Evaluator profile: ${rel(artifact.evaluator_profile_path)}
- Adapter review task: ${rel(artifact.adapter_review_task_path)}

## Notes

${artifact.notes?.length ? artifact.notes.map((note) => `- ${note}`).join("\n") : "- none"}
`;
export const writeOperatorSurfaceArtifacts = async (input) => {
    const artifact = {
        ...input.artifact,
        dashboard_path: input.markdownPath
    };
    await Promise.all([
        writeJson(input.jsonPath, artifact),
        writeText(input.markdownPath, renderOperatorSurfaceMarkdown(artifact))
    ]);
};
//# sourceMappingURL=operator-surface.js.map