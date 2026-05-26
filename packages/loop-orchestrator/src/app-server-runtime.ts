import { appendFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import readline from "node:readline";

import { resolveCodexCliLaunch } from "./codex-cli.js";
import {
  appendJsonLine,
  loadJsonIfExists,
  loadJsonLinesIfExists,
  repoRoot,
  writeText
} from "./file-system.js";
import { buildOperatorSurfaceSessionProjection } from "./session-artifacts.js";
import {
  buildTransportStateArtifact,
  type AppServerTransportSnapshot
} from "./transport-mode.js";
import { writeTransportStateArtifact } from "./runtime-state.js";
import type {
  ControllerMode,
  ControllerPhaseStatus,
  ControllerRoundPhase,
  ExecutorMode,
  SessionStatusEventArtifact,
  SessionStatusArtifact
} from "./types.js";

type JsonRpcRequest = {
  method: string;
  id?: number;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  id: number;
  result?: Record<string, unknown>;
  error?: { message?: string };
};

type JsonRpcNotification = {
  method: string;
  params?: Record<string, unknown>;
};

type PendingRequest = {
  method: string;
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type PendingTurnCompletion = {
  resolve: (value: {
    turnId: string;
    status: "completed" | "interrupted" | "failed";
    eventCursor?: number;
    responseText?: string;
    reviewText?: string;
  }) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type PendingThreadClosure = {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type PersistedTransportStatus =
  | "configured"
  | "live"
  | "idle"
  | "completed"
  | "interrupted"
  | "blocked"
  | "closed";

type AppServerTurnResult = {
  turnId: string;
  status: "completed" | "interrupted" | "failed";
  eventCursor?: number;
  responseText?: string;
  reviewText?: string;
};

export interface AppServerTransportController {
  syncPhase: (input: {
    round: number;
    phase: ControllerRoundPhase;
    status: ControllerPhaseStatus;
    notes?: string[];
  }) => Promise<void>;
  runTask: (input: {
    round: number;
    phase: ControllerRoundPhase;
    prompt: string;
    taskLabel: string;
    completionTimeoutMs?: number;
    taskCwd?: string;
    writableRoots?: string[];
    networkAccess?: boolean;
    inputItems?: Array<Record<string, unknown>>;
    outputSchema?: Record<string, unknown>;
    approvalPolicy?: string;
    sandboxMode?: "workspaceWrite" | "readOnly";
    summary?: "none" | "auto" | "concise" | "detailed";
    effort?: "low" | "medium" | "high";
  }) => Promise<AppServerTurnResult>;
  runReview: (input: {
    round: number;
    phase: ControllerRoundPhase;
    reviewLabel: string;
    instructions: string;
    completionTimeoutMs?: number;
  }) => Promise<AppServerTurnResult>;
  stop: (input?: { stopReason?: string; notes?: string[] }) => Promise<void>;
  snapshot: () => AppServerTransportSnapshot;
}

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const approvalPolicyCandidates = (policy: string): string[] => {
  switch (policy) {
    case "unlessTrusted":
    case "untrusted":
      return ["untrusted", "unlessTrusted"];
    case "onRequest":
    case "on-request":
      return ["on-request", "onRequest"];
    case "onFailure":
    case "on-failure":
      return ["on-failure", "onFailure"];
    default:
      return [policy];
  }
};

const appServerCommand = (): { command: string; args: string[] } => {
  return resolveCodexCliLaunch({
    commandEnvKeys: ["HARNESS_APP_SERVER_BIN", "HARNESS_CODEX_BIN"],
    argsEnvKeys: ["HARNESS_APP_SERVER_BIN_ARGS", "HARNESS_CODEX_BIN_ARGS"],
    tailArgs: ["app-server"]
  });
};

const isNoActiveTurnInterruptError = (error: unknown): boolean =>
  error instanceof Error && /no active turn to interrupt/i.test(error.message);

const transportPromptText = (input: {
  runId: string;
  round: number;
  phase: ControllerRoundPhase;
  status: ControllerPhaseStatus;
  notes?: string[];
}): string =>
  [
    `Harness run ${input.runId} is attached through the embedded App Server transport.`,
    "This is a background automation surface, not the stock foreground Codex thread.",
    "The external loop controller remains authoritative for filesystem mutation and round state.",
    "Use this thread as the live operator container only. Do not spawn nested codex exec calls.",
    `Round ${input.round} is ${input.phase} (${input.status}).`,
    ...(input.notes?.length ? ["Notes:", ...input.notes.map((note) => `- ${note}`)] : [])
  ].join("\n");

class LiveAppServerTransport implements AppServerTransportController {
  private readonly runId: string;
  private readonly controllerMode: ControllerMode;
  private readonly executorMode: ExecutorMode | undefined;
  private readonly transportStatePath: string;
  private readonly summaryPath: string;
  private readonly protocolPath: string;
  private readonly dashboardPath: string;
  private readonly sessionStatusPath: string;
  private readonly sessionStatusEventsPath: string;
  private readonly sessionStreamPath: string;
  private readonly command: string;
  private readonly args: string[];
  private readonly cwd: string;
  private readonly threadName: string;
  private readonly model: string;
  private readonly defaultTaskTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly requestsPath: string;
  private readonly eventsPath: string;
  private readonly mirroredSessionEventsPath: string;
  private readonly errorsPath: string;
  private readonly child;
  private readonly rl;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly pendingTurnCompletions = new Map<string, PendingTurnCompletion>();
  private readonly pendingLineHandlers = new Set<Promise<void>>();
  private lineQueue: Promise<void> = Promise.resolve();
  private readonly turnResponseText = new Map<string, string>();
  private readonly turnReviewText = new Map<string, string>();
  private pendingThreadClosure?: PendingThreadClosure;
  private readonly snapshotState: AppServerTransportSnapshot;
  private allowedApprovalPolicies?: string[];
  private nextRequestId = 1;
  private persistQueue: Promise<void> = Promise.resolve();
  private mirroredSessionEventCursor = 0;
  private terminalTransportStatus?: PersistedTransportStatus;
  private closed = false;

  constructor(input: {
    runId: string;
    controllerMode: ControllerMode;
    executorMode?: ExecutorMode;
    transportStatePath: string;
    summaryPath: string;
    protocolPath: string;
    dashboardPath: string;
    sessionStatusPath: string;
    sessionStatusEventsPath: string;
    sessionStreamPath: string;
    mirroredSessionEventsPath: string;
    restoredThreadId?: string;
    threadName: string;
    defaultTaskTimeoutMs: number;
    requestTimeoutMs: number;
  }) {
    const { command, args } = appServerCommand();
    this.runId = input.runId;
    this.controllerMode = input.controllerMode;
    this.executorMode = input.executorMode;
    this.transportStatePath = input.transportStatePath;
    this.summaryPath = input.summaryPath;
    this.protocolPath = input.protocolPath;
    this.dashboardPath = input.dashboardPath;
    this.sessionStatusPath = input.sessionStatusPath;
    this.sessionStatusEventsPath = input.sessionStatusEventsPath;
    this.sessionStreamPath = input.sessionStreamPath;
    this.command = command;
    this.args = args;
    this.cwd = repoRoot;
    this.threadName = input.threadName;
    this.model = process.env.HARNESS_APP_SERVER_MODEL ?? "gpt-5.4";
    this.defaultTaskTimeoutMs = input.defaultTaskTimeoutMs;
    this.requestTimeoutMs = input.requestTimeoutMs;
    const runtimeDirectory = join(this.cwd, "evals", "runs", this.runId, "runtime");
    this.requestsPath = join(runtimeDirectory, "app-server-requests.jsonl");
    this.eventsPath = join(runtimeDirectory, "app-server-events.jsonl");
    this.mirroredSessionEventsPath = input.mirroredSessionEventsPath;
    this.errorsPath = join(runtimeDirectory, "app-server-stderr.log");
    this.snapshotState = {
      implemented: true,
      transport: "stdio",
      initialized: false,
      command,
      args,
      thread_id: input.restoredThreadId,
      thread_name: input.threadName,
      thread_lifecycle: input.restoredThreadId ? "subscribed" : "not_started",
      turn_status: "not_started",
      requests_path: this.requestsPath,
      events_path: this.eventsPath,
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
        "turn/completed",
        "harness/session.changed"
      ]
    };
    this.child = spawn(command, args, {
      cwd: this.cwd,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.snapshotState.server_pid = this.child.pid;
    this.rl = readline.createInterface({ input: this.child.stdout });
    this.rl.on("line", (line) => {
      const pendingLine = this.lineQueue
        .then(() => this.handleLine(line))
        .catch((error) => {
          void appendFile(
            this.errorsPath,
            `App Server line handler failed: ${
              error instanceof Error ? error.message : String(error)
            }\n`,
            "utf8"
          );
        })
        .finally(() => {
          this.pendingLineHandlers.delete(pendingLine);
        });
      this.lineQueue = pendingLine;
      this.pendingLineHandlers.add(pendingLine);
    });
    this.child.stderr.on("data", (chunk) => {
      void appendFile(this.errorsPath, chunk.toString(), "utf8");
    });
    this.child.on("error", (error) => {
      this.snapshotState.thread_lifecycle = "error";
      this.snapshotState.thread_runtime_status = "systemError";
      this.snapshotState.turn_status = "error";
      void this.persistState(
        `App Server transport failed to start: ${error instanceof Error ? error.message : String(error)}`
      );
    });
    this.child.on("close", () => {
      this.closed = true;
      if (this.pendingThreadClosure) {
        clearTimeout(this.pendingThreadClosure.timeout);
        this.pendingThreadClosure.reject(
          new Error("App Server transport closed before thread shutdown was observed.")
        );
        this.pendingThreadClosure = undefined;
      }
    });
  }

  public snapshot(): AppServerTransportSnapshot {
    return {
      ...this.snapshotState,
      args: [...this.snapshotState.args],
      required_methods: [...this.snapshotState.required_methods],
      expected_event_types: [...this.snapshotState.expected_event_types]
    };
  }

  public async initialize(input: {
    restoredThreadId?: string;
    initialRound: number;
    initialPhase: ControllerRoundPhase;
    initialStatus: ControllerPhaseStatus;
    initialNotes?: string[];
    startInitialTurn?: boolean;
  }): Promise<void> {
    await mkdir(join(this.cwd, "evals", "runs", this.runId, "runtime"), {
      recursive: true
    });
    await Promise.all([
      writeText(this.requestsPath, ""),
      writeText(this.eventsPath, ""),
      writeText(this.errorsPath, "")
    ]);
    this.mirroredSessionEventCursor = (
      await loadJsonLinesIfExists<{
        params?: { sequence?: number };
      }>(this.mirroredSessionEventsPath)
    ).at(-1)?.params?.sequence ?? 0;

    await this.request("initialize", {
      clientInfo: {
        name: "generic_workbench_loop",
        title: "Generic Workbench Loop",
        version: "0.1.0"
      },
      capabilities: {
        experimentalApi: true
      }
    });
    this.send({ method: "initialized", params: {} });
    this.snapshotState.initialized = true;
    await this.tryReadConfigRequirements();

    if (input.restoredThreadId) {
      const priorThreadState = await this.tryReadThread(input.restoredThreadId);
      if (priorThreadState) {
        this.applyThreadRead(priorThreadState, input.restoredThreadId);
      }
    }

    const threadResult = input.restoredThreadId
      ? await this.request("thread/resume", {
          threadId: input.restoredThreadId
        })
      : await this.request("thread/start", {
          model: this.model
        });

    const threadId = this.extractThreadId(threadResult, input.restoredThreadId);
    this.snapshotState.thread_id = threadId;
    this.snapshotState.thread_lifecycle = "subscribed";
    this.snapshotState.thread_runtime_status ??= "idle";
    await this.trySetThreadName(threadId);

    if (input.restoredThreadId) {
      const resumedThreadState = await this.tryReadThread(threadId);
      if (resumedThreadState) {
        this.applyThreadRead(resumedThreadState, threadId);
      }
    }

    if (
      input.startInitialTurn !== false &&
      this.snapshotState.turn_status !== "inProgress"
    ) {
      await this.startTurn({
        round: input.initialRound,
        phase: input.initialPhase,
        status: input.initialStatus,
        notes: input.initialNotes
      });
      return;
    }

    await this.persistState();
  }

  public async syncPhase(input: {
    round: number;
    phase: ControllerRoundPhase;
    status: ControllerPhaseStatus;
    notes?: string[];
  }): Promise<void> {
    if (this.closed || !this.snapshotState.thread_id) {
      return;
    }

    if (
      this.snapshotState.turn_id &&
      this.snapshotState.turn_status === "inProgress"
    ) {
      await this.request("turn/steer", {
        threadId: this.snapshotState.thread_id,
        input: [
          {
            type: "text",
            text: transportPromptText({
              runId: this.runId,
              round: input.round,
              phase: input.phase,
              status: input.status,
              notes: input.notes
            })
          }
        ],
        expectedTurnId: this.snapshotState.turn_id
      });
      this.snapshotState.last_request_method = "turn/steer";
      await this.persistState();
      return;
    }

    await this.startTurn(input);
  }

  public async runTask(input: {
    round: number;
    phase: ControllerRoundPhase;
    prompt: string;
    taskLabel: string;
    completionTimeoutMs?: number;
    taskCwd?: string;
    writableRoots?: string[];
    networkAccess?: boolean;
    inputItems?: Array<Record<string, unknown>>;
    outputSchema?: Record<string, unknown>;
    approvalPolicy?: string;
    sandboxMode?: "workspaceWrite" | "readOnly";
    summary?: "none" | "auto" | "concise" | "detailed";
    effort?: "low" | "medium" | "high";
  }): Promise<AppServerTurnResult> {
    if (!this.snapshotState.thread_id) {
      throw new Error("App Server transport has no active thread.");
    }

    await this.interruptActiveTurn();

    const cwd = input.taskCwd ?? this.cwd;
    const writableRoots = unique(input.writableRoots?.length ? input.writableRoots : [cwd]);
    const sandboxMode = input.sandboxMode ?? "workspaceWrite";
    const requestedApprovalPolicy =
      input.approvalPolicy !== undefined
        ? this.resolveApprovalPolicy([input.approvalPolicy])
        : sandboxMode === "readOnly"
          ? this.resolveApprovalPolicy([
              "never",
              "on-failure",
              "untrusted",
              "unlessTrusted",
              "on-request",
              "onRequest"
            ])
          : this.resolveApprovalPolicy(
              this.controllerMode === "attached"
                ? ["never", "on-failure", "untrusted", "unlessTrusted", "on-request", "onRequest"]
                : ["never"]
            );
    const turnStartParams: Record<string, unknown> = {
      threadId: this.snapshotState.thread_id,
      input:
        input.inputItems?.length
          ? input.inputItems
          : [
              {
                type: "text",
                text: input.prompt
              }
            ],
      cwd,
      sandboxPolicy:
        sandboxMode === "readOnly"
          ? {
              type: "readOnly",
              access: { type: "fullAccess" }
            }
          : {
              type: "workspaceWrite",
              writableRoots,
              networkAccess: input.networkAccess ?? false
            },
      model: this.model,
      effort: input.effort ?? "medium",
      summary: input.summary ?? "concise"
    };
    if (requestedApprovalPolicy) {
      turnStartParams.approvalPolicy = requestedApprovalPolicy;
    }
    if (input.outputSchema) {
      turnStartParams.outputSchema = input.outputSchema;
    }

    const result = await this.request("turn/start", turnStartParams);
    const turn = result.turn as { id?: string; status?: string } | undefined;
    if (!turn?.id) {
      throw new Error(`App Server ${input.taskLabel} task did not return a turn id.`);
    }
    this.snapshotState.turn_id = turn.id;
    this.snapshotState.turn_status =
      turn.status === "completed" ||
      turn.status === "failed" ||
      turn.status === "interrupted"
        ? turn.status
        : "inProgress";
    this.snapshotState.last_request_method = "turn/start";
    await this.persistState();

    return this.waitForTurnCompletion(
      turn.id,
      input.completionTimeoutMs ?? this.defaultTaskTimeoutMs
    );
  }

  public async runReview(input: {
    round: number;
    phase: ControllerRoundPhase;
    reviewLabel: string;
    instructions: string;
    completionTimeoutMs?: number;
  }): Promise<AppServerTurnResult> {
    if (!this.snapshotState.thread_id) {
      throw new Error("App Server transport has no active thread.");
    }

    await this.interruptActiveTurn();

    const result = await this.request("review/start", {
      threadId: this.snapshotState.thread_id,
      delivery: "inline",
      target: {
        type: "custom",
        title: input.reviewLabel,
        instructions: input.instructions
      }
    });
    const turn = result.turn as { id?: string; status?: string } | undefined;
    if (!turn?.id) {
      throw new Error(`App Server ${input.reviewLabel} review did not return a turn id.`);
    }
    this.snapshotState.turn_id = turn.id;
    this.snapshotState.turn_status =
      turn.status === "completed" ||
      turn.status === "failed" ||
      turn.status === "interrupted"
        ? turn.status
        : "inProgress";
    this.snapshotState.last_request_method = "review/start";
    await this.persistState();

    return this.waitForTurnCompletion(
      turn.id,
      input.completionTimeoutMs ?? this.defaultTaskTimeoutMs
    );
  }

  public async stop(input?: {
    stopReason?: string;
    notes?: string[];
  }): Promise<void> {
    if (this.closed) {
      if (this.snapshotState.thread_id) {
        this.snapshotState.thread_lifecycle = "closed";
        this.snapshotState.thread_runtime_status = "notLoaded";
      }
      await this.persistState(
        undefined,
        input?.stopReason ? "completed" : "closed"
      );
      return;
    }

    let explicitStatus: "completed" | "closed" | "blocked" =
      input?.stopReason ? "completed" : "closed";
    this.terminalTransportStatus = explicitStatus;
    try {
      if (
        this.snapshotState.thread_id &&
        this.snapshotState.turn_id &&
        this.snapshotState.turn_status === "inProgress"
      ) {
        try {
          await this.request(
            "turn/steer",
            {
              threadId: this.snapshotState.thread_id,
              input: [
                {
                  type: "text",
                  text: [
                    `Harness run ${this.runId} is closing the live App Server transport.`,
                    ...(input?.stopReason ? [`Stop reason: ${input.stopReason}.`] : []),
                    ...(input?.notes?.length
                      ? ["Notes:", ...input.notes.map((note) => `- ${note}`)]
                      : [])
                  ].join("\n")
                }
              ],
              expectedTurnId: this.snapshotState.turn_id
            },
            Math.min(this.requestTimeoutMs, 5_000)
          );
        } catch {
          this.snapshotState.last_request_method = "turn/steer";
        }
        try {
          await this.request("turn/interrupt", {
            threadId: this.snapshotState.thread_id,
            turnId: this.snapshotState.turn_id
          });
          this.snapshotState.last_request_method = "turn/interrupt";
        } catch (error) {
          if (!isNoActiveTurnInterruptError(error)) {
            throw error;
          }
          this.snapshotState.turn_status = "interrupted";
          this.snapshotState.last_request_method = "turn/interrupt";
        }
      }
      if (this.snapshotState.thread_id) {
        await this.request("thread/unsubscribe", {
          threadId: this.snapshotState.thread_id
        });
        this.snapshotState.last_request_method = "thread/unsubscribe";
        this.snapshotState.thread_lifecycle = "unsubscribed";
        await this.waitForThreadClosed(2_000).catch(() => {});
        this.snapshotState.thread_lifecycle = "closed";
        this.snapshotState.thread_runtime_status = "notLoaded";
      }
    } catch (error) {
      explicitStatus = "blocked";
      this.terminalTransportStatus = explicitStatus;
      await this.persistState(
        error instanceof Error ? error.message : String(error),
        explicitStatus
      );
    } finally {
      this.closed = true;
      for (const pendingTurn of this.pendingTurnCompletions.values()) {
        clearTimeout(pendingTurn.timeout);
        pendingTurn.reject(
          new Error("App Server transport stopped before turn completion.")
        );
      }
      this.pendingTurnCompletions.clear();
      if (this.pendingThreadClosure) {
        clearTimeout(this.pendingThreadClosure.timeout);
        this.pendingThreadClosure = undefined;
      }
      this.rl.close();
      this.child.kill();
      await this.flushPendingLineHandlers();
      await this.persistState(undefined, explicitStatus);
    }
  }

  private async startTurn(input: {
    round: number;
    phase: ControllerRoundPhase;
    status: ControllerPhaseStatus;
    notes?: string[];
  }): Promise<void> {
    if (!this.snapshotState.thread_id) {
      return;
    }

    const statusApprovalPolicy = this.resolveApprovalPolicy([
      "never",
      "on-failure",
      "untrusted",
      "unlessTrusted",
      "on-request",
      "onRequest"
    ]);
    const turnParams: Record<string, unknown> = {
      threadId: this.snapshotState.thread_id,
      input: [
        {
          type: "text",
          text: transportPromptText({
            runId: this.runId,
            round: input.round,
            phase: input.phase,
            status: input.status,
            notes: input.notes
          })
        }
      ],
      cwd: this.cwd,
      sandboxPolicy: {
        type: "readOnly",
        access: { type: "fullAccess" }
      },
      model: this.model,
      effort: "medium",
      summary: "concise"
    };
    if (statusApprovalPolicy) {
      turnParams.approvalPolicy = statusApprovalPolicy;
    }

    const result = await this.request("turn/start", turnParams);
    const turn = result.turn as { id?: string; status?: string } | undefined;
    if (!turn?.id) {
      throw new Error("App Server turn/start did not return a turn id.");
    }
    this.snapshotState.turn_id = turn.id;
    this.snapshotState.turn_status =
      turn.status === "completed" ||
      turn.status === "failed" ||
      turn.status === "interrupted"
        ? turn.status
        : "inProgress";
    this.snapshotState.last_request_method = "turn/start";
    await this.persistState();
  }

  private async interruptActiveTurn(): Promise<void> {
    if (
      this.snapshotState.turn_id &&
      this.snapshotState.turn_status === "inProgress" &&
      this.snapshotState.thread_id
    ) {
      try {
        await this.request("turn/interrupt", {
          threadId: this.snapshotState.thread_id,
          turnId: this.snapshotState.turn_id
        });
      } catch (error) {
        if (!isNoActiveTurnInterruptError(error)) {
          throw error;
        }
        this.snapshotState.turn_status = "interrupted";
      }
      this.snapshotState.last_request_method = "turn/interrupt";
      await this.persistState();
    }
  }

  private resolveApprovalPolicy(preferredPolicies: readonly string[]): string | undefined {
    if (preferredPolicies.length === 0) {
      return undefined;
    }

    const allowedPolicies = this.allowedApprovalPolicies?.length
      ? new Set(this.allowedApprovalPolicies)
      : undefined;

    for (const preferredPolicy of preferredPolicies) {
      for (const candidate of approvalPolicyCandidates(preferredPolicy)) {
        if (!allowedPolicies || allowedPolicies.has(candidate)) {
          return candidate;
        }
      }
    }

    return undefined;
  }

  private async tryReadConfigRequirements(): Promise<void> {
    try {
      const result = await this.request("configRequirements/read", {});
      const requirements = result.requirements as
        | {
            approvals?: {
              policy?: {
                allowed?: string[];
              };
            };
          }
        | undefined;
      const allowed =
        requirements?.approvals?.policy?.allowed?.filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0
        ) ?? [];
      if (allowed.length > 0) {
        this.allowedApprovalPolicies = unique(allowed);
      }
    } catch {
      this.allowedApprovalPolicies = undefined;
    }
  }

  private send(message: JsonRpcRequest): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
    void appendFile(this.requestsPath, `${JSON.stringify(message)}\n`, "utf8");
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = this.requestTimeoutMs
  ): Promise<Record<string, unknown>> {
    if (this.closed) {
      throw new Error("App Server transport is already closed.");
    }

    const id = this.nextRequestId++;
    const payload = { method, id, params };
    const resultPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`App Server request '${method}' timed out.`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve,
        reject,
        timeout
      });
    });
    this.send(payload);
    const result = await resultPromise;
    this.snapshotState.last_request_method = method;
    return result;
  }

  private async handleLine(line: string): Promise<void> {
    await appendFile(this.eventsPath, `${line}\n`, "utf8");

    let parsed: JsonRpcResponse | JsonRpcNotification;
    try {
      parsed = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification;
    } catch {
      return;
    }

    if ("id" in parsed && typeof parsed.id === "number") {
      const pending = this.pending.get(parsed.id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeout);
      this.pending.delete(parsed.id);
      if (parsed.error?.message) {
        pending.reject(new Error(parsed.error.message));
        return;
      }
      pending.resolve(parsed.result ?? {});
      return;
    }

    if (!("method" in parsed) || typeof parsed.method !== "string") {
      return;
    }

    this.snapshotState.event_cursor = (this.snapshotState.event_cursor ?? 0) + 1;
    this.snapshotState.last_event_method = parsed.method;
    this.snapshotState.last_event_at = new Date().toISOString();

    const params = parsed.params ?? {};
    if (parsed.method === "thread/started") {
      const threadId = this.extractThreadId(params, this.snapshotState.thread_id);
      this.snapshotState.thread_id = threadId;
      this.snapshotState.thread_lifecycle = "subscribed";
      this.snapshotState.thread_runtime_status ??= "idle";
    } else if (parsed.method === "thread/status/changed") {
      const status = this.normalizeThreadRuntimeStatus(params.status);
      if (status.type) {
        this.snapshotState.thread_runtime_status = status.type;
        this.snapshotState.thread_active_flags = status.activeFlags;
      }
    } else if (parsed.method === "thread/closed") {
      this.snapshotState.thread_lifecycle = "closed";
      this.snapshotState.thread_runtime_status = "notLoaded";
      this.resolveThreadClosed();
    } else if (parsed.method === "thread/archived") {
      this.snapshotState.thread_lifecycle = "archived";
      this.resolveThreadClosed();
    } else if (parsed.method === "turn/started") {
      const turn = params.turn as { id?: string; status?: string } | undefined;
      if (turn?.id) {
        this.snapshotState.turn_id = turn.id;
        this.snapshotState.turn_status = "inProgress";
      }
    } else if (parsed.method === "item/agentMessage/delta") {
      const delta = typeof (params as { delta?: unknown }).delta === "string"
        ? ((params as { delta?: string }).delta ?? "")
        : "";
      const turnId =
        typeof (params as { turnId?: unknown }).turnId === "string"
          ? ((params as { turnId?: string }).turnId ?? "")
          : "";
      if (turnId && delta) {
        this.appendTurnResponseText(turnId, delta);
      }
    } else if (parsed.method === "item/completed") {
      const item = params.item as
        | {
            type?: string;
            id?: string;
            text?: string;
            review?: string;
          }
        | undefined;
      const turnId =
        typeof (params as { turnId?: unknown }).turnId === "string"
          ? ((params as { turnId?: string }).turnId ?? "")
          : "";
      if (turnId && typeof item?.text === "string" && item.text.trim().length > 0) {
        if (!this.turnResponseText.has(turnId)) {
          this.appendTurnResponseText(turnId, item.text);
        }
      }
      if (
        turnId &&
        item?.type === "exitedReviewMode" &&
        typeof item.review === "string" &&
        item.review.trim().length > 0
      ) {
        this.turnReviewText.set(turnId, item.review);
      }
    } else if (parsed.method === "turn/completed") {
      const turn = params.turn as { id?: string; status?: string } | undefined;
      if (turn?.id) {
        this.snapshotState.turn_id = turn.id;
      }
      if (
        turn?.status === "completed" ||
        turn?.status === "interrupted" ||
        turn?.status === "failed"
      ) {
        this.snapshotState.turn_status = turn.status;
        if (turn?.id) {
          this.resolveTurnCompletion(turn.id, turn.status);
        }
      }
    }

    await this.persistState();
  }

  private waitForTurnCompletion(
    turnId: string,
    timeoutMs: number
  ): Promise<AppServerTurnResult> {
    if (
      this.snapshotState.turn_id === turnId &&
      (this.snapshotState.turn_status === "completed" ||
        this.snapshotState.turn_status === "interrupted" ||
        this.snapshotState.turn_status === "failed")
    ) {
      const responseText = this.turnResponseText.get(turnId);
      const reviewText = this.turnReviewText.get(turnId);
      return Promise.resolve({
        turnId,
        status: this.snapshotState.turn_status,
        eventCursor: this.snapshotState.event_cursor,
        ...(responseText ? { responseText } : {}),
        ...(reviewText ? { reviewText } : {})
      });
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingTurnCompletions.delete(turnId);
        reject(new Error(`App Server turn '${turnId}' did not complete in time.`));
      }, timeoutMs);
      this.pendingTurnCompletions.set(turnId, {
        resolve,
        reject,
        timeout
      });
    });
  }

  private resolveTurnCompletion(
    turnId: string,
    status: "completed" | "interrupted" | "failed"
  ): void {
    const pending = this.pendingTurnCompletions.get(turnId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingTurnCompletions.delete(turnId);
    const responseText = this.turnResponseText.get(turnId);
    const reviewText = this.turnReviewText.get(turnId);
    pending.resolve({
      turnId,
      status,
      eventCursor: this.snapshotState.event_cursor,
      ...(responseText ? { responseText } : {}),
      ...(reviewText ? { reviewText } : {})
    });
    this.turnResponseText.delete(turnId);
    this.turnReviewText.delete(turnId);
  }

  private appendTurnResponseText(turnId: string, chunk: string): void {
    if (chunk.trim().length === 0) {
      return;
    }
    const existing = this.turnResponseText.get(turnId);
    this.turnResponseText.set(
      turnId,
      existing ? `${existing}${chunk}` : chunk
    );
  }

  private waitForThreadClosed(timeoutMs: number): Promise<void> {
    if (
      this.snapshotState.thread_lifecycle === "closed" ||
      this.snapshotState.thread_lifecycle === "archived"
    ) {
      return Promise.resolve();
    }

    if (this.pendingThreadClosure) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingThreadClosure = undefined;
        reject(new Error("App Server thread did not close in time."));
      }, timeoutMs);
      this.pendingThreadClosure = {
        resolve: () => {
          clearTimeout(timeout);
          this.pendingThreadClosure = undefined;
          resolve();
        },
        reject: (error) => {
          clearTimeout(timeout);
          this.pendingThreadClosure = undefined;
          reject(error);
        },
        timeout
      };
    });
  }

  private resolveThreadClosed(): void {
    if (!this.pendingThreadClosure) {
      return;
    }
    clearTimeout(this.pendingThreadClosure.timeout);
    this.pendingThreadClosure.resolve();
    this.pendingThreadClosure = undefined;
  }

  private async flushPendingLineHandlers(): Promise<void> {
    if (this.pendingLineHandlers.size === 0) {
      return;
    }

    await Promise.allSettled([...this.pendingLineHandlers]);
  }

  private extractThreadId(
    result: Record<string, unknown>,
    fallback?: string
  ): string {
    const thread =
      (result.thread as { id?: string } | undefined) ??
      (result as { thread?: { id?: string } }).thread;
    const threadId = thread?.id ?? fallback;
    if (!threadId) {
      throw new Error("App Server thread request did not return a thread id.");
    }
    return threadId;
  }

  private normalizeThreadRuntimeStatus(status: unknown): {
    type?: "notLoaded" | "idle" | "active" | "systemError";
    activeFlags: string[];
  } {
    if (!status || typeof status !== "object") {
      return { activeFlags: [] };
    }

    const candidate = status as {
      type?: unknown;
      activeFlags?: unknown;
    };
    const type =
      candidate.type === "notLoaded" ||
      candidate.type === "idle" ||
      candidate.type === "active" ||
      candidate.type === "systemError"
        ? candidate.type
        : undefined;
    const activeFlags = Array.isArray(candidate.activeFlags)
      ? candidate.activeFlags.filter((value): value is string => typeof value === "string")
      : [];
    return { type, activeFlags };
  }

  private applyThreadRead(
    result: Record<string, unknown>,
    fallbackThreadId?: string
  ): void {
    const thread = result.thread as
      | {
          id?: string;
          name?: string;
          status?: unknown;
          turns?: unknown;
          runtimeStatus?: unknown;
        }
      | undefined;
    const threadId = thread?.id ?? fallbackThreadId;
    if (threadId) {
      this.snapshotState.thread_id = threadId;
      this.snapshotState.thread_lifecycle = "subscribed";
    }
    if (typeof thread?.name === "string" && thread.name.trim().length > 0) {
      this.snapshotState.thread_name = thread.name;
    }

    const runtimeStatus = this.normalizeThreadRuntimeStatus(
      thread?.status ?? thread?.runtimeStatus ?? result.status
    );
    if (runtimeStatus.type) {
      this.snapshotState.thread_runtime_status = runtimeStatus.type;
      this.snapshotState.thread_active_flags = runtimeStatus.activeFlags;
    }

    const turns = Array.isArray(thread?.turns)
      ? (thread.turns as Array<{ id?: string; status?: string }>)
      : Array.isArray((result as { turns?: unknown }).turns)
        ? ((result as { turns: Array<{ id?: string; status?: string }> }).turns)
        : [];
    const lastTurn = turns.at(-1);
    if (lastTurn?.id) {
      this.snapshotState.turn_id = lastTurn.id;
      if (
        lastTurn.status === "completed" ||
        lastTurn.status === "interrupted" ||
        lastTurn.status === "failed"
      ) {
        this.snapshotState.turn_status = lastTurn.status;
      } else {
        this.snapshotState.turn_status = "inProgress";
      }
    }
  }

  private async tryReadThread(
    threadId: string
  ): Promise<Record<string, unknown> | undefined> {
    try {
      return await this.request("thread/read", {
        threadId,
        includeTurns: true
      });
    } catch {
      return undefined;
    }
  }

  private async trySetThreadName(threadId: string): Promise<void> {
    try {
      await this.request("thread/name/set", {
        threadId,
        name: this.threadName
      });
      this.snapshotState.thread_name = this.threadName;
    } catch {
      this.snapshotState.thread_name = this.threadName;
    }
  }

  private deriveTransportStatus(
    explicitStatus?: PersistedTransportStatus,
    hasError = false
  ): PersistedTransportStatus {
    if (explicitStatus) {
      return explicitStatus;
    }
    if (hasError) {
      return "blocked";
    }
    if (
      this.snapshotState.thread_lifecycle === "closed" ||
      this.snapshotState.thread_lifecycle === "archived" ||
      this.snapshotState.thread_lifecycle === "unsubscribed"
    ) {
      return "closed";
    }
    if (this.snapshotState.turn_status === "interrupted") {
      return "interrupted";
    }
    if (this.snapshotState.turn_status === "completed") {
      return "completed";
    }
    if (
      this.snapshotState.thread_runtime_status === "active" ||
      this.snapshotState.turn_status === "inProgress"
    ) {
      return "live";
    }
    if (this.snapshotState.thread_runtime_status === "idle") {
      return "idle";
    }
    return "configured";
  }

  private async mirrorSessionEvents(): Promise<void> {
    const pendingEvents = (
      await loadJsonLinesIfExists<SessionStatusEventArtifact>(
        this.sessionStatusEventsPath
      )
    ).filter((event) => event.sequence > this.mirroredSessionEventCursor);

    for (const event of pendingEvents) {
      await appendJsonLine(this.mirroredSessionEventsPath, {
        method: "harness/session.changed",
        params: {
          runId: this.runId,
          streamId: `session-stream-${this.runId}`,
          sequence: event.sequence,
          cursor: event.sequence,
          createdAt: event.created_at,
          changedFields: event.changed_fields,
          snapshotPath: this.sessionStatusPath,
          contractPath: this.sessionStreamPath,
          sourceEventsPath: this.sessionStatusEventsPath,
          session: buildOperatorSurfaceSessionProjection(event.session)
        }
      });
      this.mirroredSessionEventCursor = event.sequence;
    }
  }

  private async persistState(
    lastError?: string,
    explicitStatus?: PersistedTransportStatus
  ): Promise<void> {
    const effectiveStatus = explicitStatus ?? this.terminalTransportStatus;
    const sessionStatus =
      await loadJsonIfExists<SessionStatusArtifact>(this.sessionStatusPath);
    const notes = unique([
      "App Server transport is an embedded background-automation surface that keeps a live thread/turn container through codex app-server.",
      `Request log: ${this.requestsPath}`,
      `Event log: ${this.eventsPath}`,
      `Protocol surface: ${this.protocolPath}`,
      `Session status stream: ${this.sessionStatusEventsPath}`,
      `Session widget contract: ${this.sessionStreamPath}`,
      `Mirrored App Server session events: ${this.mirroredSessionEventsPath}`
    ]);
    this.persistQueue = this.persistQueue.then(async () => {
      await this.mirrorSessionEvents();
      await writeTransportStateArtifact(
        this.transportStatePath,
        buildTransportStateArtifact({
          runId: this.runId,
          controllerMode: this.controllerMode,
          transportMode: "app-server",
          executorMode: this.executorMode,
          summaryPath: this.summaryPath,
          protocolPath: this.protocolPath,
          dashboardPath: this.dashboardPath,
          sessionStatusPath: this.sessionStatusPath,
          sessionStatusEventsPath: this.sessionStatusEventsPath,
          sessionStreamPath: this.sessionStreamPath,
          ...(sessionStatus
            ? {
                session:
                  buildOperatorSurfaceSessionProjection(sessionStatus)
              }
            : {}),
          status: this.deriveTransportStatus(effectiveStatus, Boolean(lastError)),
          notes,
          ...(lastError ? { lastError } : {}),
          appServer: this.snapshot()
        })
      );
    });
    await this.persistQueue;
  }
}

export const startAppServerTransport = async (input: {
  runId: string;
  controllerMode: ControllerMode;
  executorMode?: ExecutorMode;
  transportStatePath: string;
  summaryPath: string;
  protocolPath: string;
  dashboardPath: string;
  sessionStatusPath: string;
  sessionStatusEventsPath: string;
  sessionStreamPath: string;
  mirroredSessionEventsPath: string;
  restoredThreadId?: string;
  initialRound: number;
  initialPhase: ControllerRoundPhase;
  initialStatus: ControllerPhaseStatus;
  initialNotes?: string[];
  startInitialTurn?: boolean;
  threadName: string;
  defaultTaskTimeoutMs: number;
  requestTimeoutMs: number;
}): Promise<AppServerTransportController> => {
  const controller = new LiveAppServerTransport({
    runId: input.runId,
    controllerMode: input.controllerMode,
    executorMode: input.executorMode,
    transportStatePath: input.transportStatePath,
    summaryPath: input.summaryPath,
    protocolPath: input.protocolPath,
    dashboardPath: input.dashboardPath,
    sessionStatusPath: input.sessionStatusPath,
    sessionStatusEventsPath: input.sessionStatusEventsPath,
    sessionStreamPath: input.sessionStreamPath,
    mirroredSessionEventsPath: input.mirroredSessionEventsPath,
    restoredThreadId: input.restoredThreadId,
    threadName: input.threadName,
    defaultTaskTimeoutMs: input.defaultTaskTimeoutMs,
    requestTimeoutMs: input.requestTimeoutMs
  });
  try {
    await controller.initialize({
      restoredThreadId: input.restoredThreadId,
      initialRound: input.initialRound,
      initialPhase: input.initialPhase,
      initialStatus: input.initialStatus,
      initialNotes: input.initialNotes,
      startInitialTurn: input.startInitialTurn
    });
    return controller;
  } catch (error) {
    await controller.stop({
      notes: [error instanceof Error ? error.message : String(error)]
    });
    throw error;
  }
};
