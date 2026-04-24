import { join } from "node:path";

import { appendJsonLine, loadJsonIfExists, repoRoot, writeJson } from "./file-system.js";
import type { FrontDoorSessionArtifact } from "./intake-schema.js";

export interface FrontDoorSessionPaths {
  directory: string;
  session_id: string;
  session_path: string;
  events_path: string;
}

export interface FrontDoorSessionEvent {
  type: "session_created" | "session_updated" | "session_status";
  session_id: string;
  thread_id?: string;
  turn_count: number;
  status: string;
  phase: string;
  message?: string;
  updated_at: string;
}

const sanitizeThreadId = (value: string): string =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "local-thread";

export const frontDoorSessionsDirectory = (): string =>
  process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY?.trim() ||
  join(repoRoot, "evals", "front-door-sessions");

export const frontDoorSessionPathsForThread = (
  threadId: string
): FrontDoorSessionPaths => {
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

export const loadFrontDoorSessionArtifact = async (
  threadId: string
): Promise<FrontDoorSessionArtifact | undefined> => {
  const paths = frontDoorSessionPathsForThread(threadId);
  return loadJsonIfExists<FrontDoorSessionArtifact>(paths.session_path);
};

export const writeFrontDoorSessionArtifact = async (
  threadId: string,
  artifact: FrontDoorSessionArtifact
): Promise<FrontDoorSessionPaths> => {
  const paths = frontDoorSessionPathsForThread(threadId);
  await writeJson(paths.session_path, artifact);
  return paths;
};

export const appendFrontDoorSessionEvent = async (
  threadId: string,
  event: FrontDoorSessionEvent
): Promise<void> => {
  const paths = frontDoorSessionPathsForThread(threadId);
  await appendJsonLine(paths.events_path, event);
};
