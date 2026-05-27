import { mkdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveCodexCliLaunch } from "./codex-cli.js";
import { isControllerMode } from "./controller-mode.js";
import { writeJson, writeText } from "./file-system.js";
import { stopProcessTree } from "./process-runtime.js";
import { redactText } from "./redaction.js";
import { defaultTransportModeForControllerMode, isCurrentThreadTransport, isTransportMode } from "./transport-mode.js";
const unique = (values) => [...new Set(values)];
const currentThreadTransportBlockedReason = "Current-thread transports forbid nested Codex command execution. Use the active Codex thread or App Server turn as the operator surface instead of spawning codex exec.";
const codexProfileFallbackOverrides = (profile) => {
    if (profile === "readonly_agent") {
        return {
            approval_policy: "never",
            sandbox_mode: "read-only"
        };
    }
    return undefined;
};
const missingCodexProfilePattern = /config profile [`'"]?([^`'"\s]+)[`'"]? not found/i;
const missingCodexProfileName = (execution) => missingCodexProfilePattern.exec(`${execution.stderr}\n${execution.error ?? ""}`)?.[1];
const positiveIntegerEnv = (key, fallback) => {
    const parsed = Number(process.env[key]);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
const codexCommandTimeoutMs = () => positiveIntegerEnv("HARNESS_CODEX_COMMAND_TIMEOUT_MS", 600000);
const codexStaleOutputTimeoutMs = () => positiveIntegerEnv("HARNESS_CODEX_STALE_OUTPUT_TIMEOUT_MS", 120000);
const codexOutputLimitBytes = () => positiveIntegerEnv("HARNESS_CODEX_OUTPUT_LIMIT_BYTES", 10 * 1024 * 1024);
const codexSensitiveValuesForRedaction = () => [
    process.env.CODEX_API_KEY,
    process.env.OPENAI_API_KEY,
    process.env.GITHUB_TOKEN,
    process.env.NPM_TOKEN
].filter((value) => typeof value === "string" && value.length >= 8);
const isCurrentThreadReadOnlyJudge = (input) => input.allowCurrentThreadReadOnlyJudge === true &&
    input.metadata?.role === "judge" &&
    input.configOverrides?.approval_policy === "never" &&
    input.configOverrides?.sandbox_mode === "read-only";
const tomlLiteral = (value) => {
    if (typeof value === "string") {
        return JSON.stringify(value);
    }
    return String(value);
};
const readJsonIfExists = async (path) => {
    try {
        return JSON.parse(await readFile(path, "utf8"));
    }
    catch {
        return undefined;
    }
};
const resolvedHarnessTransportMode = () => {
    if (isTransportMode(process.env.HARNESS_TRANSPORT)) {
        return process.env.HARNESS_TRANSPORT;
    }
    if (isControllerMode(process.env.HARNESS_CONTROLLER_MODE)) {
        return defaultTransportModeForControllerMode(process.env.HARNESS_CONTROLLER_MODE);
    }
    return undefined;
};
const spawnProcess = async (command, args, cwd, timeoutMs = codexCommandTimeoutMs()) => new Promise((resolvePromise) => {
    let settled = false;
    let child;
    let timer;
    let stdout = "";
    let stderr = "";
    let timeoutState;
    const finish = (result) => {
        if (settled) {
            return;
        }
        settled = true;
        if (timer) {
            clearTimeout(timer);
        }
        resolvePromise(result);
    };
    const finishTimeout = () => {
        if (!timeoutState) {
            return false;
        }
        finish({
            code: 124,
            stdout,
            stderr,
            error: timeoutState.message,
            timedOut: true
        });
        return true;
    };
    try {
        child = spawn(command, args, {
            cwd,
            env: process.env,
            shell: false,
            windowsHide: true
        });
    }
    catch (error) {
        finish({
            code: -1,
            stdout: "",
            stderr: "",
            error: error instanceof Error ? error.message : String(error)
        });
        return;
    }
    timer = setTimeout(() => {
        const message = `Codex auth command timed out after ${timeoutMs} ms.`;
        if (settled || timeoutState) {
            return;
        }
        timeoutState = { message };
        void stopProcessTree(child.pid ?? -1).finally(() => {
            finishTimeout();
        });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
    });
    child.on("error", (error) => {
        if (finishTimeout()) {
            return;
        }
        finish({
            code: -1,
            stdout,
            stderr,
            error: error instanceof Error ? error.message : String(error)
        });
    });
    child.on("close", (code) => {
        if (finishTimeout()) {
            return;
        }
        finish({
            code: code ?? 1,
            stdout,
            stderr
        });
    });
});
const resolveCodexHome = () => process.env.CODEX_HOME ?? join(homedir(), ".codex");
const normalizeAuthMode = (value) => {
    if (value === "chatgpt" || value === "api") {
        return value;
    }
    return "unknown";
};
const detectCodexAuthMode = (stdout, stderr) => {
    const text = `${stdout}\n${stderr}`.toLowerCase();
    if (text.includes("chatgpt")) {
        return "chatgpt";
    }
    if (text.includes("api")) {
        return "api";
    }
    return "unknown";
};
export const extractThreadIdFromJsonl = (raw) => {
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed.type === "thread.started" && typeof parsed.thread_id === "string") {
                return parsed.thread_id;
            }
        }
        catch {
            // ignore malformed lines
        }
    }
    return undefined;
};
export const readCodexSessionRegistry = async (registryPath) => (await readJsonIfExists(registryPath)) ?? {};
export const readCodexSession = async (registryPath, key) => {
    const registry = await readCodexSessionRegistry(registryPath);
    return registry[key];
};
export const writeCodexSession = async (registryPath, key, entry) => {
    const registry = await readCodexSessionRegistry(registryPath);
    registry[key] = {
        ...entry,
        updated_at: entry.updated_at ?? new Date().toISOString()
    };
    await writeJson(registryPath, registry);
};
export const checkCodexAuth = async (options) => {
    const launch = resolveCodexCliLaunch();
    const authFilePath = join(resolveCodexHome(), "auth.json");
    const status = await spawnProcess(launch.command, [...launch.args, "login", "status"], options.cwd ?? process.cwd());
    const modeFromStatus = detectCodexAuthMode(status.stdout, status.stderr);
    let authFilePresent = false;
    let hasRefreshToken = false;
    let fileBacked = false;
    let modeFromFile = "unknown";
    let authFileError;
    try {
        const authFile = JSON.parse(await readFile(authFilePath, "utf8"));
        authFilePresent = true;
        fileBacked = true;
        modeFromFile = normalizeAuthMode(authFile.auth_mode);
        hasRefreshToken =
            typeof authFile.tokens?.refresh_token === "string" &&
                authFile.tokens.refresh_token.trim().length > 0;
    }
    catch (error) {
        if (typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "ENOENT") {
            authFilePresent = false;
        }
        else if (error instanceof Error) {
            authFileError = error.message;
        }
        else if (error !== undefined) {
            authFileError = String(error);
        }
    }
    const mode = modeFromFile !== "unknown" ? modeFromFile : modeFromStatus;
    let blockedReason;
    if (status.code !== 0 || status.error) {
        const trimmedStatusStderr = status.stderr.trim();
        const statusError = status.error?.includes("ENOENT") || status.error?.includes("EPERM") || status.error?.includes("EACCES")
            ? "'codex' binary was not available or executable on PATH."
            : status.error;
        blockedReason =
            statusError ??
                (trimmedStatusStderr.length > 0 ? trimmedStatusStderr : undefined) ??
                "Codex login status did not report an active session.";
    }
    else if ((options.strict || options.requireFileBacked) && authFileError) {
        blockedReason = `Codex auth file could not be read from ${authFilePath}: ${authFileError}`;
    }
    else if ((options.strict || options.requireFileBacked) && !authFilePresent) {
        blockedReason = `Codex auth file was not present at ${authFilePath}.`;
    }
    else if (options.strict && !fileBacked) {
        blockedReason = "Codex auth was not file-backed.";
    }
    else if (options.strict && !hasRefreshToken) {
        blockedReason = "Codex auth file did not contain a refresh token.";
    }
    else if (options.strict && options.requireChatgpt && mode !== "chatgpt") {
        blockedReason = `Codex auth_mode must be 'chatgpt', received '${mode}'.`;
    }
    else if (!options.strict && options.requireChatgpt && mode === "api") {
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
        ...(status.timedOut ? { timedOut: true } : {}),
        statusStdout: status.stdout,
        statusStderr: status.stderr
    };
};
export const runCodexCommand = async (input) => {
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
    const codexLaunch = resolveCodexCliLaunch();
    const usesResume = Boolean(input.sessionId || input.resumeLast);
    const effectiveCodexPolicy = {
        used_resume: usesResume,
        profile: input.profile ?? null,
        sandbox_mode: input.sandboxMode ??
            (typeof input.configOverrides?.sandbox_mode === "string"
                ? input.configOverrides.sandbox_mode
                : null),
        approval_policy: typeof input.configOverrides?.approval_policy === "string"
            ? input.configOverrides.approval_policy
            : null,
        network_access: typeof input.configOverrides?.["sandbox_workspace_write.network_access"] ===
            "boolean"
            ? input.configOverrides["sandbox_workspace_write.network_access"]
            : null,
        output_schema_requested: Boolean(input.outputSchema),
        output_schema_passed_to_cli: Boolean(schemaPath && !usesResume),
        add_dirs: unique(input.addDirs ?? [])
    };
    if (process.env.HARNESS_DISABLE_CODEX_AGENTS === "1") {
        const disabledResult = {
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
            usedResume: usesResume,
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
                effective_policy: effectiveCodexPolicy,
                disabled: true,
                error: disabledResult.error,
                prompt_path: promptPath,
                response_path: responsePath,
                stdout_path: stdoutPath,
                stderr_path: stderrPath,
                events_path: eventsPath,
                response_written: false,
                codex_command: codexLaunch.command,
                ...(schemaPath ? { schema_path: schemaPath } : {}),
                ...(input.profile ? { profile: input.profile } : {}),
                ...(input.configOverrides ? { config_overrides: input.configOverrides } : {}),
                ...(input.metadata ? { metadata: input.metadata } : {})
            })
        ]);
        return disabledResult;
    }
    const harnessTransportMode = resolvedHarnessTransportMode();
    if (harnessTransportMode &&
        isCurrentThreadTransport(harnessTransportMode) &&
        !isCurrentThreadReadOnlyJudge(input)) {
        const blockedResult = {
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
            usedResume: usesResume,
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
                effective_policy: effectiveCodexPolicy,
                disabled: true,
                current_thread_transport_blocked: true,
                transport_mode: harnessTransportMode,
                allow_current_thread_read_only_judge: input.allowCurrentThreadReadOnlyJudge === true,
                error: blockedResult.error,
                prompt_path: promptPath,
                response_path: responsePath,
                stdout_path: stdoutPath,
                stderr_path: stderrPath,
                events_path: eventsPath,
                response_written: false,
                codex_command: codexLaunch.command,
                ...(schemaPath ? { schema_path: schemaPath } : {}),
                ...(input.profile ? { profile: input.profile } : {}),
                ...(input.configOverrides ? { config_overrides: input.configOverrides } : {}),
                ...(input.metadata ? { metadata: input.metadata } : {})
            })
        ]);
        return blockedResult;
    }
    const command = codexLaunch.command;
    const baseArgs = input.profile ? ["--profile", input.profile] : [];
    const configArgsFor = (overrides) => Object.entries(overrides ?? {}).flatMap(([key, value]) => [
        "-c",
        `${key}=${tomlLiteral(value)}`
    ]);
    const configArgs = configArgsFor(input.configOverrides);
    const resumeConfigArgs = configArgsFor({
        ...(input.sandboxMode ? { sandbox_mode: input.sandboxMode } : {}),
        ...(input.configOverrides ?? {})
    });
    const freshArgsFor = (profileArgs, freshConfigArgs) => [
        ...codexLaunch.args,
        "exec",
        ...profileArgs,
        ...freshConfigArgs,
        "--json",
        "--skip-git-repo-check",
        ...(input.sandboxMode ? ["-s", input.sandboxMode] : []),
        ...unique(input.addDirs ?? []).flatMap((dir) => ["--add-dir", dir]),
        ...(schemaPath ? ["--output-schema", schemaPath] : []),
        "--output-last-message",
        responsePath,
        "-"
    ];
    let args = usesResume
        ? [
            ...codexLaunch.args,
            "exec",
            "resume",
            ...resumeConfigArgs,
            "--skip-git-repo-check",
            "--json",
            "--output-last-message",
            responsePath,
            ...(input.resumeLast ? ["--last"] : [input.sessionId ?? ""]),
            "-"
        ]
        : freshArgsFor(baseArgs, configArgs);
    const runCodexProcess = async (executionArgs) => new Promise((resolvePromise) => {
        const startedAt = Date.now();
        const timeoutMs = input.timeoutMs ?? codexCommandTimeoutMs();
        const staleOutputTimeoutMs = input.staleOutputTimeoutMs ?? codexStaleOutputTimeoutMs();
        const outputLimitBytes = input.outputLimitBytes ?? codexOutputLimitBytes();
        let wallTimer;
        let staleTimer;
        let settled = false;
        let child;
        let stdout = "";
        let stderr = "";
        let timeoutState;
        const finish = (result) => {
            if (settled) {
                return;
            }
            settled = true;
            if (wallTimer) {
                clearTimeout(wallTimer);
            }
            if (staleTimer) {
                clearTimeout(staleTimer);
            }
            resolvePromise({
                ...result,
                durationMs: Date.now() - startedAt
            });
        };
        const finishTimeout = () => {
            if (!timeoutState) {
                return false;
            }
            finish({
                code: 124,
                stdout,
                stderr,
                error: timeoutState.message,
                timedOut: true,
                timeoutReason: timeoutState.reason
            });
            return true;
        };
        const killForTimeout = (reason, message) => {
            if (settled || timeoutState) {
                return;
            }
            timeoutState = { reason, message };
            void stopProcessTree(child?.pid ?? -1).finally(() => {
                finishTimeout();
            });
        };
        const refreshStaleTimer = () => {
            if (staleTimer) {
                clearTimeout(staleTimer);
            }
            staleTimer = setTimeout(() => {
                killForTimeout("stale_output_timeout", `Codex command produced no output for ${staleOutputTimeoutMs} ms.`);
            }, staleOutputTimeoutMs);
        };
        const appendOutput = (stream, chunk) => {
            const text = chunk instanceof Buffer ? chunk.toString() : String(chunk);
            const current = stream === "stdout" ? stdout : stderr;
            const currentBytes = Buffer.byteLength(current);
            const textBytes = Buffer.byteLength(text);
            if (currentBytes + textBytes > outputLimitBytes) {
                const remaining = Math.max(0, outputLimitBytes - currentBytes);
                const clipped = remaining > 0 ? text.slice(0, remaining) : "";
                if (stream === "stdout") {
                    stdout += clipped;
                }
                else {
                    stderr += clipped;
                }
                killForTimeout("output_limit_exceeded", `Codex command output exceeded ${outputLimitBytes} bytes.`);
                return;
            }
            if (stream === "stdout") {
                stdout += text;
            }
            else {
                stderr += text;
            }
            refreshStaleTimer();
        };
        try {
            child = spawn(command, executionArgs, {
                cwd: input.cwd,
                env: process.env,
                shell: false,
                windowsHide: true
            });
        }
        catch (error) {
            finish({
                code: -1,
                stdout: "",
                stderr: "",
                error: error instanceof Error ? error.message : String(error)
            });
            return;
        }
        wallTimer = setTimeout(() => {
            killForTimeout("wall_clock_timeout", `Codex command timed out after ${timeoutMs} ms.`);
        }, timeoutMs);
        refreshStaleTimer();
        child.stdout.on("data", (chunk) => {
            appendOutput("stdout", chunk);
        });
        child.stderr.on("data", (chunk) => {
            appendOutput("stderr", chunk);
        });
        child.on("error", (error) => {
            if (finishTimeout()) {
                return;
            }
            finish({
                code: -1,
                stdout,
                stderr,
                error: error instanceof Error ? error.message : String(error)
            });
        });
        child.on("close", (code) => {
            if (finishTimeout()) {
                return;
            }
            finish({
                code: code ?? 1,
                stdout,
                stderr
            });
        });
        child.stdin.write(input.prompt);
        child.stdin.end();
    });
    let execution = await runCodexProcess(args);
    const missingProfile = !usesResume ? missingCodexProfileName(execution) : undefined;
    let profileFallbackUsed = false;
    let profileFallbackReason;
    if (input.profile && missingProfile === input.profile) {
        const fallbackOverrides = codexProfileFallbackOverrides(input.profile);
        if (fallbackOverrides) {
            profileFallbackUsed = true;
            profileFallbackReason = `Codex profile '${input.profile}' was not configured; retried with equivalent explicit config overrides.`;
            args = freshArgsFor([], configArgsFor({
                ...fallbackOverrides,
                ...(input.configOverrides ?? {})
            }));
            execution = await runCodexProcess(args);
        }
    }
    const codexSensitiveValues = codexSensitiveValuesForRedaction();
    const stdoutRedaction = redactText(execution.stdout, codexSensitiveValues);
    const stderrRedaction = redactText(execution.stderr, codexSensitiveValues);
    const stdout = stdoutRedaction.text;
    const stderr = stderrRedaction.text;
    await Promise.all([
        writeText(stdoutPath, stdout),
        writeText(stderrPath, stderr),
        writeText(eventsPath, stdout)
    ]);
    let responseText;
    let responseError;
    let responseWritten = false;
    let responseRedactionCount = 0;
    if (execution.code === 0 && !execution.error) {
        try {
            const rawResponseText = await readFile(responsePath, "utf8");
            const responseRedaction = redactText(rawResponseText, codexSensitiveValues);
            responseText = responseRedaction.text;
            responseRedactionCount = responseRedaction.count;
            if (responseRedaction.redacted) {
                await writeText(responsePath, responseRedaction.text);
            }
            responseWritten = true;
        }
        catch (error) {
            responseError =
                error instanceof Error
                    ? error.message
                    : "Codex finished but no response file was written.";
        }
    }
    const threadId = extractThreadIdFromJsonl(stdout) ?? input.sessionId;
    const result = {
        code: execution.code,
        stdout,
        stderr,
        eventsText: stdout,
        ...(responseText ? { responseText } : {}),
        ...(execution.error ? { error: execution.error } : {}),
        ...(responseError ? { error: responseError } : {}),
        ...(execution.timedOut ? { timedOut: true } : {}),
        ...(execution.timeoutReason ? { timeoutReason: execution.timeoutReason } : {}),
        durationMs: execution.durationMs,
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
        usedResume: usesResume,
        disabled: false
    };
    await writeJson(metadataPath, {
        name: input.name,
        cwd: input.cwd,
        args,
        used_resume: result.usedResume,
        effective_policy: effectiveCodexPolicy,
        disabled: false,
        code: result.code,
        thread_id: result.threadId ?? null,
        prompt_path: promptPath,
        response_path: responsePath,
        stdout_path: stdoutPath,
        stderr_path: stderrPath,
        events_path: eventsPath,
        response_written: responseWritten,
        profile_fallback_used: profileFallbackUsed,
        ...(profileFallbackReason ? { profile_fallback_reason: profileFallbackReason } : {}),
        codex_command: command,
        duration_ms: execution.durationMs,
        timed_out: execution.timedOut === true,
        timeout_reason: execution.timeoutReason ?? null,
        timeout_ms: input.timeoutMs ?? codexCommandTimeoutMs(),
        stale_output_timeout_ms: input.staleOutputTimeoutMs ?? codexStaleOutputTimeoutMs(),
        output_limit_bytes: input.outputLimitBytes ?? codexOutputLimitBytes(),
        redaction: {
            policy_version: stdoutRedaction.policy_version,
            stdout_redacted: stdoutRedaction.redacted,
            stdout_redaction_count: stdoutRedaction.count,
            stderr_redacted: stderrRedaction.redacted,
            stderr_redaction_count: stderrRedaction.count,
            response_redacted: responseRedactionCount > 0,
            response_redaction_count: responseRedactionCount
        },
        ...(schemaPath ? { schema_path: schemaPath } : {}),
        ...(input.profile ? { profile: input.profile } : {}),
        ...(input.configOverrides ? { config_overrides: input.configOverrides } : {}),
        ...(result.error ? { error: result.error } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {})
    });
    return result;
};
//# sourceMappingURL=codex-runtime.js.map