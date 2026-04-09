import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import readline from "node:readline";

const recordPath = process.env.FAKE_APP_SERVER_RECORD_PATH
  ? resolve(process.env.FAKE_APP_SERVER_RECORD_PATH)
  : undefined;
const threadId = process.env.FAKE_APP_SERVER_THREAD_ID ?? "thread_app_server_fake_123";

let currentThreadId = threadId;
let threadStatus = "not_started";
let currentTurnId;
let turnStatus = "not_started";
let eventCursor = 0;
let turnCounter = 0;

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

const notify = async (method, params = {}) => {
  await send({
    method,
    params
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

  if (method === "thread/start") {
    threadStatus = "loaded";
    await respond(id, {
      thread: {
        id: currentThreadId,
        status: threadStatus
      }
    });
    await notify("thread/started", {
      thread: {
        id: currentThreadId,
        status: threadStatus
      },
      cursor: eventCursor
    });
    await notify("thread/status/changed", {
      threadId: currentThreadId,
      status: threadStatus,
      cursor: eventCursor
    });
    continue;
  }

  if (method === "thread/resume") {
    currentThreadId = params.threadId ?? currentThreadId;
    threadStatus = "loaded";
    await respond(id, {
      thread: {
        id: currentThreadId,
        status: threadStatus
      }
    });
    await notify("thread/status/changed", {
      threadId: currentThreadId,
      status: threadStatus,
      cursor: eventCursor
    });
    continue;
  }

  if (method === "turn/start") {
    turnCounter += 1;
    currentTurnId = `turn_fake_${turnCounter}`;
    turnStatus = "inProgress";
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
    await notify("item/started", {
      threadId: currentThreadId,
      turnId: currentTurnId,
      item: {
        id: `item_started_${turnCounter}`,
        type: "agentMessage"
      },
      cursor: eventCursor
    });
    await notify("item/agentMessage/delta", {
      threadId: currentThreadId,
      turnId: currentTurnId,
      itemId: `item_started_${turnCounter}`,
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
    continue;
  }

  if (method === "thread/unsubscribe") {
    currentThreadId = params.threadId ?? currentThreadId;
    threadStatus = "closed";
    await respond(id, {
      thread: {
        id: currentThreadId,
        status: threadStatus
      }
    });
    await notify("thread/status/changed", {
      threadId: currentThreadId,
      status: threadStatus,
      cursor: eventCursor
    });
    await notify("thread/closed", {
      threadId: currentThreadId,
      cursor: eventCursor
    });
    continue;
  }

  await respond(id, {});
}
