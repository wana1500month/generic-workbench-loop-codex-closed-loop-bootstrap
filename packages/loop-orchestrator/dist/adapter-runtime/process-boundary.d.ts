import type { ResolvedAdapterExecutionPolicy } from "../types.js";
export type AdapterCommandLaunch = {
    command: string;
    args?: string[];
    shell?: "powershell" | "sh" | "bash" | "cmd";
};
export declare const resolveAdapterCommandLaunch: (input: {
    policy: ResolvedAdapterExecutionPolicy;
    command: string;
    args?: string[];
    shell?: "powershell" | "sh" | "bash" | "cmd";
    cwd: string;
}) => AdapterCommandLaunch;
//# sourceMappingURL=process-boundary.d.ts.map