import { readFile } from "node:fs/promises";
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

const assertMainEvaluatorPathDoesNotResume = async () => {
  const evaluatorStepSource = await readFile(
    join(repoRoot, "packages", "loop-orchestrator", "src", "loop", "evaluator-step.ts"),
    "utf8"
  );
  assert(
    evaluatorStepSource.includes("enhanceEvalReportWithCodex"),
    "Evaluator step should route round evaluation through the Codex judge path."
  );
  assert(
    !evaluatorStepSource.includes("enhanceEvalReportWithCurrentThread"),
    "Evaluator step must not resume current-thread evaluator enhancement in blind mode."
  );
  assert(
    !evaluatorStepSource.includes("enhanceEvalReportWithAppServer"),
    "Evaluator step must not route evaluator scoring through App Server resume/review state."
  );

  const codexAgentsSource = await readFile(
    join(repoRoot, "packages", "loop-orchestrator", "src", "codex-agents.ts"),
    "utf8"
  );
  const evaluatorFunction = codexAgentsSource.slice(
    codexAgentsSource.indexOf("export const enhanceEvalReportWithCodex"),
    codexAgentsSource.indexOf("export const enhancePlanWithAppServer")
  );
  assert(
    !/sessionId\s*:|resumeLast\s*:/.test(evaluatorFunction),
    "Evaluator Codex command must not pass sessionId or resumeLast."
  );
};

const main = async () => {
  await ensureBuild();
  await assertMainEvaluatorPathDoesNotResume();
  const tempRoot = await createTempRoot("validate-no-evaluator-resume");
  const response = {
    overall_verdict: "revise",
    strengths: [],
    blockers: ["Synthetic current-thread judge response."],
    next_actions: ["Keep the judge fresh."]
  };

  try {
    const { enhanceEvalReportWithCodex } = await importDist("codex-agents.js");
    await withEnv(
      {
        ...fakeCodexEnv(tempRoot, response),
        HARNESS_TRANSPORT: "current-thread"
      },
      async () => {
        const fixture = await runFreshEvaluatorFixture({
          enhanceEvalReportWithCodex,
          tempRoot
        });
        assert(
          fixture.records.length === 1,
          `Expected one fresh evaluator command under current-thread transport, received ${fixture.records.length}.`
        );
        const record = fixture.records[0];
        assert(record.used_resume === false, "Current-thread evaluator judge must not resume.");
        assert(
          !record.argv.includes("resume"),
          "Current-thread evaluator judge must not call `codex exec resume`."
        );
        assert(
          fixture.metadata.disabled === false,
          "Fresh read-only evaluator judge should be allowed under current-thread transport."
        );
        assert(
          fixture.metadata.used_resume === false,
          "Evaluator metadata must record a fresh, non-resumed command."
        );
      }
    );

    console.log("validate:no-evaluator-resume passed");
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

main().catch((error) => {
  console.error("No evaluator resume validation failed.");
  console.error(error);
  process.exitCode = 1;
});
