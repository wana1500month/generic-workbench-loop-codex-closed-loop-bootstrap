import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { readJsonFile, repoRoot } from "./bootstrap-validator-helpers.mjs";

export const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

export const withEnv = async (updates, callback) => {
  const keys = Object.keys(updates);
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await callback();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
};

export const fakeCodexEnv = (tempRoot, response, recordName = "codex-records.json") => ({
  HARNESS_CODEX_BIN: process.execPath,
  HARNESS_CODEX_BIN_ARGS: JSON.stringify([
    join(repoRoot, "scripts", "testing", "fake-codex.mjs")
  ]),
  FAKE_CODEX_MODE: "success",
  FAKE_CODEX_RECORD_PATH: join(tempRoot, recordName),
  FAKE_CODEX_RESPONSE: JSON.stringify(response),
  HARNESS_DISABLE_CODEX_AGENTS: undefined,
  HARNESS_DISABLE_CODEX_EVALUATOR: undefined
});

export const fixtureIdea = () => ({
  title: "Blind evaluator validator",
  summary: "Validate the evaluator with current-round evidence only.",
  user_goals: ["Keep evaluator scoring independent per round."],
  constraints: ["Do not inspect previous round evaluator outputs."],
  quality_bar: ["Fresh read-only judge prompt is blind to previous scoring."]
});

export const fixtureContract = (round = 2) => ({
  schema_version: "2026-05-27",
  artifact_type: "round_contract",
  run_id: "run-blind-validator",
  contract_id: `blind-validator-contract-r${round}`,
  round,
  created_at: "2026-05-27T00:00:00.000Z",
  producer: "validator",
  negotiation_mode: round === 1 ? "full_negotiation" : "patch_only",
  continuation_authority: round === 1 ? "planner_contract" : "patch_request",
  objective: "Judge only the current round fixture evidence.",
  rewrite_scope: "targeted",
  focus_areas: ["qa_rigor", "artifact_handoff"],
  acceptance_checks: [
    "round_contract_written",
    "generator_plan_written",
    "release_blockers_recorded"
  ],
  release_gate_check_ids: [],
  proof_plan: ["Use the current round deterministic fixtures only."],
  pivot_triggers: ["Current evidence remains blocked."],
  required_artifacts: ["round-contract.json", "generator-plan.json", "eval_report.json"],
  non_goals: ["Do not compare this round against previous evaluator scores."],
  carry_over_context: [],
  carry_over_check_ids: ["release_blockers_recorded"]
});

export const fixtureGeneratorPlan = (round = 2) => ({
  contract_id: `blind-validator-contract-r${round}`,
  agreement_id: `blind-validator-contract-r${round}-agreement`,
  generator_plan_id: `blind-validator-contract-r${round}-generator-plan`,
  round,
  implementation_intent: "Make the current round artifacts reviewable.",
  target_check_ids: ["release_blockers_recorded"],
  files_to_touch: ["packages/loop-orchestrator/src/loop/evaluator-step.ts"],
  expected_proof: ["Fresh judge metadata and carry-forward gate artifact."],
  risk_notes: ["Previous round score must not be visible to the evaluator."],
  out_of_scope: ["Historical evaluator scoring."],
  adapter_actions: []
});

export const fixtureEvalReport = (round = 2, overrides = {}) => ({
  generated_at: "2026-05-27T00:00:00.000Z",
  round,
  total_score: 0.42,
  control_plane_score: 0.7,
  proof_score: 0,
  release_score: 0.42,
  overall_verdict: "revise",
  strengths: ["Current round contract exists."],
  blockers: ["Current round release blockers remain open."],
  next_actions: ["Close current round release blockers."],
  evidence_paths: [],
  threshold_gap_details: ["Current round release score is below target."],
  check_results: [
    {
      check_id: "round_contract_written",
      status: "pass",
      detail: "The current round contract exists."
    },
    {
      check_id: "generator_plan_written",
      status: "pass",
      detail: "The current generator plan exists."
    },
    {
      check_id: "release_blockers_recorded",
      status: "fail",
      detail: "The current round still has a release blocker."
    }
  ],
  resolved_check_ids: ["round_contract_written", "generator_plan_written"],
  unresolved_check_ids: ["release_blockers_recorded"],
  adapter_attached: false,
  threshold_results: {
    contract_completed: false,
    minimum_control_plane_score_met: true,
    minimum_proof_score_met: true,
    minimum_release_score_met: false,
    adapter_required_met: true,
    grade_score_required_met: true,
    core_probe_required_met: true,
    dimension_thresholds_met: true,
    target_reached_eligible: false
  },
  dimension_scores: [],
  adapter_results: [],
  core_probe_results: [],
  ...overrides
});

export const runFreshEvaluatorFixture = async ({
  enhanceEvalReportWithCodex,
  tempRoot,
  round = 2,
  recordName = "codex-records.json"
}) => {
  const roundDirectory = join(tempRoot, `round-${String(round).padStart(3, "0")}`);
  await mkdir(roundDirectory, { recursive: true });
  const artifactDirectory = join(roundDirectory, "codex-agents");

  const result = await enhanceEvalReportWithCodex({
    roundDirectory,
    idea: fixtureIdea(),
    contractArtifact: fixtureContract(round),
    generatorPlanArtifact: fixtureGeneratorPlan(round),
    evalReport: fixtureEvalReport(round),
    adapterExecutions: [],
    coreProbeResults: [],
    targetManifest: undefined,
    executorMode: "harness"
  });

  const metadataPath = join(artifactDirectory, "evaluator-metadata.json");
  const promptPath = join(artifactDirectory, "evaluator-prompt.md");
  const recordPath = join(tempRoot, recordName);

  return {
    result,
    roundDirectory,
    artifactDirectory,
    metadataPath,
    promptPath,
    responsePath: join(artifactDirectory, "evaluator-response.json"),
    metadata: await readJsonFile(metadataPath),
    prompt: await readFile(promptPath, "utf8"),
    records: await readJsonFile(recordPath)
  };
};
