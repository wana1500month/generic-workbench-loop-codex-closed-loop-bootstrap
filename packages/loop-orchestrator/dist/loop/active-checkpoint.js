import { loadJsonIfExists } from "../file-system.js";
export const activeArtifactPathsFor = (artifacts) => {
    const artifactValues = artifacts
        ? Object.values(artifacts).filter((value) => typeof value === "string")
        : [];
    return {
        activePromptPath: artifactValues.find((value) => value.endsWith(".md") && /prompt/i.test(value)),
        activeResponsePath: artifactValues.find((value) => value.endsWith(".json") && /response/i.test(value))
    };
};
export const activeCheckpointMetadataFor = async (input) => {
    const artifactValues = input.artifacts
        ? Object.values(input.artifacts).filter((value) => typeof value === "string")
        : [];
    const taskPath = artifactValues.find((value) => value.endsWith(".json") && /task/i.test(value));
    if (taskPath) {
        const taskArtifact = await loadJsonIfExists(taskPath);
        if (taskArtifact && typeof taskArtifact === "object") {
            const checkpointId = "checkpoint_id" in taskArtifact &&
                typeof taskArtifact.checkpoint_id === "string"
                ? taskArtifact.checkpoint_id
                : undefined;
            const checkpointSeq = "checkpoint_seq" in taskArtifact &&
                typeof taskArtifact.checkpoint_seq === "number"
                ? taskArtifact.checkpoint_seq
                : undefined;
            if (checkpointId || checkpointSeq !== undefined) {
                return {
                    checkpointId,
                    checkpointSeq
                };
            }
        }
    }
    if (!input.fallback) {
        return {};
    }
    const checkpointSeq = Date.now();
    return {
        checkpointSeq,
        checkpointId: [
            input.runId,
            `r${input.fallback.round}`,
            input.fallback.phase,
            input.fallback.checkpointKind,
            String(checkpointSeq)
        ].join(":")
    };
};
//# sourceMappingURL=active-checkpoint.js.map