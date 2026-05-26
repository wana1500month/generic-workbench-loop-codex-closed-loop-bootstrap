import type { ExecutorMode } from "./types.js";
type CodexAgentRole = "planner" | "generator" | "evaluator";
export declare const experimentalExecutorRuntimeWarning = "Executor mode 'subagents-experimental' uses manifest-backed prompt orchestration and still executes one Codex CLI call per harness stage.";
export declare const buildExecutorModePrompt: (input: {
    executorMode: ExecutorMode;
    role: CodexAgentRole;
    prompt: string;
}) => Promise<{
    prompt: string;
    warning?: string;
    manifestPath?: string;
}>;
export {};
//# sourceMappingURL=codex-agent-manifest.d.ts.map