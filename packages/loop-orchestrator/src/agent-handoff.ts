import { join } from "node:path";

import type {
  ContractAgreementArtifact,
  ContractReviewArtifact,
  EvalReport,
  FailureLineage,
  IdeaBrief,
  LoopPlan,
  LoopRunSummary,
  LoopScenario,
  PatchRequestArtifact,
  QualityCritiqueArtifact,
  TrajectoryDecisionArtifact,
  RoundArtifacts
} from "./types.js";
import { writeText } from "./file-system.js";
import { artifactsForRound } from "./protocol-artifacts.js";

const bulletList = (items: readonly string[]): string =>
  items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- none";

const dimensionScoreList = (
  dimensions: readonly NonNullable<EvalReport["dimension_scores"]>[number][]
): string =>
  dimensions.length > 0
    ? dimensions
        .map(
          (dimension) =>
            `- ${dimension.label}: ${dimension.score.toFixed(3)} / min ${dimension.minimum_score.toFixed(3)} (${dimension.passed ? "pass" : dimension.applicable ? "fail" : "n/a"})`
        )
        .join("\n")
    : "- none";

export const plannerBriefPathForRun = (runDirectory: string): string =>
  join(runDirectory, "planner-brief.md");

export const writeRunPlannerBrief = async (input: {
  runDirectory: string;
  idea: IdeaBrief;
  scenario: LoopScenario;
  plan: LoopPlan;
}): Promise<string> => {
  const path = plannerBriefPathForRun(input.runDirectory);
  const content = `# Planner Brief

## Idea

${input.idea.summary}

## User Goals

${bulletList(input.scenario.user_goals)}

## Acceptance Highlights

${bulletList(input.scenario.acceptance_highlights)}

## North Star

${input.plan.north_star}

## Planner Notes

${bulletList(input.plan.planner_notes)}

## Build Strategy

- Strategy: ${input.plan.attempt_strategy}
- Focus areas: ${input.plan.planner_focus_areas.join(", ")}

## Initial Acceptance Checks

${bulletList(input.plan.planner_acceptance_checks)}

## Remediation Policy

${bulletList(input.plan.remediation_policy)}
`;

  await writeText(path, content);
  return path;
};

export const writeRoundHandoff = async (input: {
  roundDirectory: string;
  scenario: LoopScenario;
  round: number;
  contractReview: ContractReviewArtifact;
  contractAgreement: ContractAgreementArtifact;
  evalReport: EvalReport;
  patchRequest: PatchRequestArtifact;
  qualityCritique: QualityCritiqueArtifact;
  trajectoryDecision: TrajectoryDecisionArtifact;
  failureLineage?: FailureLineage;
  executorMode?: LoopRunSummary["executor_mode"];
  targetFamily?: LoopRunSummary["target_family"];
  validationLane?: LoopRunSummary["validation_lane"];
  decisionSource?: NonNullable<
    LoopRunSummary["round_history"]
  >[number]["decision_source"];
  previousPatchRequestAddressed: boolean;
  previousPatchRequestResolved: boolean;
  stopReason?: string;
}): Promise<RoundArtifacts> => {
  const artifacts = artifactsForRound(input.roundDirectory);

  await Promise.all([
    writeText(
      artifacts.planner_context_path,
      `# Planner Context

## Scenario

${input.scenario.title}

${input.scenario.description}

## Current attempt

- Attempt: ${input.round}
- Negotiation decision: ${input.contractReview.decision}
- Agreement status: ${input.contractAgreement.status}
- Previous patch addressed: ${input.previousPatchRequestAddressed ? "yes" : "no"}
- Previous patch resolved: ${input.previousPatchRequestResolved ? "yes" : "no"}
- Executor mode: ${input.executorMode ?? "harness"}
- Target family: ${input.targetFamily ?? "none"}
- Validation lane: ${input.validationLane ?? "none"}
- Decision source: ${input.decisionSource ?? "none"}
- Quality critique: ${artifacts.quality_critique_json_path}
- Trajectory decision: ${artifacts.trajectory_decision_json_path}
- Round contract: ${artifacts.contract_json_path}
- Control-plane score: ${input.evalReport.control_plane_score.toFixed(3)}
- Proof score: ${input.evalReport.proof_score.toFixed(3)}
- Release score: ${input.evalReport.release_score.toFixed(3)}
- Dimension thresholds met: ${input.evalReport.threshold_results.dimension_thresholds_met ? "yes" : "no"}
`
    ),
    writeText(
      artifacts.generator_brief_path,
      `# Generator Brief

The repository is harness-only. Continue from the negotiated contract rather than inventing a hidden target.

## Agreement

${bulletList(input.contractAgreement.generator_must_deliver)}

## Attempt Contract

- Path: ${artifacts.contract_json_path}
- Target-eligible: ${input.evalReport.threshold_results.target_reached_eligible ? "yes" : "no"}
- Dimension thresholds met: ${input.evalReport.threshold_results.dimension_thresholds_met ? "yes" : "no"}
- Remediation strategy: ${input.patchRequest.remediation_strategy ?? input.qualityCritique.remediation_strategy}
- Trajectory mode: ${input.trajectoryDecision.mode}
- Restart from: ${input.trajectoryDecision.restart_from}
- Quality critique: ${artifacts.quality_critique_json_path}

## Immediate patch request

${bulletList(input.patchRequest.must_fix.map((item) => item.expected_change))}

## Preserve Signals

${bulletList(input.patchRequest.must_preserve)}

## Quality Focus

${bulletList(input.qualityCritique.quality_focus)}

## Trajectory

- Mode: ${input.trajectoryDecision.mode}
- Restart from: ${input.trajectoryDecision.restart_from}
- Novelty target: ${input.trajectoryDecision.novelty_target.toFixed(2)}
- Reason: ${input.trajectoryDecision.reason}
- Discardable surface: ${input.trajectoryDecision.discardable_surface.join("; ") || "none"}

## Bundle semantics

- Executor mode: ${input.executorMode ?? "harness"}
- Target family: ${input.targetFamily ?? "none"}
- Validation lane: ${input.validationLane ?? "none"}
- Decision source: ${input.decisionSource ?? "none"}

## Environment blockers

${bulletList(input.patchRequest.environment_blockers ?? [])}
`
    ),
    writeText(
      artifacts.qa_review_path,
      `# QA Review

## Verdict

${input.evalReport.overall_verdict}

## Score Breakdown

- Executor mode: ${input.executorMode ?? "harness"}
- Target family: ${input.targetFamily ?? "none"}
- Control-plane: ${input.evalReport.control_plane_score.toFixed(3)}
- Proof: ${input.evalReport.proof_score.toFixed(3)}
- Release: ${input.evalReport.release_score.toFixed(3)}
- Target eligible: ${input.evalReport.threshold_results.target_reached_eligible ? "yes" : "no"}
- Dimension thresholds met: ${input.evalReport.threshold_results.dimension_thresholds_met ? "yes" : "no"}
- Validation lane: ${input.validationLane ?? "none"}
- Decision source: ${input.decisionSource ?? "none"}

## Dimension Floors

${dimensionScoreList(input.evalReport.dimension_scores)}

## Blockers

${bulletList(input.evalReport.blockers)}

## Next Actions

${bulletList(input.evalReport.next_actions)}

## Structured Critique

${bulletList(
        input.qualityCritique.findings.map(
          (finding) =>
            `${finding.category}/${finding.severity}: ${finding.expected_change}`
        )
      )}

## Trajectory

- Mode: ${input.trajectoryDecision.mode}
- Restart from: ${input.trajectoryDecision.restart_from}
- Selected round: ${input.trajectoryDecision.selected_round ?? "current_head"}
- Frontier: current=${input.trajectoryDecision.frontier.current_head}, last_stable=${input.trajectoryDecision.frontier.last_stable ?? "none"}, best_passing=${input.trajectoryDecision.frontier.best_passing ?? "none"}

## Failure Lineage

- Classification: ${input.failureLineage?.failure_classification ?? "none"}
- Unresolved signature: ${input.failureLineage?.unresolved_signature ?? "none"}
- Environment-blocked probes: ${(input.failureLineage?.environment_blocked_probe_ids ?? []).join(", ") || "none"}
- Release regressions: ${(input.failureLineage?.release_regression_ids ?? []).join(", ") || "none"}

## Negotiation Concerns

${bulletList(input.contractReview.concerns)}
`
    ),
    writeText(
      artifacts.controller_decision_path,
      `# Controller Decision

- Attempt: ${input.round}
- Decision: ${input.evalReport.overall_verdict}
- Patch next action: ${input.patchRequest.next_action}
- Previous patch addressed: ${input.previousPatchRequestAddressed ? "yes" : "no"}
- Previous patch resolved: ${input.previousPatchRequestResolved ? "yes" : "no"}
- Executor mode: ${input.executorMode ?? "harness"}
- Target family: ${input.targetFamily ?? "none"}
- Validation lane: ${input.validationLane ?? "none"}
- Decision source: ${input.decisionSource ?? "none"}
- Release score: ${input.evalReport.release_score.toFixed(3)}
- Target eligible: ${input.evalReport.threshold_results.target_reached_eligible ? "yes" : "no"}
- Dimension thresholds met: ${input.evalReport.threshold_results.dimension_thresholds_met ? "yes" : "no"}
- Remediation strategy: ${input.patchRequest.remediation_strategy ?? input.qualityCritique.remediation_strategy}
- Trajectory mode: ${input.trajectoryDecision.mode}
- Restart from: ${input.trajectoryDecision.restart_from}
- Trajectory decision: ${artifacts.trajectory_decision_json_path}
- Round contract: ${artifacts.contract_json_path}
- Quality critique: ${artifacts.quality_critique_json_path}
- Failure classification: ${input.failureLineage?.failure_classification ?? "none"}
- Environment blockers: ${(input.patchRequest.environment_blockers ?? []).join(", ") || "none"}
- Reason: ${input.stopReason ?? "continue"}
`
    )
  ]);

  return artifacts;
};

export const writeRoundHandoffPlaceholders = async (input: {
  roundDirectory: string;
}): Promise<RoundArtifacts> => {
  const artifacts = artifactsForRound(input.roundDirectory);

  await Promise.all([
    writeText(artifacts.planner_context_path, "# Planner Context\n\nPending final handoff.\n"),
    writeText(artifacts.generator_brief_path, "# Generator Brief\n\nPending final handoff.\n"),
    writeText(artifacts.qa_review_path, "# QA Review\n\nPending final handoff.\n"),
    writeText(artifacts.controller_decision_path, "# Controller Decision\n\nPending final handoff.\n")
  ]);

  return artifacts;
};

export const writeRunControllerSummary = async (input: {
  runDirectory: string;
  summary: LoopRunSummary;
}): Promise<string> => {
  const path = join(input.runDirectory, "controller-summary.md");
  const latestRound =
    input.summary.round_history?.[input.summary.round_history.length - 1];
  await writeText(
    path,
      `# Controller Summary

- Run id: ${input.summary.run_id}
- Attempts written: ${input.summary.round_count}
- Controller mode: ${input.summary.controller_mode ?? "detached"}
- Transport: ${input.summary.transport_mode ?? "codex-exec"}
- Executor mode: ${input.summary.executor_mode ?? "harness"}
- Target family: ${input.summary.target_family ?? "none"}
- Validation lane: ${input.summary.validation_lane ?? "none"}
- Evaluator bundle: ${input.summary.evaluator_profile_path ?? "none"}
- Resume identity: ${input.summary.resume_identity_path ?? "none"}
- Transport state: ${input.summary.transport_state_path ?? "none"}
- Stop reason: ${input.summary.stop_reason ?? "none"}
- Terminal attempt: ${input.summary.terminal_round ?? "none"}
- Best-scoring attempt: ${input.summary.best_round ?? "none"}
- Terminal trajectory: ${latestRound?.trajectory.mode ?? "none"}
- Terminal restart_from: ${latestRound?.trajectory.restart_from ?? "none"}
- Terminal control-plane score: ${input.summary.control_plane_score.toFixed(3)}
- Terminal proof score: ${input.summary.proof_score.toFixed(3)}
- Terminal release score: ${input.summary.release_score.toFixed(3)}
- Terminal dimension thresholds met: ${input.summary.threshold_results?.dimension_thresholds_met ? "yes" : "no"}
- Best control-plane score: ${(input.summary.best_scoring_control_plane_score ?? input.summary.control_plane_score).toFixed(3)}
- Best proof score: ${(input.summary.best_scoring_proof_score ?? input.summary.proof_score).toFixed(3)}
- Best release score: ${(input.summary.best_scoring_release_score ?? input.summary.release_score).toFixed(3)}

## Terminal Dimension Floors

${dimensionScoreList(input.summary.dimension_scores ?? [])}

## Runtime Warnings

${bulletList(input.summary.runtime_warnings ?? [])}

## Resume Migration

- Migrated: ${input.summary.bundle_migrated ? "yes" : "no"}
- Resume identity artifact: ${input.summary.resume_identity_path ?? "none"}
- Migration artifact: ${input.summary.resume_migration_path ?? "none"}
`
  );
  return path;
};
