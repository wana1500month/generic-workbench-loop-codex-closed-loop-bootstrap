import { evaluateLoopIntent, renderLoopIntentResponse } from "./intent-gate.js";
const parseArgs = (argv) => {
    let asJson = false;
    const requestParts = [];
    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index];
        if (value === "--json") {
            asJson = true;
            continue;
        }
        requestParts.push(value);
    }
    return {
        asJson,
        request: requestParts.join(" ").trim()
    };
};
const main = async () => {
    const args = parseArgs(process.argv.slice(2));
    if (!args.request) {
        console.error("Usage: node ./packages/loop-orchestrator/dist/intent-gate-cli.js [--json] <request>");
        process.exitCode = 1;
        return;
    }
    const result = evaluateLoopIntent(args.request);
    if (args.asJson) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
    }
    process.stdout.write(`${renderLoopIntentResponse(result)}\n`);
};
main().catch((error) => {
    console.error("Intent gate failed.");
    console.error(error);
    process.exitCode = 1;
});
//# sourceMappingURL=intent-gate-cli.js.map