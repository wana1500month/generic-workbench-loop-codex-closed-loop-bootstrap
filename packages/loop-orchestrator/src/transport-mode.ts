import type {
  ControllerMode,
  ExecutorMode,
  OperatorAppVisibility,
  OperatorEntrypoint,
  OperatorLaunchOrigin,
  OperatorSurfaceSessionProjection,
  OperatorSurfaceOwner,
  ThreadBindingState,
  TransportMode,
  TransportStateArtifact
} from "./types.js";
import { resolveCodexCliLaunch } from "./codex-cli.js";
import { resolveOperatorSurfaceContext } from "./operator-surface.js";

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
  if (input.transportMode === "current-thread") {
    const context = resolveOperatorSurfaceContext(input);
    return [
      "Current-thread transport keeps the controller on the active operator surface and forbids nested codex exec calls.",
      context.presentationMode === "foreground-thread"
        ? "Current-thread transport is bound to the active Codex thread and remains visible in the stock app."
        : "When no Codex thread binding is present, current-thread degrades to manual-protocol instead of claiming foreground-thread ownership."
    ];
  }

  if (input.transportMode === "app-server") {
    return [
      "App Server transport is an embedded background-automation surface that keeps a live thread/turn container through codex app-server."
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
  dashboardPath?: string;
  sessionStatusPath?: string;
  sessionStatusEventsPath?: string;
  sessionStreamPath?: string;
  session?: OperatorSurfaceSessionProjection;
  status?: TransportStateArtifact["status"];
  notes?: string[];
  lastError?: string;
  appServer?: AppServerTransportSnapshot;
  launchOrigin?: OperatorLaunchOrigin;
  surfaceOwner?: OperatorSurfaceOwner;
  threadBindingState?: ThreadBindingState;
  entrypoint?: OperatorEntrypoint;
  appVisibility?: OperatorAppVisibility;
}): TransportStateArtifact => {
  const defaultAppServerLaunch = resolveCodexCliLaunch({
    commandEnvKeys: ["HARNESS_APP_SERVER_BIN", "HARNESS_CODEX_BIN"],
    argsEnvKeys: ["HARNESS_APP_SERVER_BIN_ARGS", "HARNESS_CODEX_BIN_ARGS"],
    tailArgs: ["app-server"]
  });
  const context = resolveOperatorSurfaceContext({
    controllerMode: input.controllerMode,
    transportMode: input.transportMode,
    threadId: input.appServer?.thread_id,
    threadName: input.appServer?.thread_name,
    launchOrigin: input.launchOrigin,
    surfaceOwner: input.surfaceOwner,
    threadBindingState: input.threadBindingState,
    entrypoint: input.entrypoint,
    appVisibility: input.appVisibility
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
    ...(input.executorMode ? { executor_mode: input.executorMode } : {}),
    updated_at: new Date().toISOString(),
    status: input.status ?? "configured",
    ...(input.summaryPath ? { summary_path: input.summaryPath } : {}),
    ...(input.protocolPath ? { protocol_path: input.protocolPath } : {}),
    ui_binding_mode:
      context.surfaceOwner === "embedded-app-server"
        ? "embedded-app-server"
        : context.surfaceOwner === "stock-codex-thread" &&
            context.threadBindingState !== "unbound"
          ? "stock-current-thread"
          : "none",
    ...((
      input.dashboardPath ||
      context.threadName ||
      input.sessionStatusPath ||
      input.sessionStatusEventsPath ||
      input.sessionStreamPath ||
      input.session
    )
      ? {
          ui_surface: {
            ...(context.threadName
              ? { thread_name: context.threadName }
              : {}),
            ...(input.dashboardPath ? { dashboard_path: input.dashboardPath } : {}),
            ...(input.sessionStatusPath
              ? { session_status_path: input.sessionStatusPath }
              : {}),
            ...(input.sessionStatusEventsPath
              ? { session_status_events_path: input.sessionStatusEventsPath }
              : {}),
            ...(input.sessionStreamPath
              ? { session_stream_path: input.sessionStreamPath }
              : {}),
            ...(input.session ? { session: input.session } : {})
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
              command: defaultAppServerLaunch.command,
              args: defaultAppServerLaunch.args,
              thread_lifecycle: "not_started",
              turn_status: "not_started",
              required_methods: [
                "configRequirements/read",
                "thread/start",
                "thread/read",
                "thread/name/set",
                "thread/resume",
                "turn/start",
                "turn/steer",
                "turn/interrupt",
                "review/start"
              ],
              expected_event_types: [
                "thread/started",
                "thread/status/changed",
                "turn/started",
                "item/started",
                "item/completed",
                "item/agentMessage/delta",
                "turn/diff/updated",
                "turn/completed"
              ]
            }
        }
      : {})
  };
};
