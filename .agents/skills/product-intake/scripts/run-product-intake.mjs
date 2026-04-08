import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const request = process.argv.slice(2).join(" ").trim();
const distModulePath = resolve(
  repoRoot,
  "packages/loop-orchestrator/dist/intake-gate.js"
);

if (!request) {
  console.error(
    "Usage: node .agents/skills/product-intake/scripts/run-product-intake.mjs <request>"
  );
  process.exitCode = 1;
} else {
  try {
    await access(distModulePath, constants.F_OK);
  } catch {
    console.error(
      "Missing packages/loop-orchestrator/dist/intake-gate.js. Build the repository first."
    );
    process.exitCode = 1;
  }

  if (process.exitCode !== 1) {
    const { evaluateIntakeRequest } = await import(pathToFileURL(distModulePath).href);
    process.stdout.write(`${JSON.stringify(evaluateIntakeRequest(request), null, 2)}\n`);
  }
}
