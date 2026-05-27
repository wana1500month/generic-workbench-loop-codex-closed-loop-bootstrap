import { canonicalCodexCheckpointStopReason } from "../stop-reason.js";
import { activeArtifactPathsFor, activeCheckpointMetadataFor } from "./active-checkpoint.js";
const unique = (values) => [...new Set(values)];
export const pauseForHumanInputCheckpoint = async (deps, input) => {
    const { activePromptPath, activeResponsePath } = activeArtifactPathsFor(input.artifacts);
    const checkpointMetadata = await activeCheckpointMetadataFor({
        artifacts: input.artifacts,
        runId: deps.runId,
        fallback: {
            round: input.round,
            phase: input.phase,
            checkpointKind: input.checkpointKind ?? "planner"
        }
    });
    await deps.recordRoundPhase({
        round: input.round,
        phase: input.phase,
        status: "awaiting_human_input",
        artifacts: input.artifacts ?? {},
        notes: input.notes
    });
    return deps.finalizeRunAsPausedStop({
        stopReason: "awaiting_human_input",
        notes: input.notes,
        attentionRequired: "human",
        checkpointKind: input.checkpointKind,
        checkpointId: checkpointMetadata.checkpointId,
        checkpointSeq: checkpointMetadata.checkpointSeq,
        autoResumeEligible: false,
        userVisiblePause: true,
        decisionOptions: input.decisionOptions,
        recommendedSkill: "loop-control",
        recommendedCommand: input.recommendedCommand,
        activePromptPath,
        activeResponsePath
    });
};
export const pauseForExternalConditionCheckpoint = async (deps, input) => {
    const { activePromptPath, activeResponsePath } = activeArtifactPathsFor(input.artifacts);
    const checkpointMetadata = await activeCheckpointMetadataFor({
        artifacts: input.artifacts,
        runId: deps.runId,
        fallback: {
            round: input.round,
            phase: input.phase,
            checkpointKind: input.checkpointKind ?? "evaluator"
        }
    });
    await deps.recordRoundPhase({
        round: input.round,
        phase: input.phase,
        status: "awaiting_external_condition",
        artifacts: input.artifacts ?? {},
        notes: input.notes
    });
    return deps.finalizeRunAsPausedStop({
        stopReason: "awaiting_external_condition",
        notes: input.notes,
        attentionRequired: "external",
        checkpointKind: input.checkpointKind,
        checkpointId: checkpointMetadata.checkpointId,
        checkpointSeq: checkpointMetadata.checkpointSeq,
        autoResumeEligible: false,
        userVisiblePause: true,
        recommendedSkill: "loop-control",
        recommendedCommand: input.recommendedCommand,
        activePromptPath,
        activeResponsePath
    });
};
export const checkpointForCurrentThreadWorkCheckpoint = async (deps, input) => {
    if (deps.manualCurrentThreadProtocol) {
        const manualProtocolNotes = input.notes.filter((note) => !/not a human decision stop/i.test(note));
        return pauseForHumanInputCheckpoint(deps, {
            round: input.round,
            phase: input.phase,
            checkpointKind: input.checkpointKind,
            artifacts: input.artifacts,
            notes: unique([
                ...manualProtocolNotes,
                "This current-thread run is using the manual protocol, so a human operator must complete the active checkpoint before resuming."
            ])
        });
    }
    const { activePromptPath, activeResponsePath } = activeArtifactPathsFor(input.artifacts);
    const checkpointMetadata = await activeCheckpointMetadataFor({
        artifacts: input.artifacts,
        runId: deps.runId,
        fallback: {
            round: input.round,
            phase: input.phase,
            checkpointKind: input.checkpointKind
        }
    });
    await deps.recordRoundPhase({
        round: input.round,
        phase: input.phase,
        status: "awaiting_codex_work",
        artifacts: input.artifacts,
        notes: input.notes
    });
    return deps.finalizeRunAsPausedStop({
        stopReason: canonicalCodexCheckpointStopReason,
        notes: input.notes,
        attentionRequired: "codex",
        checkpointKind: input.checkpointKind,
        checkpointId: checkpointMetadata.checkpointId,
        checkpointSeq: checkpointMetadata.checkpointSeq,
        autoResumeEligible: true,
        userVisiblePause: false,
        recommendedSkill: "loop-control",
        activePromptPath,
        activeResponsePath
    });
};
//# sourceMappingURL=checkpoint-flow.js.map