import { getFrontDoorSessionStatus, runFrontDoorDiscoveryTurn } from "./front-door-session.js";
const usage = "Usage: node ./packages/loop-orchestrator/dist/front-door-session-cli.js [--thread-id <thread-id>] [--status] [--json] [--message <message>]";
const defaultThreadId = () => process.env.CODEX_THREAD_ID?.trim() ||
    process.env.HARNESS_FRONT_DOOR_THREAD_ID?.trim() ||
    "local-codex-thread";
const parseArgs = (argv) => {
    let asJson = false;
    let statusOnly = false;
    let threadId;
    let message;
    const messageParts = [];
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
const main = async () => {
    const args = parseArgs(process.argv.slice(2));
    if (args.statusOnly) {
        const existing = await getFrontDoorSessionStatus(args.threadId);
        if (!existing) {
            console.error("No front-door session exists for that thread.");
            process.exitCode = 1;
            return;
        }
        process.stdout.write(args.asJson ? `${JSON.stringify(existing, null, 2)}\n` : `${existing.status}\n`);
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
    const nextActionLines = result.status === "ready_for_prepare"
        ? result.locale === "ko"
            ? [
                "\uB2E4\uC74C \uB2E8\uACC4: loop:prepare\uB97C \uC2E4\uD589\uD558\uBA74 generated adapter bundle\uC774 \uC0DD\uC131\uB429\uB2C8\uB2E4.",
                "prepare \uD6C4 \uC138\uC158\uC740 ready_to_start\uC5D0\uC11C \uBA48\uCD89\uB2C8\uB2E4. \uB8E8\uD504\uB97C \uC2DC\uC791\uD558\uB824\uBA74 '\uB8E8\uD504 \uC2DC\uC791' \uB610\uB294 'start loop'\uC774\uB77C\uACE0 \uB9D0\uD558\uC138\uC694."
            ]
            : [
                "Next: run loop:prepare to generate the adapter bundle.",
                "Prepare stops at ready_to_start. After prepare, say '루프 시작' or 'start loop' to run."
            ]
        : result.status === "prepared"
            ? result.locale === "ko"
                ? [
                    "\uC138\uC158 \uC0C1\uD0DC\uB294 ready_to_start\uC785\uB2C8\uB2E4.",
                    "\uB8E8\uD504\uB97C \uC2DC\uC791\uD558\uB824\uBA74 '\uB8E8\uD504 \uC2DC\uC791' \uB610\uB294 'start loop'\uC774\uB77C\uACE0 \uB9D0\uD558\uC138\uC694."
                ]
                : [
                    "Session status is ready_to_start.",
                    "Say '루프 시작' or 'start loop' to run."
                ]
            : [];
    process.stdout.write([
        result.status,
        "",
        ...(result.preparation_summary ?? []),
        ...(result.preparation_summary?.length ? [""] : []),
        ...(result.adapter_plan_preview ?? []),
        ...(result.adapter_plan_preview?.length ? [""] : []),
        ...nextActionLines
    ]
        .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
        .join("\n") + "\n");
};
main().catch((error) => {
    console.error("Front-door discovery failed.");
    console.error(error);
    process.exitCode = 1;
});
//# sourceMappingURL=front-door-session-cli.js.map