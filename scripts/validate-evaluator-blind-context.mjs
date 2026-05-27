import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  cleanupTempRoot,
  createTempRoot,
  ensureBuild,
  importDist,
  repoRoot
} from "./testing/bootstrap-validator-helpers.mjs";
import {
  assert,
  fakeCodexEnv,
  runFreshEvaluatorFixture,
  withEnv
} from "./testing/evaluator-blind-fixtures.mjs";

const forbiddenPreviousContextSentinels = [
  "ROUND_1_SECRET_SCORE_0_99",
  "ROUND_1_EVALUATOR_VERDICT_ADVANCE",
  "ROUND_1_SCORECARD_TARGET_REACHED",
  "ROUND_1_EVAL_REPORT_BLOCKER",
  "ROUND_1_PATCH_REQUEST_BODY",
  "ROUND_1_QUALITY_CRITIQUE_BODY"
];

const assertEvaluatorSourceIsBlind = async () => {
  const codexAgentsSource = await readFile(
    join(repoRoot, "packages", "loop-orchestrator", "src", "codex-agents.ts"),
    "utf8"
  );
  const evaluatorFunction = codexAgentsSource.slice(
    codexAgentsSource.indexOf("export const enhanceEvalReportWithCodex"),
    codexAgentsSource.indexOf("export const enhancePlanWithAppServer")
  );
  assert(
    evaluatorFunction.includes("fresh independent evaluator"),
    "Evaluator prompt must identify the judge as fresh and independent."
  );
  assert(
    evaluatorFunction.includes("Blind mode is mandatory"),
    "Evaluator prompt must state blind mode explicitly."
  );
  assert(
    evaluatorFunction.includes("carry_forward_gate"),
    "Evaluator prompt must state that previous patch resolution is separated into carry_forward_gate."
  );
  assert(
    !/input\.(history|previousRoundSummary|scoreDeltas|previousPatchTargetCheckIds|previousPatchRequestAddressed)/.test(
      evaluatorFunction
    ),
    "Evaluator prompt builder must not accept previous round history or carry-forward state."
  );
  assert(
    !/previousPatchRequest|qualityCritiqueArtifact|scorecardPath|evalReportPath/.test(
      evaluatorFunction
    ),
    "Evaluator prompt builder must not load previous patch, critique, scorecard, or eval-report artifacts."
  );

  const evaluatorStepSource = await readFile(
    join(repoRoot, "packages", "loop-orchestrator", "src", "loop", "evaluator-step.ts"),
    "utf8"
  );
  const callStart = evaluatorStepSource.indexOf(
    "const resolvedEvalEnhancement = await enhanceEvalReportWithCodex"
  );
  const callEnd = evaluatorStepSource.indexOf("});", callStart);
  const evaluatorCall = evaluatorStepSource.slice(callStart, callEnd);
  assert(callStart >= 0 && callEnd > callStart, "Could not locate evaluator Codex call.");
  assert(
    !/history|previousRoundSummary|scoreDeltas|previousPatchTargetCheckIds|previousPatchRequestAddressed|patchRequestArtifact|qualityCritiqueArtifact|roundScorecard/.test(
      evaluatorCall
    ),
    "Evaluator Codex call must not pass previous round score, verdict, patch, critique, or scorecard context."
  );
};

const main = async () => {
  await ensureBuild();
  await assertEvaluatorSourceIsBlind();
  const tempRoot = await createTempRoot("validate-evaluator-blind-context");
  const response = {
    overall_verdict: "revise",
    strengths: [],
    blockers: ["Synthetic blind context response."],
    next_actions: []
  };

  try {
    await writeFile(
      join(tempRoot, "previous-round-artifacts.json"),
      JSON.stringify(Object.fromEntries(forbiddenPreviousContextSentinels.map((value) => [value, true]))),
      "utf8"
    );
    const { enhanceEvalReportWithCodex } = await importDist("codex-agents.js");
    await withEnv(
      {
        ...fakeCodexEnv(tempRoot, response),
        HARNESS_TRANSPORT: undefined
      },
      async () => {
        const fixture = await runFreshEvaluatorFixture({
          enhanceEvalReportWithCodex,
          tempRoot
        });
        for (const sentinel of forbiddenPreviousContextSentinels) {
          assert(
            !fixture.prompt.includes(sentinel),
            `Evaluator prompt leaked previous-round sentinel '${sentinel}'.`
          );
        }
        assert(
          fixture.prompt.includes("Do not use, request, infer, or compare against any previous round evaluator response"),
          "Evaluator prompt must explicitly ban previous evaluator context."
        );
        assert(
          fixture.prompt.includes("# Deterministic eval report"),
          "Evaluator may receive only the current deterministic eval report subset."
        );
      }
    );

    console.log("validate:evaluator-blind-context passed");
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

main().catch((error) => {
  console.error("Evaluator blind-context validation failed.");
  console.error(error);
  process.exitCode = 1;
});
