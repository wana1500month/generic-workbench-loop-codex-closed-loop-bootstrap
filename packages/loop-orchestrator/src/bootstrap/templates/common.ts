import { relative } from "node:path";
export const moduleImportPath = (fromDirectory: string, toFile: string): string =>
  (() => {
    const normalized = relative(fromDirectory, toFile).replace(/\\/g, "/");
    return normalized.startsWith(".") ? normalized : `./${normalized}`;
  })();

export const helperTemplate = (codexRuntimeImportPath: string): string => `import { existsSync, openSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";
import {
  readCodexSession,
  runCodexCommand,
  writeCodexSession
} from "${codexRuntimeImportPath}";

const roundDirectory = process.env.HARNESS_ROUND_DIRECTORY ?? process.cwd();
const runDirectory = process.env.HARNESS_RUN_DIRECTORY ?? roundDirectory;
const adapterDirectory = join(roundDirectory, "adapter");
const artifactsDirectory = join(roundDirectory, "artifacts");
const runtimeDirectory =
  process.env.HARNESS_RUNTIME_DIRECTORY ?? join(runDirectory, "runtime");
const codexSessionRegistryPath =
  process.env.HARNESS_CODEX_SESSION_REGISTRY_PATH ??
  join(runtimeDirectory, "codex-sessions.json");
const inputPath = process.env.HARNESS_INPUT_PATH;
const outputPath = process.env.HARNESS_OUTPUT_PATH;
const targetRoot = process.env.HARNESS_TARGET_ROOT ?? process.cwd();
const verificationProfilePath =
  process.env.HARNESS_VERIFICATION_PROFILE_PATH ??
  new URL("../../../verification-profile.generated.json", import.meta.url);

const ensureDirectory = async (path) => {
  await mkdir(path, { recursive: true });
  return path;
};

export const readConfig = async () =>
  JSON.parse(await readFile(new URL("../runtime-config.json", import.meta.url), "utf8"));

export const readIdeaMarkdown = async () => {
  const config = await readConfig();
  if (!config.idea_path) {
    return "";
  }
  try {
    return await readFile(config.idea_path, "utf8");
  } catch {
    return "";
  }
};

export const readVerificationProfile = async () =>
  JSON.parse(await readFile(verificationProfilePath, "utf8"));

export const readPacket = async () => {
  if (!inputPath) {
    return {};
  }
  return JSON.parse(await readFile(inputPath, "utf8"));
};

export const readCoreProbeResults = async () => {
  const path = process.env.HARNESS_CORE_PROBE_RESULTS_PATH;
  if (!path) {
    return [];
  }
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return [];
  }
};

export const readTargetManifest = async () => {
  const path = process.env.HARNESS_TARGET_MANIFEST_PATH;
  if (!path) {
    return {};
  }
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return {};
  }
};

export const writeJson = async (path, value) => {
  await ensureDirectory(dirname(path));
  await writeFile(path, JSON.stringify(value, null, 2) + "\\n", "utf8");
};

export const writeText = async (path, value) => {
  await ensureDirectory(dirname(path));
  await writeFile(path, value, "utf8");
};

export const relativeToRound = (path) =>
  path.startsWith(roundDirectory)
    ? path.slice(roundDirectory.length + 1).replace(/\\\\/g, "/")
    : path.replace(/\\\\/g, "/");

export const normalizeRoundPath = (value) =>
  typeof value === "string" && value
    ? value.startsWith(roundDirectory)
      ? relativeToRound(value)
      : value.replace(/\\\\/g, "/")
    : value;

export const writeArtifact = async (name, contents) => {
  const fullPath = join(artifactsDirectory, name);
  await writeText(fullPath, contents);
  return relativeToRound(fullPath);
};

export const writeArtifactJson = async (name, value) => {
  const fullPath = join(artifactsDirectory, name);
  await writeJson(fullPath, value);
  return relativeToRound(fullPath);
};

export const writeRuntimeJson = async (name, value) => {
  const fullPath = join(runtimeDirectory, name);
  await writeJson(fullPath, value);
  return fullPath;
};

export const writeRuntimeText = async (name, value) => {
  const fullPath = join(runtimeDirectory, name);
  await writeText(fullPath, value);
  return fullPath;
};

export const readJsonIfExists = async (path) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
};

export const loadChromium = async () => {
  const playwright = await import("playwright-core");
  return playwright.chromium;
};

const browserExecutableCandidates = () =>
  process.platform === "win32"
    ? [
        "msedge.exe",
        "chrome.exe",
        "chromium.exe",
        "C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe",
        "C:\\\\Program Files\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe",
        "C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe",
        "C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe"
      ]
    : process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "chromium"
        ]
      : [
          "google-chrome",
          "chromium",
          "chromium-browser",
          "microsoft-edge",
          "/usr/bin/google-chrome",
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser",
          "/usr/bin/microsoft-edge"
        ];

const canExecute = async (path) => {
  try {
    await access(path, process.platform === "win32" ? 0 : 0o111);
    return true;
  } catch {
    return false;
  }
};

const findExecutableOnPath = async (name) => {
  if (isAbsolute(name)) {
    return (await canExecute(name)) ? name : undefined;
  }
  if (name.includes("\\\\") || name.includes("/")) {
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
      const exeCandidate = candidate + ".exe";
      if (await canExecute(exeCandidate)) {
        return exeCandidate;
      }
    }
  }
  return undefined;
};

export const resolveBrowserExecutable = async (profile) => {
  const probeExecutable = (profile.core_probes ?? []).find(
    (probe) =>
      (probe.mode === "browser" || probe.mode === "browser_journey") &&
      typeof probe.browser_executable === "string" &&
      probe.browser_executable.trim().length > 0
  )?.browser_executable;
  if (typeof probeExecutable === "string" && probeExecutable.trim().length > 0) {
    return findExecutableOnPath(probeExecutable.trim());
  }
  if (
    typeof process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH === "string" &&
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.trim().length > 0
  ) {
    return findExecutableOnPath(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.trim());
  }
  for (const candidate of browserExecutableCandidates()) {
    const resolved = await findExecutableOnPath(candidate);
    if (resolved) {
      return resolved;
    }
  }
  return undefined;
};

const browserSurfaceExpected = (profile) =>
  (Array.isArray(profile.expected_target_surfaces) &&
    profile.expected_target_surfaces.includes("browser")) ||
  (profile.core_probes ?? []).some(
    (probe) => probe.mode === "browser" || probe.mode === "browser_journey"
  );

const selectBaselineProbe = (profile) =>
  (profile.core_probes ?? []).find(
    (probe) =>
      probe.required !== false &&
      (probe.mode === "browser" || probe.mode === "browser_journey")
  ) ??
  (profile.core_probes ?? []).find(
    (probe) => probe.mode === "browser" || probe.mode === "browser_journey"
  );

const targetManifestValueForProbe = (probe, config, targetManifest) => {
  if (probe?.target_manifest_key === "app_url") {
    return targetManifest?.app_url ?? config.app_url;
  }
  if (probe?.target_manifest_key === "health_url") {
    return targetManifest?.health_url ?? config.health_url;
  }
  if (probe?.target_manifest_key === "api_base_url") {
    return targetManifest?.api_base_url ?? config.api_base_url;
  }
  return undefined;
};

const resolveBrowserBaselineTarget = (probe, config, targetManifest) => {
  const literalTarget =
    typeof probe?.target === "string" && probe.target.trim().length > 0
      ? probe.target.trim()
      : undefined;
  const manifestTarget = probe
    ? targetManifestValueForProbe(probe, config, targetManifest)
    : undefined;
  const baseTarget = manifestTarget ?? literalTarget ?? config.app_url ?? config.ready_url;
  if (!baseTarget) {
    return undefined;
  }
  if (probe?.target_path) {
    return new URL(probe.target_path, baseTarget).toString();
  }
  return baseTarget;
};

const resolvedJourneyTarget = (target, stepValue) =>
  typeof stepValue === "string" && stepValue.trim().length > 0
    ? new URL(stepValue.trim(), target).toString()
    : target;

const executeBestEffortBaselineJourney = async ({ page, target, steps, timeoutMs }) => {
  await page.goto(target, {
    waitUntil: "networkidle",
    timeout: timeoutMs
  });
  for (const step of steps) {
    const stepTimeout = step.timeout_ms ?? timeoutMs;
    try {
      switch (step.action) {
        case "goto":
          await page.goto(resolvedJourneyTarget(target, step.value), {
            waitUntil: "networkidle",
            timeout: stepTimeout
          });
          break;
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
        case "assert_not_visible":
        case "assert_text":
        case "assert_value":
        case "assert_url":
          break;
      }
    } catch {
      break;
    }
  }
};

export const captureBrowserBaselineIfNeeded = async (options = {}) => {
  const baselineManifestPath = join(runtimeDirectory, "product-baseline.json");
  const existingBaseline = await readJsonIfExists(baselineManifestPath);
  const baselineSourceSemanticsForPhase = (value) => {
    if (value === "pre_round_1") {
      return "initial_pre_round_baseline";
    }
    if (value === "round_1_initial_prototype_fallback") {
      return "first_rendered_round_fallback";
    }
    if (value === "operator_provided_baseline") {
      return "operator_provided_initial_baseline";
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      return undefined;
    }
    if (value.startsWith("post_round_") || value.includes("post_")) {
      return "post_mutation_or_late_round_baseline";
    }
    return "unknown_baseline_origin";
  };
  const existingBaselineSourceSemantics = baselineSourceSemanticsForPhase(
    existingBaseline?.source_phase
  );
  if (
    existingBaseline &&
    typeof existingBaseline.baseline_path === "string" &&
    existingBaseline.baseline_path.length > 0
  ) {
    return {
      status: "reused",
      baseline_path: existingBaseline.baseline_path,
      source_phase: existingBaseline.source_phase ?? null,
      ...(existingBaselineSourceSemantics
        ? { source_semantics: existingBaselineSourceSemantics }
        : {})
    };
  }

  const config = options.config ?? (await readConfig());
  const profile = options.profile ?? (await readVerificationProfile());
  if (!browserSurfaceExpected(profile)) {
    return {
      status: "skipped",
      reason: "non_browser_surface",
      ...(existingBaselineSourceSemantics
        ? { source_semantics: existingBaselineSourceSemantics }
        : {})
    };
  }

  const targetManifest = await readTargetManifest();
  const baselineProbe = selectBaselineProbe(profile);
  const baselineTarget = resolveBrowserBaselineTarget(
    baselineProbe,
    config,
    targetManifest
  );
  if (!baselineTarget) {
    return {
      status: "skipped",
      reason: "no_browser_target",
      ...(existingBaselineSourceSemantics
        ? { source_semantics: existingBaselineSourceSemantics }
        : {})
    };
  }

  const readinessUrl = config.ready_url ?? baselineTarget;
  const readinessProbe = await waitForUrl(readinessUrl, 1500);
  if (!readinessProbe.ok) {
    return {
      status: "skipped",
      reason: "target_not_ready",
      readiness_url: readinessUrl,
      ...(existingBaselineSourceSemantics
        ? { source_semantics: existingBaselineSourceSemantics }
        : {})
    };
  }

  let browser;
  let context;
  let traceStarted = false;
  const screenshotPath = join(runtimeDirectory, "baseline-home.png");
  const tracePath = join(runtimeDirectory, "baseline-trace.zip");
  const timeoutMs = options.timeoutMs ?? baselineProbe?.timeout_ms ?? 30000;

  try {
    const executablePath = await resolveBrowserExecutable(profile);
    if (!executablePath) {
      return {
        status: "blocked",
        reason: "browser_executable=missing",
        readiness_url: readinessUrl,
        ...(existingBaselineSourceSemantics
          ? { source_semantics: existingBaselineSourceSemantics }
          : {})
      };
    }
    const chromium = await loadChromium();
    browser = await chromium.launch({
      headless: true,
      executablePath
    });
    context = await browser.newContext();
    await context.tracing.start({ screenshots: true, snapshots: true });
    traceStarted = true;
    const page = await context.newPage();
    if (
      baselineProbe?.mode === "browser_journey" &&
      Array.isArray(baselineProbe.steps) &&
      baselineProbe.steps.length > 0
    ) {
      await executeBestEffortBaselineJourney({
        page,
        target: baselineTarget,
        steps: baselineProbe.steps,
        timeoutMs
      });
    } else {
      await page.goto(baselineTarget, {
        waitUntil: "networkidle",
        timeout: timeoutMs
      });
    }
    await page.screenshot({ path: screenshotPath, fullPage: true });
    if (traceStarted) {
      await context.tracing.stop({ path: tracePath });
      traceStarted = false;
    }
    const evidencePaths = [screenshotPath];
    if (existsSync(tracePath)) {
      evidencePaths.push(tracePath);
    }
    const baselineState = {
      source_round: 0,
      source_phase: "pre_round_1",
      source_semantics: "initial_pre_round_baseline",
      baseline_path: screenshotPath,
      source_target: baselineTarget,
      probe_id: baselineProbe?.probe_id ?? null,
      created_at: new Date().toISOString(),
      evidence_paths: evidencePaths
    };
    await writeRuntimeJson("product-baseline.json", baselineState);
    return {
      status: "captured",
      baseline_path: screenshotPath,
      source_phase: "pre_round_1",
      source_semantics: "initial_pre_round_baseline",
      source_target: baselineTarget,
      evidence_paths: evidencePaths
    };
  } catch (error) {
    if (traceStarted && context) {
      try {
        await context.tracing.stop({ path: tracePath });
      } catch {}
    }
    return {
      status: "blocked",
      reason: error instanceof Error ? error.message : String(error),
      source_target: baselineTarget,
      ...(existingBaselineSourceSemantics
        ? { source_semantics: existingBaselineSourceSemantics }
        : {})
    };
  } finally {
    if (context) {
      try {
        await context.close();
      } catch {}
    }
    if (browser) {
      await browser.close();
    }
  }
};

export const finalize = async (result) => {
  if (!outputPath) {
    throw new Error("HARNESS_OUTPUT_PATH is not set.");
  }
  await writeJson(outputPath, result);
};

export const roundScore = (value) => Math.round(value * 1000) / 1000;

export const spawnCommand = async (command, options = {}) =>
  new Promise((resolvePromise) => {
    const child = spawn(command, {
      cwd: options.cwd ?? targetRoot,
      env: { ...process.env, ...(options.env ?? {}) },
      shell: options.shell ?? true,
      detached: options.detached ?? false,
      windowsHide: options.windowsHide ?? true
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    if (typeof options.stdinText === "string") {
      child.stdin?.write(options.stdinText);
      child.stdin?.end();
    }

    if (options.detached) {
      child.unref();
      resolvePromise({ code: 0, stdout, stderr, pid: child.pid ?? -1 });
      return;
    }

    child.on("close", (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr, pid: child.pid ?? -1 });
    });
  });

export const startDetachedCommand = async (command, logPath, cwd = targetRoot) => {
  await ensureDirectory(dirname(logPath));
  const stdoutFd = openSync(logPath, "a");
  const stderrFd = openSync(logPath, "a");
  const child = spawn(command, {
    cwd,
    env: process.env,
    shell: true,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", stdoutFd, stderrFd]
  });
  child.unref();
  return { pid: child.pid ?? -1 };
};

export { readCodexSession, runCodexCommand, writeCodexSession };

export const isProcessAlive = (pid) => {
  if (typeof pid !== "number" || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const stopProcessTree = async (pid) => {
  if (typeof pid !== "number" || pid <= 0) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise((resolvePromise) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        shell: false,
        windowsHide: true,
        stdio: "ignore"
      });
      killer.on("close", () => resolvePromise(undefined));
      killer.on("error", () => resolvePromise(undefined));
    });
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
};

export const waitForUrl = async (url, timeoutMs = 60000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      const body = await response.text();
      return {
        ok: response.status >= 200 && response.status < 500,
        status: response.status,
        body: body.slice(0, 4000)
      };
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
    }
  }
  return {
    ok: false,
    status: 0,
    body: ""
  };
};

export const runtimePaths = {
  runDirectory,
  roundDirectory,
  adapterDirectory,
  artifactsDirectory,
  runtimeDirectory,
  codexSessionRegistryPath,
  targetRoot
};
`;
