import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureDistModule } from "../../lib/ensure-dist.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const request = process.argv.slice(2).join(" ").trim();

if (!request) {
  console.error(
    "Usage: node .agents/skills/product-intake/scripts/run-product-intake.mjs <request>"
  );
  process.exitCode = 1;
} else {
  const dist = await ensureDistModule(
    repoRoot,
    "packages/loop-orchestrator/dist/intake-gate.js"
  );
  if (!dist.ok) {
    console.error(dist.message);
    process.exitCode = 1;
  }

  if (process.exitCode !== 1) {
    const { evaluateIntakeRequest } = await import(pathToFileURL(dist.distModulePath).href);
    process.stdout.write(`${JSON.stringify(evaluateIntakeRequest(request), null, 2)}\n`);
  }
}
