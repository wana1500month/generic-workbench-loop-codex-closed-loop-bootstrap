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
    "Usage: node .agents/skills/evaluator-tuning/scripts/prepare-evaluator-tuning.mjs <request>"
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
    const result = evaluateLoopIntent(request);
    process.stdout.write(
      `${JSON.stringify(
        {
          intent: result.intent,
          status: result.status,
          rationale: result.rationale,
          questions: result.questions,
          canonical_surfaces: [
            "evals/verification-profiles",
            "quality_contract",
            "subjective_metrics",
            "light lane",
            "heavy lane",
            "goldens",
            "trigger conditions"
          ]
        },
        null,
        2
      )}\n`
    );
  }
}
