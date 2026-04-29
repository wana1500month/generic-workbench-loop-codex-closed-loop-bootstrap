import {
  getFrontDoorSessionStatus,
  runFrontDoorDiscoveryTurn
} from "./front-door-session.js";

interface DiscoverArgs {
  asJson: boolean;
  statusOnly: boolean;
  threadId: string;
  message: string;
}

const usage =
  "Usage: node ./packages/loop-orchestrator/dist/front-door-session-cli.js [--thread-id <thread-id>] [--status] [--json] [--message <message>]";

const defaultThreadId = (): string =>
  process.env.CODEX_THREAD_ID?.trim() ||
  process.env.HARNESS_FRONT_DOOR_THREAD_ID?.trim() ||
  "local-codex-thread";

const parseArgs = (argv: readonly string[]): DiscoverArgs => {
  let asJson = false;
  let statusOnly = false;
  let threadId: string | undefined;
  let message: string | undefined;
  const messageParts: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") {
      asJson = true;
      continue;
    }
    if (value === "--status") {
      statusOnly = true;
      continue;
    }
    if (value === "--thread-id") {
      threadId = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--message") {
      message = argv[index + 1];
      index += 1;
      continue;
    }
    messageParts.push(value);
  }

  return {
    asJson,
    statusOnly,
    threadId: threadId?.trim() || defaultThreadId(),
    message: message ?? messageParts.join(" ").trim()
  };
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  if (args.statusOnly) {
    const existing = await getFrontDoorSessionStatus(args.threadId);
    if (!existing) {
      console.error("No front-door session exists for that thread.");
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      args.asJson ? `${JSON.stringify(existing, null, 2)}\n` : `${existing.status}\n`
    );
    return;
  }

  if (!args.message) {
    console.error("A discovery message is required.");
    console.error(usage);
    process.exitCode = 1;
    return;
  }

  const result = await runFrontDoorDiscoveryTurn({
    threadId: args.threadId,
    message: args.message
  });

  if (args.asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (result.questions.length > 0) {
    process.stdout.write(`${result.questions.map((question, index) => `${index + 1}. ${question}`).join("\n")}\n`);
    return;
  }

  const nextActionLines =
    result.status === "ready_for_prepare"
      ? [
          "Next: run loop:prepare to generate the adapter bundle.",
          "Prepare stops at ready_to_start. After prepare, say '루프 시작' or 'start loop' to run."
        ]
      : result.status === "prepared"
        ? [
            "Session status is ready_to_start.",
            "Say '루프 시작' or 'start loop' to run."
          ]
        : [];

  process.stdout.write(
    [
      result.status,
      "",
      ...(result.preparation_summary ?? []),
      ...(result.preparation_summary?.length ? [""] : []),
      ...(result.adapter_plan_preview ?? []),
      ...(result.adapter_plan_preview?.length ? [""] : []),
      ...nextActionLines
    ]
      .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
      .join("\n") + "\n"
  );
};

main().catch((error: unknown) => {
  console.error("Front-door discovery failed.");
  console.error(error);
  process.exitCode = 1;
});
