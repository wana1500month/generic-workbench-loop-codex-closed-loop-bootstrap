import { mkdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

import { isControllerMode } from "./controller-mode.js";
import { writeJson, writeText } from "./file-system.js";
import {
  defaultTransportModeForControllerMode,
  isCurrentThreadTransport,
  isTransportMode
} from "./transport-mode.js";

export type CodexSandboxMode = "read-only" | "workspace-write";
export type CodexJsonSchema = Record<string, unknown>;
export type CodexAuthMode = "chatgpt" | "api" | "unknown";

export type CodexSessionEntry = {
  thread_id: string;
  updated_at: string;
  cwd?: string;
  run_id?: string;
  round?: number;
  role?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type CodexSessionRegistry = Record<string, CodexSessionEntry>;

export type CodexCommandInput = {
  name: string;
  prompt: string;
  cwd: string;
  artifactDirectory: string;
  profile?: string;
  configOverrides?: Record<string, string | number | boolean>;
  addDirs?: string[];
  outputSchema?: CodexJsonSchema;
  sandboxMode?: CodexSandboxMode;
  sessionId?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type CodexCommandResult = {
  code: number;
  stdout: string;
  stderr: string;
  eventsText: string;
  responseText?: string;
  error?: string;
  promptPath: string;
  responsePath: string;
  stdoutPath: string;
  stderrPath: string;
  eventsPath: string;
  metadataPath: string;
  schemaPath?: string;
  threadId?: string;
  profile?: string;
  responseWritten: boolean;
  usedResume: boolean;
  disabled: boolean;
};

export type CodexAuthPreflight = {
  ok: boolean;
  mode: CodexAuthMode;
  authFilePath: string;
  authFilePresent: boolean;
  hasRefreshToken: boolean;
  fileBacked: boolean;
  statusCode: number;
  blockedReason?: string;
  error?: string;
  statusStdout: string;
  statusStderr: string;
};

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];
const currentThreadTransportBlockedReason =
  "Current-thread transports forbid nested Codex command execution. Use the active Codex thread or App Server turn as the operator surface instead of spawning codex exec.";

const tomlLiteral = (value: string | number | boolean): string => {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  return String(value);
};

const readJsonIfExists = async <T>(path: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
};

const getCodexCommand = (): string => process.env.HARNESS_CODEX_BIN ?? "codex";

const getCodexCommandPrefixArgs = (): string[] => {
  if (!process.env.HARNESS_CODEX_BIN_ARGS) {
    return [];
  }

  try {
    const parsed = JSON.parse(process.env.HARNESS_CODEX_BIN_ARGS) as unknown;
    if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
      return parsed;
    }
  } catch {
    // ignore malformed testing override
  }

  return [];
};

const resolvedHarnessTransportMode = () => {
  if (isTransportMode(process.env.HARNESS_TRANSPORT)) {
    return process.env.HARNESS_TRANSPORT;
  }

  if (isControllerMode(process.env.HARNESS_CONTROLLER_MODE)) {
    return defaultTransportModeForControllerMode(
      process.env.HARNESS_CONTROLLER_MODE
    );
  }

  return undefined;
};

const spawnProcess = async (
  command: string,
  args: string[],
  cwd: string
): Promise<{ code: number; stdout: string; stderr: string; error?: string }> =>
  new Promise((resolvePromise) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: process.env,
        shell: false
      });
    } catch (error: unknown) {
      resolvePromise({
        code: -1,
        stdout: "",
        stderr: "",
        error: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolvePromise({
        code: -1,
        stdout,
        stderr,
        error: error instanceof Error ? error.message : String(error)
      });
    });
    child.on("close", (code) => {
      resolvePromise({
        code: code ?? 1,
        stdout,
        stderr
      });
    });
  });

const resolveCodexHome = (): string => process.env.CODEX_HOME ?? join(homedir(), ".codex");

const normalizeAuthMode = (value: unknown): CodexAuthMode => {
  if (value === "chatgpt" || value === "api") {
    return value;
  }

  return "unknown";
};

const detectCodexAuthMode = (stdout: string, stderr: string): CodexAuthMode => {
  const text = `${stdout}\n${stderr}`.toLowerCase();
  if (text.includes("chatgpt")) {
    return "chatgpt";
  }
  if (text.includes("api")) {
    return "api";
  }

  return "unknown";
};

export const extractThreadIdFromJsonl = (raw: string): string | undefined => {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed.type === "thread.started" && typeof parsed.thread_id === "string") {
        return parsed.thread_id;
      }
    } catch {
      // ignore malformed lines
    }
  }

  return undefined;
};

export const readCodexSessionRegistry = async (
  registryPath: string
): Promise<CodexSessionRegistry> =>
  (await readJsonIfExists<CodexSessionRegistry>(registryPath)) ?? {};

export const readCodexSession = async (
  registryPath: string,
  key: string
): Promise<CodexSessionEntry | undefined> => {
  const registry = await readCodexSessionRegistry(registryPath);
  return registry[key];
};

export const writeCodexSession = async (
  registryPath: string,
  key: string,
  entry: Omit<CodexSessionEntry, "updated_at"> & { updated_at?: string }
): Promise<void> => {
  const registry = await readCodexSessionRegistry(registryPath);
  registry[key] = {
    ...entry,
    updated_at: entry.updated_at ?? new Date().toISOString()
  };
  await writeJson(registryPath, registry);
};

export const checkCodexAuth = async (options: {
  strict: boolean;
  requireChatgpt: boolean;
  requireFileBacked: boolean;
  cwd?: string;
}): Promise<CodexAuthPreflight> => {
  const command = getCodexCommand();
  const prefixArgs = getCodexCommandPrefixArgs();
  const authFilePath = join(resolveCodexHome(), "auth.json");
  const status = await spawnProcess(
    command,
    [...prefixArgs, "login", "status"],
    options.cwd ?? process.cwd()
  );

  const modeFromStatus = detectCodexAuthMode(status.stdout, status.stderr);
  let authFilePresent = false;
  let hasRefreshToken = false;
  let fileBacked = false;
  let modeFromFile: CodexAuthMode = "unknown";
  let authFileError: string | undefined;

  try {
    const authFile = JSON.parse(await readFile(authFilePath, "utf8")) as {
      auth_mode?: unknown;
      tokens?: { refresh_token?: unknown } | null;
    };
    authFilePresent = true;
    fileBacked = true;
    modeFromFile = normalizeAuthMode(authFile.auth_mode);
    hasRefreshToken =
      typeof authFile.tokens?.refresh_token === "string" &&
      authFile.tokens.refresh_token.trim().length > 0;
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      authFilePresent = false;
    } else if (error instanceof Error) {
      authFileError = error.message;
    } else if (error !== undefined) {
      authFileError = String(error);
    }
  }

  const mode = modeFromFile !== "unknown" ? modeFromFile : modeFromStatus;
  let blockedReason: string | undefined;

  if (status.code !== 0 || status.error) {
    const trimmedStatusStderr = status.stderr.trim();
    const statusError =
      status.error?.includes("ENOENT") || status.error?.includes("EPERM") || status.error?.includes("EACCES")
        ? "'codex' binary was not available or executable on PATH."
        : status.error;
    blockedReason =
      statusError ??
      (trimmedStatusStderr.length > 0 ? trimmedStatusStderr : undefined) ??
      "Codex login status did not report an active session.";
  } else if ((options.strict || options.requireFileBacked) && authFileError) {
    blockedReason = `Codex auth file could not be read from ${authFilePath}: ${authFileError}`;
  } else if ((options.strict || options.requireFileBacked) && !authFilePresent) {
    blockedReason = `Codex auth file was not present at ${authFilePath}.`;
  } else if (options.strict && !fileBacked) {
    blockedReason = "Codex auth was not file-backed.";
  } else if (options.strict && !hasRefreshToken) {
    blockedReason = "Codex auth file did not contain a refresh token.";
  } else if (options.strict && options.requireChatgpt && mode !== "chatgpt") {
    blockedReason = `Codex auth_mode must be 'chatgpt', received '${mode}'.`;
  } else if (!options.strict && options.requireChatgpt && mode === "api") {
    blockedReason = "Codex login status reported API-key auth; ChatGPT-managed auth is required.";
  }

  return {
    ok: !blockedReason,
    mode,
    authFilePath,
    authFilePresent,
    hasRefreshToken,
    fileBacked,
    statusCode: status.code,
    ...(blockedReason ? { blockedReason } : {}),
    ...(status.error ? { error: status.error } : {}),
    statusStdout: status.stdout,
    statusStderr: status.stderr
  };
};

export const runCodexCommand = async (
  input: CodexCommandInput
): Promise<CodexCommandResult> => {
  await mkdir(input.artifactDirectory, { recursive: true });

  const promptPath = join(input.artifactDirectory, `${input.name}-prompt.md`);
  const responsePath = join(input.artifactDirectory, `${input.name}-response.json`);
  const stdoutPath = join(input.artifactDirectory, `${input.name}-stdout.log`);
  const stderrPath = join(input.artifactDirectory, `${input.name}-stderr.log`);
  const eventsPath = join(input.artifactDirectory, `${input.name}-events.jsonl`);
  const metadataPath = join(input.artifactDirectory, `${input.name}-metadata.json`);
  const schemaPath = input.outputSchema
    ? join(input.artifactDirectory, `${input.name}-schema.json`)
    : undefined;

  await writeText(promptPath, input.prompt);
  if (schemaPath && input.outputSchema) {
    await writeJson(schemaPath, input.outputSchema);
  }

  if (process.env.HARNESS_DISABLE_CODEX_AGENTS === "1") {
    const disabledResult: CodexCommandResult = {
      code: 0,
      stdout: "",
      stderr: "",
      eventsText: "",
      error: "Codex agent execution disabled by HARNESS_DISABLE_CODEX_AGENTS=1.",
      promptPath,
      responsePath,
      stdoutPath,
      stderrPath,
      eventsPath,
      metadataPath,
      ...(schemaPath ? { schemaPath } : {}),
      ...(input.profile ? { profile: input.profile } : {}),
      responseWritten: false,
      usedResume: Boolean(input.sessionId),
      disabled: true
    };
    await Promise.all([
      writeText(stdoutPath, ""),
      writeText(stderrPath, ""),
      writeText(eventsPath, ""),
      writeJson(metadataPath, {
        name: input.name,
        cwd: input.cwd,
        used_resume: disabledResult.usedResume,
        disabled: true,
        error: disabledResult.error,
        prompt_path: promptPath,
        response_path: responsePath,
        stdout_path: stdoutPath,
        stderr_path: stderrPath,
        events_path: eventsPath,
        response_written: false,
        codex_command: getCodexCommand(),
        ...(schemaPath ? { schema_path: schemaPath } : {}),
        ...(input.profile ? { profile: input.profile } : {}),
        ...(input.configOverrides ? { config_overrides: input.configOverrides } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {})
      })
    ]);
    return disabledResult;
  }

  const harnessTransportMode = resolvedHarnessTransportMode();
  if (harnessTransportMode && isCurrentThreadTransport(harnessTransportMode)) {
    const blockedResult: CodexCommandResult = {
      code: 0,
      stdout: "",
      stderr: "",
      eventsText: "",
      error: currentThreadTransportBlockedReason,
      promptPath,
      responsePath,
      stdoutPath,
      stderrPath,
      eventsPath,
      metadataPath,
      ...(schemaPath ? { schemaPath } : {}),
      ...(input.profile ? { profile: input.profile } : {}),
      responseWritten: false,
      usedResume: Boolean(input.sessionId),
      disabled: true
    };
    await Promise.all([
      writeText(stdoutPath, ""),
      writeText(stderrPath, ""),
      writeText(eventsPath, ""),
      writeJson(metadataPath, {
        name: input.name,
        cwd: input.cwd,
        used_resume: blockedResult.usedResume,
        disabled: true,
        current_thread_transport_blocked: true,
        transport_mode: harnessTransportMode,
        error: blockedResult.error,
        prompt_path: promptPath,
        response_path: responsePath,
        stdout_path: stdoutPath,
        stderr_path: stderrPath,
        events_path: eventsPath,
        response_written: false,
        codex_command: getCodexCommand(),
        ...(schemaPath ? { schema_path: schemaPath } : {}),
        ...(input.profile ? { profile: input.profile } : {}),
        ...(input.configOverrides ? { config_overrides: input.configOverrides } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {})
      })
    ]);
    return blockedResult;
  }

  const command = getCodexCommand();
  const commandPrefixArgs = getCodexCommandPrefixArgs();
  const baseArgs = input.profile ? ["--profile", input.profile] : [];
  const configArgs = Object.entries(input.configOverrides ?? {}).flatMap(([key, value]) => [
    "-c",
    `${key}=${tomlLiteral(value)}`
  ]);
  const args = input.sessionId
    ? [
        ...commandPrefixArgs,
        "exec",
        "resume",
        ...configArgs,
        "--skip-git-repo-check",
        "--json",
        "--output-last-message",
        responsePath,
        input.sessionId,
        "-"
      ]
    : [
        ...commandPrefixArgs,
        "exec",
        ...baseArgs,
        ...configArgs,
        "--json",
        "--skip-git-repo-check",
        ...(input.sandboxMode ? ["-s", input.sandboxMode] : []),
        ...unique(input.addDirs ?? []).flatMap((dir) => ["--add-dir", dir]),
        ...(schemaPath ? ["--output-schema", schemaPath] : []),
        "--output-last-message",
        responsePath,
        "-"
      ];

  const execution = await new Promise<{
    code: number;
    stdout: string;
    stderr: string;
    error?: string;
  }>((resolvePromise) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: input.cwd,
        env: process.env,
        shell: false
      });
    } catch (error: unknown) {
      resolvePromise({
        code: -1,
        stdout: "",
        stderr: "",
        error: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolvePromise({
        code: -1,
        stdout,
        stderr,
        error: error instanceof Error ? error.message : String(error)
      });
    });
    child.on("close", (code) => {
      resolvePromise({
        code: code ?? 1,
        stdout,
        stderr
      });
    });
    child.stdin.write(input.prompt);
    child.stdin.end();
  });

  await Promise.all([
    writeText(stdoutPath, execution.stdout),
    writeText(stderrPath, execution.stderr),
    writeText(eventsPath, execution.stdout)
  ]);

  let responseText: string | undefined;
  let responseError: string | undefined;
  let responseWritten = false;
  if (execution.code === 0 && !execution.error) {
    try {
      responseText = await readFile(responsePath, "utf8");
      responseWritten = true;
    } catch (error: unknown) {
      responseError =
        error instanceof Error
          ? error.message
          : "Codex finished but no response file was written.";
    }
  }

  const threadId = extractThreadIdFromJsonl(execution.stdout) ?? input.sessionId;
  const result: CodexCommandResult = {
    code: execution.code,
    stdout: execution.stdout,
    stderr: execution.stderr,
    eventsText: execution.stdout,
    ...(responseText ? { responseText } : {}),
    ...(execution.error ? { error: execution.error } : {}),
    ...(responseError ? { error: responseError } : {}),
    promptPath,
    responsePath,
    stdoutPath,
    stderrPath,
    eventsPath,
    metadataPath,
    ...(schemaPath ? { schemaPath } : {}),
    ...(threadId ? { threadId } : {}),
    ...(input.profile ? { profile: input.profile } : {}),
    responseWritten,
    usedResume: Boolean(input.sessionId),
    disabled: false
  };

  await writeJson(metadataPath, {
    name: input.name,
    cwd: input.cwd,
    args,
    used_resume: result.usedResume,
    disabled: false,
    code: result.code,
    thread_id: result.threadId ?? null,
    prompt_path: promptPath,
    response_path: responsePath,
    stdout_path: stdoutPath,
    stderr_path: stderrPath,
    events_path: eventsPath,
    response_written: responseWritten,
    codex_command: command,
    ...(schemaPath ? { schema_path: schemaPath } : {}),
    ...(input.profile ? { profile: input.profile } : {}),
    ...(input.configOverrides ? { config_overrides: input.configOverrides } : {}),
    ...(result.error ? { error: result.error } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {})
  });

  return result;
};
