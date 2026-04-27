import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureDistModule } from "../../lib/ensure-dist.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const request = process.argv.slice(2).join(" ").trim();

if (!request) {
  console.error(
    "Usage: node .agents/skills/harness-design/scripts/prepare-harness-design.mjs <request>"
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
    const result = evaluateLoopIntent(request);
    process.stdout.write(
      `${JSON.stringify(
        {
          intent: result.intent,
          status: result.status,
          rationale: result.rationale,
          questions: result.questions,
          canonical_surfaces: [
            "AGENTS.md",
            "RUNBOOK.md",
            "packages/loop-orchestrator/src/intent-gate.ts",
            ".agents/skills",
            "feature_list.generated.json",
            "progress.jsonl",
            "done_when.md",
            "init.sh"
          ]
        },
        null,
        2
      )}\n`
    );
  }
}
