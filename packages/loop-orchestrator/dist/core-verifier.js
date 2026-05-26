import { spawn } from "node:child_process";
import { mkdir, readFile, stat, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { resolvedAdapterTargetRoot } from "./adapter-paths.js";
import { loadJsonIfExists, writeJson, writeText } from "./file-system.js";
import { assertPlaywrightCoreImportAvailable } from "./playwright-availability.js";
import { stopProcessTree } from "./process-runtime.js";
import { assertAllowedTargetUrl } from "./target-url-policy.js";
const sha256ForBuffer = (value) => createHash("sha256").update(value).digest("hex");
const defaultProbeRoleForMode = (mode) => mode === "http_json" || mode === "browser_journey" ? "release_gate" : "supporting";
const defaultSemanticLevelForMode = (mode) => mode === "http_json" || mode === "browser_journey" ? "feature" : "liveness";
const positiveIntegerEnv = (name, fallback) => {
    const parsed = Number(process.env[name]);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
const httpBodyMaxBytes = () => positiveIntegerEnv("HARNESS_HTTP_BODY_MAX_BYTES", 1024 * 1024);
const commandOutputMaxBytes = () => positiveIntegerEnv("HARNESS_COMMAND_OUTPUT_MAX_BYTES", 1024 * 1024);
const targetManifestValueForProbe = (probe, targetManifest) => {
    const key = probe.target_manifest_key;
    if (!key) {
        return undefined;
    }
    return targetManifest?.[key];
};
const resolvedLiveProbeTarget = (input) => {
    const context = `Core verification probe '${input.probe.probe_id}'`;
    const manifestValue = targetManifestValueForProbe(input.probe, input.targetManifest)?.trim();
    if (manifestValue || input.probe.target?.trim()) {
        const baseTarget = manifestValue ?? input.probe.target?.trim();
        if (!baseTarget) {
            throw new Error(`Core verification probe '${input.probe.probe_id}' is missing a live target.`);
        }
        if (input.probe.target_path) {
            return assertAllowedTargetUrl(new URL(input.probe.target_path, baseTarget).toString(), context);
        }
        return assertAllowedTargetUrl(baseTarget, context);
    }
    if (input.probe.target?.trim()) {
        return assertAllowedTargetUrl(input.probe.target.trim(), context);
    }
    if (input.probe.target_manifest_key) {
        throw new Error(`Core verification probe '${input.probe.probe_id}' requested target_manifest.${input.probe.target_manifest_key}, but run_target did not publish it.`);
    }
    throw new Error(`Core verification probe '${input.probe.probe_id}' is missing a literal target and target_manifest_key.`);
};
const quoted = (value) => `"${value.replace(/"/g, '\\"')}"`;
const commandTokens = (command) => command.match(/"[^"]+"|'[^']+'|\S+/g)?.map((token) => token.replace(/^['"]|['"]$/g, "")) ?? [];
const shellExecutableFor = (shell) => {
    switch (shell) {
        case "powershell":
            return "powershell.exe";
        case "sh":
            return "sh";
        case "bash":
            return "bash";
        case "cmd":
            return "cmd.exe";
    }
    throw new Error(`Unsupported shell: ${shell}`);
};
const blockedEnvironmentPattern = /ERR_BLOCKED_BY_ADMINISTRATOR|ERR_BLOCKED_BY_CLIENT|Access is denied|administrator|sandbox/i;
const classifyProbeFailureSummary = (summary) => blockedEnvironmentPattern.test(summary) ? "environment_blocked" : "probe_error";
const loadChromium = async () => {
    await assertPlaywrightCoreImportAvailable();
    const playwright = await import("playwright-core");
    return playwright.chromium;
};
const stringValueForJsonPath = (value, jsonPath) => {
    const tokens = jsonPath
        .split(".")
        .map((token) => token.trim())
        .filter(Boolean);
    let current = value;
    for (const token of tokens) {
        if (Array.isArray(current)) {
            const index = Number(token);
            if (!Number.isInteger(index) || index < 0 || index >= current.length) {
                return undefined;
            }
            current = current[index];
            continue;
        }
        if (typeof current !== "object" || current === null || !(token in current)) {
            return undefined;
        }
        current = current[token];
    }
    if (typeof current === "string") {
        return current;
    }
    if (typeof current === "number" ||
        typeof current === "boolean" ||
        current === null) {
        return String(current);
    }
    return current === undefined ? undefined : JSON.stringify(current);
};
const readResponseTextLimited = async (response, maxBytes) => {
    if (!response.body) {
        const text = await response.text();
        const buffer = Buffer.from(text);
        return {
            text: buffer.subarray(0, maxBytes).toString(),
            truncated: buffer.length > maxBytes
        };
    }
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    let truncated = false;
    while (true) {
        const { done, value } = await reader.read();
        if (done || !value) {
            break;
        }
        const chunk = Buffer.from(value);
        const remaining = maxBytes - totalBytes;
        if (remaining <= 0) {
            truncated = true;
            await reader.cancel();
            break;
        }
        if (chunk.length > remaining) {
            chunks.push(chunk.subarray(0, remaining));
            totalBytes = maxBytes;
            truncated = true;
            await reader.cancel();
            break;
        }
        chunks.push(chunk);
        totalBytes += chunk.length;
    }
    return {
        text: Buffer.concat(chunks).toString("utf8"),
        truncated
    };
};
const resolvedProbeTarget = (input) => {
    if (!input.probe.target) {
        throw new Error(`Core verification probe '${input.probe.probe_id}' is missing a target-root path target.`);
    }
    return resolve(resolvedAdapterTargetRoot(input.loadedAdapter), input.probe.target);
};
const buildAttestation = async (input) => {
    const resultRaw = await readFile(input.resultPath);
    const evidenceSha256 = {};
    for (const evidencePath of input.evidencePaths) {
        evidenceSha256[evidencePath] = sha256ForBuffer(await readFile(evidencePath));
    }
    return {
        started_at: input.startedAt.toISOString(),
        finished_at: input.finishedAt.toISOString(),
        duration_ms: input.finishedAt.getTime() - input.startedAt.getTime(),
        target: input.target,
        result_sha256: sha256ForBuffer(resultRaw),
        evidence_sha256: evidenceSha256
    };
};
const executeHttpProbe = async (input) => {
    const timeoutMs = input.probe.timeout_ms ?? 15_000;
    const target = resolvedLiveProbeTarget({
        probe: input.probe,
        targetManifest: input.targetManifest
    });
    const response = await fetch(target, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "manual"
    });
    const { text: body, truncated } = await readResponseTextLimited(response, httpBodyMaxBytes());
    const bodyPath = join(input.probeDirectory, `${input.probe.probe_id}-body.txt`);
    await writeText(bodyPath, body);
    const ok = response.ok &&
        !truncated &&
        body.includes(input.probe.expected_value ?? "");
    return {
        ok,
        summary: ok
            ? `HTTP probe '${input.probe.probe_id}' observed expected content at '${target}'.`
            : `HTTP probe '${input.probe.probe_id}' did not observe expected content at '${target}'.`,
        target,
        observedValue: `status=${response.status}; body_contains=${body.includes(input.probe.expected_value ?? "")}; body_truncated=${truncated}`,
        evidencePaths: [bodyPath]
    };
};
const executeHttpJsonProbe = async (input) => {
    const timeoutMs = input.probe.timeout_ms ?? 15_000;
    const target = resolvedLiveProbeTarget({
        probe: input.probe,
        targetManifest: input.targetManifest
    });
    const response = await fetch(target, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "manual"
    });
    const { text: rawBody, truncated } = await readResponseTextLimited(response, httpBodyMaxBytes());
    const bodyPath = join(input.probeDirectory, `${input.probe.probe_id}-body.json`);
    await writeText(bodyPath, rawBody);
    if (truncated) {
        return {
            ok: false,
            summary: `HTTP JSON probe '${input.probe.probe_id}' response from '${target}' exceeded the body cap.`,
            target,
            observedValue: `status=${response.status}; observed=body_truncated`,
            evidencePaths: [bodyPath]
        };
    }
    if (!input.probe.json_path || input.probe.expected_value === undefined) {
        return {
            ok: false,
            summary: `HTTP JSON probe '${input.probe.probe_id}' is missing json_path or expected_value.`,
            target,
            observedValue: `status=${response.status}; observed=undefined`,
            evidencePaths: [bodyPath]
        };
    }
    let parsed;
    try {
        parsed = JSON.parse(rawBody);
    }
    catch {
        return {
            ok: false,
            summary: `HTTP JSON probe '${input.probe.probe_id}' got non-JSON response from '${target}'.`,
            target,
            observedValue: `status=${response.status}; observed=non-json`,
            evidencePaths: [bodyPath]
        };
    }
    const observed = stringValueForJsonPath(parsed, input.probe.json_path);
    const expectedStatus = input.probe.expected_status ?? 200;
    const statusOk = response.status === expectedStatus;
    const valueOk = observed === input.probe.expected_value;
    const failureSummary = `status=${response.status}; observed=${observed ?? "undefined"}; body=${rawBody}`;
    const failureClassification = !statusOk || !valueOk
        ? response.status === 403 || response.status === 451 || blockedEnvironmentPattern.test(failureSummary)
            ? "environment_blocked"
            : "probe_error"
        : undefined;
    return {
        ok: statusOk && valueOk,
        summary: statusOk && valueOk
            ? `HTTP JSON probe '${input.probe.probe_id}' matched '${input.probe.json_path}' at '${target}'.`
            : failureClassification === "environment_blocked"
                ? `HTTP JSON probe '${input.probe.probe_id}' hit an environment block at '${target}'.`
                : `HTTP JSON probe '${input.probe.probe_id}' did not match '${input.probe.json_path}' at '${target}'.`,
        target,
        observedValue: `status=${response.status}; observed=${observed ?? "undefined"}`,
        evidencePaths: [bodyPath],
        ...(failureClassification ? { failureClassification } : {})
    };
};
const execCommand = async (input) => new Promise((resolvePromise, rejectPromise) => {
    const child = (() => {
        if (input.shell) {
            return spawn(input.command, {
                cwd: input.cwd,
                env: input.env,
                shell: shellExecutableFor(input.shell),
                detached: process.platform !== "win32",
                windowsHide: true
            });
        }
        const [command, ...args] = Array.isArray(input.args)
            ? [input.command, ...input.args]
            : commandTokens(input.command);
        if (!command) {
            rejectPromise(new Error("Core verification probe command cannot be empty."));
            return undefined;
        }
        return spawn(command, args, {
            cwd: input.cwd,
            env: input.env,
            shell: false,
            detached: process.platform !== "win32",
            windowsHide: true
        });
    })();
    if (!child) {
        return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let outputLimitExceeded = false;
    const outputLimitBytes = commandOutputMaxBytes();
    const timer = setTimeout(() => {
        timedOut = true;
        void stopProcessTree(child.pid ?? -1);
    }, input.timeoutMs);
    child.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        if (Buffer.byteLength(stdout) + Buffer.byteLength(text) > outputLimitBytes) {
            const remaining = Math.max(outputLimitBytes - Buffer.byteLength(stdout), 0);
            stdout += Buffer.from(text).subarray(0, remaining).toString();
            stdout += `\n[output truncated after ${outputLimitBytes} bytes]\n`;
            outputLimitExceeded = true;
            void stopProcessTree(child.pid ?? -1);
            return;
        }
        stdout += text;
    });
    child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        if (Buffer.byteLength(stderr) + Buffer.byteLength(text) > outputLimitBytes) {
            const remaining = Math.max(outputLimitBytes - Buffer.byteLength(stderr), 0);
            stderr += Buffer.from(text).subarray(0, remaining).toString();
            stderr += `\n[output truncated after ${outputLimitBytes} bytes]\n`;
            outputLimitExceeded = true;
            void stopProcessTree(child.pid ?? -1);
            return;
        }
        stderr += text;
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) {
            rejectPromise(new Error(`Core verification probe timed out: ${input.command}`));
            return;
        }
        if (outputLimitExceeded) {
            rejectPromise(new Error(`Core verification probe exceeded output cap (${outputLimitBytes} bytes per stream): ${input.command}`));
            return;
        }
        resolvePromise({ code, stdout, stderr });
    });
});
const browserExecutableCandidates = () => {
    switch (process.platform) {
        case "win32":
            return [
                "msedge.exe",
                "chrome.exe",
                "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
                "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
                "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
                "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
            ];
        case "darwin":
            return [
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
                "/Applications/Chromium.app/Contents/MacOS/Chromium"
            ];
        default:
            return [
                "google-chrome",
                "chromium",
                "chromium-browser",
                "microsoft-edge",
                "/usr/bin/google-chrome",
                "/usr/bin/chromium",
                "/usr/bin/chromium-browser",
                "/usr/bin/microsoft-edge"
            ];
    }
};
const canExecute = async (path) => {
    try {
        await access(path, process.platform === "win32" ? 0 : 0o111);
        return true;
    }
    catch {
        return false;
    }
};
const findExecutableOnPath = async (name) => {
    if (isAbsolute(name)) {
        return (await canExecute(name)) ? name : undefined;
    }
    if (name.includes("\\") || name.includes("/")) {
        return (await canExecute(name)) ? name : undefined;
    }
    for (const directory of (process.env.PATH ?? "").split(delimiter)) {
        if (!directory) {
            continue;
        }
        const candidate = join(directory, name);
        if (await canExecute(candidate)) {
            return candidate;
        }
        if (process.platform === "win32" && !candidate.toLowerCase().endsWith(".exe")) {
            const exeCandidate = `${candidate}.exe`;
            if (await canExecute(exeCandidate)) {
                return exeCandidate;
            }
        }
    }
    return undefined;
};
const resolveBrowserExecutable = async (input) => {
    const explicit = input.probe.browser_executable?.trim() ||
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
    if (explicit) {
        const explicitPath = explicit.includes("\\") || explicit.includes("/")
            ? resolve(input.loadedAdapter.base_directory, explicit)
            : explicit;
        return (await findExecutableOnPath(explicitPath)) ?? undefined;
    }
    for (const candidate of browserExecutableCandidates()) {
        const resolved = await findExecutableOnPath(candidate);
        if (resolved) {
            return resolved;
        }
    }
    return undefined;
};
const resolvedJourneyTarget = (target, stepValue) => {
    const resolved = stepValue?.trim() ? new URL(stepValue.trim(), target).toString() : target;
    return assertAllowedTargetUrl(resolved, "Browser journey probe step");
};
const executeBrowserProbe = async (input) => {
    const timeoutMs = input.probe.timeout_ms ?? 20_000;
    const target = resolvedLiveProbeTarget({
        probe: input.probe,
        targetManifest: input.targetManifest
    });
    const browserExecutable = await resolveBrowserExecutable({
        probe: input.probe,
        loadedAdapter: input.loadedAdapter
    });
    if (!browserExecutable) {
        return {
            ok: false,
            summary: "Browser verification is environment-blocked: no Chrome/Chromium executable was found.",
            target,
            observedValue: "browser_executable=missing",
            evidencePaths: [],
            failureClassification: "environment_blocked"
        };
    }
    const domPath = join(input.probeDirectory, `${input.probe.probe_id}-dom.html`);
    const stderrPath = join(input.probeDirectory, `${input.probe.probe_id}-stderr.log`);
    const command = `${quoted(browserExecutable)} --headless --disable-gpu --dump-dom ${quoted(target)}`;
    const result = await execCommand({
        command,
        cwd: input.loadedAdapter.base_directory,
        timeoutMs,
        env: process.env
    });
    await Promise.all([writeText(domPath, result.stdout), writeText(stderrPath, result.stderr)]);
    const ok = result.code === 0 && result.stdout.includes(input.probe.expected_value ?? "");
    return {
        ok,
        summary: ok
            ? `Browser probe '${input.probe.probe_id}' observed expected DOM content at '${target}'.`
            : `Browser probe '${input.probe.probe_id}' did not observe expected DOM content at '${target}'.`,
        target,
        observedValue: `exit_code=${String(result.code)}; dom_contains=${result.stdout.includes(input.probe.expected_value ?? "")}`,
        evidencePaths: [domPath, stderrPath],
        ...(!ok
            ? {
                failureClassification: classifyProbeFailureSummary(`${result.stderr}\n${result.stdout}`)
            }
            : {})
    };
};
const executeBrowserJourneyProbe = async (input) => {
    const timeoutMs = input.probe.timeout_ms ?? 30_000;
    const target = resolvedLiveProbeTarget({
        probe: input.probe,
        targetManifest: input.targetManifest
    });
    const browserExecutable = await resolveBrowserExecutable({
        probe: input.probe,
        loadedAdapter: input.loadedAdapter
    });
    if (!browserExecutable) {
        return {
            ok: false,
            summary: "Browser verification is environment-blocked: no Chrome/Chromium executable was found.",
            target,
            observedValue: "browser_executable=missing",
            evidencePaths: [],
            failureClassification: "environment_blocked"
        };
    }
    const steps = input.probe.steps ?? [];
    if (steps.length === 0) {
        return {
            ok: false,
            summary: `Browser journey probe '${input.probe.probe_id}' has no steps to execute.`,
            target,
            observedValue: "steps=0",
            evidencePaths: []
        };
    }
    const transcriptPath = join(input.probeDirectory, `${input.probe.probe_id}-journey.json`);
    const tracePath = join(input.probeDirectory, `${input.probe.probe_id}-trace.zip`);
    const evidencePaths = [];
    const transcript = [];
    const chromium = await loadChromium();
    const browser = await chromium.launch({
        executablePath: browserExecutable,
        headless: true
    });
    let context;
    let page;
    let ok = true;
    let failureSummary = "";
    try {
        context = await browser.newContext();
        await context.tracing.start({ screenshots: true, snapshots: true });
        page = await context.newPage();
        for (const [index, step] of steps.entries()) {
            const stepTimeout = step.timeout_ms ?? timeoutMs;
            const screenshotPath = join(input.probeDirectory, `${input.probe.probe_id}-step-${String(index + 1).padStart(2, "0")}.png`);
            const entry = {
                step: index + 1,
                action: step.action,
                selector: step.selector,
                value: step.value
            };
            switch (step.action) {
                case "goto": {
                    const url = resolvedJourneyTarget(target, step.value);
                    await page.goto(url, { waitUntil: "networkidle", timeout: stepTimeout });
                    entry.url = url;
                    break;
                }
                case "click":
                    await page.locator(step.selector ?? "").click({ timeout: stepTimeout });
                    break;
                case "fill":
                    await page.locator(step.selector ?? "").fill(step.value ?? "", {
                        timeout: stepTimeout
                    });
                    break;
                case "press":
                    await page.locator(step.selector ?? "").press(step.value ?? "", {
                        timeout: stepTimeout
                    });
                    break;
                case "reload":
                    await page.reload({ waitUntil: "networkidle", timeout: stepTimeout });
                    entry.url = page.url();
                    break;
                case "wait_for":
                    if (step.selector) {
                        await page.locator(step.selector).waitFor({
                            state: "visible",
                            timeout: stepTimeout
                        });
                    }
                    else {
                        await page.waitForTimeout(stepTimeout);
                    }
                    break;
                case "assert_visible":
                    await page.locator(step.selector ?? "").waitFor({
                        state: "visible",
                        timeout: stepTimeout
                    });
                    break;
                case "assert_not_visible":
                    await page.locator(step.selector ?? "").waitFor({
                        state: "hidden",
                        timeout: stepTimeout
                    });
                    break;
                case "assert_text": {
                    const text = step.selector
                        ? (await page.locator(step.selector).textContent({ timeout: stepTimeout })) ?? ""
                        : (await page.textContent("body")) ?? "";
                    if (!text.includes(step.value ?? "")) {
                        throw new Error(`expected text '${step.value ?? ""}' was not visible${step.selector ? ` for selector '${step.selector}'` : ""}`);
                    }
                    entry.observed = text.slice(0, 200);
                    break;
                }
                case "assert_value": {
                    const observedValue = await page
                        .locator(step.selector ?? "")
                        .inputValue({ timeout: stepTimeout });
                    if (observedValue !== (step.value ?? "")) {
                        throw new Error(`expected input value '${step.value ?? ""}' but observed '${observedValue}'${step.selector ? ` for selector '${step.selector}'` : ""}`);
                    }
                    entry.observed = observedValue;
                    break;
                }
                case "assert_url": {
                    const currentUrl = page.url();
                    if (!currentUrl.includes(step.value ?? "")) {
                        throw new Error(`expected URL '${currentUrl}' to include '${step.value ?? ""}'`);
                    }
                    entry.observed = currentUrl;
                    break;
                }
            }
            await page.screenshot({ path: screenshotPath });
            evidencePaths.push(screenshotPath);
            entry.outcome = "pass";
            entry.screenshot_path = screenshotPath;
            transcript.push(entry);
        }
    }
    catch (error) {
        ok = false;
        failureSummary =
            error instanceof Error
                ? error.message
                : `Browser journey probe '${input.probe.probe_id}' failed with an unknown error.`;
        if (page) {
            const failureScreenshotPath = join(input.probeDirectory, `${input.probe.probe_id}-failure.png`);
            try {
                await page.screenshot({ path: failureScreenshotPath });
                evidencePaths.push(failureScreenshotPath);
            }
            catch {
                // ignore secondary screenshot failures
            }
        }
        transcript.push({
            step: transcript.length + 1,
            action: "error",
            outcome: "fail",
            value: failureSummary
        });
    }
    finally {
        await writeJson(transcriptPath, transcript);
        evidencePaths.push(transcriptPath);
        if (context) {
            try {
                await context.tracing.stop({ path: tracePath });
                evidencePaths.push(tracePath);
            }
            catch {
                // ignore trace stop failures
            }
            await context.close();
        }
        await browser.close();
    }
    return {
        ok,
        summary: ok
            ? `Browser journey probe '${input.probe.probe_id}' completed ${steps.length} step(s) against '${target}'.`
            : `Browser journey probe '${input.probe.probe_id}' failed: ${failureSummary}`,
        target,
        observedValue: ok
            ? `steps=${steps.length}; final_url=${transcript[transcript.length - 1]?.url ?? target}`
            : `steps_completed=${Math.max(transcript.length - 1, 0)}; failure=${failureSummary}`,
        evidencePaths,
        ...(!ok
            ? {
                failureClassification: classifyProbeFailureSummary(failureSummary)
            }
            : {})
    };
};
const executeShellCommandProbe = async (input) => {
    const timeoutMs = input.probe.timeout_ms ?? 15_000;
    if (!input.probe.target) {
        throw new Error(`Core verification probe '${input.probe.probe_id}' is missing a shell command target.`);
    }
    const cwd = resolve(resolvedAdapterTargetRoot(input.loadedAdapter), input.probe.cwd ?? ".");
    const stdoutPath = join(input.probeDirectory, `${input.probe.probe_id}-stdout.log`);
    const stderrPath = join(input.probeDirectory, `${input.probe.probe_id}-stderr.log`);
    const result = await execCommand({
        command: input.probe.target,
        args: input.probe.args,
        cwd,
        timeoutMs,
        env: {
            ...process.env,
            HARNESS_TARGET_ROOT: resolvedAdapterTargetRoot(input.loadedAdapter),
            HARNESS_RUN_DIRECTORY: input.runDirectory,
            HARNESS_ROUND_DIRECTORY: input.roundDirectory
        },
        shell: input.probe.shell
    });
    await Promise.all([writeText(stdoutPath, result.stdout), writeText(stderrPath, result.stderr)]);
    const expectedExitCode = input.probe.expected_exit_code ?? 0;
    const exitCodeMatches = result.code === expectedExitCode;
    const stdoutMatches = input.probe.expected_value === undefined ||
        result.stdout.includes(input.probe.expected_value);
    const ok = exitCodeMatches && stdoutMatches;
    return {
        ok,
        summary: ok
            ? `Shell probe '${input.probe.probe_id}' observed expected output from '${input.probe.target}'.`
            : `Shell probe '${input.probe.probe_id}' did not observe expected output from '${input.probe.target}'.`,
        target: input.probe.target,
        observedValue: `exit_code=${String(result.code)}; stdout_contains=${stdoutMatches}`,
        evidencePaths: [stdoutPath, stderrPath]
    };
};
const executeFileContainsProbe = async (input) => {
    const targetPath = resolvedProbeTarget(input);
    const content = await readFile(targetPath, "utf8");
    const contains = content.includes(input.probe.expected_value ?? "");
    return {
        ok: contains,
        summary: contains
            ? `File probe '${input.probe.probe_id}' observed expected content in '${targetPath}'.`
            : `File probe '${input.probe.probe_id}' did not observe expected content in '${targetPath}'.`,
        target: targetPath,
        observedValue: contains ? "present" : "missing",
        evidencePaths: [targetPath]
    };
};
const executeJsonValueProbe = async (input) => {
    const targetPath = resolvedProbeTarget(input);
    const parsed = JSON.parse(await readFile(targetPath, "utf8"));
    const observedValue = stringValueForJsonPath(parsed, input.probe.json_path ?? "");
    const ok = observedValue === input.probe.expected_value;
    return {
        ok,
        summary: ok
            ? `JSON probe '${input.probe.probe_id}' matched '${input.probe.json_path}' in '${targetPath}'.`
            : `JSON probe '${input.probe.probe_id}' did not match '${input.probe.json_path}' in '${targetPath}'.`,
        target: targetPath,
        observedValue: observedValue ?? "undefined",
        evidencePaths: [targetPath]
    };
};
export const executeCoreVerificationProbes = async (input) => {
    const profile = input.loadedAdapter?.verification_profile?.profile;
    if (!input.loadedAdapter || !profile?.core_probes || profile.core_probes.length === 0) {
        return [];
    }
    const probeDirectory = join(input.roundDirectory, "core-probes");
    await mkdir(probeDirectory, { recursive: true });
    const executions = [];
    const probes = input.probeIds && input.probeIds.length > 0
        ? profile.core_probes.filter((probe) => input.probeIds?.includes(probe.probe_id))
        : profile.core_probes;
    for (const probe of probes) {
        const startedAt = new Date();
        const resultPath = join(probeDirectory, `${probe.probe_id}-result.json`);
        const required = probe.required ?? true;
        const role = probe.role ?? defaultProbeRoleForMode(probe.mode);
        const semanticLevel = probe.semantic_level ?? defaultSemanticLevelForMode(probe.mode);
        try {
            const execution = probe.mode === "browser_journey"
                ? await executeBrowserJourneyProbe({
                    probe,
                    loadedAdapter: input.loadedAdapter,
                    targetManifest: input.targetManifest,
                    probeDirectory
                })
                : probe.mode === "browser"
                    ? await executeBrowserProbe({
                        probe,
                        loadedAdapter: input.loadedAdapter,
                        targetManifest: input.targetManifest,
                        probeDirectory
                    })
                    : probe.mode === "http_json"
                        ? await executeHttpJsonProbe({
                            probe,
                            probeDirectory,
                            targetManifest: input.targetManifest
                        })
                        : probe.mode === "http"
                            ? await executeHttpProbe({
                                probe,
                                probeDirectory,
                                targetManifest: input.targetManifest
                            })
                            : probe.mode === "shell_command"
                                ? await executeShellCommandProbe({
                                    probe,
                                    loadedAdapter: input.loadedAdapter,
                                    runDirectory: input.runDirectory,
                                    roundDirectory: input.roundDirectory,
                                    probeDirectory
                                })
                                : probe.mode === "file_contains"
                                    ? await executeFileContainsProbe({
                                        probe,
                                        loadedAdapter: input.loadedAdapter,
                                        runDirectory: input.runDirectory,
                                        roundDirectory: input.roundDirectory
                                    })
                                    : await executeJsonValueProbe({
                                        probe,
                                        loadedAdapter: input.loadedAdapter,
                                        runDirectory: input.runDirectory,
                                        roundDirectory: input.roundDirectory
                                    });
            await writeJson(resultPath, {
                probe_id: probe.probe_id,
                label: probe.label,
                role,
                ...(probe.assertion_id ? { assertion_id: probe.assertion_id } : {}),
                ...(probe.assertion_tags?.length ? { assertion_tags: probe.assertion_tags } : {}),
                ...(probe.quality_axis_id ? { quality_axis_id: probe.quality_axis_id } : {}),
                semantic_level: semanticLevel,
                mode: probe.mode,
                required,
                ok: execution.ok,
                summary: execution.summary,
                target: execution.target,
                observed_value: execution.observedValue,
                evidence_paths: execution.evidencePaths,
                ...(execution.failureClassification
                    ? { failure_classification: execution.failureClassification }
                    : {})
            });
            const finishedAt = new Date();
            const recordedExecution = {
                probe_id: probe.probe_id,
                label: probe.label,
                role,
                ...(probe.assertion_id ? { assertion_id: probe.assertion_id } : {}),
                ...(probe.assertion_tags?.length ? { assertion_tags: probe.assertion_tags } : {}),
                ...(probe.quality_axis_id ? { quality_axis_id: probe.quality_axis_id } : {}),
                semantic_level: semanticLevel,
                mode: probe.mode,
                required,
                ok: execution.ok,
                summary: execution.summary,
                target: execution.target,
                evidence_paths: [resultPath, ...execution.evidencePaths],
                observed_value: execution.observedValue,
                ...(execution.failureClassification
                    ? { failure_classification: execution.failureClassification }
                    : {}),
                attestation: await buildAttestation({
                    startedAt,
                    finishedAt,
                    target: execution.target,
                    resultPath,
                    evidencePaths: [resultPath, ...execution.evidencePaths]
                })
            };
            executions.push(recordedExecution);
            await input.onProbeComplete?.(recordedExecution);
        }
        catch (error) {
            const summary = error instanceof Error
                ? error.message
                : `Core verification probe '${probe.probe_id}' failed with an unknown error.`;
            const target = probe.mode === "http" ||
                probe.mode === "http_json" ||
                probe.mode === "browser" ||
                probe.mode === "browser_journey"
                ? (() => {
                    try {
                        return resolvedLiveProbeTarget({
                            probe,
                            targetManifest: input.targetManifest
                        });
                    }
                    catch {
                        return `${probe.mode}:unresolved`;
                    }
                })()
                : probe.mode === "shell_command"
                    ? probe.target ?? "shell_command:unresolved"
                    : resolvedProbeTarget({
                        probe,
                        loadedAdapter: input.loadedAdapter,
                        runDirectory: input.runDirectory,
                        roundDirectory: input.roundDirectory
                    });
            await writeJson(resultPath, {
                probe_id: probe.probe_id,
                label: probe.label,
                role,
                ...(probe.assertion_id ? { assertion_id: probe.assertion_id } : {}),
                ...(probe.assertion_tags?.length ? { assertion_tags: probe.assertion_tags } : {}),
                ...(probe.quality_axis_id ? { quality_axis_id: probe.quality_axis_id } : {}),
                semantic_level: semanticLevel,
                mode: probe.mode,
                required,
                ok: false,
                summary,
                target,
                evidence_paths: [],
                failure_classification: classifyProbeFailureSummary(summary)
            });
            const finishedAt = new Date();
            const recordedExecution = {
                probe_id: probe.probe_id,
                label: probe.label,
                role,
                ...(probe.assertion_id ? { assertion_id: probe.assertion_id } : {}),
                ...(probe.assertion_tags?.length ? { assertion_tags: probe.assertion_tags } : {}),
                ...(probe.quality_axis_id ? { quality_axis_id: probe.quality_axis_id } : {}),
                semantic_level: semanticLevel,
                mode: probe.mode,
                required,
                ok: false,
                summary: `Core verification probe '${probe.probe_id}' failed: ${summary}`,
                target,
                evidence_paths: [resultPath],
                failure_classification: classifyProbeFailureSummary(summary),
                attestation: await buildAttestation({
                    startedAt,
                    finishedAt,
                    target,
                    resultPath,
                    evidencePaths: [resultPath]
                })
            };
            executions.push(recordedExecution);
            await input.onProbeComplete?.(recordedExecution);
        }
    }
    return executions;
};
export const restoreCoreVerificationProbeExecutions = async (input) => {
    const profile = input.loadedAdapter?.verification_profile?.profile;
    if (!input.loadedAdapter || !profile?.core_probes || profile.core_probes.length === 0) {
        return [];
    }
    const probeDirectory = join(input.roundDirectory, "core-probes");
    const restored = [];
    for (const probe of profile.core_probes) {
        const resultPath = join(probeDirectory, `${probe.probe_id}-result.json`);
        const storedResult = await loadJsonIfExists(resultPath);
        if (!storedResult) {
            continue;
        }
        const role = storedResult.role ?? probe.role ?? defaultProbeRoleForMode(probe.mode);
        const semanticLevel = storedResult.semantic_level ??
            probe.semantic_level ??
            defaultSemanticLevelForMode(probe.mode);
        const evidencePaths = Array.isArray(storedResult.evidence_paths)
            ? storedResult.evidence_paths.filter((path) => typeof path === "string")
            : [];
        const restoredEvidencePaths = [resultPath, ...evidencePaths];
        const resultStats = await stat(resultPath);
        const attestationTimestamp = resultStats.mtime;
        const target = typeof storedResult.target === "string" ? storedResult.target : probe.target ?? "";
        restored.push({
            probe_id: probe.probe_id,
            label: typeof storedResult.label === "string" && storedResult.label.trim().length > 0
                ? storedResult.label
                : probe.label,
            mode: probe.mode,
            role,
            ...(probe.assertion_id ? { assertion_id: probe.assertion_id } : {}),
            ...(probe.assertion_tags?.length ? { assertion_tags: probe.assertion_tags } : {}),
            ...(probe.quality_axis_id ? { quality_axis_id: probe.quality_axis_id } : {}),
            semantic_level: semanticLevel,
            required: typeof storedResult.required === "boolean"
                ? storedResult.required
                : probe.required ?? true,
            ok: storedResult.ok === true,
            summary: typeof storedResult.summary === "string" && storedResult.summary.trim().length > 0
                ? storedResult.summary
                : `Restored core verification probe '${probe.probe_id}'.`,
            target,
            evidence_paths: restoredEvidencePaths,
            ...(typeof storedResult.observed_value === "string"
                ? { observed_value: storedResult.observed_value }
                : {}),
            ...(storedResult.failure_classification
                ? { failure_classification: storedResult.failure_classification }
                : {}),
            attestation: await buildAttestation({
                startedAt: attestationTimestamp,
                finishedAt: attestationTimestamp,
                target,
                resultPath,
                evidencePaths: restoredEvidencePaths
            })
        });
    }
    return restored;
};
//# sourceMappingURL=core-verifier.js.map