import { join } from "node:path";

import {
  cleanupTempRoot,
  createTempRoot,
  ensureBuild,
  importDist,
  readJsonFile,
  repoRoot
} from "./testing/bootstrap-validator-helpers.mjs";
import { ensureSemanticValidationFixtures } from "./testing/semantic-fixtures.mjs";
import { scaffoldExternalQualityLane } from "./scaffold-external-quality-lane.mjs";
import {
  assertPatchRequestQualitySurface,
  assertQualityCritiqueSurface,
  assertStopReason,
  extractRunDirectory,
  readSummary,
  runLoop
} from "./validation-utils.mjs";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const main = async () => {
  await ensureSemanticValidationFixtures({ clean: true });
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-quality-lift");

  try {
    const lenientProfilePath = join(
      repoRoot,
      ".tmp",
      "semantic-validation",
      "verification-profile-score-policy-lenient.json"
    );
    const strictLanePath = join(tempRoot, "external-quality-lane.json");
    const { profile: strictLaneProfile } = await scaffoldExternalQualityLane({
      profilePath: lenientProfilePath,
      outputPath: strictLanePath,
      label: "Semantic Validation External Quality Lane"
    });

    assert(
      Array.isArray(strictLaneProfile.quality_contract?.quality_axes) &&
        strictLaneProfile.quality_contract.quality_axes.length >= 4,
      "external quality lane should publish at least four quality axes"
    );
    assert(
      (strictLaneProfile.score_policy?.proof_weights?.external_grade ?? 0) >= 0.7,
      "external quality lane should tighten external_grade weighting"
    );

    console.log(
      "[validate-quality-lift] baseline lenient lane should allow low-score target closure"
    );
    const baselineResult = await runLoop([
      "--single",
      "--adapter",
      "./.tmp/semantic-validation/low-score/adapter.json",
      "--evaluator-profile",
      lenientProfilePath
    ]);
    if (baselineResult.code !== 0) {
      throw new Error("baseline lenient quality-lift run failed");
    }
    const baselineSummary = await readSummary(
      extractRunDirectory(baselineResult.stdout)
    );
    assertStopReason(baselineSummary, "target_reached");

    console.log(
      "[validate-quality-lift] strict external lane should hold low-score target closure closed"
    );
    const strictResult = await runLoop([
      "--single",
      "--adapter",
      "./.tmp/semantic-validation/low-score/adapter.json",
      "--evaluator-profile",
      strictLanePath
    ]);
    if (strictResult.code !== 0) {
      throw new Error("strict external quality-lane run failed");
    }
    const strictSummary = await readSummary(extractRunDirectory(strictResult.stdout));
    assertStopReason(strictSummary, "max_rounds_reached");
    assert(
      strictSummary.release_score < baselineSummary.release_score,
      "strict external lane should reduce release score versus the lenient baseline"
    );

    console.log(
      "[validate-quality-lift] bootstrap generated bundle should publish richer quality contract and journey probes"
    );
    const { createBootstrapArtifactPaths, scaffoldBootstrapArtifacts } =
      await importDist("bootstrap.js");
    const workspaceRoot = join(tempRoot, "bootstrap-workspace");
    const targetRoot = join(tempRoot, "bootstrap-target");
    const paths = createBootstrapArtifactPaths(workspaceRoot);
    await scaffoldBootstrapArtifacts(
      {
        title: "Quality Lift App",
        summary: "A fixture app for validating quality-oriented bootstrap outputs.",
        targetUsers: ["operator", "reviewer"],
        coreFeatures: ["review dashboard", "save draft", "retry publish"],
        referenceApps: ["Linear", "Notion"],
        finishLine: "A reviewer can save, reload, and finish the release flow without losing state.",
        targetFamily: "fullstack-app",
        goalLevel: "usable",
        targetScore: 0.9,
        maxRounds: 3,
        targetRoot,
        projectMode: "new",
        frameworkHint: "Next.js",
        packageManager: "npm",
        runCommand: "npm run dev",
        checkCommand: "npm test",
        readyUrl: "http://127.0.0.1:3000/healthz",
        appUrl: "http://127.0.0.1:3000/",
        healthUrl: "http://127.0.0.1:3000/healthz",
        apiBaseUrl: "http://127.0.0.1:3000/api/",
        constraints: ["Keep the harness adapter-free."],
        qualityBar: [
          "The reviewer flow must feel coherent across reload.",
          "Failure states must be explicit and recoverable."
        ],
        notes: "quality-lift validator"
      },
      paths
    );
    const generatedProfile = await readJsonFile(paths.generatedVerificationProfilePath);
    const baseProfile = await readJsonFile(
      join(repoRoot, "evals", "verification-profiles", "fullstack-app.profile.json")
    );
    assert(
      Array.isArray(generatedProfile.quality_contract?.quality_axes) &&
        generatedProfile.quality_contract.quality_axes.length >= 4,
      "generated bootstrap profile should publish at least four quality axes"
    );
    const baseReleaseGateProbeCount = (baseProfile.core_probes ?? []).filter(
      (probe) => (probe.role ?? "supporting") === "release_gate"
    ).length;
    const generatedReleaseGateProbeCount = (generatedProfile.core_probes ?? []).filter(
      (probe) => (probe.role ?? "supporting") === "release_gate"
    ).length;
    assert(
      generatedReleaseGateProbeCount >= baseReleaseGateProbeCount,
      "generated bootstrap profile should preserve the base fullstack release-gate floor"
    );
    assert(
      (generatedProfile.criteria ?? []).length >= (baseProfile.criteria ?? []).length,
      "generated bootstrap profile should preserve the base fullstack criteria floor"
    );
    assert(
      (generatedProfile.minimum_feature_release_assertions ?? 0) >=
        (baseProfile.minimum_feature_release_assertions ?? 0),
      "generated bootstrap profile should not lower the base fullstack feature assertion floor"
    );
    for (const [tag, requiredCount] of Object.entries(
      baseProfile.minimum_assertion_tag_counts ?? {}
    )) {
      assert(
        (generatedProfile.minimum_assertion_tag_counts?.[tag] ?? 0) >= requiredCount,
        `generated bootstrap profile should preserve the base fullstack assertion-tag floor for ${tag}`
      );
    }
    const continuityProbe = generatedProfile.core_probes.find(
      (probe) => probe.probe_id === "quality-lift-app-state-continuity"
    );
    assert(
      continuityProbe?.mode === "browser_journey" &&
        continuityProbe.steps?.some((step) => step.action === "reload") &&
        continuityProbe.steps?.some((step) => step.action === "assert_value"),
      "generated bootstrap profile should include a browser continuity probe with reload/value assertions"
    );
    const errorProbe = generatedProfile.core_probes.find(
      (probe) => probe.probe_id === "quality-lift-app-error-recovery"
    );
    assert(
      errorProbe?.steps?.some((step) => step.action === "assert_not_visible"),
      "generated bootstrap profile should include a negative browser assertion for error recovery"
    );

    console.log(
      "[validate-quality-lift] patch-only runtime should persist structured critique and remediation strategy"
    );
    const critiqueRun = await runLoop([
      "--adapter",
      "./.tmp/semantic-validation/patch-only-success/adapter.json",
      "--target-family",
      "api-service",
      "--max-rounds",
      "3"
    ]);
    if (critiqueRun.code !== 0) {
      throw new Error("quality critique propagation run failed");
    }
    const critiqueSummary = await readSummary(extractRunDirectory(critiqueRun.stdout));
    const firstRound = critiqueSummary.round_history?.[0];
    const latestRound = critiqueSummary.round_history?.[critiqueSummary.round_history.length - 1];
    await assertQualityCritiqueSurface(firstRound, {
      minimumFindingCount: 1,
      label: "first-round quality critique"
    });
    await assertPatchRequestQualitySurface(firstRound, {
      minimumMustFixCount: 1,
      label: "first-round patch request quality surface"
    });
    await assertQualityCritiqueSurface(latestRound, {
      minimumFindingCount: 0,
      label: "terminal-round quality critique"
    });

    console.log("[validate-quality-lift] complete");
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
