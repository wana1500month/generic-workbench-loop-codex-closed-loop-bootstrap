import { appendFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../");
export const resolveRunsDirectory = () => resolve(process.env.HARNESS_RUNS_DIRECTORY?.trim() ||
    join(repoRoot, "evals", "runs"));
export const loadJson = async (path) => {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
};
export const loadJsonIfExists = async (path) => {
    try {
        return await loadJson(path);
    }
    catch (error) {
        if (typeof error === "object" &&
            error !== null &&
            "code" in error &&
            (error.code === "ENOENT" || error.code === "ENOTDIR")) {
            return undefined;
        }
        throw error;
    }
};
export const loadJsonLinesIfExists = async (path) => {
    try {
        const raw = await readFile(path, "utf8");
        return raw
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => JSON.parse(line));
    }
    catch (error) {
        if (typeof error === "object" &&
            error !== null &&
            "code" in error &&
            (error.code === "ENOENT" || error.code === "ENOTDIR")) {
            return [];
        }
        throw error;
    }
};
export const writeJson = async (path, value) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};
export const writeText = async (path, value) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, value, "utf8");
};
export const appendJsonLine = async (path, value) => {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(value)}\n`, "utf8");
};
export const pathExists = async (path) => {
    try {
        await stat(path);
        return true;
    }
    catch (error) {
        if (typeof error === "object" &&
            error !== null &&
            "code" in error &&
            (error.code === "ENOENT" || error.code === "ENOTDIR")) {
            return false;
        }
        throw error;
    }
};
export const sha256ForPath = async (path) => {
    if (!path) {
        return undefined;
    }
    const raw = await readFile(path);
    return createHash("sha256").update(raw).digest("hex");
};
export const removeIfExists = async (path) => {
    try {
        await rm(path, { force: true, recursive: true });
    }
    catch {
        // optional cleanup
    }
};
export const nextRunId = async (runsDirectory) => {
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
        }
        catch (error) {
            if (typeof error === "object" &&
                error !== null &&
                "code" in error &&
                error.code === "EEXIST") {
                continue;
            }
            throw error;
        }
    }
};
//# sourceMappingURL=file-system.js.map