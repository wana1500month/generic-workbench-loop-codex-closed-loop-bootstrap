import { appendFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import readline from "node:readline";
import { resolveCodexCliLaunch } from "./codex-cli.js";
import { appendJsonLine, loadJsonIfExists, loadJsonLinesIfExists, repoRoot, writeText } from "./file-system.js";
import { buildOperatorSurfaceSessionProjection } from "./session-artifacts.js";
import { buildTransportStateArtifact } from "./transport-mode.js";
import { writeTransportStateArtifact } from "./runtime-state.js";
const unique = (values) => [...new Set(values)];
const approvalPolicyCandidates = (policy) => {
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
const appServerCommand = () => {
    return resolveCodexCliLaunch({
        commandEnvKeys: ["HARNESS_APP_SERVER_BIN", "HARNESS_CODEX_BIN"],
        argsEnvKeys: ["HARNESS_APP_SERVER_BIN_ARGS", "HARNESS_CODEX_BIN_ARGS"],
        tailArgs: ["app-server"]
    });
};
const isNoActiveTurnInterruptError = (error) => error instanceof Error && /no active turn to interrupt/i.test(error.message);
const transportPromptText = (input) => [
    `Harness run ${input.runId} is attached through the embedded App Server transport.`,
    "This is a background automation surface, not the stock foreground Codex thread.",
    "The external loop controller remains authoritative for filesystem mutation and round state.",
    "Use this thread as the live operator container only. Do not spawn nested codex exec calls.",
    `Round ${input.round} is ${input.phase} (${input.status}).`,
    ...(input.notes?.length ? ["Notes:", ...input.notes.map((note) => `- ${note}`)] : [])
].join("\n");
class LiveAppServerTransport {
    runId;
    controllerMode;
    executorMode;
    transportStatePath;
    summaryPath;
    protocolPath;
    dashboardPath;
    sessionStatusPath;
    sessionStatusEventsPath;
    sessionStreamPath;
    command;
    args;
    cwd;
    threadName;
    model;
    defaultTaskTimeoutMs;
    requestTimeoutMs;
    requestsPath;
    eventsPath;
    mirroredSessionEventsPath;
    errorsPath;
    child;
    rl;
    pending = new Map();
    pendingTurnCompletions = new Map();
    pendingLineHandlers = new Set();
    lineQueue = Promise.resolve();
    turnResponseText = new Map();
    turnReviewText = new Map();
    pendingThreadClosure;
    snapshotState;
    allowedApprovalPolicies;
    nextRequestId = 1;
    persistQueue = Promise.resolve();
    mirroredSessionEventCursor = 0;
    terminalTransportStatus;
    closed = false;
    constructor(input) {
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
                void appendFile(this.errorsPath, `App Server line handler failed: ${error instanceof Error ? error.message : String(error)}\n`, "utf8");
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
            void this.persistState(`App Server transport failed to start: ${error instanceof Error ? error.message : String(error)}`);
        });
        this.child.on("close", () => {
            this.closed = true;
            if (this.pendingThreadClosure) {
                clearTimeout(this.pendingThreadClosure.timeout);
                this.pendingThreadClosure.reject(new Error("App Server transport closed before thread shutdown was observed."));
                this.pendingThreadClosure = undefined;
            }
        });
    }
    snapshot() {
        return {
            ...this.snapshotState,
            args: [...this.snapshotState.args],
            required_methods: [...this.snapshotState.required_methods],
            expected_event_types: [...this.snapshotState.expected_event_types]
        };
    }
    async initialize(input) {
        await mkdir(join(this.cwd, "evals", "runs", this.runId, "runtime"), {
            recursive: true
        });
        await Promise.all([
            writeText(this.requestsPath, ""),
            writeText(this.eventsPath, ""),
            writeText(this.errorsPath, "")
        ]);
        this.mirroredSessionEventCursor = (await loadJsonLinesIfExists(this.mirroredSessionEventsPath)).at(-1)?.params?.sequence ?? 0;
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
        if (input.startInitialTurn !== false &&
            this.snapshotState.turn_status !== "inProgress") {
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
    async syncPhase(input) {
        if (this.closed || !this.snapshotState.thread_id) {
            return;
        }
        if (this.snapshotState.turn_id &&
            this.snapshotState.turn_status === "inProgress") {
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
    async runTask(input) {
        if (!this.snapshotState.thread_id) {
            throw new Error("App Server transport has no active thread.");
        }
        await this.interruptActiveTurn();
        const cwd = input.taskCwd ?? this.cwd;
        const writableRoots = unique(input.writableRoots?.length ? input.writableRoots : [cwd]);
        const sandboxMode = input.sandboxMode ?? "workspaceWrite";
        const requestedApprovalPolicy = input.approvalPolicy !== undefined
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
                : this.resolveApprovalPolicy(this.controllerMode === "attached"
                    ? ["never", "on-failure", "untrusted", "unlessTrusted", "on-request", "onRequest"]
                    : ["never"]);
        const turnStartParams = {
            threadId: this.snapshotState.thread_id,
            input: input.inputItems?.length
                ? input.inputItems
                : [
                    {
                        type: "text",
                        text: input.prompt
                    }
                ],
            cwd,
            sandboxPolicy: sandboxMode === "readOnly"
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
        const turn = result.turn;
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
        return this.waitForTurnCompletion(turn.id, input.completionTimeoutMs ?? this.defaultTaskTimeoutMs);
    }
    async runReview(input) {
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
        const turn = result.turn;
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
        return this.waitForTurnCompletion(turn.id, input.completionTimeoutMs ?? this.defaultTaskTimeoutMs);
    }
    async stop(input) {
        if (this.closed) {
            return;
        }
        let explicitStatus = input?.stopReason ? "completed" : "closed";
        this.terminalTransportStatus = explicitStatus;
        try {
            if (this.snapshotState.thread_id &&
                this.snapshotState.turn_id &&
                this.snapshotState.turn_status === "inProgress") {
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
                try {
                    await this.request("turn/interrupt", {
                        threadId: this.snapshotState.thread_id,
                        turnId: this.snapshotState.turn_id
                    });
                    this.snapshotState.last_request_method = "turn/interrupt";
                }
                catch (error) {
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
                await this.waitForThreadClosed(2_000).catch(() => { });
                this.snapshotState.thread_lifecycle = "closed";
                this.snapshotState.thread_runtime_status = "notLoaded";
            }
        }
        catch (error) {
            explicitStatus = "blocked";
            this.terminalTransportStatus = explicitStatus;
            await this.persistState(error instanceof Error ? error.message : String(error), explicitStatus);
        }
        finally {
            this.closed = true;
            for (const pendingTurn of this.pendingTurnCompletions.values()) {
                clearTimeout(pendingTurn.timeout);
                pendingTurn.reject(new Error("App Server transport stopped before turn completion."));
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
    async startTurn(input) {
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
        const turnParams = {
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
        const turn = result.turn;
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
    async interruptActiveTurn() {
        if (this.snapshotState.turn_id &&
            this.snapshotState.turn_status === "inProgress" &&
            this.snapshotState.thread_id) {
            try {
                await this.request("turn/interrupt", {
                    threadId: this.snapshotState.thread_id,
                    turnId: this.snapshotState.turn_id
                });
            }
            catch (error) {
                if (!isNoActiveTurnInterruptError(error)) {
                    throw error;
                }
                this.snapshotState.turn_status = "interrupted";
            }
            this.snapshotState.last_request_method = "turn/interrupt";
            await this.persistState();
        }
    }
    resolveApprovalPolicy(preferredPolicies) {
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
    async tryReadConfigRequirements() {
        try {
            const result = await this.request("configRequirements/read", {});
            const requirements = result.requirements;
            const allowed = requirements?.approvals?.policy?.allowed?.filter((value) => typeof value === "string" && value.trim().length > 0) ?? [];
            if (allowed.length > 0) {
                this.allowedApprovalPolicies = unique(allowed);
            }
        }
        catch {
            this.allowedApprovalPolicies = undefined;
        }
    }
    send(message) {
        this.child.stdin.write(`${JSON.stringify(message)}\n`);
        void appendFile(this.requestsPath, `${JSON.stringify(message)}\n`, "utf8");
    }
    async request(method, params) {
        if (this.closed) {
            throw new Error("App Server transport is already closed.");
        }
        const id = this.nextRequestId++;
        const payload = { method, id, params };
        const resultPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`App Server request '${method}' timed out.`));
            }, this.requestTimeoutMs);
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
    async handleLine(line) {
        await appendFile(this.eventsPath, `${line}\n`, "utf8");
        let parsed;
        try {
            parsed = JSON.parse(line);
        }
        catch {
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
        }
        else if (parsed.method === "thread/status/changed") {
            const status = this.normalizeThreadRuntimeStatus(params.status);
            if (status.type) {
                this.snapshotState.thread_runtime_status = status.type;
                this.snapshotState.thread_active_flags = status.activeFlags;
            }
        }
        else if (parsed.method === "thread/closed") {
            this.snapshotState.thread_lifecycle = "closed";
            this.snapshotState.thread_runtime_status = "notLoaded";
            this.resolveThreadClosed();
        }
        else if (parsed.method === "thread/archived") {
            this.snapshotState.thread_lifecycle = "archived";
            this.resolveThreadClosed();
        }
        else if (parsed.method === "turn/started") {
            const turn = params.turn;
            if (turn?.id) {
                this.snapshotState.turn_id = turn.id;
                this.snapshotState.turn_status = "inProgress";
            }
        }
        else if (parsed.method === "item/agentMessage/delta") {
            const delta = typeof params.delta === "string"
                ? (params.delta ?? "")
                : "";
            const turnId = typeof params.turnId === "string"
                ? (params.turnId ?? "")
                : "";
            if (turnId && delta) {
                this.appendTurnResponseText(turnId, delta);
            }
        }
        else if (parsed.method === "item/completed") {
            const item = params.item;
            const turnId = typeof params.turnId === "string"
                ? (params.turnId ?? "")
                : "";
            if (turnId && typeof item?.text === "string" && item.text.trim().length > 0) {
                if (!this.turnResponseText.has(turnId)) {
                    this.appendTurnResponseText(turnId, item.text);
                }
            }
            if (turnId &&
                item?.type === "exitedReviewMode" &&
                typeof item.review === "string" &&
                item.review.trim().length > 0) {
                this.turnReviewText.set(turnId, item.review);
            }
        }
        else if (parsed.method === "turn/completed") {
            const turn = params.turn;
            if (turn?.id) {
                this.snapshotState.turn_id = turn.id;
            }
            if (turn?.status === "completed" ||
                turn?.status === "interrupted" ||
                turn?.status === "failed") {
                this.snapshotState.turn_status = turn.status;
                if (turn?.id) {
                    this.resolveTurnCompletion(turn.id, turn.status);
                }
            }
        }
        await this.persistState();
    }
    waitForTurnCompletion(turnId, timeoutMs) {
        if (this.snapshotState.turn_id === turnId &&
            (this.snapshotState.turn_status === "completed" ||
                this.snapshotState.turn_status === "interrupted" ||
                this.snapshotState.turn_status === "failed")) {
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
    resolveTurnCompletion(turnId, status) {
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
    appendTurnResponseText(turnId, chunk) {
        if (chunk.trim().length === 0) {
            return;
        }
        const existing = this.turnResponseText.get(turnId);
        this.turnResponseText.set(turnId, existing ? `${existing}${chunk}` : chunk);
    }
    waitForThreadClosed(timeoutMs) {
        if (this.snapshotState.thread_lifecycle === "closed" ||
            this.snapshotState.thread_lifecycle === "archived") {
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
    resolveThreadClosed() {
        if (!this.pendingThreadClosure) {
            return;
        }
        clearTimeout(this.pendingThreadClosure.timeout);
        this.pendingThreadClosure.resolve();
        this.pendingThreadClosure = undefined;
    }
    async flushPendingLineHandlers() {
        if (this.pendingLineHandlers.size === 0) {
            return;
        }
        await Promise.allSettled([...this.pendingLineHandlers]);
    }
    extractThreadId(result, fallback) {
        const thread = result.thread ??
            result.thread;
        const threadId = thread?.id ?? fallback;
        if (!threadId) {
            throw new Error("App Server thread request did not return a thread id.");
        }
        return threadId;
    }
    normalizeThreadRuntimeStatus(status) {
        if (!status || typeof status !== "object") {
            return { activeFlags: [] };
        }
        const candidate = status;
        const type = candidate.type === "notLoaded" ||
            candidate.type === "idle" ||
            candidate.type === "active" ||
            candidate.type === "systemError"
            ? candidate.type
            : undefined;
        const activeFlags = Array.isArray(candidate.activeFlags)
            ? candidate.activeFlags.filter((value) => typeof value === "string")
            : [];
        return { type, activeFlags };
    }
    applyThreadRead(result, fallbackThreadId) {
        const thread = result.thread;
        const threadId = thread?.id ?? fallbackThreadId;
        if (threadId) {
            this.snapshotState.thread_id = threadId;
            this.snapshotState.thread_lifecycle = "subscribed";
        }
        if (typeof thread?.name === "string" && thread.name.trim().length > 0) {
            this.snapshotState.thread_name = thread.name;
        }
        const runtimeStatus = this.normalizeThreadRuntimeStatus(thread?.status ?? thread?.runtimeStatus ?? result.status);
        if (runtimeStatus.type) {
            this.snapshotState.thread_runtime_status = runtimeStatus.type;
            this.snapshotState.thread_active_flags = runtimeStatus.activeFlags;
        }
        const turns = Array.isArray(thread?.turns)
            ? thread.turns
            : Array.isArray(result.turns)
                ? (result.turns)
                : [];
        const lastTurn = turns.at(-1);
        if (lastTurn?.id) {
            this.snapshotState.turn_id = lastTurn.id;
            if (lastTurn.status === "completed" ||
                lastTurn.status === "interrupted" ||
                lastTurn.status === "failed") {
                this.snapshotState.turn_status = lastTurn.status;
            }
            else {
                this.snapshotState.turn_status = "inProgress";
            }
        }
    }
    async tryReadThread(threadId) {
        try {
            return await this.request("thread/read", {
                threadId,
                includeTurns: true
            });
        }
        catch {
            return undefined;
        }
    }
    async trySetThreadName(threadId) {
        try {
            await this.request("thread/name/set", {
                threadId,
                name: this.threadName
            });
            this.snapshotState.thread_name = this.threadName;
        }
        catch {
            this.snapshotState.thread_name = this.threadName;
        }
    }
    deriveTransportStatus(explicitStatus, hasError = false) {
        if (explicitStatus) {
            return explicitStatus;
        }
        if (hasError) {
            return "blocked";
        }
        if (this.snapshotState.thread_lifecycle === "closed" ||
            this.snapshotState.thread_lifecycle === "archived" ||
            this.snapshotState.thread_lifecycle === "unsubscribed") {
            return "closed";
        }
        if (this.snapshotState.turn_status === "interrupted") {
            return "interrupted";
        }
        if (this.snapshotState.turn_status === "completed") {
            return "completed";
        }
        if (this.snapshotState.thread_runtime_status === "active" ||
            this.snapshotState.turn_status === "inProgress") {
            return "live";
        }
        if (this.snapshotState.thread_runtime_status === "idle") {
            return "idle";
        }
        return "configured";
    }
    async mirrorSessionEvents() {
        const pendingEvents = (await loadJsonLinesIfExists(this.sessionStatusEventsPath)).filter((event) => event.sequence > this.mirroredSessionEventCursor);
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
    async persistState(lastError, explicitStatus) {
        const effectiveStatus = explicitStatus ?? this.terminalTransportStatus;
        const sessionStatus = await loadJsonIfExists(this.sessionStatusPath);
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
            await writeTransportStateArtifact(this.transportStatePath, buildTransportStateArtifact({
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
                        session: buildOperatorSurfaceSessionProjection(sessionStatus)
                    }
                    : {}),
                status: this.deriveTransportStatus(effectiveStatus, Boolean(lastError)),
                notes,
                ...(lastError ? { lastError } : {}),
                appServer: this.snapshot()
            }));
        });
        await this.persistQueue;
    }
}
export const startAppServerTransport = async (input) => {
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
    }
    catch (error) {
        await controller.stop({
            notes: [error instanceof Error ? error.message : String(error)]
        });
        throw error;
    }
};
//# sourceMappingURL=app-server-runtime.js.map