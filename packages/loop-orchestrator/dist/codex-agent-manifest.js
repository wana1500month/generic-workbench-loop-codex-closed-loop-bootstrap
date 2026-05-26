import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "./file-system.js";
export const experimentalExecutorRuntimeWarning = "Executor mode 'subagents-experimental' uses manifest-backed prompt orchestration and still executes one Codex CLI call per harness stage.";
const manifestCache = new Map();
const parseQuotedField = (raw, key) => raw.match(new RegExp(`^${key}\\s*=\\s*"([^"\\r\\n]+)"`, "m"))?.[1]?.trim() || undefined;
const parseMultilineField = (raw, key) => raw
    .match(new RegExp(`^${key}\\s*=\\s*"""\\r?\\n([\\s\\S]*?)\\r?\\n"""`, "m"))?.[1]
    ?.trim() || undefined;
const loadCodexAgentManifest = async (role) => {
    const cached = manifestCache.get(role);
    if (cached !== undefined) {
        return cached;
    }
    const path = join(repoRoot, ".codex", "agents", `${role}.toml`);
    try {
        const raw = await readFile(path, "utf8");
        const manifest = {
            path,
            ...(parseQuotedField(raw, "name") ? { name: parseQuotedField(raw, "name") } : {}),
            ...(parseQuotedField(raw, "description")
                ? { description: parseQuotedField(raw, "description") }
                : {}),
            ...(parseMultilineField(raw, "developer_instructions")
                ? { developerInstructions: parseMultilineField(raw, "developer_instructions") }
                : {})
        };
        manifestCache.set(role, manifest);
        return manifest;
    }
    catch {
        manifestCache.set(role, null);
        return null;
    }
};
export const buildExecutorModePrompt = async (input) => {
    if (input.executorMode !== "subagents-experimental") {
        return { prompt: input.prompt };
    }
    const manifest = await loadCodexAgentManifest(input.role);
    if (!manifest?.developerInstructions) {
        return {
            prompt: input.prompt,
            warning: `Executor mode 'subagents-experimental' could not load developer instructions for the ${input.role} agent manifest. Falling back to the built-in prompt.`
        };
    }
    return {
        prompt: [
            "Executor mode: subagents-experimental",
            "Apply the following custom agent manifest before answering.",
            `Agent role: ${manifest.name ?? input.role}`,
            ...(manifest.description ? [`Description: ${manifest.description}`] : []),
            "",
            "Developer instructions:",
            manifest.developerInstructions,
            "",
            "Task input follows below.",
            "",
            input.prompt
        ].join("\n"),
        manifestPath: manifest.path
    };
};
//# sourceMappingURL=codex-agent-manifest.js.map