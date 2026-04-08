import { join, relative } from "node:path";

import { repoRoot, writeText } from "./file-system.js";
import type { LoopPlan, LoopRunSummary, LoopScenario } from "./types.js";

const bulletList = (items: readonly string[]): string =>
  items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- none";

const rel = (path: string | undefined): string =>
  path ? relative(repoRoot, path) : "unavailable";

export const codexHandoffPathForRun = (runDirectory: string): string =>
  join(runDirectory, "codex-handoff.md");

export const writeRunCodexHandoff = async (input: {
  runDirectory: string;
  summary: LoopRunSummary;
  plan: LoopPlan;
  scenario: LoopScenario;
}): Promise<string> => {
  const path = codexHandoffPathForRun(input.runDirectory);
  const latestRound =
    input.summary.round_history?.[input.summary.round_history.length - 1];

  const content = `# Codex Handoff

## Purpose

Continue work on the harness itself. This repository does not ship a bundled adapter or sample product surface.

## Current run

- Run id: ${input.summary.run_id}
- Scenario: ${input.scenario.title}
- Executor mode: ${input.summary.executor_mode ?? "harness"}
- Target family: ${input.summary.target_family ?? "none"}
- Validation lane: ${input.summary.validation_lane ?? "none"}
- Evaluator bundle: ${rel(input.summary.evaluator_profile_path)}
- Resume identity: ${rel(input.summary.resume_identity_path)}
- Terminal attempt: ${input.summary.terminal_round ?? "unknown"}
- Best-scoring attempt: ${input.summary.best_round ?? "unknown"}
- Latest trajectory mode: ${latestRound?.trajectory.mode ?? "none"}
- Latest trajectory restart_from: ${latestRound?.trajectory.restart_from ?? "none"}
- Terminal control-plane score: ${input.summary.control_plane_score.toFixed(3)}
- Terminal proof score: ${input.summary.proof_score.toFixed(3)}
- Terminal release score: ${input.summary.release_score.toFixed(3)}
- Best control-plane score: ${(input.summary.best_scoring_control_plane_score ?? input.summary.control_plane_score).toFixed(3)}
- Best proof score: ${(input.summary.best_scoring_proof_score ?? input.summary.proof_score).toFixed(3)}
- Best release score: ${(input.summary.best_scoring_release_score ?? input.summary.release_score).toFixed(3)}
- Stop reason: ${input.summary.stop_reason ?? "none"}
- Adapter attached: ${input.summary.adapter_attached ? "yes" : "no"}

## Primary files

- Idea: ${rel(input.summary.idea_path)}
- Feature ledger: ${rel(input.summary.feature_list_path)}
- Progress log: ${rel(input.summary.progress_path)}
- Progress journal: ${rel(input.summary.progress_log_path)}
- Done-when: ${rel(input.summary.done_when_path)}
- Init script: ${rel(input.summary.init_script_path)}
- Planned scenario: ${rel(input.summary.planned_scenario_path)}
- Plan: ${rel(input.summary.plan_path)}
- Planner brief: ${rel(input.summary.planner_brief_path)}
- Latest attempt contract: ${rel(latestRound?.contract_path)}
- Latest contract review: ${rel(latestRound?.contract_review_path)}
- Latest contract agreement: ${rel(latestRound?.contract_agreement_path)}
- Latest generator plan: ${rel(latestRound?.generator_plan_path)}
- Latest evaluator verdict: ${rel(latestRound?.evaluator_verdict_path)}
- Latest patch request: ${rel(latestRound?.patch_request_path)}
- Latest trajectory decision: ${rel(latestRound?.trajectory_decision_path)}
- Latest eval report: ${rel(latestRound?.eval_report_path)}
- Latest QA review: ${rel(latestRound?.qa_review_path)}

## What this repo owns

${bulletList([
  "Idea intake from IDEA.md",
  "Planning and remediation-driven build/evaluator flow",
  "File-based generator and evaluator protocol",
  "Codex handoff and controller summaries",
  "External adapter capability boundary"
])}

## What this repo does not own

${bulletList([
  "A bundled product UI",
  "Fixture content for a specific domain",
  "Direct ownership of an external target repository",
  "Adapter-specific generation logic that should live outside the core"
])}

## Suggested next actions

1. Keep the harness generic and file-driven.
2. Treat the latest patch request as the highest-priority follow-up.
3. If adapter proof is desired, configure the external adapter boundary rather than rebuilding a sample app inside this repo.

## Runtime Warnings

${bulletList(input.summary.runtime_warnings ?? [])}

## Resume Migration

- Migrated: ${input.summary.bundle_migrated ? "yes" : "no"}
- Resume identity artifact: ${rel(input.summary.resume_identity_path)}
- Migration artifact: ${rel(input.summary.resume_migration_path)}

## Build Strategy

- Strategy: ${input.plan.attempt_strategy}
- Planner focus areas: ${input.plan.planner_focus_areas.join(", ")}

## Initial Acceptance Checks

${bulletList(input.plan.planner_acceptance_checks)}

## Remediation Policy

${bulletList(input.plan.remediation_policy)}
`;

  await writeText(path, content);
  return path;
};
