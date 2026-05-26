import type { ControllerMode, ExecutorMode, OperatorAppVisibility, OperatorEntrypoint, OperatorLaunchOrigin, OperatorSurfaceSessionProjection, OperatorSurfaceOwner, ThreadBindingState, TransportMode, TransportStateArtifact } from "./types.js";
export type AppServerTransportSnapshot = NonNullable<TransportStateArtifact["app_server"]>;
export declare const transportModes: readonly ["codex-exec", "current-thread", "app-server"];
export declare const defaultTransportModeForControllerMode: (controllerMode: ControllerMode) => TransportMode;
export declare const isTransportMode: (value: string | undefined) => value is TransportMode;
export declare const isCurrentThreadTransport: (transportMode: TransportMode) => boolean;
export declare const validateTransportMode: (input: {
    controllerMode: ControllerMode;
    transportMode: TransportMode;
}) => string | undefined;
export declare const transportRuntimeWarningsForMode: (input: {
    controllerMode: ControllerMode;
    transportMode: TransportMode;
}) => string[];
export declare const buildTransportStateArtifact: (input: {
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
}) => TransportStateArtifact;
//# sourceMappingURL=transport-mode.d.ts.map