import { join } from "node:path";

import { writeRunControllerSummary } from "../agent-handoff.js";
import { writeJson } from "../file-system.js";
import type { LoopRunSummary } from "../types.js";
import type { RunCheckpointCurrentBest } from "./run-summary-finalization.js";

export const writeRunCheckpoint = async (input: {
  runDirectory: string;
  summary: LoopRunSummary;
  currentBest: RunCheckpointCurrentBest;
}): Promise<void> => {
  const normalizedSummary: LoopRunSummary =
    input.summary.operator_surface_path &&
    input.summary.session_status_path &&
    input.summary.session_status_events_path &&
    input.summary.session_stream_path
      ? input.summary
      : {
          ...input.summary,
          operator_surface_path:
            input.summary.operator_surface_path ??
            join(input.runDirectory, "runtime", "operator-surface.json"),
          session_status_path:
            input.summary.session_status_path ??
            join(input.runDirectory, "runtime", "session-status.json"),
          session_status_events_path:
            input.summary.session_status_events_path ??
            join(input.runDirectory, "runtime", "session-status-events.jsonl"),
          session_stream_path:
            input.summary.session_stream_path ??
            join(input.runDirectory, "runtime", "session-stream.json")
        };
  const writes: Promise<unknown>[] = [
    writeJson(join(input.runDirectory, "summary.json"), normalizedSummary),
    writeRunControllerSummary({
      runDirectory: input.runDirectory,
      summary: normalizedSummary
    })
  ];

  if (normalizedSummary.terminal_round !== undefined) {
    writes.push(
      writeJson(join(input.runDirectory, "current_best.json"), {
        round: input.currentBest.round ?? normalizedSummary.terminal_round,
        selection_basis: "terminal_round",
        total_score: input.currentBest.totalScore ?? normalizedSummary.total_score,
        control_plane_score:
          input.currentBest.controlPlaneScore ?? normalizedSummary.control_plane_score,
        proof_score: input.currentBest.proofScore ?? normalizedSummary.proof_score,
        release_score: input.currentBest.releaseScore ?? normalizedSummary.release_score,
        threshold_results:
          input.currentBest.thresholdResults ?? normalizedSummary.threshold_results,
        dimension_scores:
          input.currentBest.dimensionScores ?? normalizedSummary.dimension_scores,
        patch_request_path: input.currentBest.patchRequestPath,
        eval_report_path: input.currentBest.evalReportPath,
        best_scoring_round:
          input.currentBest.bestScoringRound ?? normalizedSummary.best_round,
        best_scoring_total_score:
          input.currentBest.bestScoringTotalScore ??
          normalizedSummary.best_scoring_total_score,
        best_scoring_control_plane_score:
          input.currentBest.bestScoringControlPlaneScore ??
          normalizedSummary.best_scoring_control_plane_score,
        best_scoring_proof_score:
          input.currentBest.bestScoringProofScore ??
          normalizedSummary.best_scoring_proof_score,
        best_scoring_release_score:
          input.currentBest.bestScoringReleaseScore ??
          normalizedSummary.best_scoring_release_score,
        best_scoring_threshold_results:
          input.currentBest.bestScoringThresholdResults ??
          normalizedSummary.best_scoring_threshold_results,
        best_scoring_dimension_scores:
          input.currentBest.bestScoringDimensionScores,
        best_scoring_patch_request_path:
          input.currentBest.bestScoringPatchRequestPath,
        best_scoring_eval_report_path:
          input.currentBest.bestScoringEvalReportPath
      })
    );
  }

  await Promise.all(writes);
};
