import {
  cleanupTempRoot,
  createTempRoot,
  ensureBuild,
  importDist
} from "./testing/bootstrap-validator-helpers.mjs";
import {
  assert,
  fakeCodexEnv,
  runFreshEvaluatorFixture,
  withEnv
} from "./testing/evaluator-blind-fixtures.mjs";

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-evaluator-freshness");
  const response = {
    overall_verdict: "hold",
    strengths: ["Fresh judge inspected only current evidence."],
    blockers: ["Synthetic current-round blocker."],
    next_actions: ["Keep judging independently."]
  };

  try {
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
        assert(
          fixture.records.length === 1,
          `Expected exactly one evaluator Codex command, received ${fixture.records.length}.`
        );
        const record = fixture.records[0];
        assert(record.used_resume === false, "Evaluator must use a fresh Codex command.");
        assert(
          !record.argv.includes("resume"),
          "Evaluator command must not call `codex exec resume`."
        );
        assert(
          record.argv.includes("exec"),
          "Evaluator command should invoke `codex exec`."
        );
        assert(
          record.argv.includes("--output-schema"),
          "Fresh evaluator command should pass the structured output schema."
        );
        assert(
          record.argv.includes("--add-dir") &&
            record.argv.includes(fixture.roundDirectory),
          "Fresh evaluator command should add only the current round directory."
        );

        const policy = fixture.metadata.effective_policy;
        assert(policy.used_resume === false, "Evaluator metadata must record used_resume=false.");
        assert(policy.sandbox_mode === "read-only", "Evaluator must run in read-only sandbox mode.");
        assert(policy.approval_policy === "never", "Evaluator must run with approval_policy=never.");
        assert(policy.network_access === false, "Evaluator read-only judge must disable network access.");
        assert(
          fixture.metadata.metadata?.role === "judge",
          "Evaluator metadata role must be judge."
        );
        assert(
          fixture.metadata.metadata?.stage === "fresh_independent_eval_report_review",
          "Evaluator metadata stage must describe a fresh independent review."
        );
        assert(
          fixture.metadata.metadata?.evaluator_mode === "per_round_blind",
          "Evaluator metadata must mark per_round_blind mode."
        );
        assert(
          fixture.prompt.includes("You are a fresh independent evaluator"),
          "Evaluator prompt must state the fresh independent evaluator principle."
        );
      }
    );

    console.log("validate:evaluator-freshness passed");
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

main().catch((error) => {
  console.error("Evaluator freshness validation failed.");
  console.error(error);
  process.exitCode = 1;
});
