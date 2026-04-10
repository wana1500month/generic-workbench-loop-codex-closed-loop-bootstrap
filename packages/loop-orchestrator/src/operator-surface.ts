import { relative } from "node:path";

import { repoRoot, writeJson, writeText } from "./file-system.js";
import type {
  ControllerMode,
  ControllerPhaseStatus,
  ControllerRoundPhase,
  ExecutionState,
  OperatorPresentationMode,
  OperatorSurfaceArtifact,
  OperatorWorkspaceSurface,
  TransportMode
} from "./types.js";

const rel = (path: string | undefined): string =>
  path ? relative(repoRoot, path) : "unavailable";

export const operatorPresentationModeForTransport = (input: {
  controllerMode: ControllerMode;
  transportMode: TransportMode;
}): OperatorPresentationMode => {
  if (input.transportMode === "current-thread") {
    return "foreground-thread";
  }
  if (input.transportMode === "app-server") {
    return "background-automation";
  }
  return "headless";
};

const defaultNextActionForTransport = (input: {
  transportMode: TransportMode;
  phase?: ControllerRoundPhase;
  phaseStatus?: ControllerPhaseStatus;
}): string | undefined => {
  if (input.transportMode === "current-thread" && input.phaseStatus === "awaiting_input") {
    return "Stay on the current Codex thread, complete the active protocol artifact, then resume.";
  }
  if (input.transportMode === "app-server") {
    return "Resume or inspect the embedded App Server transport from persisted runtime state.";
  }
  if (input.transportMode === "codex-exec") {
    return "Inspect persisted controller artifacts or supervisor state before restarting detached execution.";
  }
  return undefined;
};

export const buildOperatorSurfaceArtifact = (input: {
  runId: string;
  controllerMode: ControllerMode;
  transportMode: TransportMode;
  workspaceSurface?: OperatorWorkspaceSurface;
  updatedAt?: string;
  executionState: ExecutionState | "configured";
  round?: number;
  phase?: ControllerRoundPhase;
  phaseStatus?: ControllerPhaseStatus;
  summaryPath?: string;
  transportStatePath?: string;
  transportProtocolPath?: string;
  activePromptPath?: string;
  activeResponsePath?: string;
  dashboardPath?: string;
  threadId?: string;
  threadName?: string;
  nextAction?: string;
  notes?: string[];
}): OperatorSurfaceArtifact => {
  const nextAction =
    input.nextAction ??
    defaultNextActionForTransport({
      transportMode: input.transportMode,
      phase: input.phase,
      phaseStatus: input.phaseStatus
    });

  return {
    run_id: input.runId,
    controller_mode: input.controllerMode,
    transport_mode: input.transportMode,
    presentation_mode: operatorPresentationModeForTransport({
      controllerMode: input.controllerMode,
      transportMode: input.transportMode
    }),
    workspace_surface: input.workspaceSurface ?? "local",
    updated_at: input.updatedAt ?? new Date().toISOString(),
    execution_state: input.executionState,
    ...(input.round !== undefined ? { round: input.round } : {}),
    ...(input.phase ? { phase: input.phase } : {}),
    ...(input.phaseStatus ? { phase_status: input.phaseStatus } : {}),
    ...(input.summaryPath ? { summary_path: input.summaryPath } : {}),
    ...(input.transportStatePath ? { transport_state_path: input.transportStatePath } : {}),
    ...(input.transportProtocolPath ? { transport_protocol_path: input.transportProtocolPath } : {}),
    ...(input.activePromptPath ? { active_prompt_path: input.activePromptPath } : {}),
    ...(input.activeResponsePath ? { active_response_path: input.activeResponsePath } : {}),
    ...(input.dashboardPath ? { dashboard_path: input.dashboardPath } : {}),
    ...(input.threadId ? { thread_id: input.threadId } : {}),
    ...(input.threadName ? { thread_name: input.threadName } : {}),
    ...(nextAction ? { next_action: nextAction } : {}),
    ...(input.notes?.length ? { notes: input.notes } : {})
  };
};

export const renderOperatorSurfaceMarkdown = (
  artifact: OperatorSurfaceArtifact
): string =>
  `# Operator Surface

## Run

- Run id: ${artifact.run_id}
- Controller mode: ${artifact.controller_mode}
- Transport mode: ${artifact.transport_mode}
- Presentation mode: ${artifact.presentation_mode}
- Workspace surface: ${artifact.workspace_surface}
- Execution state: ${artifact.execution_state}
- Round: ${artifact.round ?? "none"}
- Phase: ${artifact.phase ?? "none"}
- Phase status: ${artifact.phase_status ?? "none"}
- Summary: ${rel(artifact.summary_path)}
- Transport state: ${rel(artifact.transport_state_path)}
- Transport protocol: ${rel(artifact.transport_protocol_path)}
- Active prompt: ${rel(artifact.active_prompt_path)}
- Active response: ${rel(artifact.active_response_path)}
- Thread id: ${artifact.thread_id ?? "none"}
- Thread name: ${artifact.thread_name ?? "none"}
- Next action: ${artifact.next_action ?? "none"}

## Notes

${artifact.notes?.length ? artifact.notes.map((note) => `- ${note}`).join("\n") : "- none"}
`;

export const writeOperatorSurfaceArtifacts = async (input: {
  jsonPath: string;
  markdownPath: string;
  artifact: OperatorSurfaceArtifact;
}): Promise<void> => {
  const artifact = {
    ...input.artifact,
    dashboard_path: input.markdownPath
  } satisfies OperatorSurfaceArtifact;
  await Promise.all([
    writeJson(input.jsonPath, artifact),
    writeText(input.markdownPath, renderOperatorSurfaceMarkdown(artifact))
  ]);
};
