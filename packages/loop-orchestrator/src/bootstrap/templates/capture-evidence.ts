export const captureEvidenceTemplate = (): string => `import { join } from "node:path";

import {
  finalize,
  loadChromium,
  readVerificationProfile,
  readConfig,
  relativeToRound,
  resolveBrowserExecutable,
  runtimePaths,
  waitForUrl,
  writeArtifact,
  writeArtifactJson
} from "./runtime-helpers.mjs";

const workflowChecksForConfig = (config) =>
  Array.isArray(config.workflow_checks) && config.workflow_checks.length > 0
    ? config.workflow_checks
    : Array.isArray(config.adapter_plan?.workflow_checks)
      ? config.adapter_plan.workflow_checks
      : [];

const adapterPlanForConfig = (config) =>
  config.adapter_plan ?? {
    target_family: config.target_family,
    verification_surfaces: config.verification_surfaces ?? [],
    runtime_strategy: {
      run_command: config.run_command,
      check_command: config.check_command,
      ready_url: config.ready_url,
      app_url: config.app_url,
      api_base_url: config.api_base_url,
      health_url: config.health_url
    },
    workflow_checks: workflowChecksForConfig(config)
  };

const browserEvidenceExpected = (config) =>
  (config.verification_surfaces ?? []).includes("browser") ||
  (config.adapter_plan?.verification_surfaces ?? []).includes("browser");

const captureBrowserHomeEvidence = async ({ config, profile }) => {
  if (!browserEvidenceExpected(config)) {
    return { status: "skipped", reason: "browser surface was not requested" };
  }

  const executablePath = await resolveBrowserExecutable(profile);
  if (!executablePath) {
    return { status: "environment_blocked", reason: "browser_executable=missing" };
  }

  const target = config.app_url ?? config.ready_url;
  let browser;
  let context;
  try {
    const chromium = await loadChromium();
    browser = await chromium.launch({ headless: true, executablePath });
    context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(target, { waitUntil: "networkidle", timeout: 30000 });
    const html = await page.content();
    const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    const htmlPath = await writeArtifact("home.html", html);
    const textPath = await writeArtifact("home-text.txt", text);
    const screenshotPath = join(runtimePaths.artifactsDirectory, "home.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return {
      status: "captured",
      target,
      executable_path: executablePath,
      screenshot_path: relativeToRound(screenshotPath),
      html_path: htmlPath,
      text_path: textPath
    };
  } catch (error) {
    return {
      status: "environment_blocked",
      target,
      reason: error instanceof Error ? error.message : String(error)
    };
  } finally {
    if (context) {
      await context.close().catch(() => undefined);
    }
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
};

const main = async () => {
  const config = await readConfig();
  const profile = await readVerificationProfile();
  const adapterPlan = adapterPlanForConfig(config);
  const workflowChecks = workflowChecksForConfig(config);
  const probe = await waitForUrl(config.ready_url, 15000);
  const browserEvidence = await captureBrowserHomeEvidence({ config, profile });
  const workflowEvidencePath = await writeArtifactJson("workflow-evidence.json", {
    status: "planned",
    note: "capture_evidence records the requested workflow checks; core probes and run_checks own pass/fail classification.",
    workflow_checks: workflowChecks.map((check, index) => ({
      index: index + 1,
      workflow: check.workflow,
      surface: check.surface,
      trigger: check.trigger ?? null,
      expected_result: check.expected_result,
      selector_hints: check.selector_hints ?? null,
      api_hint: check.api_hint ?? null,
      command_hint: check.command_hint ?? null
    })),
    browser_evidence: browserEvidence
  });
  const reportPath = await writeArtifact(
    "capture-evidence.md",
    [
      "# Live evidence",
      "",
      "Ready URL: " + config.ready_url,
      "HTTP status: " + probe.status,
      "Reachable: " + String(probe.ok),
      "",
      "## Adapter plan",
      "",
      "~~~json",
      JSON.stringify(adapterPlan, null, 2),
      "~~~",
      "",
      "## Workflow checks",
      "",
      ...(workflowChecks.length > 0
        ? workflowChecks.map(
            (check, index) =>
              String(index + 1) +
              ". " +
              check.workflow +
              " -> " +
              check.expected_result +
              " (" +
              check.surface +
              ")"
          )
        : ["none"]),
      "",
      "## Browser evidence",
      "",
      "Status: " + browserEvidence.status,
      "Target: " + String(browserEvidence.target ?? "none"),
      "Screenshot: " + String(browserEvidence.screenshot_path ?? "none"),
      "HTML: " + String(browserEvidence.html_path ?? "none"),
      "Text: " + String(browserEvidence.text_path ?? "none"),
      "Reason: " + String(browserEvidence.reason ?? "none"),
      "",
      "## HTTP body",
      "",
      probe.body || "No response body captured."
    ].join("\\n")
  );
  const browserEvidencePaths = [
    browserEvidence.screenshot_path,
    browserEvidence.html_path,
    browserEvidence.text_path
  ].filter(Boolean);
  const evidencePaths = [reportPath, workflowEvidencePath, ...browserEvidencePaths];

  await finalize({
    capability: "capture_evidence",
    ok: probe.ok,
    summary: probe.ok
      ? "Captured live evidence from " + config.ready_url + "."
      : "Could not capture live evidence from " + config.ready_url + ".",
    findings: [
      ...(probe.ok ? [] : ["Failed to capture evidence from " + config.ready_url + "."]),
      ...(browserEvidence.status === "environment_blocked"
        ? [
            "Browser evidence is environment-blocked: " +
              (browserEvidence.reason ?? "no browser evidence reason recorded")
          ]
        : [])
    ],
    evidence_paths: evidencePaths,
    evidence_items: [
      {
        path: reportPath,
        kind: "report",
        description: "Bootstrap-generated live evidence capture."
      },
      {
        path: workflowEvidencePath,
        kind: "json",
        description: "Adapter workflow checks requested for this product session."
      }
    ].concat(
      browserEvidencePaths.map((path) => ({
        path,
        kind: path.endsWith(".png") ? "screenshot" : "browser-snapshot",
        description: "Browser home evidence captured from the configured product surface."
      }))
    ),
    metadata: {
      workflow_check_count: workflowChecks.length,
      browser_evidence_status: browserEvidence.status
    }
  });

  if (!probe.ok) {
    process.exitCode = 1;
  }
};

main().catch(async (error) => {
  await finalize({
    capability: "capture_evidence",
    ok: false,
    summary: "capture_evidence failed.",
    findings: [error instanceof Error ? error.message : String(error)],
    evidence_paths: []
  });
  process.exitCode = 1;
});
`;
