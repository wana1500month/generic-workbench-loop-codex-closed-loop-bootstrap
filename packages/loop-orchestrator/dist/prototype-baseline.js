import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadJsonIfExists, writeJson } from "./file-system.js";
const prototypeBaselineSourceSemanticsValues = new Set([
    "initial_pre_round_baseline",
    "first_rendered_round_fallback",
    "operator_provided_initial_baseline",
    "post_mutation_or_late_round_baseline",
    "unknown_baseline_origin"
]);
export const validPrototypeBaselineSourcePhases = new Set([
    "pre_round_1",
    "round_1_initial_prototype_fallback",
    "operator_provided_baseline"
]);
export const prototypeBaselinePaths = (runtimeDirectory) => ({
    manifestPath: join(runtimeDirectory, "product-baseline.json"),
    screenshotPath: join(runtimeDirectory, "baseline-home.png"),
    tracePath: join(runtimeDirectory, "baseline-trace.zip")
});
export const isValidPrototypeBaselineSourcePhase = (value) => typeof value === "string" && validPrototypeBaselineSourcePhases.has(value);
export const prototypeBaselineSourceSemanticsForPhase = (value) => {
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
export const isPrototypeBaselineSourceSemantics = (value) => typeof value === "string" &&
    prototypeBaselineSourceSemanticsValues.has(value);
export const describePrototypeBaselineSourceSemantics = (value) => {
    switch (value) {
        case "initial_pre_round_baseline":
            return "A true pre-round baseline was captured before generator mutation began.";
        case "first_rendered_round_fallback":
            return "No pre-round existing-product baseline was available, so the first rendered round is serving as the comparison baseline.";
        case "operator_provided_initial_baseline":
            return "An operator-provided initial baseline is serving as the comparison baseline.";
        case "post_mutation_or_late_round_baseline":
            return "The stored baseline came from post-mutation or later-round evidence, so it does not represent the initial prototype honestly.";
        case "unknown_baseline_origin":
            return "The stored baseline origin is unclear, so it should not be trusted as an initial prototype without operator review.";
        default:
            return undefined;
    }
};
export const hasPrototypeBaseline = (state) => typeof state?.baseline_path === "string" && state.baseline_path.trim().length > 0;
export const hasValidPrototypeBaseline = (state) => hasPrototypeBaseline(state) && isValidPrototypeBaselineSourcePhase(state.source_phase);
export const attachedPreGeneratorBaselineWindowOpen = (input) => input.round === 1 &&
    input.attachedGeneratorEligible &&
    !input.existingTask &&
    !input.existingResponse;
export const loadPrototypeBaselineState = async (runtimeDirectory) => loadJsonIfExists(prototypeBaselinePaths(runtimeDirectory).manifestPath);
const browserSurfaceExpected = (profile) => (Array.isArray(profile.expected_target_surfaces) &&
    profile.expected_target_surfaces.includes("browser")) ||
    (profile.core_probes ?? []).some((probe) => probe.mode === "browser" || probe.mode === "browser_journey");
const selectBaselineProbe = (profile) => (profile.core_probes ?? []).find((probe) => probe.required !== false &&
    (probe.mode === "browser" || probe.mode === "browser_journey")) ??
    (profile.core_probes ?? []).find((probe) => probe.mode === "browser" || probe.mode === "browser_journey");
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
    const literalTarget = typeof probe?.target === "string" && probe.target.trim().length > 0
        ? probe.target.trim()
        : undefined;
    const manifestTarget = targetManifestValueForProbe(probe, config, targetManifest);
    const baseTarget = manifestTarget ?? literalTarget ?? config.app_url ?? config.ready_url;
    if (!baseTarget) {
        return undefined;
    }
    if (probe?.target_path) {
        return new URL(probe.target_path, baseTarget).toString();
    }
    return baseTarget;
};
const resolvedJourneyTarget = (target, stepValue) => typeof stepValue === "string" && stepValue.trim().length > 0
    ? new URL(stepValue.trim(), target).toString()
    : target;
const waitForUrl = async (url, timeoutMs = 60000) => {
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
        }
        catch {
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
        }
    }
    return {
        ok: false,
        status: 0,
        body: ""
    };
};
const loadChromium = async () => {
    const playwright = await import("playwright-core");
    return playwright.chromium;
};
const browserExecutableCandidates = () => process.platform === "win32"
    ? ["msedge", "chrome", "chromium"]
    : process.platform === "darwin"
        ? ["Google Chrome", "Microsoft Edge", "chromium"]
        : ["google-chrome", "chromium", "chromium-browser", "microsoft-edge"];
const resolveBrowserExecutable = (profile) => {
    const probeExecutable = (profile.core_probes ?? []).find((probe) => (probe.mode === "browser" || probe.mode === "browser_journey") &&
        typeof probe.browser_executable === "string" &&
        probe.browser_executable.trim().length > 0)?.browser_executable;
    if (typeof probeExecutable === "string" && probeExecutable.trim().length > 0) {
        return probeExecutable.trim();
    }
    if (typeof process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH === "string" &&
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.trim().length > 0) {
        return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.trim();
    }
    return browserExecutableCandidates()[0];
};
const executeBestEffortBaselineJourney = async (input) => {
    await input.page.goto(input.target, {
        waitUntil: "networkidle",
        timeout: input.timeoutMs
    });
    for (const step of input.steps) {
        const stepTimeout = step.timeout_ms ?? input.timeoutMs;
        try {
            switch (step.action) {
                case "goto":
                    await input.page.goto(resolvedJourneyTarget(input.target, step.value), {
                        waitUntil: "networkidle",
                        timeout: stepTimeout
                    });
                    break;
                case "click":
                    await input.page.locator(step.selector ?? "").click({ timeout: stepTimeout });
                    break;
                case "fill":
                    await input.page.locator(step.selector ?? "").fill(step.value ?? "", {
                        timeout: stepTimeout
                    });
                    break;
                case "press":
                    await input.page.locator(step.selector ?? "").press(step.value ?? "", {
                        timeout: stepTimeout
                    });
                    break;
                case "reload":
                    await input.page.reload({ waitUntil: "networkidle", timeout: stepTimeout });
                    break;
                case "wait_for":
                    if (step.selector) {
                        await input.page.locator(step.selector).waitFor({
                            state: "visible",
                            timeout: stepTimeout
                        });
                    }
                    else {
                        await input.page.waitForTimeout(stepTimeout);
                    }
                    break;
                case "assert_visible":
                case "assert_not_visible":
                case "assert_text":
                case "assert_value":
                case "assert_url":
                    break;
            }
        }
        catch {
            break;
        }
    }
};
export const captureBootstrapGeneratedBaselineIfNeeded = async (input) => {
    const existingBaseline = await loadPrototypeBaselineState(input.runtimeDirectory);
    const existingBaselineSourceSemantics = prototypeBaselineSourceSemanticsForPhase(existingBaseline?.source_phase);
    if (hasValidPrototypeBaseline(existingBaseline)) {
        return {
            status: "reused",
            baseline_path: existingBaseline.baseline_path,
            source_phase: existingBaseline.source_phase,
            ...(existingBaselineSourceSemantics
                ? { source_semantics: existingBaselineSourceSemantics }
                : {}),
            ...(typeof existingBaseline.source_round === "number"
                ? { source_round: existingBaseline.source_round }
                : {}),
            ...(existingBaseline.source_target ? { source_target: existingBaseline.source_target } : {}),
            ...(Array.isArray(existingBaseline.evidence_paths)
                ? { evidence_paths: existingBaseline.evidence_paths }
                : {}),
            prototype_baseline_present: true,
            prototype_baseline_valid: true
        };
    }
    const generatedRoot = join(dirname(input.loadedAdapter.contract_path), ".generated", "codex-adapter");
    const profile = input.loadedAdapter.verification_profile?.profile ??
        (await loadJsonIfExists(join(dirname(input.loadedAdapter.contract_path), "verification-profile.generated.json")));
    if (!profile || !browserSurfaceExpected(profile)) {
        return {
            status: "skipped",
            reason: "non_browser_surface",
            ...(existingBaselineSourceSemantics
                ? { source_semantics: existingBaselineSourceSemantics }
                : {}),
            prototype_baseline_present: hasPrototypeBaseline(existingBaseline),
            prototype_baseline_valid: hasValidPrototypeBaseline(existingBaseline)
        };
    }
    const config = (await loadJsonIfExists(join(generatedRoot, "runtime-config.json"))) ?? {};
    const baselineProbe = selectBaselineProbe(profile);
    const baselineTarget = resolveBrowserBaselineTarget(baselineProbe, config, input.targetManifest);
    if (!baselineTarget) {
        return {
            status: "skipped",
            reason: "no_browser_target",
            ...(existingBaselineSourceSemantics
                ? { source_semantics: existingBaselineSourceSemantics }
                : {}),
            prototype_baseline_present: hasPrototypeBaseline(existingBaseline),
            prototype_baseline_valid: hasValidPrototypeBaseline(existingBaseline)
        };
    }
    const readinessUrl = config.ready_url ?? baselineTarget;
    const readinessProbe = await waitForUrl(readinessUrl, 1500);
    if (!readinessProbe.ok) {
        return {
            status: "skipped",
            reason: "target_not_ready",
            ...(existingBaselineSourceSemantics
                ? { source_semantics: existingBaselineSourceSemantics }
                : {}),
            readiness_url: readinessUrl,
            source_target: baselineTarget,
            prototype_baseline_present: hasPrototypeBaseline(existingBaseline),
            prototype_baseline_valid: hasValidPrototypeBaseline(existingBaseline)
        };
    }
    const { manifestPath, screenshotPath, tracePath } = prototypeBaselinePaths(input.runtimeDirectory);
    const timeoutMs = baselineProbe?.timeout_ms ?? 30000;
    let browser;
    let context;
    let traceStarted = false;
    try {
        const chromium = await loadChromium();
        const executablePath = resolveBrowserExecutable(profile);
        const activeBrowser = await chromium.launch({
            headless: true,
            ...(typeof executablePath === "string" && executablePath.length > 0
                ? { executablePath }
                : {})
        });
        browser = activeBrowser;
        const activeContext = await activeBrowser.newContext();
        context = activeContext;
        await activeContext.tracing.start({ screenshots: true, snapshots: true });
        traceStarted = true;
        const page = await activeContext.newPage();
        if (baselineProbe?.mode === "browser_journey" &&
            Array.isArray(baselineProbe.steps) &&
            baselineProbe.steps.length > 0) {
            await executeBestEffortBaselineJourney({
                page,
                target: baselineTarget,
                steps: baselineProbe.steps,
                timeoutMs
            });
        }
        else {
            await page.goto(baselineTarget, {
                waitUntil: "networkidle",
                timeout: timeoutMs
            });
        }
        await page.screenshot({ path: screenshotPath, fullPage: true });
        if (traceStarted) {
            await activeContext.tracing.stop({ path: tracePath });
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
        await writeJson(manifestPath, baselineState);
        return {
            status: "captured",
            baseline_path: screenshotPath,
            source_phase: "pre_round_1",
            source_semantics: "initial_pre_round_baseline",
            source_round: 0,
            source_target: baselineTarget,
            evidence_paths: evidencePaths,
            prototype_baseline_present: true,
            prototype_baseline_valid: true
        };
    }
    catch (error) {
        return {
            status: "blocked",
            reason: error instanceof Error ? error.message : "baseline_capture_failed",
            ...(existingBaselineSourceSemantics
                ? { source_semantics: existingBaselineSourceSemantics }
                : {}),
            source_target: baselineTarget,
            prototype_baseline_present: hasPrototypeBaseline(existingBaseline),
            prototype_baseline_valid: hasValidPrototypeBaseline(existingBaseline)
        };
    }
    finally {
        if (context) {
            if (traceStarted) {
                try {
                    await context.tracing.stop({ path: tracePath });
                }
                catch {
                    // ignore secondary trace failures
                }
            }
            await context.close();
        }
        if (browser) {
            await browser.close();
        }
    }
};
//# sourceMappingURL=prototype-baseline.js.map