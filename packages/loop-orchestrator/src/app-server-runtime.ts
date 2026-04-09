import { appendFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import readline from "node:readline";

import { repoRoot, writeText } from "./file-system.js";
import {
  buildTransportStateArtifact,
  type AppServerTransportSnapshot
} from "./transport-mode.js";
import { writeTransportStateArtifact } from "./runtime-state.js";
import type {
  ControllerMode,
  ControllerPhaseStatus,
  ControllerRoundPhase,
  ExecutorMode
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

export interface AppServerTransportController {
  syncPhase: (input: {
    round: number;
    phase: ControllerRoundPhase;
    status: ControllerPhaseStatus;
    notes?: string[];
  }) => Promise<void>;
  stop: (input?: { stopReason?: string; notes?: string[] }) => Promise<void>;
  snapshot: () => AppServerTransportSnapshot;
}

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const appServerCommand = (): { command: string; args: string[] } => {
  const command =
    process.env.HARNESS_APP_SERVER_BIN ??
    process.env.HARNESS_CODEX_BIN ??
    "codex";
  const parsedArgs = process.env.HARNESS_APP_SERVER_BIN_ARGS
    ? JSON.parse(process.env.HARNESS_APP_SERVER_BIN_ARGS)
    : process.env.HARNESS_CODEX_BIN_ARGS
      ? JSON.parse(process.env.HARNESS_CODEX_BIN_ARGS)
      : [];
  const prefixArgs =
    Array.isArray(parsedArgs) && parsedArgs.every((value) => typeof value === "string")
      ? parsedArgs
      : [];
  return {
    command,
    args: [...prefixArgs, "app-server"]
  };
};

const transportPromptText = (input: {
  runId: string;
  round: number;
  phase: ControllerRoundPhase;
  status: ControllerPhaseStatus;
  notes?: string[];
}): string =>
  [
    `Harness run ${input.runId} is attached through App Server transport.`,
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
  private readonly command: string;
  private readonly args: string[];
  private readonly cwd: string;
  private readonly model: string;
  private readonly requestsPath: string;
  private readonly eventsPath: string;
  private readonly errorsPath: string;
  private readonly child;
  private readonly rl;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly snapshotState: AppServerTransportSnapshot;
  private nextRequestId = 1;
  private persistQueue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(input: {
    runId: string;
    controllerMode: ControllerMode;
    executorMode?: ExecutorMode;
    transportStatePath: string;
    summaryPath: string;
    protocolPath: string;
    restoredThreadId?: string;
  }) {
    const { command, args } = appServerCommand();
    this.runId = input.runId;
    this.controllerMode = input.controllerMode;
    this.executorMode = input.executorMode;
    this.transportStatePath = input.transportStatePath;
    this.summaryPath = input.summaryPath;
    this.protocolPath = input.protocolPath;
    this.command = command;
    this.args = args;
    this.cwd = repoRoot;
    this.model = process.env.HARNESS_APP_SERVER_MODEL ?? "gpt-5.4";
    const runtimeDirectory = join(this.cwd, "evals", "runs", this.runId, "runtime");
    this.requestsPath = join(runtimeDirectory, "app-server-requests.jsonl");
    this.eventsPath = join(runtimeDirectory, "app-server-events.jsonl");
    this.errorsPath = join(runtimeDirectory, "app-server-stderr.log");
    this.snapshotState = {
      implemented: true,
      transport: "stdio",
      initialized: false,
      command,
      args,
      thread_id: input.restoredThreadId,
      thread_status: input.restoredThreadId ? "loaded" : "not_started",
      turn_status: "not_started",
      requests_path: this.requestsPath,
      events_path: this.eventsPath,
      required_methods: [
        "thread/start",
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
    };
    this.child = spawn(command, args, {
      cwd: this.cwd,
      env: process.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.snapshotState.server_pid = this.child.pid;
    this.rl = readline.createInterface({ input: this.child.stdout });
    this.rl.on("line", (line) => {
      void this.handleLine(line);
    });
    this.child.stderr.on("data", (chunk) => {
      void appendFile(this.errorsPath, chunk.toString(), "utf8");
    });
    this.child.on("error", (error) => {
      this.snapshotState.thread_status = "error";
      this.snapshotState.turn_status = "error";
      void this.persistState(
        `App Server transport failed to start: ${error instanceof Error ? error.message : String(error)}`
      );
    });
    this.child.on("close", () => {
      this.closed = true;
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
  }): Promise<void> {
    await mkdir(join(this.cwd, "evals", "runs", this.runId, "runtime"), {
      recursive: true
    });
    await Promise.all([
      writeText(this.requestsPath, ""),
      writeText(this.eventsPath, ""),
      writeText(this.errorsPath, "")
    ]);

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

    const threadResult = input.restoredThreadId
      ? await this.request("thread/resume", {
          threadId: input.restoredThreadId
        })
      : await this.request("thread/start", {
          model: this.model
        });

    const threadId = this.extractThreadId(threadResult, input.restoredThreadId);
    this.snapshotState.thread_id = threadId;
    this.snapshotState.thread_status = "loaded";

    await this.startTurn({
      round: input.initialRound,
      phase: input.initialPhase,
      status: input.initialStatus,
      notes: input.initialNotes
    });
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

  public async stop(input?: {
    stopReason?: string;
    notes?: string[];
  }): Promise<void> {
    if (this.closed) {
      return;
    }

    try {
      if (
        this.snapshotState.thread_id &&
        this.snapshotState.turn_id &&
        this.snapshotState.turn_status === "inProgress"
      ) {
        await this.request("turn/steer", {
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
        });
        await this.request("turn/interrupt", {
          threadId: this.snapshotState.thread_id,
          turnId: this.snapshotState.turn_id
        });
        this.snapshotState.last_request_method = "turn/interrupt";
      }
      if (this.snapshotState.thread_id) {
        await this.request("thread/unsubscribe", {
          threadId: this.snapshotState.thread_id
        });
        this.snapshotState.last_request_method = "thread/unsubscribe";
      }
    } catch (error) {
      await this.persistState(
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      this.closed = true;
      this.rl.close();
      this.child.kill();
      await this.persistState();
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

    const result = await this.request("turn/start", {
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
      approvalPolicy: "never",
      sandboxPolicy: {
        type: "readOnly",
        access: { type: "fullAccess" }
      },
      model: this.model,
      effort: "medium",
      summary: "concise"
    });
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

  private send(message: JsonRpcRequest): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
    void appendFile(this.requestsPath, `${JSON.stringify(message)}\n`, "utf8");
  }

  private async request(
    method: string,
    params: Record<string, unknown>
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
      }, 10_000);
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
      this.snapshotState.thread_status = "loaded";
    } else if (parsed.method === "thread/status/changed") {
      const status = params.status;
      if (status === "loaded" || status === "closed" || status === "archived") {
        this.snapshotState.thread_status = status;
      }
    } else if (parsed.method === "thread/closed") {
      this.snapshotState.thread_status = "closed";
    } else if (parsed.method === "thread/archived") {
      this.snapshotState.thread_status = "archived";
    } else if (parsed.method === "turn/started") {
      const turn = params.turn as { id?: string; status?: string } | undefined;
      if (turn?.id) {
        this.snapshotState.turn_id = turn.id;
        this.snapshotState.turn_status = "inProgress";
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
      }
    }

    await this.persistState();
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

  private async persistState(lastError?: string): Promise<void> {
    const notes = unique([
      "App Server transport keeps a live thread/turn container through codex app-server.",
      `Request log: ${this.requestsPath}`,
      `Event log: ${this.eventsPath}`,
      `Protocol surface: ${this.protocolPath}`
    ]);
    this.persistQueue = this.persistQueue.then(() =>
      writeTransportStateArtifact(
        this.transportStatePath,
        buildTransportStateArtifact({
          runId: this.runId,
          controllerMode: this.controllerMode,
          transportMode: "app-server",
          executorMode: this.executorMode,
          summaryPath: this.summaryPath,
          protocolPath: this.protocolPath,
          status: lastError ? "blocked" : "live",
          notes,
          ...(lastError ? { lastError } : {}),
          appServer: this.snapshot()
        })
      )
    );
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
  restoredThreadId?: string;
  initialRound: number;
  initialPhase: ControllerRoundPhase;
  initialStatus: ControllerPhaseStatus;
  initialNotes?: string[];
}): Promise<AppServerTransportController> => {
  const controller = new LiveAppServerTransport({
    runId: input.runId,
    controllerMode: input.controllerMode,
    executorMode: input.executorMode,
    transportStatePath: input.transportStatePath,
    summaryPath: input.summaryPath,
    protocolPath: input.protocolPath,
    restoredThreadId: input.restoredThreadId
  });
  try {
    await controller.initialize({
      restoredThreadId: input.restoredThreadId,
      initialRound: input.initialRound,
      initialPhase: input.initialPhase,
      initialStatus: input.initialStatus,
      initialNotes: input.initialNotes
    });
    return controller;
  } catch (error) {
    await controller.stop({
      notes: [error instanceof Error ? error.message : String(error)]
    });
    throw error;
  }
};
