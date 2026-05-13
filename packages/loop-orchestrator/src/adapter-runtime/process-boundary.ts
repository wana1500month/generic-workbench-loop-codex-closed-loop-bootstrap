import type { ResolvedAdapterExecutionPolicy } from "../types.js";

export type AdapterCommandLaunch = {
  command: string;
  args?: string[];
  shell?: "powershell" | "sh" | "bash" | "cmd";
};

export const resolveAdapterCommandLaunch = (input: {
  policy: ResolvedAdapterExecutionPolicy;
  command: string;
  args?: string[];
  shell?: "powershell" | "sh" | "bash" | "cmd";
  cwd: string;
}): AdapterCommandLaunch => {
  if (input.policy.trust_mode === "trusted") {
    return {
      command: input.command,
      ...(input.args ? { args: input.args } : {}),
      ...(input.shell ? { shell: input.shell } : {})
    };
  }

  const wrapperJson = process.env.HARNESS_ADAPTER_SANDBOX_WRAPPER_JSON;
  if (!wrapperJson) {
    throw new Error(
      "Adapter requested sandboxed execution, but HARNESS_ADAPTER_SANDBOX_WRAPPER_JSON is not configured."
    );
  }

  const parsed: unknown = JSON.parse(wrapperJson);
  if (!Array.isArray(parsed) || parsed.some((part) => typeof part !== "string")) {
    throw new Error("HARNESS_ADAPTER_SANDBOX_WRAPPER_JSON must be a JSON string array.");
  }

  const [wrapperCommand, ...wrapperArgs] = parsed;
  if (!wrapperCommand) {
    throw new Error("HARNESS_ADAPTER_SANDBOX_WRAPPER_JSON cannot be empty.");
  }

  return {
    command: wrapperCommand,
    args: [...wrapperArgs, "--", input.command, ...(input.args ?? [])]
  };
};
