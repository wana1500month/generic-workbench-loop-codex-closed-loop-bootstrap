import { join } from "node:path";
import { appendJsonLine, loadJsonIfExists, repoRoot, writeJson } from "./file-system.js";
const sanitizeThreadId = (value) => value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "local-thread";
export const frontDoorSessionsDirectory = () => process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY?.trim() ||
    join(repoRoot, "evals", "front-door-sessions");
export const frontDoorSessionPathsForThread = (threadId) => {
    const directory = frontDoorSessionsDirectory();
    const threadKey = sanitizeThreadId(threadId);
    const sessionId = `session-${threadKey}`;
    return {
        directory,
        session_id: sessionId,
        session_path: join(directory, `${sessionId}.json`),
        events_path: join(directory, `${sessionId}.events.jsonl`)
    };
};
export const loadFrontDoorSessionArtifact = async (threadId) => {
    const paths = frontDoorSessionPathsForThread(threadId);
    return loadJsonIfExists(paths.session_path);
};
export const writeFrontDoorSessionArtifact = async (threadId, artifact) => {
    const paths = frontDoorSessionPathsForThread(threadId);
    await writeJson(paths.session_path, artifact);
    return paths;
};
export const appendFrontDoorSessionEvent = async (threadId, event) => {
    const paths = frontDoorSessionPathsForThread(threadId);
    await appendJsonLine(paths.events_path, event);
};
//# sourceMappingURL=front-door-session-store.js.map