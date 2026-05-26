import { evaluateIntakeRequest, renderIntakeGateResponse } from "./intake-gate.js";
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
        console.error("Usage: node ./packages/loop-orchestrator/dist/intake-gate-cli.js [--json] <request>");
        process.exitCode = 1;
        return;
    }
    const result = evaluateIntakeRequest(args.request);
    if (args.asJson) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
    }
    process.stdout.write(`${renderIntakeGateResponse(result)}\n`);
};
main().catch((error) => {
    console.error("Intake gate failed.");
    console.error(error);
    process.exitCode = 1;
});
//# sourceMappingURL=intake-gate-cli.js.map