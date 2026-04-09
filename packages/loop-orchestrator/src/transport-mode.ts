import type {
  ControllerMode,
  ExecutorMode,
  TransportMode,
  TransportStateArtifact
} from "./types.js";

export const transportModes = [
  "codex-exec",
  "current-thread",
  "app-server"
] as const satisfies readonly TransportMode[];

export const defaultTransportModeForControllerMode = (
  controllerMode: ControllerMode
): TransportMode =>
  controllerMode === "attached" ? "current-thread" : "codex-exec";

export const isTransportMode = (
  value: string | undefined
): value is TransportMode =>
  typeof value === "string" &&
  (transportModes as readonly string[]).includes(value);

export const isCurrentThreadTransport = (
  transportMode: TransportMode
): boolean =>
  transportMode === "current-thread" || transportMode === "app-server";

export const validateTransportMode = (input: {
  controllerMode: ControllerMode;
  transportMode: TransportMode;
}): string | undefined => {
  if (input.controllerMode === "detached" && input.transportMode !== "codex-exec") {
    return `Detached controller mode requires transport 'codex-exec'; received '${input.transportMode}'.`;
  }

  if (input.controllerMode === "attached" && input.transportMode === "codex-exec") {
    return "Attached controller mode requires transport 'current-thread' or 'app-server'.";
  }

  return undefined;
};

export const transportRuntimeWarningsForMode = (input: {
  controllerMode: ControllerMode;
  transportMode: TransportMode;
}): string[] => {
  if (input.transportMode === "app-server") {
    return [
      "App Server transport is scaffolded only. This CLI run records the expected thread/start, thread/resume, turn/start, and turn/steer contract but does not create a live App Server thread container."
    ];
  }

  if (input.transportMode === "current-thread") {
    return [
      "Current-thread transport keeps the stock Codex session as the operator surface and forbids nested codex exec calls."
    ];
  }

  return input.controllerMode === "detached"
    ? [
        "Detached controller mode uses codex-exec transport for external supervisor-style execution."
      ]
    : [];
};

export const buildTransportStateArtifact = (input: {
  runId: string;
  controllerMode: ControllerMode;
  transportMode: TransportMode;
  executorMode?: ExecutorMode;
  summaryPath?: string;
  notes?: string[];
}): TransportStateArtifact => ({
  run_id: input.runId,
  controller_mode: input.controllerMode,
  transport_mode: input.transportMode,
  ...(input.executorMode ? { executor_mode: input.executorMode } : {}),
  updated_at: new Date().toISOString(),
  status: input.transportMode === "app-server" ? "scaffold_only" : "configured",
  ...(input.summaryPath ? { summary_path: input.summaryPath } : {}),
  ...(input.notes?.length ? { notes: input.notes } : {}),
  ...(input.transportMode === "app-server"
    ? {
        app_server: {
          implemented: false,
          thread_status: "not_started",
          turn_status: "not_started",
          required_methods: [
            "thread/start",
            "thread/resume",
            "turn/start",
            "turn/steer"
          ],
          expected_event_types: [
            "item/agentMessage/delta",
            "item/completed",
            "turn/completed",
            "turn/plan/updated"
          ]
        }
      }
    : {})
});
