import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import readline from "node:readline";

const recordPath = process.env.FAKE_APP_SERVER_RECORD_PATH
  ? resolve(process.env.FAKE_APP_SERVER_RECORD_PATH)
  : undefined;
const statePath = process.env.FAKE_APP_SERVER_STATE_PATH
  ? resolve(process.env.FAKE_APP_SERVER_STATE_PATH)
  : undefined;
const defaultThreadId = process.env.FAKE_APP_SERVER_THREAD_ID ?? "thread_app_server_fake_123";

const loadPersistedState = async () => {
  if (!statePath) {
    return undefined;
  }
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    return undefined;
  }
};

const persistedState = await loadPersistedState();

let currentThreadId = persistedState?.currentThreadId ?? defaultThreadId;
let threadName = persistedState?.threadName ?? "fake attached loop";
let threadLifecycle = persistedState?.threadLifecycle ?? "not_started";
let threadRuntimeStatus = persistedState?.threadRuntimeStatus ?? "notLoaded";
let threadActiveFlags = Array.isArray(persistedState?.threadActiveFlags)
  ? persistedState.threadActiveFlags
  : [];
let currentTurnId = persistedState?.currentTurnId;
let turnStatus = persistedState?.turnStatus ?? "not_started";
let eventCursor = Number.isFinite(persistedState?.eventCursor)
  ? persistedState.eventCursor
  : 0;
let turnCounter = Number.isFinite(persistedState?.turnCounter)
  ? persistedState.turnCounter
  : 0;

const persistState = async () => {
  if (!statePath) {
    return;
  }
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(
    statePath,
    JSON.stringify(
      {
        currentThreadId,
        threadName,
        threadLifecycle,
        threadRuntimeStatus,
        threadActiveFlags,
        currentTurnId,
        turnStatus,
        eventCursor,
        turnCounter
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
};

const extractDirective = (text, key) => {
  const match = text.match(new RegExp(`${key}:\\s*(.+)`));
  return match ? match[1].trim() : undefined;
};

const appendRecord = async (entry) => {
  if (!recordPath) {
    return;
  }

  let existing = [];
  try {
    existing = JSON.parse(await readFile(recordPath, "utf8"));
    if (!Array.isArray(existing)) {
      existing = [];
    }
  } catch {
    existing = [];
  }
  existing.push(entry);
  await writeFile(recordPath, JSON.stringify(existing, null, 2) + "\n", "utf8");
};

const send = async (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
  if ("method" in message) {
    eventCursor += 1;
    await persistState();
  }
  await appendRecord({
    direction: "out",
    message
  });
};

const respond = async (id, result) => {
  await send({
    id,
    result
  });
};

const runtimeStatusPayload = () => ({
  type: threadRuntimeStatus,
  activeFlags: threadActiveFlags
});

const notify = async (method, params = {}) => {
  await send({
    method,
    params
  });
};

const setThreadRuntimeStatus = async (type, activeFlags = []) => {
  threadRuntimeStatus = type;
  threadActiveFlags = activeFlags;
  await persistState();
};

const maybeCompleteTaskTurn = async ({ text, turnId, itemId }) => {
  const leaveTurnActive =
    process.env.FAKE_APP_SERVER_LEAVE_TURN_ACTIVE === "1" ||
    extractDirective(text, "FAKE_APP_SERVER_LEAVE_TURN_ACTIVE") === "1";
  if (leaveTurnActive) {
    return true;
  }

  const responsePath =
    extractDirective(text, "ATTACHED_GENERATOR_RESPONSE_PATH") ??
    extractDirective(text, "APP_SERVER_SMOKE_RESPONSE_PATH");
  if (!responsePath) {
    return false;
  }

  const simulatedFile =
    extractDirective(text, "ATTACHED_GENERATOR_SIMULATED_FILE") ??
    extractDirective(text, "APP_SERVER_SMOKE_FILE_PATH");
  const simulatedContent =
    extractDirective(text, "ATTACHED_GENERATOR_SIMULATED_CONTENT") ??
    extractDirective(text, "APP_SERVER_SMOKE_FILE_CONTENT") ??
    "fake app-server wrote this file";

  if (simulatedFile) {
    await mkdir(dirname(simulatedFile), { recursive: true });
    await writeFile(simulatedFile, `${simulatedContent}\n`, "utf8");
  }

  await mkdir(dirname(responsePath), { recursive: true });
  await writeFile(
    responsePath,
    JSON.stringify(
      {
        status: "applied",
        summary: "fake app-server applied the requested task",
        changed_files: simulatedFile ? [simulatedFile] : [],
        notes: ["fake-app-server auto-completed the task turn"],
        generated_at: new Date().toISOString()
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  turnStatus = "completed";
  await setThreadRuntimeStatus("idle");
  await notify("item/completed", {
    threadId: currentThreadId,
    turnId,
    item: {
      id: itemId,
      type: "agentMessage"
    },
    cursor: eventCursor
  });
  await notify("turn/completed", {
    threadId: currentThreadId,
    turn: {
      id: turnId,
      status: turnStatus
    },
    cursor: eventCursor
  });
  return true;
};

const completeStructuredTurn = async ({ turnId, itemId, responseText = "{}" }) => {
  turnStatus = "completed";
  await setThreadRuntimeStatus("idle");
  await notify("item/agentMessage/delta", {
    threadId: currentThreadId,
    turnId,
    itemId,
    delta: responseText,
    cursor: eventCursor
  });
  await notify("item/completed", {
    threadId: currentThreadId,
    turnId,
    item: {
      id: itemId,
      type: "agentMessage",
      text: responseText
    },
    cursor: eventCursor
  });
  await notify("turn/completed", {
    threadId: currentThreadId,
    turn: {
      id: turnId,
      status: turnStatus
    },
    cursor: eventCursor
  });
};

const completeInlineReview = async ({ turnId, reviewText = "{}" }) => {
  turnStatus = "completed";
  await setThreadRuntimeStatus("idle");
  await notify("item/started", {
    threadId: currentThreadId,
    turnId,
    item: {
      id: `review_started_${turnCounter}`,
      type: "enteredReviewMode"
    },
    cursor: eventCursor
  });
  await notify("item/completed", {
    threadId: currentThreadId,
    turnId,
    item: {
      id: `review_completed_${turnCounter}`,
      type: "exitedReviewMode",
      review: reviewText
    },
    cursor: eventCursor
  });
  await notify("turn/completed", {
    threadId: currentThreadId,
    turn: {
      id: turnId,
      status: turnStatus
    },
    cursor: eventCursor
  });
};

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

for await (const line of rl) {
  if (!line.trim()) {
    continue;
  }
  const message = JSON.parse(line);
  await appendRecord({
    direction: "in",
    message
  });

  const { id, method, params = {} } = message;

  if (method === "initialize") {
    await respond(id, {
      serverInfo: {
        name: "fake-app-server",
        version: "0.0.0"
      }
    });
    continue;
  }

  if (method === "initialized") {
    continue;
  }

  if (method === "configRequirements/read") {
    await respond(id, {
      requirements: {
        approvals: {
          policy: {
            allowed: ["never", "onRequest", "unlessTrusted"]
          }
        }
      }
    });
    continue;
  }

  if (method === "thread/start") {
    threadLifecycle = "subscribed";
    await setThreadRuntimeStatus("idle");
    await respond(id, {
      thread: {
        id: currentThreadId,
        name: threadName
      }
    });
    await notify("thread/started", {
      thread: {
        id: currentThreadId,
        name: threadName
      },
      cursor: eventCursor
    });
    await notify("thread/status/changed", {
      threadId: currentThreadId,
      status: runtimeStatusPayload(),
      cursor: eventCursor
    });
    continue;
  }

  if (method === "thread/read") {
    currentThreadId = params.threadId ?? currentThreadId;
    await respond(id, {
      thread: {
        id: currentThreadId,
        name: threadName,
        status: runtimeStatusPayload(),
        turns: currentTurnId
          ? [
              {
                id: currentTurnId,
                status: turnStatus
              }
            ]
          : []
      }
    });
    continue;
  }

  if (method === "thread/name/set") {
    threadName = params.name ?? threadName;
    await persistState();
    await respond(id, {
      thread: {
        id: currentThreadId,
        name: threadName
      }
    });
    continue;
  }

  if (method === "thread/resume") {
    currentThreadId = params.threadId ?? currentThreadId;
    threadLifecycle = "subscribed";
    if (threadRuntimeStatus === "notLoaded") {
      await setThreadRuntimeStatus(turnStatus === "inProgress" ? "active" : "idle");
    }
    await respond(id, {
      thread: {
        id: currentThreadId,
        name: threadName
      }
    });
    await notify("thread/status/changed", {
      threadId: currentThreadId,
      status: runtimeStatusPayload(),
      cursor: eventCursor
    });
    continue;
  }

  if (method === "turn/start") {
    turnCounter += 1;
    currentTurnId = `turn_fake_${turnCounter}`;
    turnStatus = "inProgress";
    const itemId = `item_started_${turnCounter}`;
    const text =
      Array.isArray(params.input) && params.input[0]?.type === "text"
        ? params.input[0].text ?? ""
        : "";
    await setThreadRuntimeStatus("active", ["turnInProgress"]);
    await respond(id, {
      turn: {
        id: currentTurnId,
        status: turnStatus
      }
    });
    await notify("turn/started", {
      threadId: currentThreadId,
      turn: {
        id: currentTurnId,
        status: turnStatus
      },
      cursor: eventCursor
    });
    await notify("thread/status/changed", {
      threadId: currentThreadId,
      status: runtimeStatusPayload(),
      cursor: eventCursor
    });
    await notify("item/started", {
      threadId: currentThreadId,
      turnId: currentTurnId,
      item: {
        id: itemId,
        type: "agentMessage"
      },
      cursor: eventCursor
    });
    if (typeof text === "string" && text.trim().length > 0) {
      const completed = await maybeCompleteTaskTurn({
        text,
        turnId: currentTurnId,
        itemId
      });
      if (completed) {
        continue;
      }
    }
    if (params.outputSchema) {
      await completeStructuredTurn({
        turnId: currentTurnId,
        itemId,
        responseText: "{}"
      });
      continue;
    }
    await notify("item/agentMessage/delta", {
      threadId: currentThreadId,
      turnId: currentTurnId,
      itemId,
      delta: "transport attached",
      cursor: eventCursor
    });
    continue;
  }

  if (method === "turn/steer") {
    await respond(id, {
      turn: {
        id: params.expectedTurnId ?? currentTurnId,
        status: turnStatus
      }
    });
    await notify("item/agentMessage/delta", {
      threadId: currentThreadId,
      turnId: params.expectedTurnId ?? currentTurnId,
      itemId: `item_started_${turnCounter}`,
      delta: "transport steer",
      cursor: eventCursor
    });
    continue;
  }

  if (method === "turn/interrupt") {
    currentTurnId = params.turnId ?? currentTurnId;
    turnStatus = "interrupted";
    await setThreadRuntimeStatus("idle");
    await respond(id, {
      turn: {
        id: currentTurnId,
        status: turnStatus
      }
    });
    await notify("item/completed", {
      threadId: currentThreadId,
      turnId: currentTurnId,
      item: {
        id: `item_started_${turnCounter}`,
        type: "agentMessage"
      },
      cursor: eventCursor
    });
    await notify("turn/completed", {
      threadId: currentThreadId,
      turn: {
        id: currentTurnId,
        status: turnStatus
      },
      cursor: eventCursor
    });
    await notify("thread/status/changed", {
      threadId: currentThreadId,
      status: runtimeStatusPayload(),
      cursor: eventCursor
    });
    continue;
  }

  if (method === "review/start") {
    turnCounter += 1;
    currentTurnId = `turn_fake_${turnCounter}`;
    turnStatus = "inProgress";
    await setThreadRuntimeStatus("active", ["turnInProgress"]);
    await respond(id, {
      turn: {
        id: currentTurnId,
        status: turnStatus
      }
    });
    await notify("turn/started", {
      threadId: currentThreadId,
      turn: {
        id: currentTurnId,
        status: turnStatus
      },
      cursor: eventCursor
    });
    await notify("thread/status/changed", {
      threadId: currentThreadId,
      status: runtimeStatusPayload(),
      cursor: eventCursor
    });
    await completeInlineReview({
      turnId: currentTurnId,
      reviewText: "{}"
    });
    continue;
  }

  if (method === "thread/unsubscribe") {
    currentThreadId = params.threadId ?? currentThreadId;
    threadLifecycle = "unsubscribed";
    await setThreadRuntimeStatus("notLoaded");
    await respond(id, {
      thread: {
        id: currentThreadId,
        name: threadName
      }
    });
    await notify("thread/status/changed", {
      threadId: currentThreadId,
      status: runtimeStatusPayload(),
      cursor: eventCursor
    });
    threadLifecycle = "closed";
    await persistState();
    await notify("thread/closed", {
      threadId: currentThreadId,
      cursor: eventCursor
    });
    continue;
  }

  await respond(id, {});
}
