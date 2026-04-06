import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const slugify = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "external-quality-lane";

const unique = (values) => [...new Set((values ?? []).filter(Boolean))];
const requiredReleaseGateProbes = (profile) =>
  (profile.core_probes ?? []).filter(
    (probe) => (probe.role ?? "supporting") === "release_gate" && probe.required !== false
  );
const configuredAssertionIdsByTag = (profile) => {
  const tagCounts = new Map();
  for (const probe of requiredReleaseGateProbes(profile)) {
    if (!probe.assertion_id || !(probe.assertion_tags ?? []).length) {
      continue;
    }
    for (const tag of probe.assertion_tags) {
      const assertionIds = tagCounts.get(tag) ?? new Set();
      assertionIds.add(probe.assertion_id);
      tagCounts.set(tag, assertionIds);
    }
  }
  return tagCounts;
};
const configuredFeatureReleaseAssertionCount = (profile) =>
  new Set(
    requiredReleaseGateProbes(profile)
      .filter((probe) => probe.assertion_id)
      .map((probe) => probe.assertion_id)
  ).size;

const defaultQualityAxesForFamily = (targetFamily) => [
  {
    axis_id: "primary_flow",
    label: "Primary Flow",
    description: "Keep the main release workflow coherent before claiming target closure.",
    desired_outcome: "The primary flow should remain usable end to end under the stricter quality lane."
  },
  {
    axis_id: "error_recovery",
    label: "Error Recovery",
    description: "Invalid states should fail explicitly and recover predictably.",
    desired_outcome: "Users should see a clear recovery path instead of silent failure."
  },
  {
    axis_id: "state_continuity",
    label: "State Continuity",
    description: "State should survive reload, refresh, retry, or persistence boundaries.",
    desired_outcome: "Workflow continuity should hold across state boundaries."
  },
  {
    axis_id: "reference_fit",
    label: "Reference Fit",
    description: `The ${targetFamily ?? "target"} result should stay aligned with the requested product direction.`,
    desired_outcome: "Refinement should improve fit without regressing working flows."
  }
];

const tightenedAssertionTagCounts = (profile) => {
  const existing = profile.minimum_assertion_tag_counts ?? {};
  const expectedSurfaces = new Set(profile.expected_target_surfaces ?? []);
  const configuredAssertionIds = configuredAssertionIdsByTag(profile);
  const setIfConfigured = (tag, minimumCount) => {
    if (minimumCount < 1) {
      return {};
    }
    const configuredCount = configuredAssertionIds.get(tag)?.size ?? 0;
    if (configuredCount === 0) {
      return {};
    }
    return {
      [tag]: Math.min(Math.max(existing[tag] ?? 0, minimumCount), configuredCount)
    };
  };
  return {
    ...existing,
    ...(expectedSurfaces.has("browser") ? setIfConfigured("browser", 1) : {}),
    ...(expectedSurfaces.has("api") ? setIfConfigured("api", 2) : {}),
    ...setIfConfigured("error_path", 1),
    ...setIfConfigured("persistence", expectedSurfaces.has("api") ? 1 : 0),
    ...setIfConfigured("workflow_multi_step", 2),
    ...setIfConfigured("consistency", expectedSurfaces.has("api") ? 1 : 0)
  };
};

const tightenedScorePolicy = (profile) => ({
  ...(profile.score_policy ?? {}),
  proof_weights: {
    ...(profile.score_policy?.proof_weights ?? {}),
    proof_pass_rate: 0.1,
    criterion_pass_rate: 0.1,
    threshold_verdict: 0.1,
    external_grade: 0.7
  },
  release_weights: {
    ...(profile.score_policy?.release_weights ?? {}),
    control_plane_score: 0.4,
    proof_score: 0.6
  }
});

export const scaffoldExternalQualityLane = async ({
  profilePath,
  outputPath,
  label,
  targetFamily
}) => {
  const resolvedProfilePath = resolve(profilePath);
  const resolvedOutputPath = resolve(outputPath);
  const baseProfile = JSON.parse(await readFile(resolvedProfilePath, "utf8"));
  const resolvedTargetFamily = targetFamily ?? baseProfile.target_family ?? "generic-core";
  const existingQualityContract = baseProfile.quality_contract ?? {};
  const qualityAxes =
    existingQualityContract.quality_axes?.length > 0
      ? existingQualityContract.quality_axes
      : defaultQualityAxesForFamily(resolvedTargetFamily);
  const preserveSignals = unique([
    ...(existingQualityContract.preserve_signals ?? []),
    "Keep working release-gate flows intact while tightening quality.",
    "Do not widen scope unless the controller explicitly recontracts."
  ]);
  const referenceSignals = unique([
    ...(existingQualityContract.reference_signals ?? []),
    ...((baseProfile.notes ?? []).slice(0, 2))
  ]);

  const strictProfile = {
    ...baseProfile,
    profile_id: `${slugify(baseProfile.profile_id ?? resolvedTargetFamily)}-external-quality-lane`,
    label: label ?? `${baseProfile.label ?? "Evaluator Bundle"} External Quality Lane`,
    bundle_label:
      label ?? `${baseProfile.bundle_label ?? baseProfile.label ?? "Evaluator Bundle"} External Quality Lane`,
    target_family: resolvedTargetFamily,
    minimum_feature_release_assertions: Math.max(
      Math.min(
        configuredFeatureReleaseAssertionCount(baseProfile),
        Math.max(baseProfile.minimum_feature_release_assertions ?? 2, 2)
      ),
      1
    ),
    minimum_assertion_tag_counts: tightenedAssertionTagCounts(baseProfile),
    score_policy: tightenedScorePolicy(baseProfile),
    quality_contract: {
      primary_goal:
        existingQualityContract.primary_goal ??
        `Raise release quality for ${resolvedTargetFamily} without regressing the working core flow.`,
      critique_style: "deterministic_release_gate",
      quality_axes: qualityAxes,
      preserve_signals: preserveSignals,
      reference_signals: referenceSignals
    },
    notes: unique([
      ...(baseProfile.notes ?? []),
      "This companion lane is intentionally stricter than the base evaluator bundle.",
      "Use this lane when the external verifier should push harder on release quality before target_reached."
    ])
  };

  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await writeFile(
    resolvedOutputPath,
    JSON.stringify(strictProfile, null, 2) + "\n",
    "utf8"
  );

  return {
    outputPath: resolvedOutputPath,
    profile: strictProfile
  };
};

const readArg = (argv, flag) => {
  const index = argv.findIndex((value) => value === flag);
  return index >= 0 ? argv[index + 1] : undefined;
};

const main = async () => {
  const argv = process.argv.slice(2);
  const profilePath = readArg(argv, "--profile");
  const outputPath = readArg(argv, "--out");
  const label = readArg(argv, "--label");
  const targetFamily = readArg(argv, "--target-family");

  if (!profilePath || !outputPath) {
    throw new Error(
      "Usage: node ./scripts/scaffold-external-quality-lane.mjs --profile <path> --out <path> [--label <label>] [--target-family <family>]"
    );
  }

  const result = await scaffoldExternalQualityLane({
    profilePath,
    outputPath,
    label,
    targetFamily
  });

  console.log(`External quality lane written: ${result.outputPath}`);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
