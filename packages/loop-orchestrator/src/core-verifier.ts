import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

import { writeJson, writeText } from "./file-system.js";
import type {
  CoreProbeAttestation,
  ProbeFailureClassification,
  CoreVerificationProbeExecution,
  CoreVerificationProbeRole,
  LoadedAdapterContract,
  ProbeSemanticLevel,
  TargetManifest,
  VerificationCoreProbe
} from "./types.js";

const sha256ForBuffer = (value: Buffer | string): string =>
  createHash("sha256").update(value).digest("hex");

const defaultProbeRoleForMode = (
  mode: VerificationCoreProbe["mode"]
): CoreVerificationProbeRole =>
  mode === "http_json" || mode === "browser_journey" ? "release_gate" : "supporting";

const defaultSemanticLevelForMode = (
  mode: VerificationCoreProbe["mode"]
): ProbeSemanticLevel =>
  mode === "http_json" || mode === "browser_journey" ? "feature" : "liveness";

const targetManifestValueForProbe = (
  probe: VerificationCoreProbe,
  targetManifest?: TargetManifest
): string | undefined => {
  const key = probe.target_manifest_key;
  if (!key) {
    return undefined;
  }
  return targetManifest?.[key];
};

const resolvedLiveProbeTarget = (input: {
  probe: VerificationCoreProbe;
  targetManifest?: TargetManifest;
}): string => {
  const manifestValue = targetManifestValueForProbe(input.probe, input.targetManifest)?.trim();
  if (manifestValue || input.probe.target?.trim()) {
    const baseTarget = manifestValue ?? input.probe.target?.trim();
    if (!baseTarget) {
      throw new Error(
        `Core verification probe '${input.probe.probe_id}' is missing a live target.`
      );
    }
    if (input.probe.target_path) {
      return new URL(input.probe.target_path, baseTarget).toString();
    }
    return baseTarget;
  }
  if (input.probe.target?.trim()) {
    return input.probe.target.trim();
  }
  if (input.probe.target_manifest_key) {
    throw new Error(
      `Core verification probe '${input.probe.probe_id}' requested target_manifest.${input.probe.target_manifest_key}, but run_target did not publish it.`
    );
  }
  throw new Error(
    `Core verification probe '${input.probe.probe_id}' is missing a literal target and target_manifest_key.`
  );
};

const quoted = (value: string): string => `"${value.replace(/"/g, '\\"')}"`;

const shellExecutableFor = (
  shell: "powershell" | "sh" | "bash" | "cmd" | undefined
): string | true => {
  switch (shell) {
    case "powershell":
      return "powershell.exe";
    case "sh":
      return "sh";
    case "bash":
      return "bash";
    case "cmd":
      return "cmd.exe";
    default:
      return true;
  }
};

const blockedEnvironmentPattern =
  /ERR_BLOCKED_BY_ADMINISTRATOR|ERR_BLOCKED_BY_CLIENT|Access is denied|administrator|sandbox/i;

const classifyProbeFailureSummary = (
  summary: string
): ProbeFailureClassification =>
  blockedEnvironmentPattern.test(summary) ? "environment_blocked" : "probe_error";

const loadChromium = async () => {
  const playwright = await import("playwright-core");
  return playwright.chromium;
};

const stringValueForJsonPath = (value: unknown, jsonPath: string): string | undefined => {
  const tokens = jsonPath
    .split(".")
    .map((token) => token.trim())
    .filter(Boolean);
  let current: unknown = value;
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
    current = (current as Record<string, unknown>)[token];
  }

  if (typeof current === "string") {
    return current;
  }
  if (
    typeof current === "number" ||
    typeof current === "boolean" ||
    current === null
  ) {
    return String(current);
  }

  return current === undefined ? undefined : JSON.stringify(current);
};

const resolvedProbeTarget = (input: {
  probe: VerificationCoreProbe;
  loadedAdapter: LoadedAdapterContract;
  runDirectory?: string;
  roundDirectory?: string;
}): string => {
  if (!input.probe.target) {
    throw new Error(
      `Core verification probe '${input.probe.probe_id}' is missing a target-root path target.`
    );
  }
  return resolve(
    input.loadedAdapter.base_directory,
    input.loadedAdapter.contract.target_root,
    input.probe.target
  );
};

const buildAttestation = async (input: {
  startedAt: Date;
  finishedAt: Date;
  target: string;
  resultPath: string;
  evidencePaths: string[];
}): Promise<CoreProbeAttestation> => {
  const resultRaw = await readFile(input.resultPath);
  const evidenceSha256: Record<string, string> = {};
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

const executeHttpProbe = async (input: {
  probe: VerificationCoreProbe;
  probeDirectory: string;
  targetManifest?: TargetManifest;
}): Promise<{
  ok: boolean;
  summary: string;
  target: string;
  observedValue: string;
  evidencePaths: string[];
  failureClassification?: ProbeFailureClassification;
}> => {
  const timeoutMs = input.probe.timeout_ms ?? 15_000;
  const target = resolvedLiveProbeTarget({
    probe: input.probe,
    targetManifest: input.targetManifest
  });
  const response = await fetch(target, {
    signal: AbortSignal.timeout(timeoutMs)
  });
  const body = await response.text();
  const bodyPath = join(input.probeDirectory, `${input.probe.probe_id}-body.txt`);
  await writeText(bodyPath, body);
  const ok =
    response.ok &&
    body.includes(input.probe.expected_value ?? "");
  return {
    ok,
    summary: ok
      ? `HTTP probe '${input.probe.probe_id}' observed expected content at '${target}'.`
      : `HTTP probe '${input.probe.probe_id}' did not observe expected content at '${target}'.`,
    target,
    observedValue: `status=${response.status}; body_contains=${body.includes(
      input.probe.expected_value ?? ""
    )}`,
    evidencePaths: [bodyPath]
  };
};

const executeHttpJsonProbe = async (input: {
  probe: VerificationCoreProbe;
  probeDirectory: string;
  targetManifest?: TargetManifest;
}): Promise<{
  ok: boolean;
  summary: string;
  target: string;
  observedValue: string;
  evidencePaths: string[];
  failureClassification?: ProbeFailureClassification;
}> => {
  const timeoutMs = input.probe.timeout_ms ?? 15_000;
  const target = resolvedLiveProbeTarget({
    probe: input.probe,
    targetManifest: input.targetManifest
  });
  const response = await fetch(target, {
    signal: AbortSignal.timeout(timeoutMs)
  });
  const rawBody = await response.text();
  const bodyPath = join(input.probeDirectory, `${input.probe.probe_id}-body.json`);
  await writeText(bodyPath, rawBody);

  if (!input.probe.json_path || input.probe.expected_value === undefined) {
    return {
      ok: false,
      summary: `HTTP JSON probe '${input.probe.probe_id}' is missing json_path or expected_value.`,
      target,
      observedValue: `status=${response.status}; observed=undefined`,
      evidencePaths: [bodyPath]
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
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
  const failureClassification =
    !statusOk || !valueOk
      ? response.status === 403 || response.status === 451 || blockedEnvironmentPattern.test(failureSummary)
        ? "environment_blocked"
        : "probe_error"
      : undefined;

  return {
    ok: statusOk && valueOk,
    summary:
      statusOk && valueOk
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

const execCommand = async (input: {
  command: string;
  cwd: string;
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
  shell?: "powershell" | "sh" | "bash" | "cmd";
}): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(input.command, {
      cwd: input.cwd,
      env: input.env,
      shell: shellExecutableFor(input.shell)
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, input.timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        rejectPromise(new Error(`Core verification probe timed out: ${input.command}`));
        return;
      }
      resolvePromise({ code, stdout, stderr });
    });
  });

const browserExecutableCandidates = (): string[] => {
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

const resolveBrowserExecutable = (input: {
  probe: VerificationCoreProbe;
  loadedAdapter: LoadedAdapterContract;
}): string => {
  if (input.probe.browser_executable) {
    return input.probe.browser_executable.includes("\\") ||
      input.probe.browser_executable.includes("/")
      ? resolve(input.loadedAdapter.base_directory, input.probe.browser_executable)
      : input.probe.browser_executable;
  }

  const commandCandidates: string[] = [];
  for (const candidate of browserExecutableCandidates()) {
    if (!candidate.includes("\\") && !candidate.includes("/")) {
      commandCandidates.push(candidate);
      continue;
    }
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  if (commandCandidates.length > 0) {
    return commandCandidates[0];
  }

  throw new Error(
    `Core verification probe '${input.probe.probe_id}' could not find a compatible headless browser executable.`
  );
};

const resolvedJourneyTarget = (
  target: string,
  stepValue?: string
): string => {
  if (!stepValue?.trim()) {
    return target;
  }
  return new URL(stepValue.trim(), target).toString();
};

const executeBrowserProbe = async (input: {
  probe: VerificationCoreProbe;
  loadedAdapter: LoadedAdapterContract;
  targetManifest?: TargetManifest;
  probeDirectory: string;
}): Promise<{
  ok: boolean;
  summary: string;
  target: string;
  observedValue: string;
  evidencePaths: string[];
  failureClassification?: ProbeFailureClassification;
}> => {
  const timeoutMs = input.probe.timeout_ms ?? 20_000;
  const target = resolvedLiveProbeTarget({
    probe: input.probe,
    targetManifest: input.targetManifest
  });
  const browserExecutable = resolveBrowserExecutable({
    probe: input.probe,
    loadedAdapter: input.loadedAdapter
  });
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
    observedValue: `exit_code=${String(result.code)}; dom_contains=${result.stdout.includes(
      input.probe.expected_value ?? ""
    )}`,
    evidencePaths: [domPath, stderrPath],
    ...(!ok
      ? {
          failureClassification: classifyProbeFailureSummary(
            `${result.stderr}\n${result.stdout}`
          )
        }
      : {})
  };
};

const executeBrowserJourneyProbe = async (input: {
  probe: VerificationCoreProbe;
  loadedAdapter: LoadedAdapterContract;
  targetManifest?: TargetManifest;
  probeDirectory: string;
}): Promise<{
  ok: boolean;
  summary: string;
  target: string;
  observedValue: string;
  evidencePaths: string[];
  failureClassification?: ProbeFailureClassification;
}> => {
  const timeoutMs = input.probe.timeout_ms ?? 30_000;
  const target = resolvedLiveProbeTarget({
    probe: input.probe,
    targetManifest: input.targetManifest
  });
  const browserExecutable = resolveBrowserExecutable({
    probe: input.probe,
    loadedAdapter: input.loadedAdapter
  });
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
  const evidencePaths: string[] = [];
  const transcript: Array<Record<string, string | number | boolean | undefined>> = [];
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
      const screenshotPath = join(
        input.probeDirectory,
        `${input.probe.probe_id}-step-${String(index + 1).padStart(2, "0")}.png`
      );
      const entry: Record<string, string | number | boolean | undefined> = {
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
          } else {
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
          const text =
            step.selector
              ? (await page.locator(step.selector).textContent({ timeout: stepTimeout })) ?? ""
              : (await page.textContent("body")) ?? "";
          if (!text.includes(step.value ?? "")) {
            throw new Error(
              `expected text '${step.value ?? ""}' was not visible${
                step.selector ? ` for selector '${step.selector}'` : ""
              }`
            );
          }
          entry.observed = text.slice(0, 200);
          break;
        }
        case "assert_value": {
          const observedValue = await page
            .locator(step.selector ?? "")
            .inputValue({ timeout: stepTimeout });
          if (observedValue !== (step.value ?? "")) {
            throw new Error(
              `expected input value '${step.value ?? ""}' but observed '${observedValue}'${
                step.selector ? ` for selector '${step.selector}'` : ""
              }`
            );
          }
          entry.observed = observedValue;
          break;
        }
        case "assert_url": {
          const currentUrl = page.url();
          if (!currentUrl.includes(step.value ?? "")) {
            throw new Error(
              `expected URL '${currentUrl}' to include '${step.value ?? ""}'`
            );
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
  } catch (error: unknown) {
    ok = false;
    failureSummary =
      error instanceof Error
        ? error.message
        : `Browser journey probe '${input.probe.probe_id}' failed with an unknown error.`;
    if (page) {
      const failureScreenshotPath = join(
        input.probeDirectory,
        `${input.probe.probe_id}-failure.png`
      );
      try {
        await page.screenshot({ path: failureScreenshotPath });
        evidencePaths.push(failureScreenshotPath);
      } catch {
        // ignore secondary screenshot failures
      }
    }
    transcript.push({
      step: transcript.length + 1,
      action: "error",
      outcome: "fail",
      value: failureSummary
    });
  } finally {
    await writeJson(transcriptPath, transcript);
    evidencePaths.push(transcriptPath);
    if (context) {
      try {
        await context.tracing.stop({ path: tracePath });
        evidencePaths.push(tracePath);
      } catch {
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

const executeShellCommandProbe = async (input: {
  probe: VerificationCoreProbe;
  loadedAdapter: LoadedAdapterContract;
  runDirectory: string;
  roundDirectory: string;
  probeDirectory: string;
}): Promise<{
  ok: boolean;
  summary: string;
  target: string;
  observedValue: string;
  evidencePaths: string[];
  failureClassification?: ProbeFailureClassification;
}> => {
  const timeoutMs = input.probe.timeout_ms ?? 15_000;
  if (!input.probe.target) {
    throw new Error(
      `Core verification probe '${input.probe.probe_id}' is missing a shell command target.`
    );
  }
  const cwd = resolve(
    input.loadedAdapter.base_directory,
    input.loadedAdapter.contract.target_root,
    input.probe.cwd ?? "."
  );
  const stdoutPath = join(input.probeDirectory, `${input.probe.probe_id}-stdout.log`);
  const stderrPath = join(input.probeDirectory, `${input.probe.probe_id}-stderr.log`);
  const result = await execCommand({
    command: input.probe.target,
    cwd,
    timeoutMs,
    env: {
      ...process.env,
      HARNESS_TARGET_ROOT: resolve(
        input.loadedAdapter.base_directory,
        input.loadedAdapter.contract.target_root
      ),
      HARNESS_RUN_DIRECTORY: input.runDirectory,
      HARNESS_ROUND_DIRECTORY: input.roundDirectory
    },
    shell: input.probe.shell
  });
  await Promise.all([writeText(stdoutPath, result.stdout), writeText(stderrPath, result.stderr)]);

  const expectedExitCode = input.probe.expected_exit_code ?? 0;
  const exitCodeMatches = result.code === expectedExitCode;
  const stdoutMatches =
    input.probe.expected_value === undefined ||
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

const executeFileContainsProbe = async (input: {
  probe: VerificationCoreProbe;
  loadedAdapter: LoadedAdapterContract;
  runDirectory: string;
  roundDirectory: string;
}): Promise<{
  ok: boolean;
  summary: string;
  target: string;
  observedValue: string;
  evidencePaths: string[];
  failureClassification?: ProbeFailureClassification;
}> => {
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

const executeJsonValueProbe = async (input: {
  probe: VerificationCoreProbe;
  loadedAdapter: LoadedAdapterContract;
  runDirectory: string;
  roundDirectory: string;
}): Promise<{
  ok: boolean;
  summary: string;
  target: string;
  observedValue: string;
  evidencePaths: string[];
  failureClassification?: ProbeFailureClassification;
}> => {
  const targetPath = resolvedProbeTarget(input);
  const parsed = JSON.parse(await readFile(targetPath, "utf8")) as unknown;
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

export const executeCoreVerificationProbes = async (input: {
  loadedAdapter?: LoadedAdapterContract;
  runDirectory: string;
  roundDirectory: string;
  targetManifest?: TargetManifest;
}): Promise<CoreVerificationProbeExecution[]> => {
  const profile = input.loadedAdapter?.verification_profile?.profile;
  if (!input.loadedAdapter || !profile?.core_probes || profile.core_probes.length === 0) {
    return [];
  }

  const probeDirectory = join(input.roundDirectory, "core-probes");
  await mkdir(probeDirectory, { recursive: true });
  const executions: CoreVerificationProbeExecution[] = [];

  for (const probe of profile.core_probes) {
    const startedAt = new Date();
    const resultPath = join(probeDirectory, `${probe.probe_id}-result.json`);
    const required = probe.required ?? true;
    const role = probe.role ?? defaultProbeRoleForMode(probe.mode);
    const semanticLevel = probe.semantic_level ?? defaultSemanticLevelForMode(probe.mode);

    try {
      const execution =
        probe.mode === "browser_journey"
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
      executions.push({
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
      });
    } catch (error: unknown) {
      const summary =
        error instanceof Error
          ? error.message
          : `Core verification probe '${probe.probe_id}' failed with an unknown error.`;
      const target =
        probe.mode === "http" ||
        probe.mode === "http_json" ||
        probe.mode === "browser" ||
        probe.mode === "browser_journey"
          ? (() => {
              try {
                return resolvedLiveProbeTarget({
                  probe,
                  targetManifest: input.targetManifest
                });
              } catch {
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
      executions.push({
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
      });
    }
  }

  return executions;
};
