import type {
  ControllerMode,
  ExecutorMode,
  TransportMode,
  TransportStateArtifact
} from "./types.js";

export type AppServerTransportSnapshot = NonNullable<
  TransportStateArtifact["app_server"]
>;

export const transportModes = [
  "codex-exec",
  "current-thread",
  "app-server"
] as const satisfies readonly TransportMode[];

export const defaultTransportModeForControllerMode = (
  controllerMode: ControllerMode
): TransportMode =>
  controllerMode === "attached" ? "app-server" : "codex-exec";

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
  if (input.transportMode === "current-thread") {
    return [
      "Current-thread transport is a manual same-thread protocol for the stock Codex session and forbids nested codex exec calls."
    ];
  }

  if (input.transportMode === "app-server") {
    return [
      "App Server transport keeps a live attached thread/turn container through codex app-server."
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
  protocolPath?: string;
  status?: TransportStateArtifact["status"];
  notes?: string[];
  lastError?: string;
  appServer?: AppServerTransportSnapshot;
}): TransportStateArtifact => ({
  run_id: input.runId,
  controller_mode: input.controllerMode,
  transport_mode: input.transportMode,
  ...(input.executorMode ? { executor_mode: input.executorMode } : {}),
  updated_at: new Date().toISOString(),
  status: input.status ?? "configured",
  ...(input.summaryPath ? { summary_path: input.summaryPath } : {}),
  ...(input.protocolPath ? { protocol_path: input.protocolPath } : {}),
  ui_binding_mode:
    input.transportMode === "app-server"
      ? "embedded-app-server"
      : input.transportMode === "current-thread"
        ? "stock-current-thread"
        : "none",
  ...(input.transportMode === "app-server" && input.appServer?.thread_name
    ? {
        ui_surface: {
          thread_name: input.appServer.thread_name
        }
      }
    : {}),
  ...(input.notes?.length ? { notes: input.notes } : {}),
  ...(input.lastError ? { last_error: input.lastError } : {}),
  ...(input.transportMode === "app-server" || input.appServer
    ? {
        app_server:
          input.appServer ?? {
            implemented: false,
            transport: "stdio",
            initialized: false,
            command: process.env.HARNESS_APP_SERVER_BIN ??
              process.env.HARNESS_CODEX_BIN ??
              "codex",
            args: [],
            thread_lifecycle: "not_started",
            turn_status: "not_started",
            required_methods: [
              "thread/start",
              "thread/read",
              "thread/name/set",
              "thread/resume",
              "turn/start",
              "turn/steer",
              "turn/interrupt"
            ],
            expected_event_types: [
              "thread/started",
              "thread/status/changed",
              "turn/started",
              "item/started",
              "item/completed",
              "item/agentMessage/delta",
              "turn/completed"
            ]
          }
      }
    : {})
});
