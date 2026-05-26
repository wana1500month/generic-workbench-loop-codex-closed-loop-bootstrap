import type { LoopPlan, LoopRunSummary, LoopScenario } from "./types.js";
export declare const codexHandoffPathForRun: (runDirectory: string) => string;
export declare const writeRunCodexHandoff: (input: {
    runDirectory: string;
    summary: LoopRunSummary;
    plan: LoopPlan;
    scenario: LoopScenario;
}) => Promise<string>;
//# sourceMappingURL=codex-handoff.d.ts.map