import { strict as assert } from "node:assert";

import {
  cleanupTempRoot,
  createBootstrapFixture,
  createTempRoot,
  ensureBuild,
  readJsonFile
} from "./testing/bootstrap-validator-helpers.mjs";

const allProbeText = (probes) =>
  JSON.stringify(
    probes.map((probe) => ({
      probe_id: probe.probe_id,
      label: probe.label,
      mode: probe.mode,
      target_manifest_key: probe.target_manifest_key,
      assertion_tags: probe.assertion_tags,
      steps: probe.steps
    })),
    null,
    2
  );

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-generated-verification-contract");

  try {
    const fixture = await createBootstrapFixture(tempRoot, {
      title: "Budget Browser App",
      summary: "A browser-only budget tracker for freelance operators. API is not required.",
      targetUsers: ["freelancer"],
      coreFeatures: [
        "income expense entry",
        "monthly summary",
        "category filter"
      ],
      finishLine:
        "A freelancer can enter transactions and review monthly totals with a category filter.",
      targetFamily: "browser-app",
      verificationSurfaces: ["browser"],
      healthUrl: undefined,
      apiBaseUrl: undefined,
      failureExpectations: [],
      continuityBoundaries: [],
      qualityBar: [
        "transactions are visible after entry",
        "monthly totals are visible",
        "category filtering is visible"
      ]
    });

    const [profile, adapterPlan, runtimeConfig] = await Promise.all([
      readJsonFile(fixture.paths.generatedVerificationProfilePath),
      readJsonFile(fixture.paths.adapterPlanPath),
      readJsonFile(fixture.paths.generatedRuntimeConfigPath)
    ]);
    const probes = profile.core_probes ?? [];
    const probeText = allProbeText(probes);

    assert.deepEqual(profile.expected_target_surfaces, ["browser"]);
    assert.deepEqual(profile.required_live_verification_modes, ["browser"]);
    assert.ok(
      probes.some((probe) => probe.mode === "browser_journey"),
      "browser-only profile should still include browser journey probes"
    );
    assert.ok(
      probes.every((probe) => probe.mode !== "http_json"),
      `browser-only profile must not include http_json probes:\n${probeText}`
    );
    assert.ok(
      probes.every((probe) => probe.target_manifest_key !== "api_base_url"),
      `browser-only profile must not require api_base_url:\n${probeText}`
    );
    assert.doesNotMatch(probeText, /draft-input|save-draft|draft-restored/);
    assert.doesNotMatch(probeText, /error-banner/);
    assert.doesNotMatch(
      probeText,
      /draft-persists|navigation-state-preserved|refresh-state-persisted|submission-roundtrip-consistent|draft-restore-after-refresh/
    );

    const minimumTagCounts = profile.minimum_assertion_tag_counts ?? {};
    for (const tag of ["api", "persistence", "consistency", "error_path"]) {
      assert.equal(
        minimumTagCounts[tag],
        undefined,
        `browser-only profile must not keep '${tag}' assertion floor`
      );
    }

    const workflowProbes = probes.filter((probe) =>
      /^Workflow works:/.test(probe.label)
    );
    assert.ok(workflowProbes.length >= 3, probeText);
    const firstWorkflowSelectors = workflowProbes[0].steps
      .map((step) => step.selector)
      .filter(Boolean);
    assert.ok(
      firstWorkflowSelectors.some((selector) =>
        selector.startsWith("[data-workflow-id='workflow-1']")
      ),
      JSON.stringify(firstWorkflowSelectors, null, 2)
    );
    assert.ok(
      firstWorkflowSelectors.some((selector) =>
        selector.includes("[data-testid='feature-1-action']")
      ),
      "legacy testid fallback should remain accepted but not primary"
    );

    const workflowSelector =
      runtimeConfig.verification_contract.workflow_selectors[0];
    assert.match(
      runtimeConfig.verification_contract.app_shell_selector,
      /data-harness='app-shell'/
    );
    assert.match(
      runtimeConfig.verification_contract.finish_line_selector,
      /data-harness='finish-line-ready'/
    );
    assert.match(workflowSelector.root_selector, /data-workflow-id='workflow-1'/);
    assert.match(
      workflowSelector.action_selector,
      /data-workflow-action='primary'/
    );
    assert.match(
      workflowSelector.result_selector,
      /data-workflow-result='primary'/
    );
    assert.match(
      adapterPlan.workflow_checks[0].selector_hints.action,
      /data-workflow-action='primary'/
    );
    assert.match(
      adapterPlan.workflow_checks[0].selector_hints.result,
      /data-workflow-result='primary'/
    );
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

await main();
console.log("validate:generated-verification-contract passed");
