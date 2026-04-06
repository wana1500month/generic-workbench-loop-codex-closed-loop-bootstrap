import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../"
);

export const loadJson = async <T>(path: string): Promise<T> => {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
};

export const writeJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

export const writeText = async (path: string, value: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
};

export const sha256ForPath = async (path?: string): Promise<string | undefined> => {
  if (!path) {
    return undefined;
  }

  const raw = await readFile(path);
  return createHash("sha256").update(raw).digest("hex");
};

export const removeIfExists = async (path: string): Promise<void> => {
  try {
    await rm(path, { force: true, recursive: true });
  } catch {
    // optional cleanup
  }
};

export const nextRunId = async (runsDirectory: string): Promise<string> => {
  await mkdir(runsDirectory, { recursive: true });

  while (true) {
    const entries = await readdir(runsDirectory, { withFileTypes: true });
    const maxRun = entries.reduce((currentMax, entry) => {
      if (!entry.isDirectory()) {
        return currentMax;
      }

      const match = /^run-(\d+)$/.exec(entry.name);
      if (!match) {
        return currentMax;
      }

      return Math.max(currentMax, Number(match[1]));
    }, 0);

    const runId = `run-${String(maxRun + 1).padStart(3, "0")}`;
    try {
      await mkdir(resolve(runsDirectory, runId));
      return runId;
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        continue;
      }

      throw error;
    }
  }
};
