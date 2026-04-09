import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const firstDefinedEnv = (keys: readonly string[]): string | undefined => {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return undefined;
};

const parseCommandArgs = (raw: string | undefined): string[] | undefined => {
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
      return parsed;
    }
  } catch {
    // ignore malformed overrides and fall back to defaults
  }

  return undefined;
};

export const resolveBundledCodexScript = (): string | undefined => {
  if (process.platform !== "win32") {
    return undefined;
  }

  const appData = process.env.APPDATA;
  const candidates = unique(
    [
      appData
        ? join(appData, "npm", "node_modules", "@openai", "codex", "bin", "codex.js")
        : undefined,
      join(
        homedir(),
        "AppData",
        "Roaming",
        "npm",
        "node_modules",
        "@openai",
        "codex",
        "bin",
        "codex.js"
      )
    ].filter((value): value is string => typeof value === "string" && value.length > 0)
  );

  return candidates.find((candidate) => existsSync(candidate));
};

export const resolveCodexCliLaunch = (input?: {
  commandEnvKeys?: readonly string[];
  argsEnvKeys?: readonly string[];
  tailArgs?: readonly string[];
  fallbackCommand?: string;
}): { command: string; args: string[] } => {
  const commandEnvKeys = input?.commandEnvKeys ?? ["HARNESS_CODEX_BIN"];
  const argsEnvKeys = input?.argsEnvKeys ?? ["HARNESS_CODEX_BIN_ARGS"];
  const tailArgs = [...(input?.tailArgs ?? [])];
  const fallbackCommand = input?.fallbackCommand ?? "codex";

  const explicitCommand = firstDefinedEnv(commandEnvKeys);
  const explicitArgs = parseCommandArgs(firstDefinedEnv(argsEnvKeys));

  if (explicitCommand) {
    return {
      command: explicitCommand,
      args: [...(explicitArgs ?? []), ...tailArgs]
    };
  }

  if (explicitArgs) {
    return {
      command: fallbackCommand,
      args: [...explicitArgs, ...tailArgs]
    };
  }

  const bundledScript = resolveBundledCodexScript();
  if (bundledScript) {
    return {
      command: process.execPath,
      args: [bundledScript, ...tailArgs]
    };
  }

  return {
    command: fallbackCommand,
    args: tailArgs
  };
};
