import { strict as assert } from "node:assert";
import { join } from "node:path";

import {
  cleanupTempRoot,
  createTempRoot,
  runCommand,
  writeJsonFile
} from "./testing/bootstrap-validator-helpers.mjs";

const scorecardForRound = (round) => ({
  schema_version: "2026-05-26",
  generated_at: "2026-05-26T00:00:00.000Z",
  round,
  target_reached: round === 2,
  total_score: round === 2 ? 0.94 : 0.84,
  target_total_score: 0.93,
  strictness_level: 4,
  pass_mode: "all_required_dimensions",
  blocking_reasons:
    round === 2
      ? []
      : [
          {
            dimension_id: "design.no_noise_text",
            score: 8.7,
            minimum_score: 9.5,
            reason: "Required dimension below threshold."
          }
        ],
  dimension_scores: [],
  next_round_focus: []
});

const main = async () => {
  const tempRoot = await createTempRoot("validate-loop-scorecards");
  try {
    const runDirectory = join(tempRoot, "run-001");
    await writeJsonFile(
      join(runDirectory, "round-001", "scorecard.json"),
      scorecardForRound(1)
    );
    await writeJsonFile(
      join(runDirectory, "rounds", "round-002", "scorecard.json"),
      scorecardForRound(2)
    );

    const jsonResult = await runCommand(process.execPath, [
      "./scripts/loop-scorecards.mjs",
      "--run-dir",
      runDirectory,
      "--json"
    ]);
    assert.equal(jsonResult.code, 0, jsonResult.stderr);
    const payload = JSON.parse(jsonResult.stdout);
    assert.equal(payload.scorecards.length, 2);
    assert.deepEqual(
      payload.scorecards.map((entry) => entry.scorecard.round),
      [1, 2]
    );
    assert.ok(
      payload.scorecards.some((entry) =>
        entry.path.includes(`${join("run-001", "round-001")}`)
      ),
      "direct run/round-001 scorecard should be listed"
    );
    assert.ok(
      payload.scorecards.some((entry) =>
        entry.path.includes(`${join("run-001", "rounds", "round-002")}`)
      ),
      "nested run/rounds/round-002 scorecard should be listed"
    );

    const textResult = await runCommand(process.execPath, [
      "./scripts/loop-scorecards.mjs",
      "--run-dir",
      runDirectory
    ]);
    assert.equal(textResult.code, 0, textResult.stderr);
    assert.match(textResult.stdout, /Scorecards: 2/u);
    assert.match(textResult.stdout, /Round 1: fail/u);
    assert.match(textResult.stdout, /Round 2: pass/u);
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

await main();
console.log("validate:loop-scorecards passed");
