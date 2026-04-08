import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const request = process.argv.slice(2).join(" ").trim();
const distModulePath = resolve(
  repoRoot,
  "packages/loop-orchestrator/dist/intent-gate.js"
);

if (!request) {
  console.error(
    "Usage: node .agents/skills/intent-router/scripts/route-intent.mjs <request>"
  );
  process.exitCode = 1;
} else {
  try {
    await access(distModulePath, constants.F_OK);
  } catch {
    console.error(
      "Missing packages/loop-orchestrator/dist/intent-gate.js. Build the repository first."
    );
    process.exitCode = 1;
  }

  if (process.exitCode !== 1) {
    const { evaluateLoopIntent } = await import(pathToFileURL(distModulePath).href);
    process.stdout.write(`${JSON.stringify(evaluateLoopIntent(request), null, 2)}\n`);
  }
}
