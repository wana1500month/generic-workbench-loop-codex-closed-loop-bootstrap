import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureDistModule } from "../../lib/ensure-dist.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const request = process.argv.slice(2).join(" ").trim();

if (!request) {
  console.error(
    "Usage: node .agents/skills/intent-router/scripts/route-intent.mjs <request>"
  );
  process.exitCode = 1;
} else {
  const dist = await ensureDistModule(
    repoRoot,
    "packages/loop-orchestrator/dist/intent-gate.js"
  );
  if (!dist.ok) {
    console.error(dist.message);
    process.exitCode = 1;
  }

  if (process.exitCode !== 1) {
    const { evaluateLoopIntent } = await import(pathToFileURL(dist.distModulePath).href);
    process.stdout.write(`${JSON.stringify(evaluateLoopIntent(request), null, 2)}\n`);
  }
}
