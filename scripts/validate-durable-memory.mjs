import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  detectDurableMemoryPaths,
  ensureDurableMemoryArtifacts,
  loadDurableMemoryContext,
  scaffoldDurableMemoryArtifacts
} from "../packages/loop-orchestrator/dist/durable-memory.js";

const rootDirectory = await mkdtemp(join(tmpdir(), "durable-memory-"));

try {
  const ideaPath = join(rootDirectory, "IDEA.md");
  await writeFile(ideaPath, "# Placeholder\n", "utf8");
  await writeFile(
    join(rootDirectory, "intake.json"),
    JSON.stringify(
      {
        product_title: "Harness router hardening",
        product_summary: "Improve bilingual routing and durable memory persistence.",
        core_features: [
          "Route Korean harness-design requests into the harness lane",
          "Keep evaluator-themed product builds in product intake"
        ],
        finish_line: "The front-door router reliably separates product builds from harness work.",
        quality_bar: [
          "Bilingual regression fixtures stay green.",
          "Durable memory files exist before closeout."
        ],
        constraints: ["Harness-only repository"],
        target_score: 0.92,
        max_rounds: 4,
        must_not_break: ["Existing product-build intake behavior"]
      },
      null,
      2
    ),
    "utf8"
  );

  const { rootDirectory: loadedRoot, context } = await loadDurableMemoryContext({
    title: "Fallback title",
    summary: "Fallback summary",
    user_goals: ["Fallback workflow"],
    constraints: ["Fallback constraint"],
    quality_bar: ["Fallback quality bar"],
    source_path: ideaPath
  });

  assert.equal(loadedRoot, rootDirectory);
  assert.equal(context.title, "Harness router hardening");
  assert.equal(
    context.finishLine,
    "The front-door router reliably separates product builds from harness work."
  );
  assert.equal(context.targetScore, 0.92);
  assert.equal(context.maxRounds, 4);

  const paths = await scaffoldDurableMemoryArtifacts(rootDirectory, context);
  const ledger = JSON.parse(await readFile(paths.feature_list_path, "utf8"));
  const progress = await readFile(paths.progress_path, "utf8");
  const progressLog = await readFile(paths.progress_log_path, "utf8");
  const doneWhen = await readFile(paths.done_when_path, "utf8");
  const initScript = await readFile(paths.init_script_path, "utf8");

  assert.equal(ledger.format_version, "feature-ledger.v1");
  assert.equal(ledger.product_title, "Harness router hardening");
  assert.ok(
    ledger.items.some((item) => item.feature_id === "finish-line"),
    "finish-line item should exist"
  );
  assert.match(progress, /feature_list\.generated\.json/);
  assert.match(progress, /progress\.jsonl/);
  assert.match(progressLog, /"event":"memory_scaffolded"/);
  assert.match(doneWhen, /The front-door router reliably separates product builds from harness work\./);
  assert.match(doneWhen, /Target score: 0\.92/);
  assert.match(initScript, /npm run loop:intent/);

  const detected = await detectDurableMemoryPaths(rootDirectory);
  assert.equal(detected.feature_list_path, paths.feature_list_path);
  assert.equal(detected.progress_path, paths.progress_path);
  assert.equal(detected.progress_log_path, paths.progress_log_path);
  assert.equal(detected.done_when_path, paths.done_when_path);
  assert.equal(detected.init_script_path, paths.init_script_path);

  await unlink(paths.progress_path);
  await unlink(paths.progress_log_path);
  const ensured = await ensureDurableMemoryArtifacts(rootDirectory, context);
  const restoredProgress = await readFile(ensured.progress_path, "utf8");
  const restoredProgressLog = await readFile(ensured.progress_log_path, "utf8");
  assert.match(restoredProgress, /## Next Actions/);
  assert.match(restoredProgressLog, /"status":"bootstrapped"/);

  console.log("validate:durable-memory passed");
} finally {
  await rm(rootDirectory, { recursive: true, force: true });
}
