import { existsSync } from "node:fs";
import { extname, isAbsolute, join, resolve } from "node:path";

import { repoRoot } from "./file-system.js";
import type {
  AdapterCapabilityExecution,
  CoreVerificationProbeExecution,
  ContractAgreementArtifact,
  ContractReviewArtifact,
  EvalReport,
  EvalScoreDimension,
  LoadedAdapterContract,
  LoopRubric,
  ReleaseThresholdResults,
  RoundVerdict,
  RoundArtifacts,
  RoundCheckResult,
  RoundCheckStatus,
  RoundContractArtifact,
  TargetManifest,
  VerificationAssertionTag,
  VerificationCriterion,
  VerificationCoreProbe
} from "./types.js";

const adapterContractDocPath = join(repoRoot, "ADAPTER_CONTRACT.md");
const adapterExamplePath = join(repoRoot, "adapter.example.json");
const adapterRuntimePath = join(
  repoRoot,
  "packages",
  "loop-orchestrator",
  "src",
  "adapter-runtime.ts"
);

const placeholderSurfaceChecks = new Set<string>([
  "planner_context_surface_reserved",
  "generator_brief_surface_reserved",
  "qa_review_surface_reserved",
  "evaluator_verdict_surface_reserved",
  "patch_request_surface_reserved",
  "eval_report_surface_reserved",
  "controller_decision_surface_reserved"
]);

const artifactOnlyChecks = new Set<string>([
  "planner_brief_written",
  "plan_written",
  "round_contract_written",
  "contract_review_written",
  "contract_agreement_written",
  "generator_plan_written",
  ...placeholderSurfaceChecks
]);

const knownCheckIds = new Set<string>([
  ...artifactOnlyChecks,
  "round_contract_is_testable",
  "round_contract_scopes_release_qa",
  "contract_review_quality",
  "agreement_matches_review",
  "handoff_is_resumable",
  "previous_patch_request_addressed",
  "previous_patch_request_resolved",
  "release_blockers_recorded",
  "adapter_boundary_documented",
  "adapter_runtime_present",
  "adapter_example_written",
  "adapter_execution_healthy",
  "adapter_claims_are_honest",
  "proof_provenance_is_attested",
  "live_verification_present",
  "adapter_evidence_is_meaningful",
  "proof_boundary_is_independent",
  "adapter_criteria_are_grounded",
  "adapter_criteria_match_profile",
  "independent_target_probe_present",
  "subjective_quality_present",
  "subjective_thresholds_met",
  "visual_evidence_present",
  "prototype_baseline_present",
  "prototype_delta_present",
  "target_signal_thresholds_met"
]);

const nonCarryForwardDerivedChecks = new Set<string>([
  "previous_patch_request_addressed",
  "previous_patch_request_resolved"
]);
const proofEvaluatorChecks = new Set<string>([
  "adapter_execution_healthy",
  "adapter_claims_are_honest",
  "proof_provenance_is_attested",
  "live_verification_present",
  "adapter_evidence_is_meaningful",
  "proof_boundary_is_independent",
  "adapter_criteria_are_grounded",
  "adapter_criteria_match_profile",
  "independent_target_probe_present",
  "subjective_quality_present",
  "subjective_thresholds_met",
  "visual_evidence_present",
  "prototype_baseline_present",
  "prototype_delta_present"
]);
const nonScoringDerivedChecks = new Set<string>([
  "target_signal_thresholds_met",
  "previous_patch_request_addressed",
  "previous_patch_request_resolved"
]);
const liveVerificationKinds = new Set([
  "interaction-log",
  "verification-log",
  "browser-trace",
  "playwright-trace",
  "api-log",
  "db-log",
  "transcript",
  "shell-session"
]);
const proofCapabilityKinds = new Set(["capture_evidence", "run_checks", "grade_round"]);
const releaseGateCoreProbeModes = new Set(["http_json", "browser_journey"]);

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const isProofCapabilityName = (value: string): boolean => proofCapabilityKinds.has(value);

const proofExecutionsFor = (
  adapterExecutions: readonly AdapterCapabilityExecution[]
): AdapterCapabilityExecution[] =>
  adapterExecutions.filter(
    (execution) =>
      execution.capability === "capture_evidence" ||
      execution.capability === "run_checks" ||
      execution.capability === "grade_round"
  );

const buildProofEvidenceOriginIndex = (
  adapterExecutions: readonly AdapterCapabilityExecution[]
): Map<string, Set<string>> => {
  const index = new Map<string, Set<string>>();
  const remember = (path: string, capability: string): void => {
    if (!path || !isProofCapabilityName(capability)) {
      return;
    }
    const current = index.get(path) ?? new Set<string>();
    current.add(capability);
    index.set(path, current);
  };

  for (const execution of proofExecutionsFor(adapterExecutions)) {
    for (const evidence of execution.verified_evidence) {
      remember(evidence.path, evidence.witness?.capability ?? evidence.produced_by_capability);
      if (evidence.witness) {
        remember(evidence.witness.interaction_log_path, evidence.witness.capability);
        for (const step of evidence.witness.steps) {
          for (const artifactPath of step.artifact_paths) {
            remember(artifactPath, evidence.witness.capability);
          }
        }
      }
    }
  }

  return index;
};

const commandTokens = (command: string): string[] =>
  command.match(/"[^"]+"|'[^']+'|\S+/g)?.map((token) => token.replace(/^['"]|['"]$/g, "")) ?? [];

const commandVectorFor = (input: {
  command: string;
  args?: readonly string[];
}): string[] =>
  input.args && input.args.length > 0 ? [input.command, ...input.args] : commandTokens(input.command);

const commandTargetFingerprint = (input: {
  command: string;
  args?: readonly string[];
  baseDirectory: string;
  cwd?: string;
}): string => {
  const tokens = commandVectorFor(input);
  if (tokens.length === 0) {
    return "raw:";
  }

  const commandName = tokens[0].toLowerCase();
  const candidateScript = tokens[1];
  const scriptLike =
    candidateScript &&
    [".js", ".cjs", ".mjs", ".ts", ".ps1", ".sh", ".cmd", ".bat", ".py"].includes(
      extname(candidateScript).toLowerCase()
    );
  if (
    scriptLike &&
    [
      "node",
      "node.exe",
      "bun",
      "bun.exe",
      "python",
      "python3",
      "python.exe",
      "bash",
      "sh",
      "powershell",
      "powershell.exe",
      "cmd",
      "cmd.exe"
    ].includes(commandName)
  ) {
    const scriptPath = isAbsolute(candidateScript)
      ? resolve(candidateScript)
      : resolve(input.cwd ?? input.baseDirectory, candidateScript);
    return `${commandName}:${scriptPath}`;
  }

  return `raw:${commandVectorFor(input).join("\u0000").trim().toLowerCase()}`;
};

const observedValueMatches = (
  operator: "equals" | "contains" | "regex" | "number_gte" | "number_lte",
  observedValue: string,
  expectedValue: string
): boolean => {
  switch (operator) {
    case "equals":
      return observedValue === expectedValue;
    case "contains":
      return observedValue.includes(expectedValue);
    case "regex":
      try {
        return new RegExp(expectedValue).test(observedValue);
      } catch {
        return false;
      }
    case "number_gte": {
      const observed = Number(observedValue);
      const expected = Number(expectedValue);
      return Number.isFinite(observed) && Number.isFinite(expected) && observed >= expected;
    }
    case "number_lte": {
      const observed = Number(observedValue);
      const expected = Number(expectedValue);
      return Number.isFinite(observed) && Number.isFinite(expected) && observed <= expected;
    }
    default:
      return false;
  }
};

const checkResult = (
  check_id: string,
  status: RoundCheckStatus,
  detail: string
): RoundCheckResult => ({
  check_id,
  status,
  detail
});

const isPassingCheck = (result: RoundCheckResult): boolean => result.status === "pass";
const isFailingCheck = (result: RoundCheckResult): boolean => result.status === "fail";
const isSatisfiedCheck = (result: RoundCheckResult): boolean => result.status !== "fail";
const isApplicableCheck = (result: RoundCheckResult): boolean =>
  result.status !== "not_applicable";

const ratioScore = (passedItems: number, totalItems: number): number =>
  totalItems === 0 ? 0 : passedItems / totalItems;

const strictPartialCreditScore = (passedItems: number, totalItems: number): number =>
  totalItems === 0
    ? 0
    : Number(Math.pow(ratioScore(passedItems, totalItems), 2).toFixed(3));

const scoreFromResults = (
  results: readonly RoundCheckResult[],
  options?: { strictPartialCredit?: boolean }
): number => {
  const applicableResults = results.filter(isApplicableCheck);
  const applicableCount = applicableResults.length;
  if (applicableCount === 0) {
    return 0;
  }

  const passedCount = applicableResults.filter(isPassingCheck).length;
  return options?.strictPartialCredit
    ? strictPartialCreditScore(passedCount, applicableCount)
    : Number(ratioScore(passedCount, applicableCount).toFixed(3));
};

const isKnownCheck = (checkId: string): boolean => knownCheckIds.has(checkId);

const pathExists = (path?: string): boolean => (path ? existsSync(path) : false);
const requiredProofCapabilities = ["capture_evidence", "run_checks", "grade_round"] as const;

const requiredCoreProbesFor = (loadedAdapter?: LoadedAdapterContract) =>
  loadedAdapter?.verification_profile?.profile.core_probes?.filter(
    (probe) =>
      probe.required !== false &&
      (loadedAdapter.verification_profile?.profile.target_reached_requires_core_probes ?? true)
  ) ?? [];

const coreProbeRole = (probe: VerificationCoreProbe) =>
  probe.role ?? (releaseGateCoreProbeModes.has(probe.mode) ? "release_gate" : "supporting");

const probeSemanticLevel = (probe: VerificationCoreProbe) =>
  probe.semantic_level ??
  (releaseGateCoreProbeModes.has(probe.mode) ? "feature" : "liveness");

const assertionIdForCriterion = (criterion: VerificationCriterion): string =>
  criterion.assertion_id?.trim() || criterion.criterion_id;

const releaseAssertionIdForProbe = (
  probe: VerificationCoreProbe
): string | undefined =>
  coreProbeRole(probe) === "release_gate" &&
  (probeSemanticLevel(probe) === "feature" || probeSemanticLevel(probe) === "workflow")
    ? probe.assertion_id?.trim()
    : undefined;

const requiredReleaseGateCoreProbesFor = (loadedAdapter?: LoadedAdapterContract) =>
  requiredCoreProbesFor(loadedAdapter).filter(
    (probe) =>
      coreProbeRole(probe) === "release_gate" && releaseGateCoreProbeModes.has(probe.mode)
  );

const requiredBrowserJourneyReleaseProbesFor = (loadedAdapter?: LoadedAdapterContract) =>
  requiredReleaseGateCoreProbesFor(loadedAdapter).filter(
    (probe) => probe.mode === "browser_journey"
  );

const requiredHttpJsonReleaseProbesFor = (loadedAdapter?: LoadedAdapterContract) =>
  requiredReleaseGateCoreProbesFor(loadedAdapter).filter(
    (probe) => probe.mode === "http_json"
  );

const minimumFeatureReleaseAssertionsFor = (loadedAdapter?: LoadedAdapterContract): number =>
  loadedAdapter?.verification_profile?.profile.minimum_feature_release_assertions ?? 2;

const minimumAssertionTagCountsFor = (
  loadedAdapter?: LoadedAdapterContract
): Partial<Record<VerificationAssertionTag, number>> =>
  loadedAdapter?.verification_profile?.profile.minimum_assertion_tag_counts ?? {};

const expectedTargetSurfacesFor = (loadedAdapter?: LoadedAdapterContract): Set<"browser" | "api"> =>
  new Set(loadedAdapter?.verification_profile?.profile.expected_target_surfaces ?? []);

const normalizedWeights = <T extends string>(
  weights: Partial<Record<T, number>>,
  fallback: Record<T, number>
): Record<T, number> => {
  const merged = { ...fallback, ...weights } as Record<T, number>;
  const total = (Object.values(merged) as number[]).reduce(
    (sum, value) => sum + value,
    0
  );
  if (total <= 0) {
    return fallback;
  }

  return Object.fromEntries(
    (Object.entries(merged) as Array<[T, number]>).map(([key, value]) => [
      key,
      value / total
    ])
  ) as Record<T, number>;
};

const proofScoreWeightsFor = (loadedAdapter?: LoadedAdapterContract) => {
  const externalGradeConfigured =
    loadedAdapter?.verification_profile?.profile.score_policy?.proof_weights?.external_grade !==
    undefined;
  const fallback = externalGradeConfigured
    ? {
        proof_pass_rate: 0.25,
        criterion_pass_rate: 0.35,
        threshold_verdict: 0.1,
        external_grade: 0.3
      }
    : {
        proof_pass_rate: 0.45,
        criterion_pass_rate: 0.4,
        threshold_verdict: 0.15,
        external_grade: 0
      };

  return normalizedWeights(
    loadedAdapter?.verification_profile?.profile.score_policy?.proof_weights ?? {},
    fallback
  );
};

const releaseScoreWeightsFor = (loadedAdapter?: LoadedAdapterContract) =>
  normalizedWeights(
    loadedAdapter?.verification_profile?.profile.score_policy?.release_weights ?? {},
    {
      control_plane_score: 0.6,
      proof_score: 0.4
    }
  );

const visualEvidenceExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp"
]);

const isVisualEvidencePath = (path: string): boolean => {
  const normalized = path.toLowerCase();
  if (visualEvidenceExtensions.has(extname(normalized))) {
    return true;
  }
  return normalized.endsWith(".zip") && normalized.includes("trace");
};

const successfulGradeRoundExecutionFor = (
  adapterExecutions: readonly AdapterCapabilityExecution[]
): AdapterCapabilityExecution | undefined =>
  adapterExecutions.find(
    (execution) => execution.capability === "grade_round" && execution.result.ok
  );

const assertionTagLabel = (tag: VerificationAssertionTag): string => {
  switch (tag) {
    case "browser":
      return "browser";
    case "api":
      return "api";
    case "persistence":
      return "persistence";
    case "error_path":
      return "error-path";
    case "auth":
      return "auth";
    case "consistency":
      return "consistency";
    case "workflow_multi_step":
      return "workflow-multi-step";
    case "latency_budget":
      return "latency-budget";
    case "undo_redo":
      return "undo-redo";
    case "grounded_tool_use":
      return "grounded-tool-use";
  }
};

const configuredReleaseAssertionIdsForTag = (
  loadedAdapter: LoadedAdapterContract | undefined,
  tag: VerificationAssertionTag
): Set<string> =>
  new Set(
    requiredReleaseGateCoreProbesFor(loadedAdapter).flatMap((probe) =>
      probe.assertion_id && probe.assertion_tags?.includes(tag) ? [probe.assertion_id] : []
    )
  );

const releaseGateAssertionIdsFor = (loadedAdapter?: LoadedAdapterContract): Set<string> =>
  new Set(
    requiredReleaseGateCoreProbesFor(loadedAdapter)
      .map((probe) => releaseAssertionIdForProbe(probe))
      .filter((assertionId): assertionId is string => Boolean(assertionId))
  );

const hardReleaseAssertionIdsFor = (loadedAdapter?: LoadedAdapterContract): Set<string> => {
  const releaseAssertionIds = releaseGateAssertionIdsFor(loadedAdapter);
  const criteria = loadedAdapter?.verification_profile?.profile.criteria ?? [];
  return new Set(
    criteria
      .filter((criterion) => criterion.hard)
      .map((criterion) => assertionIdForCriterion(criterion))
      .filter((assertionId) => releaseAssertionIds.has(assertionId))
  );
};

const passedFeatureReleaseAssertionIds = (input: {
  loadedAdapter?: LoadedAdapterContract;
  coreProbeResults: CoreVerificationProbeExecution[];
}): Set<string> => {
  const profile = input.loadedAdapter?.verification_profile?.profile;
  const probeById = new Map(profile?.core_probes?.map((probe) => [probe.probe_id, probe]) ?? []);

  return new Set(
    input.coreProbeResults.flatMap((result) => {
      const probe = probeById.get(result.probe_id);
      if (!probe || !result.ok || result.evidence_paths.length === 0) {
        return [];
      }
      const assertionId = releaseAssertionIdForProbe(probe);
      return assertionId ? [assertionId] : [];
    })
  );
};

const passedBrowserJourneyAssertionIds = (input: {
  loadedAdapter?: LoadedAdapterContract;
  coreProbeResults: CoreVerificationProbeExecution[];
}): Set<string> => {
  const resultByProbeId = new Map(
    input.coreProbeResults.map((result) => [result.probe_id, result])
  );

  return new Set(
    requiredBrowserJourneyReleaseProbesFor(input.loadedAdapter).flatMap((probe) => {
      const result = resultByProbeId.get(probe.probe_id);
      return result?.ok && result.evidence_paths.length > 0 && probe.assertion_id
        ? [probe.assertion_id]
        : [];
    })
  );
};

const passedHttpJsonAssertionIds = (input: {
  loadedAdapter?: LoadedAdapterContract;
  coreProbeResults: CoreVerificationProbeExecution[];
}): Set<string> => {
  const resultByProbeId = new Map(
    input.coreProbeResults.map((result) => [result.probe_id, result])
  );

  return new Set(
    requiredHttpJsonReleaseProbesFor(input.loadedAdapter).flatMap((probe) => {
      const result = resultByProbeId.get(probe.probe_id);
      return result?.ok && result.evidence_paths.length > 0 && probe.assertion_id
        ? [probe.assertion_id]
        : [];
    })
  );
};

const passedReleaseAssertionIdsForTag = (input: {
  loadedAdapter?: LoadedAdapterContract;
  coreProbeResults: CoreVerificationProbeExecution[];
  tag: VerificationAssertionTag;
}): Set<string> => {
  const profile = input.loadedAdapter?.verification_profile?.profile;
  const probeById = new Map(profile?.core_probes?.map((probe) => [probe.probe_id, probe]) ?? []);

  return new Set(
    input.coreProbeResults.flatMap((result) => {
      const probe = probeById.get(result.probe_id);
      if (
        !probe ||
        !result.ok ||
        result.evidence_paths.length === 0 ||
        !probe.assertion_id ||
        !probe.assertion_tags?.includes(input.tag)
      ) {
        return [];
      }
      return [probe.assertion_id];
    })
  );
};

const verificationBoundaryIssues = (
  loadedAdapter?: LoadedAdapterContract
): string[] => {
  if (!loadedAdapter) {
    return [];
  }

  const issues: string[] = [];
  if (!loadedAdapter.verification_profile) {
    issues.push(
      "No core-owned evaluator profile is attached, so target-specific criteria remain outside the harness trust domain."
    );
  } else if (loadedAdapter.verification_profile_source !== "core") {
    issues.push(
      `verification_profile '${loadedAdapter.verification_profile.profile_path}' was loaded from the adapter trust domain. target_reached requires a core-owned evaluator profile selected by the harness.`
    );
  }

  const verificationProvider = loadedAdapter.contract.verification_provider;
  if (!verificationProvider) {
    issues.push(
      "No verification_provider is attached, so target proof would run inside the executor trust domain."
    );
  } else {
    if (!verificationProvider.provider_id?.trim()) {
      issues.push("verification_provider.provider_id is missing or empty.");
    }
    if (verificationProvider.provider_id === loadedAdapter.contract.adapter_id) {
      issues.push(
        "verification_provider.provider_id must differ from adapter_id so proof stays in a separate trust domain."
      );
    }
    const missingCapabilities = requiredProofCapabilities.filter(
      (capability) => !verificationProvider.capabilities?.[capability]
    );
    if (missingCapabilities.length > 0) {
      issues.push(
        `verification_provider is missing proof capabilities: ${missingCapabilities.join(", ")}.`
      );
    }
    const executorFingerprints = unique(
      Object.values(loadedAdapter.contract.capabilities)
        .filter((spec): spec is NonNullable<typeof spec> => Boolean(spec))
        .map((spec) =>
          commandTargetFingerprint({
            command: spec.command,
            args: spec.args,
            baseDirectory: loadedAdapter.base_directory,
            cwd: spec.cwd ? resolve(loadedAdapter.base_directory, spec.cwd) : undefined
          })
        )
    );
    const overlappingVerifierCommands = requiredProofCapabilities.filter((capability) => {
      const spec = verificationProvider.capabilities?.[capability];
      if (!spec) {
        return false;
      }
      const verifierFingerprint = commandTargetFingerprint({
        command: spec.command,
        args: spec.args,
        baseDirectory: loadedAdapter.base_directory,
        cwd: spec.cwd ? resolve(loadedAdapter.base_directory, spec.cwd) : undefined
      });
      return executorFingerprints.includes(verifierFingerprint);
    });
    if (overlappingVerifierCommands.length > 0) {
      issues.push(
        `verification_provider must use command targets distinct from executor capabilities for: ${overlappingVerifierCommands.join(", ")}.`
      );
    }
  }
  if (
    loadedAdapter.verification_profile &&
    (!loadedAdapter.verification_profile.profile.required_live_verification_modes ||
      loadedAdapter.verification_profile.profile.required_live_verification_modes.length === 0)
  ) {
    issues.push(
      "verification_profile.required_live_verification_modes is missing, so the core cannot demand a specific live verification modality."
    );
  }
  const requiredCoreProbes = requiredCoreProbesFor(loadedAdapter);
  if (
    loadedAdapter.verification_profile &&
    (loadedAdapter.verification_profile.profile.target_reached_requires_core_probes ?? true) &&
    requiredCoreProbes.length === 0
  ) {
    issues.push(
      "verification_profile.core_probes is missing, so the core cannot generate independent target evidence for target_reached."
    );
  }
  if (
    loadedAdapter.verification_profile &&
    (loadedAdapter.verification_profile.profile.target_reached_requires_core_probes ?? true) &&
    requiredCoreProbes.length > 0 &&
    requiredReleaseGateCoreProbesFor(loadedAdapter).length === 0
  ) {
    issues.push(
      "verification_profile.core_probes must include at least one required release-gate probe using mode 'http_json' or 'browser_journey' before target_reached can be claimed."
    );
  }
  const verificationProfile = loadedAdapter.verification_profile?.profile;
  const expectedSurfaces = expectedTargetSurfacesFor(loadedAdapter);
  const requiredReleaseGateProbes = requiredReleaseGateCoreProbesFor(loadedAdapter);
  for (const probe of requiredReleaseGateProbes) {
    if (!releaseGateCoreProbeModes.has(probe.mode)) {
      issues.push(
        `verification_profile core probe '${probe.probe_id}' must use mode 'http_json' or 'browser_journey' for release-gate use.`
      );
    }
    if (!probe.target_manifest_key) {
      issues.push(
        `verification_profile core probe '${probe.probe_id}' must declare target_manifest_key for release-gate use.`
      );
    }
    if (!probe.assertion_id?.trim()) {
      issues.push(
        `verification_profile core probe '${probe.probe_id}' must declare assertion_id for release-gate use.`
      );
    }
    if (probeSemanticLevel(probe) === "liveness") {
      issues.push(
        `verification_profile core probe '${probe.probe_id}' cannot use semantic_level 'liveness' for release-gate use.`
      );
    }
    if (probe.mode === "http_json" && (!probe.json_path || probe.expected_value === undefined)) {
      issues.push(
        `verification_profile core probe '${probe.probe_id}' must declare json_path and expected_value for mode 'http_json'.`
      );
    }
    if (probe.mode === "browser_journey" && (!probe.steps || probe.steps.length === 0)) {
      issues.push(
        `verification_profile core probe '${probe.probe_id}' must declare at least one browser journey step.`
      );
    }
  }
  if (
    verificationProfile &&
    (verificationProfile.target_reached_requires_core_probes ?? true)
  ) {
    const releaseAssertionIds = releaseGateAssertionIdsFor(loadedAdapter);
    if (releaseAssertionIds.size < minimumFeatureReleaseAssertionsFor(loadedAdapter)) {
      issues.push(
        `verification_profile needs at least ${minimumFeatureReleaseAssertionsFor(loadedAdapter)} distinct feature/workflow release assertions, but only ${releaseAssertionIds.size} were configured.`
      );
    }
  }
  if (expectedSurfaces.has("browser")) {
    if (!verificationProfile?.required_live_verification_modes?.includes("browser")) {
      issues.push(
        "verification_profile expects a browser surface, but required_live_verification_modes does not include 'browser'."
      );
    }
    if (requiredBrowserJourneyReleaseProbesFor(loadedAdapter).length === 0) {
      issues.push(
        "verification_profile expects a browser surface, but no required browser_journey release-gate probe is configured."
      );
    }
  }
  if (expectedSurfaces.has("api")) {
    if (!verificationProfile?.required_live_verification_modes?.includes("api")) {
      issues.push(
        "verification_profile expects an API surface, but required_live_verification_modes does not include 'api'."
      );
    }
    if (requiredHttpJsonReleaseProbesFor(loadedAdapter).length === 0) {
      issues.push(
        "verification_profile expects an API surface, but no required http_json release-gate probe is configured."
      );
    }
  }
  const minimumAssertionTagCounts = minimumAssertionTagCountsFor(loadedAdapter);
  if (minimumAssertionTagCounts.browser && !expectedSurfaces.has("browser")) {
    issues.push(
      "verification_profile cannot require browser assertion coverage without declaring browser in expected_target_surfaces."
    );
  }
  if (minimumAssertionTagCounts.api && !expectedSurfaces.has("api")) {
    issues.push(
      "verification_profile cannot require api assertion coverage without declaring api in expected_target_surfaces."
    );
  }
  if (minimumAssertionTagCounts.persistence && !expectedSurfaces.has("api")) {
    issues.push(
      "verification_profile cannot require persistence assertion coverage without declaring api in expected_target_surfaces."
    );
  }
  for (const [tag, minimumCount] of Object.entries(
    minimumAssertionTagCounts
  ) as Array<[VerificationAssertionTag, number]>) {
    const configuredCount = configuredReleaseAssertionIdsForTag(loadedAdapter, tag).size;
    if (configuredCount < minimumCount) {
      issues.push(
        `verification_profile requires at least ${minimumCount} configured ${assertionTagLabel(tag)} release assertion(s), but only ${configuredCount} were configured.`
      );
    }
  }

  return issues;
};

const fileWrittenCheck = (
  check_id: string,
  path: string | undefined,
  label: string
): RoundCheckResult =>
  checkResult(
    check_id,
    pathExists(path) ? "pass" : "fail",
    pathExists(path) ? `${label} exists.` : `${label} is missing.`
  );

const fileSurfaceReservedCheck = (
  check_id: string,
  path: string | undefined,
  label: string
): RoundCheckResult =>
  checkResult(
    check_id,
    pathExists(path) ? "pass" : "fail",
    pathExists(path)
      ? `${label} surface exists for placeholder or final content.`
      : `${label} surface is missing.`
  );

const adapterHonestyCheck = (input: {
  loadedAdapter?: LoadedAdapterContract;
  adapterExecutions: AdapterCapabilityExecution[];
}): RoundCheckResult =>
  (() => {
    if (!input.loadedAdapter) {
      return checkResult(
        "adapter_claims_are_honest",
        input.adapterExecutions.length === 0 ? "pass" : "fail",
        input.adapterExecutions.length === 0
          ? "No adapter-owned runtime proof was claimed while no adapter is attached."
          : "Adapter capability outputs appeared even though no adapter is attached."
      );
    }

    if (input.adapterExecutions.length === 0) {
      return checkResult(
        "adapter_claims_are_honest",
        "pass",
        "No adapter capability claims were recorded for this round."
      );
    }

    const validationErrors = input.adapterExecutions.flatMap((execution) =>
      execution.validation_errors.map((error) => `${execution.capability}: ${error}`)
    );

    return checkResult(
      "adapter_claims_are_honest",
      validationErrors.length === 0 ? "pass" : "fail",
      validationErrors.length === 0
        ? "Adapter claims passed schema validation and every cited evidence path resolved."
        : `Adapter claims failed validation: ${validationErrors.join(" ")}`
    );
  })();

const proofBoundaryIndependenceCheck = (input: {
  loadedAdapter?: LoadedAdapterContract;
  adapterExecutions: AdapterCapabilityExecution[];
}): RoundCheckResult =>
  (() => {
    if (!input.loadedAdapter) {
      return checkResult(
        "proof_boundary_is_independent",
        input.adapterExecutions.length === 0 ? "pass" : "fail",
        input.adapterExecutions.length === 0
          ? "No external proof boundary was required for this round."
          : "Adapter executions appeared even though no adapter is attached."
      );
    }

    const boundaryIssues = verificationBoundaryIssues(input.loadedAdapter);
    const proofExecutions = input.adapterExecutions.filter((execution) =>
      execution.capability === "capture_evidence" ||
      execution.capability === "run_checks" ||
      execution.capability === "grade_round"
    );
    const runtimeIssues: string[] = [];
    const verifierId = input.loadedAdapter.contract.verification_provider?.provider_id;

    for (const execution of proofExecutions) {
      if (execution.provider_role !== "verifier") {
        runtimeIssues.push(
          `Capability '${execution.capability}' executed under provider role '${execution.provider_role}' instead of 'verifier'.`
        );
      }
      if (verifierId && execution.provider_id !== verifierId) {
        runtimeIssues.push(
          `Capability '${execution.capability}' executed under provider '${execution.provider_id}' instead of verifier '${verifierId}'.`
        );
      }
    }

    const failures = [...boundaryIssues, ...runtimeIssues];
    return checkResult(
      "proof_boundary_is_independent",
      failures.length === 0 ? "pass" : "fail",
      failures.length === 0
        ? `Proof capabilities are routed through verifier '${verifierId ?? "unknown"}' instead of the executor boundary.`
        : `Proof boundary is not independent: ${failures.join(" ")}`
    );
  })();

const proofProvenanceAttestationCheck = (input: {
  loadedAdapter?: LoadedAdapterContract;
  adapterExecutions: AdapterCapabilityExecution[];
}): RoundCheckResult =>
  (() => {
    if (!input.loadedAdapter) {
      return checkResult(
        "proof_provenance_is_attested",
        input.adapterExecutions.length === 0 ? "pass" : "fail",
        input.adapterExecutions.length === 0
          ? "No verifier provenance was required for this round."
          : "Adapter executions appeared even though no adapter is attached."
      );
    }

    const proofExecutions = input.adapterExecutions.filter(
      (execution) =>
        execution.capability === "capture_evidence" ||
        execution.capability === "run_checks" ||
        execution.capability === "grade_round"
    );
    if (proofExecutions.length === 0) {
      return checkResult(
        "proof_provenance_is_attested",
        "fail",
        "No verifier proof executions were available to attest provenance."
      );
    }

    const failures: string[] = [];
    const originIndex = buildProofEvidenceOriginIndex(proofExecutions);
    for (const execution of proofExecutions) {
      if (!execution.attestation) {
        failures.push(`Capability '${execution.capability}' is missing execution attestation.`);
        continue;
      }
      if (!execution.attestation.command_sha256) {
        failures.push(`Capability '${execution.capability}' is missing a command hash.`);
      }
      if (!execution.attestation.result_sha256) {
        failures.push(`Capability '${execution.capability}' is missing a result hash.`);
      }
      if (!execution.attestation.stdout_sha256 || !execution.attestation.stderr_sha256) {
        failures.push(
          `Capability '${execution.capability}' is missing stdout/stderr hash attestation.`
        );
      }
      if (
        !pathExists(execution.attestation.stdout_path) ||
        !pathExists(execution.attestation.stderr_path)
      ) {
        failures.push(
          `Capability '${execution.capability}' is missing persisted stdout/stderr logs for provenance review.`
        );
      }
      for (const evidence of execution.verified_evidence) {
        if (!evidence.sha256) {
          failures.push(
            `Capability '${execution.capability}' evidence '${evidence.path}' is missing a sha256 attestation.`
          );
        }
        if (!isProofCapabilityName(evidence.produced_by_capability)) {
          failures.push(
            `Capability '${execution.capability}' evidence '${evidence.path}' was attributed to non-proof capability '${evidence.produced_by_capability}'.`
          );
          continue;
        }

        if (
          evidence.produced_by_capability !== execution.capability &&
          !originIndex.get(evidence.path)?.has(evidence.produced_by_capability)
        ) {
          failures.push(
            `Capability '${execution.capability}' cited upstream evidence '${evidence.path}' without an attested proof origin for '${evidence.produced_by_capability}'.`
          );
        }

        if (evidence.witness) {
          if (!originIndex.get(evidence.path)?.has(evidence.witness.capability)) {
            failures.push(
              `Verification witness '${evidence.witness.witness_id}' is not anchored to an attested proof origin.`
            );
          }
          if (
            !originIndex
              .get(evidence.witness.interaction_log_path)
              ?.has(evidence.witness.capability)
          ) {
            failures.push(
              `Verification witness '${evidence.witness.witness_id}' referenced interaction log '${evidence.witness.interaction_log_path}' without an attested proof origin.`
            );
          }
        }
      }
    }

    return checkResult(
      "proof_provenance_is_attested",
      failures.length === 0 ? "pass" : "fail",
      failures.length === 0
        ? "Verifier proof executions carry command, log, result, and evidence hashes for provenance review."
        : `Verifier provenance is not fully attested: ${failures.join(" ")}`
    );
  })();

const liveVerificationPresentCheck = (input: {
  loadedAdapter?: LoadedAdapterContract;
  adapterExecutions: AdapterCapabilityExecution[];
  coreProbeResults: CoreVerificationProbeExecution[];
  targetManifest?: TargetManifest;
}): RoundCheckResult =>
  (() => {
    if (!input.loadedAdapter) {
      return checkResult(
        "live_verification_present",
        input.adapterExecutions.length === 0 ? "pass" : "fail",
        input.adapterExecutions.length === 0
          ? "No live verification artifact was required for this round."
          : "Adapter executions appeared even though no adapter is attached."
      );
    }

    const proofExecutions = proofExecutionsFor(input.adapterExecutions).filter(
      (execution) =>
        execution.provider_role === "verifier" &&
        execution.result.ok
    );
    const liveEvidence = proofExecutions.flatMap((execution) =>
      execution.verified_evidence.filter((item) =>
        liveVerificationKinds.has(item.kind?.trim().toLowerCase() ?? "")
      )
    );
    const witnessEvidence = proofExecutions.flatMap((execution) =>
      execution.verified_evidence.filter((item) => item.witness)
    );
    if (liveEvidence.length === 0 || witnessEvidence.length === 0) {
      return checkResult(
        "live_verification_present",
        "fail",
        "No verifier-produced interaction log plus structured verification-witness pair was recorded."
      );
    }

    const originIndex = buildProofEvidenceOriginIndex(proofExecutions);
    const liveEvidencePaths = new Set(liveEvidence.map((item) => item.path));
    const witnessEvidencePaths = new Set(witnessEvidence.map((item) => item.path));
    const proofEvidencePaths = new Set(
      proofExecutions.flatMap((execution) => execution.verified_evidence.map((item) => item.path))
    );
    const criterionIds = new Set(
      proofExecutions.flatMap((execution) =>
        execution.verified_criteria_results.map((criterion) => criterion.criterion_id)
      )
    );
    const criterionEvidencePaths = new Set(
      proofExecutions.flatMap((execution) =>
        execution.verified_criteria_results.flatMap((criterion) => criterion.evidence_paths)
      )
    );
    const gradeDerivedPaths = new Set(
      proofExecutions
        .filter((execution) => execution.capability === "grade_round")
        .flatMap((execution) =>
          execution.verified_evidence.flatMap((item) => item.derived_from_evidence_paths)
        )
    );
    const requiredModes =
      input.loadedAdapter.verification_profile?.profile.required_live_verification_modes ?? [];
    const expectedHardReleaseAssertionIds = hardReleaseAssertionIdsFor(input.loadedAdapter);
    const expectedSurfaces = expectedTargetSurfacesFor(input.loadedAdapter);
    const witnessedAssertionIds = new Set(
      witnessEvidence.flatMap((item) => item.witness?.assertion_ids ?? [])
    );
    const corePassedAssertionIds = passedFeatureReleaseAssertionIds({
      loadedAdapter: input.loadedAdapter,
      coreProbeResults: input.coreProbeResults
    });
    const witnessedModes = new Set(
      witnessEvidence
        .map((item) => item.witness?.mode)
        .filter((mode): mode is NonNullable<typeof mode> => Boolean(mode))
    );
    const criteriaPathLinked = [...criterionEvidencePaths].some(
      (path) => liveEvidencePaths.has(path) || witnessEvidencePaths.has(path)
    );
    const criteriaSupportLinked =
      liveEvidence.some((item) =>
        item.supports_criterion_ids.some((criterionId) => criterionIds.has(criterionId))
      ) ||
      witnessEvidence.some((item) =>
        item.supports_criterion_ids.some((criterionId) => criterionIds.has(criterionId))
      );
    const referencedByCriteria = criteriaPathLinked || criteriaSupportLinked;
    const referencedByGrade = [...gradeDerivedPaths].some(
      (path) => liveEvidencePaths.has(path) || witnessEvidencePaths.has(path)
    );
    const explicitlyLinked =
      liveEvidence.some(
        (item) =>
          item.supports_check_ids.length > 0 || item.supports_criterion_ids.length > 0
      ) ||
      witnessEvidence.some(
        (item) =>
          item.supports_check_ids.length > 0 || item.supports_criterion_ids.length > 0
      );
    const failures: string[] = [];
    for (const requiredMode of requiredModes) {
      if (!witnessedModes.has(requiredMode)) {
        failures.push(
          `No verification witness satisfied required live verification mode '${requiredMode}'.`
        );
      }
    }
    if (expectedSurfaces.has("browser") && !input.targetManifest?.app_url) {
      failures.push(
        "Core-owned evaluator profile expects a browser surface, but run_target did not publish target_manifest.app_url."
      );
    }
    if (expectedSurfaces.has("api") && !input.targetManifest?.api_base_url) {
      failures.push(
        "Core-owned evaluator profile expects an API surface, but run_target did not publish target_manifest.api_base_url."
      );
    }
    if (expectedSurfaces.has("api") && !witnessedModes.has("api")) {
      failures.push(
        "Core-owned evaluator profile expects an API surface, but no verification witness satisfied api mode."
      );
    }
    if (expectedSurfaces.has("browser") && !witnessedModes.has("browser")) {
      failures.push(
        "Core-owned evaluator profile expects a browser surface, but no verification witness satisfied browser mode."
      );
    }
    for (const assertionId of expectedHardReleaseAssertionIds) {
      if (!witnessedAssertionIds.has(assertionId)) {
        failures.push(
          `No verification witness covered hard release assertion '${assertionId}'.`
        );
      }
      if (!corePassedAssertionIds.has(assertionId)) {
        failures.push(
          `No core-owned release gate passed hard release assertion '${assertionId}'.`
        );
      }
    }
    if (!explicitlyLinked) {
      failures.push(
        "Live verification artifacts were present but did not declare supported checks or criteria."
      );
    }
    for (const witnessItem of witnessEvidence) {
      const witness = witnessItem.witness;
      if (!witness) {
        continue;
      }
      if (!liveEvidencePaths.has(witness.interaction_log_path)) {
        failures.push(
          `Verification witness '${witness.witness_id}' did not point to a verified live interaction artifact.`
        );
      }
      if (!originIndex.get(witness.interaction_log_path)?.has(witness.capability)) {
        failures.push(
          `Verification witness '${witness.witness_id}' did not carry an attested proof origin for its interaction log.`
        );
      }
      const stepArtifactsGrounded = witness.steps.every((step) =>
        step.artifact_paths.some(
          (path) =>
            proofEvidencePaths.has(path) ||
            path === witness.interaction_log_path ||
            originIndex.get(path)?.has(witness.capability)
        )
      );
      if (!stepArtifactsGrounded) {
        failures.push(
          `Verification witness '${witness.witness_id}' referenced step artifacts that were not grounded in verified proof files.`
        );
      }
    }
    if (!referencedByCriteria && !referencedByGrade) {
      failures.push(
        "Live verification artifacts were present but were not referenced by criteria or grade derivation."
      );
    }

    return checkResult(
      "live_verification_present",
      failures.length === 0 ? "pass" : "fail",
      failures.length === 0
        ? `Verifier recorded ${liveEvidence.length} live verification artifact(s) and ${witnessEvidence.length} structured witness artifact(s) across required modes.`
        : `Live verification is too weak: ${failures.join(" ")}`
    );
  })();

const independentTargetProbeCheck = (input: {
  loadedAdapter?: LoadedAdapterContract;
  coreProbeResults: CoreVerificationProbeExecution[];
  targetManifest?: TargetManifest;
}): RoundCheckResult =>
  (() => {
    if (!input.loadedAdapter) {
      return checkResult(
        "independent_target_probe_present",
        input.coreProbeResults.length === 0 ? "pass" : "fail",
        input.coreProbeResults.length === 0
          ? "No independent core-owned target probe was required for this round."
          : "Core probe results appeared even though no adapter is attached."
      );
    }

    const profile = input.loadedAdapter.verification_profile?.profile;
    const requiresCoreProbes = profile?.target_reached_requires_core_probes ?? true;
    if (!requiresCoreProbes) {
      return checkResult(
        "independent_target_probe_present",
        "pass",
        "Independent core-owned target probes are not required by the verification profile."
      );
    }

    const requiredProbes = requiredCoreProbesFor(input.loadedAdapter);
    const expectedSurfaces = expectedTargetSurfacesFor(input.loadedAdapter);
    if (requiredProbes.length === 0) {
      return checkResult(
        "independent_target_probe_present",
        "fail",
        "No required core-owned target probes are configured in the verification profile."
      );
    }
    const requiredReleaseGateProbes = requiredReleaseGateCoreProbesFor(input.loadedAdapter);
    const requiredBrowserReleaseGateProbes =
      requiredBrowserJourneyReleaseProbesFor(input.loadedAdapter);
    if (requiredReleaseGateProbes.length === 0) {
      return checkResult(
        "independent_target_probe_present",
        "fail",
        "No required release-gate core probe is configured. target_reached now requires at least one required 'http_json' or 'browser_journey' probe."
      );
    }

    const resultByProbeId = new Map(
      input.coreProbeResults.map((result) => [result.probe_id, result])
    );
    const failures = requiredProbes.flatMap((probe) => {
      const result = resultByProbeId.get(probe.probe_id);
      if (!result) {
        return [`Required core probe '${probe.probe_id}' did not run.`];
      }
      if (!result.ok) {
        return [`Required core probe '${probe.probe_id}' failed: ${result.summary}`];
      }
      if (result.evidence_paths.length === 0) {
        return [`Required core probe '${probe.probe_id}' did not persist evidence.`];
      }
      return [];
    });
    const passedReleaseGateProbeIds = requiredReleaseGateProbes.flatMap((probe) => {
      const result = resultByProbeId.get(probe.probe_id);
      return result && result.ok && result.evidence_paths.length > 0 ? [result.probe_id] : [];
    });
    if (passedReleaseGateProbeIds.length === 0) {
      failures.push(
        `No required release-gate core probe passed. Expected one of: ${requiredReleaseGateProbes.map((probe) => probe.probe_id).join(", ")}.`
      );
    }
    const passedAssertionIds = passedFeatureReleaseAssertionIds({
      loadedAdapter: input.loadedAdapter,
      coreProbeResults: input.coreProbeResults
    });
    const passedBrowserAssertionIds = passedBrowserJourneyAssertionIds({
      loadedAdapter: input.loadedAdapter,
      coreProbeResults: input.coreProbeResults
    });
    const passedApiAssertionIds = passedHttpJsonAssertionIds({
      loadedAdapter: input.loadedAdapter,
      coreProbeResults: input.coreProbeResults
    });
    const minimumAssertionTagCounts = minimumAssertionTagCountsFor(input.loadedAdapter);
    if (expectedSurfaces.has("browser") && !input.targetManifest?.app_url) {
      failures.push(
        "Core-owned evaluator profile expects a browser surface, but run_target did not publish target_manifest.app_url."
      );
    }
    if (expectedSurfaces.has("api") && !input.targetManifest?.api_base_url) {
      failures.push(
        "Core-owned evaluator profile expects an API surface, but run_target did not publish target_manifest.api_base_url."
      );
    }
    if (
      expectedSurfaces.has("browser") &&
      requiredBrowserReleaseGateProbes.length === 0
    ) {
      failures.push(
        "Core-owned evaluator profile expects a browser surface, but no required browser_journey release-gate probe is configured."
      );
    }
    if (
      expectedSurfaces.has("api") &&
      requiredHttpJsonReleaseProbesFor(input.loadedAdapter).length === 0
    ) {
      failures.push(
        "Core-owned evaluator profile expects an API surface, but no required http_json release-gate probe is configured."
      );
    }
    if (expectedSurfaces.has("browser") && passedBrowserAssertionIds.size === 0) {
      failures.push(
        "Core-owned evaluator profile expects a browser surface, but no browser_journey release assertion passed."
      );
    }
    if (expectedSurfaces.has("api") && passedApiAssertionIds.size === 0) {
      failures.push(
        "Core-owned evaluator profile expects an API surface, but no http_json release assertion passed."
      );
    }
    for (const [tag, minimumCount] of Object.entries(
      minimumAssertionTagCounts
    ) as Array<[VerificationAssertionTag, number]>) {
      const passedCount = passedReleaseAssertionIdsForTag({
        loadedAdapter: input.loadedAdapter,
        coreProbeResults: input.coreProbeResults,
        tag
      }).size;
      if (passedCount < minimumCount) {
        failures.push(
          `Core-owned evaluator profile requires at least ${minimumCount} passing ${assertionTagLabel(tag)} release assertion(s), but only ${passedCount} passed.`
        );
      }
    }
    const minimumAssertions = minimumFeatureReleaseAssertionsFor(input.loadedAdapter);
    if (passedAssertionIds.size < minimumAssertions) {
      failures.push(
        `Only ${passedAssertionIds.size} feature/workflow release assertion(s) passed; need at least ${minimumAssertions}.`
      );
    }

    return checkResult(
      "independent_target_probe_present",
      failures.length === 0 ? "pass" : "fail",
      failures.length === 0
        ? `Core-owned target probes passed, including release-gate assertion(s): ${[...passedAssertionIds].join(", ")}.`
        : `Independent target probing is incomplete: ${failures.join(" ")}`
    );
  })();

const adapterMeaningfulEvidenceCheck = (input: {
  loadedAdapter?: LoadedAdapterContract;
  adapterExecutions: AdapterCapabilityExecution[];
}): RoundCheckResult =>
  (() => {
    if (!input.loadedAdapter) {
      return checkResult(
        "adapter_evidence_is_meaningful",
        input.adapterExecutions.length === 0 ? "pass" : "fail",
        input.adapterExecutions.length === 0
          ? "No adapter-owned evidence was required for this round."
          : "Adapter evidence appeared even though no adapter is attached."
      );
    }

    if (input.adapterExecutions.length === 0) {
      return checkResult(
        "adapter_evidence_is_meaningful",
        "pass",
        "No adapter evidence was evaluated in this round."
      );
    }

    const semanticFailures: string[] = [];
    const executionsWithValidationErrors = input.adapterExecutions.filter(
      (execution) => execution.validation_errors.length > 0
    );
    if (executionsWithValidationErrors.length > 0) {
      semanticFailures.push(
        "Meaningful evidence cannot be established while adapter validation errors remain."
      );
    }
    const successfulCheckExecutions = input.adapterExecutions.filter(
      (execution) => execution.capability === "run_checks" && execution.result.ok
    );
    const successfulCaptureExecutions = input.adapterExecutions.filter(
      (execution) => execution.capability === "capture_evidence" && execution.result.ok
    );
    const successfulGradeExecutions = input.adapterExecutions.filter(
      (execution) => execution.capability === "grade_round" && execution.result.ok
    );
    const successfulRuntimeEvidencePaths = new Set(
      unique([
        ...successfulCheckExecutions.flatMap((execution) =>
          execution.verified_evidence.map((item) => item.path)
        ),
        ...successfulCaptureExecutions.flatMap((execution) =>
          execution.verified_evidence.map((item) => item.path)
        )
      ])
    );

    for (const execution of successfulCheckExecutions) {
      const linkedEvidenceCount = execution.verified_evidence.filter(
        (item) => item.supports_check_ids.length > 0
      ).length;
      if (linkedEvidenceCount === 0) {
        semanticFailures.push(
          "Capability 'run_checks' succeeded but none of its evidence items declare supported check ids."
        );
      }
    }

    const hasSupportingRuntimeEvidence =
      successfulCheckExecutions.some((execution) => execution.verified_evidence.length > 0) ||
      successfulCaptureExecutions.some((execution) => execution.verified_evidence.length > 0);

    for (const execution of successfulGradeExecutions) {
      const hasUpstreamCapabilityLink = execution.verified_evidence.some((item) =>
        item.derived_from_capabilities.some(
          (capability) => capability === "run_checks" || capability === "capture_evidence"
        )
      );
      const hasUpstreamEvidencePathLink = execution.verified_evidence.some((item) =>
        item.derived_from_evidence_paths.some((path) => successfulRuntimeEvidencePaths.has(path))
      );

      if (!hasUpstreamCapabilityLink) {
        semanticFailures.push(
          "Capability 'grade_round' succeeded but none of its evidence items reference run_checks or capture_evidence output."
        );
      }
      if (!hasUpstreamEvidencePathLink) {
        semanticFailures.push(
          "Capability 'grade_round' succeeded but none of its evidence items trace back to concrete run_checks or capture_evidence files."
        );
      }
    }

    if (successfulGradeExecutions.length > 0 && !hasSupportingRuntimeEvidence) {
      semanticFailures.push(
        "Capability 'grade_round' succeeded without any successful run_checks or capture_evidence evidence in the same round."
      );
    }

    return checkResult(
      "adapter_evidence_is_meaningful",
      semanticFailures.length === 0 ? "pass" : "fail",
      semanticFailures.length === 0
        ? "Adapter evidence is non-empty and preserves explicit links between checks, proof, and grading."
        : `Adapter evidence semantics are weak: ${semanticFailures.join(" ")}`
    );
  })();

const adapterCriteriaGroundingCheck = (input: {
  loadedAdapter?: LoadedAdapterContract;
  adapterExecutions: AdapterCapabilityExecution[];
}): RoundCheckResult =>
  (() => {
    if (!input.loadedAdapter) {
      return checkResult(
        "adapter_criteria_are_grounded",
        input.adapterExecutions.length === 0 ? "pass" : "fail",
        input.adapterExecutions.length === 0
          ? "No adapter-owned criteria were required for this round."
          : "Adapter criteria appeared even though no adapter is attached."
      );
    }

    if (input.adapterExecutions.length === 0) {
      return checkResult(
        "adapter_criteria_are_grounded",
        "pass",
        "No adapter criteria were evaluated in this round."
      );
    }

    const failures: string[] = [];
    const successfulCheckExecutions = input.adapterExecutions.filter(
      (execution) => execution.capability === "run_checks" && execution.result.ok
    );
    const successfulCaptureExecutions = input.adapterExecutions.filter(
      (execution) => execution.capability === "capture_evidence" && execution.result.ok
    );
    const successfulGradeExecutions = input.adapterExecutions.filter(
      (execution) => execution.capability === "grade_round" && execution.result.ok
    );
    const runtimeEvidencePaths = new Set(
      unique([
        ...successfulCheckExecutions.flatMap((execution) => execution.verified_evidence_paths),
        ...successfulCaptureExecutions.flatMap((execution) => execution.verified_evidence_paths)
      ])
    );
    const runCheckCriteria = successfulCheckExecutions.flatMap(
      (execution) => execution.verified_criteria_results
    );
    const runCheckCriterionMap = new Map(
      runCheckCriteria.map((criterion) => [criterion.criterion_id, criterion])
    );
    const gradeOnlyCriterionIds = new Set(
      (input.loadedAdapter?.verification_profile?.profile.criteria ?? [])
        .filter(
          (criterion) =>
            criterion.capability === "grade_round" &&
            !(input.loadedAdapter?.verification_profile?.profile.criteria ?? []).some(
              (candidate) =>
                candidate.capability === "run_checks" &&
                candidate.criterion_id === criterion.criterion_id
            )
        )
        .map((criterion) => criterion.criterion_id)
    );

    for (const execution of successfulCheckExecutions) {
      if (execution.verified_criteria_results.length === 0) {
        failures.push(
          "Capability 'run_checks' succeeded but did not produce any verified criterion results."
        );
        continue;
      }

      for (const criterion of execution.verified_criteria_results) {
        const criterionSupported = execution.verified_evidence.some(
          (item) =>
            item.supports_criterion_ids.includes(criterion.criterion_id) &&
            criterion.evidence_paths.includes(item.path)
        );
        if (!criterionSupported) {
          failures.push(
            `Capability 'run_checks' criterion '${criterion.criterion_id}' is not grounded by evidence items that explicitly support it.`
          );
        }
      }
    }

    for (const execution of successfulGradeExecutions) {
      if (execution.verified_criteria_results.length === 0) {
        failures.push(
          "Capability 'grade_round' succeeded but did not produce any verified criterion results."
        );
        continue;
      }

      for (const criterion of execution.verified_criteria_results) {
        const matchingRunCheckCriterion = runCheckCriterionMap.get(criterion.criterion_id);
        const isGradeOnlyCriterion = gradeOnlyCriterionIds.has(criterion.criterion_id);
        if (!matchingRunCheckCriterion && !isGradeOnlyCriterion) {
          failures.push(
            `Capability 'grade_round' introduced criterion '${criterion.criterion_id}' without a matching run_checks criterion.`
          );
          continue;
        }
        if (
          matchingRunCheckCriterion &&
          matchingRunCheckCriterion.status === "fail" &&
          criterion.status === "pass"
        ) {
          failures.push(
            `Capability 'grade_round' upgraded failed run_checks criterion '${criterion.criterion_id}' to pass without new grounded proof.`
          );
        }
        if (!criterion.evidence_paths.some((path) => runtimeEvidencePaths.has(path))) {
          failures.push(
            `Capability 'grade_round' criterion '${criterion.criterion_id}' is not grounded in concrete run_checks or capture_evidence files.`
          );
        }
      }

      const blockingCriterionIds = execution.result.blocking_criterion_ids ?? [];
      if (
        blockingCriterionIds.some(
          (criterionId) =>
            !execution.verified_criteria_results.some(
              (criterion) =>
                criterion.criterion_id === criterionId && criterion.status === "fail"
            )
        )
      ) {
        failures.push(
          "Capability 'grade_round' marked blocking criteria that are not present as failing criterion results."
        );
      }
      if (
        execution.result.threshold_verdict === "pass" &&
        execution.verified_criteria_results.some(
          (criterion) => criterion.hard && criterion.status === "fail"
        )
      ) {
        failures.push(
          "Capability 'grade_round' reported threshold_verdict 'pass' while hard criteria still fail."
        );
      }
    }

    return checkResult(
      "adapter_criteria_are_grounded",
      failures.length === 0 ? "pass" : "fail",
      failures.length === 0
        ? "Adapter criteria are explicitly grounded in evidence and stay consistent between checks and grading."
        : `Adapter criteria are weakly grounded: ${failures.join(" ")}`
    );
  })();

const evaluateVerificationProfile = (input: {
  loadedAdapter?: LoadedAdapterContract;
  adapterExecutions: AdapterCapabilityExecution[];
}): {
  profileCheck: RoundCheckResult;
  criterionChecks: RoundCheckResult[];
  hardFailedCriterionIds: string[];
} => {
  if (!input.loadedAdapter) {
    return {
      profileCheck: checkResult(
        "adapter_criteria_match_profile",
        input.adapterExecutions.length === 0 ? "pass" : "fail",
        input.adapterExecutions.length === 0
          ? "No core-owned evaluator profile was required for this round."
          : "Adapter criteria appeared even though no adapter is attached."
      ),
      criterionChecks: [],
      hardFailedCriterionIds: []
    };
  }

  const successfulCriteriaExecutions = input.adapterExecutions.filter(
    (execution) =>
      execution.result.ok &&
      (execution.capability === "run_checks" || execution.capability === "grade_round")
  );
  const verificationProfile = input.loadedAdapter.verification_profile?.profile;
  if (!verificationProfile) {
    return {
      profileCheck: checkResult(
        "adapter_criteria_match_profile",
        "fail",
        "Adapter criteria were reported without a core-owned evaluator profile."
      ),
      criterionChecks: [],
      hardFailedCriterionIds: []
    };
  }

  if (successfulCriteriaExecutions.length === 0) {
    return {
      profileCheck: checkResult(
        "adapter_criteria_match_profile",
        "pass",
        "No adapter-owned criteria were evaluated against a verification profile in this round."
      ),
      criterionChecks: [],
      hardFailedCriterionIds: []
    };
  }

  const failures: string[] = [];
  const criterionChecks: RoundCheckResult[] = [];
  const hardFailedCriterionIds: string[] = [];

  for (const expectedCriterion of verificationProfile.criteria) {
    const matchingExecution = successfulCriteriaExecutions.find(
      (execution) => execution.capability === expectedCriterion.capability
    );
    if (!matchingExecution) {
      failures.push(
        `Verification profile criterion '${expectedCriterion.criterion_id}' expected capability '${expectedCriterion.capability}', but that capability did not produce successful criteria for this round.`
      );
      criterionChecks.push(
        checkResult(
          `${expectedCriterion.capability}:${expectedCriterion.criterion_id}`,
          "fail",
          `${expectedCriterion.summary} No matching capability output was available.`
        )
      );
      if (expectedCriterion.hard) {
        hardFailedCriterionIds.push(expectedCriterion.criterion_id);
      }
      continue;
    }

    const matchingCriterion = matchingExecution.verified_criteria_results.find(
      (criterion) => criterion.criterion_id === expectedCriterion.criterion_id
    );
    if (!matchingCriterion) {
      failures.push(
        `Verification profile criterion '${expectedCriterion.criterion_id}' was not reported by capability '${expectedCriterion.capability}'.`
      );
      criterionChecks.push(
        checkResult(
          `${expectedCriterion.capability}:${expectedCriterion.criterion_id}`,
          "fail",
          `${expectedCriterion.summary} The expected criterion was not reported.`
        )
      );
      if (expectedCriterion.hard) {
        hardFailedCriterionIds.push(expectedCriterion.criterion_id);
      }
      continue;
    }

    if (!matchingCriterion.observed_value) {
      failures.push(
        `Verification profile criterion '${expectedCriterion.criterion_id}' did not include an observed_value.`
      );
      criterionChecks.push(
        checkResult(
          `${expectedCriterion.capability}:${expectedCriterion.criterion_id}`,
          "fail",
          `${expectedCriterion.summary} The criterion is missing an observed_value.`
        )
      );
      if (expectedCriterion.hard ?? matchingCriterion.hard) {
        hardFailedCriterionIds.push(expectedCriterion.criterion_id);
      }
      continue;
    }

    const expectedStatus = observedValueMatches(
      expectedCriterion.operator,
      matchingCriterion.observed_value,
      expectedCriterion.expected_value
    )
      ? "pass"
      : "fail";
    criterionChecks.push(
      checkResult(
        `${expectedCriterion.capability}:${expectedCriterion.criterion_id}`,
        expectedStatus,
        `${expectedCriterion.summary} Observed '${matchingCriterion.observed_value}' against ${expectedCriterion.operator} '${expectedCriterion.expected_value}'.`
      )
    );

    if (matchingCriterion.status !== expectedStatus) {
      failures.push(
        `Capability '${expectedCriterion.capability}' reported criterion '${expectedCriterion.criterion_id}' as '${matchingCriterion.status}', but the evaluator-owned profile derived '${expectedStatus}' from observed_value '${matchingCriterion.observed_value}'.`
      );
    }
    if (
      expectedCriterion.hard !== undefined &&
      matchingCriterion.hard !== expectedCriterion.hard
    ) {
      failures.push(
        `Capability '${expectedCriterion.capability}' reported criterion '${expectedCriterion.criterion_id}' with hard=${String(matchingCriterion.hard)}, but the verification profile requires hard=${String(expectedCriterion.hard)}.`
      );
    }
    if (expectedStatus === "fail" && (expectedCriterion.hard ?? matchingCriterion.hard)) {
      hardFailedCriterionIds.push(expectedCriterion.criterion_id);
    }
  }

  return {
    profileCheck: checkResult(
      "adapter_criteria_match_profile",
      failures.length === 0 ? "pass" : "fail",
      failures.length === 0
        ? `Adapter criteria matched core-owned evaluator profile '${verificationProfile.profile_id}'.`
        : `Adapter criteria did not match core-owned evaluator profile '${verificationProfile.profile_id}': ${failures.join(" ")}`
    ),
    criterionChecks,
    hardFailedCriterionIds: unique(hardFailedCriterionIds)
  };
};

export const buildContractReviewArtifact = (input: {
  contractArtifact: RoundContractArtifact;
  loadedAdapter?: LoadedAdapterContract;
}): ContractReviewArtifact => {
  const unknownChecks = input.contractArtifact.acceptance_checks.filter((checkId) => !isKnownCheck(checkId));
  const duplicateChecks = input.contractArtifact.acceptance_checks.filter(
    (checkId, index, allChecks) => allChecks.indexOf(checkId) !== index
  );
  const carryOverChecksNotAccepted = input.contractArtifact.carry_over_check_ids.filter(
    (checkId) => !input.contractArtifact.acceptance_checks.includes(checkId)
  );
  const hasMeaningfulCheck = input.contractArtifact.acceptance_checks.some(
    (checkId) => !artifactOnlyChecks.has(checkId)
  );

  const concerns: string[] = [];
  const requiredChanges: string[] = [];
  const staticBlockers: string[] = [];

  if (input.contractArtifact.acceptance_checks.length === 0) {
    concerns.push("The contract has no acceptance checks.");
    requiredChanges.push("Add at least one acceptance check before the round can proceed.");
  }

  if (unknownChecks.length > 0) {
    concerns.push(`Unknown acceptance checks: ${unknownChecks.join(", ")}.`);
    requiredChanges.push("Replace unknown checks with evaluator-known check ids.");
  }

  if (duplicateChecks.length > 0) {
    concerns.push(`Duplicate acceptance checks: ${unique(duplicateChecks).join(", ")}.`);
    requiredChanges.push("Remove duplicate acceptance checks so the contract is testable.");
  }

  if (!hasMeaningfulCheck) {
    concerns.push("All acceptance checks are artifact-write checks, so the contract cannot fail usefully.");
    requiredChanges.push("Include at least one behavioral or resolution check beyond file existence.");
  }

  if (
    input.contractArtifact.carry_over_patch_ids.length > 0 &&
    input.contractArtifact.carry_over_check_ids.length === 0
  ) {
    concerns.push("A previous patch request exists, but no carried check ids were attached.");
    requiredChanges.push("Carry unresolved check ids forward from the previous patch request.");
  }

  if (carryOverChecksNotAccepted.length > 0) {
    concerns.push(
      `The draft contract does not promise to close carried checks: ${carryOverChecksNotAccepted.join(", ")}.`
    );
    requiredChanges.push("Add every carried check id to the current acceptance checks.");
  }

  if (input.loadedAdapter) {
    concerns.push(`Adapter '${input.loadedAdapter.contract.adapter_id}' is attached for this round.`);
    const boundaryIssues = verificationBoundaryIssues(input.loadedAdapter);
    if (boundaryIssues.length > 0) {
      staticBlockers.push(...boundaryIssues);
      concerns.push(
        `Independent proof boundary is incomplete: ${boundaryIssues.join(" ")}`
      );
      requiredChanges.push(
        "Fix the adapter contract before retrying: attach a distinct verification_provider, a core-owned evaluator profile, and required browser_journey/http_json release-gate probes for independent target verification."
      );
    }
    if (!input.loadedAdapter.verification_profile) {
      staticBlockers.push(
        "No core-owned evaluator profile is attached, so target-specific criteria would stay adapter-authored."
      );
      concerns.push(
        "No core-owned evaluator profile is attached, so target-specific criteria would stay adapter-authored."
      );
      requiredChanges.push(
      "Attach a core-owned evaluator bundle via --target-family or rubric.evaluator_profile_path, or use --evaluator-profile for an explicit override."
      );
    } else if (input.loadedAdapter.verification_profile_source !== "core") {
      requiredChanges.push(
      "Move verification profile ownership into the harness: select it through --target-family or rubric.evaluator_profile_path, and reserve --evaluator-profile for explicit overrides instead of adapter.json."
      );
    }
  } else {
    concerns.push("No external adapter is attached; this round can only claim harness-side proof.");
  }

  return {
    contract_id: input.contractArtifact.contract_id,
    review_id: `${input.contractArtifact.contract_id}-review`,
    decision: requiredChanges.length > 0 ? "revise" : "accept",
    concerns,
    required_changes: requiredChanges,
    approved_checks:
      requiredChanges.length > 0
        ? input.contractArtifact.acceptance_checks.filter((checkId) => isKnownCheck(checkId))
        : input.contractArtifact.acceptance_checks,
    adapter_ready: Boolean(input.loadedAdapter),
    static_blockers: unique(staticBlockers)
  };
};

export const buildContractAgreementArtifact = (input: {
  contractArtifact: RoundContractArtifact;
  contractReviewArtifact: ContractReviewArtifact;
}): ContractAgreementArtifact => {
  const agreed = input.contractReviewArtifact.decision === "accept";

  return {
    contract_id: input.contractArtifact.contract_id,
    agreement_id: `${input.contractArtifact.contract_id}-agreement`,
    status: agreed ? "agreed" : "blocked",
    objective: input.contractArtifact.objective,
    acceptance_checks: agreed
      ? input.contractReviewArtifact.approved_checks
      : unique([
          ...input.contractReviewArtifact.approved_checks,
          ...input.contractArtifact.carry_over_check_ids
        ]),
    generator_must_deliver: agreed
      ? input.contractReviewArtifact.approved_checks
      : input.contractReviewArtifact.required_changes,
    evaluator_must_verify: agreed
      ? input.contractReviewArtifact.approved_checks
      : input.contractReviewArtifact.required_changes,
    carry_over_context: input.contractArtifact.carry_over_context
  };
};

const staticCheckLookup = (input: {
  contractArtifact: RoundContractArtifact;
  contractReviewArtifact: ContractReviewArtifact;
  contractAgreementArtifact: ContractAgreementArtifact;
  artifacts: RoundArtifacts;
  plannerBriefPath: string;
  planPath: string;
  previousPatchTargetCheckIds: string[];
  previousPatchRequestAddressed: boolean;
}): Record<string, RoundCheckResult> => {
  const hasMeaningfulCheck = input.contractArtifact.acceptance_checks.some(
    (checkId) => !artifactOnlyChecks.has(checkId)
  );
  const allChecksKnown = input.contractArtifact.acceptance_checks.every((checkId) => isKnownCheck(checkId));
  const carriedChecksAccepted = input.contractArtifact.carry_over_check_ids.every((checkId) =>
    input.contractArtifact.acceptance_checks.includes(checkId)
  );
  const roundContractHasReleaseScope =
    input.contractArtifact.release_gate_check_ids.length > 0 &&
    input.contractArtifact.proof_plan.length > 0 &&
    input.contractArtifact.pivot_triggers.length > 0;

  return {
    planner_brief_written: fileWrittenCheck(
      "planner_brief_written",
      input.plannerBriefPath,
      "Planner brief"
    ),
    plan_written: fileWrittenCheck("plan_written", input.planPath, "Run-local plan"),
    round_contract_written: fileWrittenCheck(
      "round_contract_written",
      input.artifacts.contract_json_path,
      "Round contract artifact"
    ),
    round_contract_is_testable: checkResult(
      "round_contract_is_testable",
      hasMeaningfulCheck && allChecksKnown && carriedChecksAccepted ? "pass" : "fail",
      hasMeaningfulCheck && allChecksKnown && carriedChecksAccepted
        ? "The round contract includes evaluator-known checks and keeps carried issues explicit."
        : "The round contract is missing meaningful checks, known check ids, or carried issue coverage."
    ),
    contract_review_written: fileWrittenCheck(
      "contract_review_written",
      input.artifacts.contract_review_json_path,
      "Contract review artifact"
    ),
    contract_review_quality: checkResult(
      "contract_review_quality",
      input.contractReviewArtifact.decision === "revise"
        ? input.contractReviewArtifact.required_changes.length > 0
          ? "pass"
          : "fail"
        : input.contractReviewArtifact.required_changes.length === 0
          ? "pass"
          : "fail",
      input.contractReviewArtifact.decision === "revise"
        ? "The evaluator rejected the draft with explicit required changes."
        : "The evaluator accepted the draft because no structural gaps remained."
    ),
    contract_agreement_written: fileWrittenCheck(
      "contract_agreement_written",
      input.artifacts.contract_agreement_json_path,
      "Contract agreement artifact"
    ),
    round_contract_scopes_release_qa: checkResult(
      "round_contract_scopes_release_qa",
      roundContractHasReleaseScope ? "pass" : "fail",
      roundContractHasReleaseScope
        ? "The round contract names release-gate checks, proof expectations, and pivot triggers for end-pass QA."
        : "The round contract is missing release-gate checks, proof expectations, or pivot triggers for end-pass QA."
    ),
    agreement_matches_review: checkResult(
      "agreement_matches_review",
      (input.contractReviewArtifact.decision === "accept" &&
        input.contractAgreementArtifact.status === "agreed") ||
        (input.contractReviewArtifact.decision === "revise" &&
          input.contractAgreementArtifact.status === "blocked")
        ? "pass"
        : "fail",
      "The agreement status follows the review decision."
    ),
    generator_plan_written: fileWrittenCheck(
      "generator_plan_written",
      input.artifacts.generator_plan_json_path,
      "Generator plan artifact"
    ),
    planner_context_surface_reserved: fileSurfaceReservedCheck(
      "planner_context_surface_reserved",
      input.artifacts.planner_context_path,
      "Planner context handoff"
    ),
    generator_brief_surface_reserved: fileSurfaceReservedCheck(
      "generator_brief_surface_reserved",
      input.artifacts.generator_brief_path,
      "Generator brief handoff"
    ),
    qa_review_surface_reserved: fileSurfaceReservedCheck(
      "qa_review_surface_reserved",
      input.artifacts.qa_review_path,
      "QA review handoff"
    ),
    handoff_is_resumable: checkResult(
      "handoff_is_resumable",
      pathExists(input.artifacts.planner_context_path) &&
        pathExists(input.artifacts.generator_brief_path) &&
        pathExists(input.artifacts.qa_review_path) &&
        pathExists(input.artifacts.controller_decision_path) &&
        (input.previousPatchTargetCheckIds.length === 0 || input.previousPatchRequestAddressed)
        ? "pass"
        : "fail",
      "The round keeps the full handoff surface and does not drop carried patch context."
    ),
    evaluator_verdict_surface_reserved: fileSurfaceReservedCheck(
      "evaluator_verdict_surface_reserved",
      input.artifacts.evaluator_verdict_json_path,
      "Evaluator verdict artifact"
    ),
    patch_request_surface_reserved: fileSurfaceReservedCheck(
      "patch_request_surface_reserved",
      input.artifacts.patch_request_json_path,
      "Patch request artifact"
    ),
    previous_patch_request_addressed: checkResult(
      "previous_patch_request_addressed",
      input.previousPatchTargetCheckIds.length === 0 || input.previousPatchRequestAddressed
        ? "pass"
        : "fail",
      input.previousPatchTargetCheckIds.length === 0
        ? "No previous patch request required carry-forward."
        : input.previousPatchRequestAddressed
          ? `The current contract explicitly carries forward ${input.previousPatchTargetCheckIds.join(", ")}.`
          : `The current contract does not explicitly carry forward ${input.previousPatchTargetCheckIds.join(", ")}.`
    ),
    eval_report_surface_reserved: fileSurfaceReservedCheck(
      "eval_report_surface_reserved",
      input.artifacts.eval_report_path,
      "Eval report"
    ),
    controller_decision_surface_reserved: fileSurfaceReservedCheck(
      "controller_decision_surface_reserved",
      input.artifacts.controller_decision_path,
      "Controller decision handoff"
    ),
    adapter_boundary_documented: checkResult(
      "adapter_boundary_documented",
      existsSync(adapterContractDocPath) ? "pass" : "fail",
      existsSync(adapterContractDocPath)
        ? "Adapter contract document exists."
        : "Adapter contract document is missing."
    ),
    adapter_runtime_present: checkResult(
      "adapter_runtime_present",
      existsSync(adapterRuntimePath) ? "pass" : "fail",
      existsSync(adapterRuntimePath)
        ? "Adapter runtime source exists."
        : "Adapter runtime source is missing."
    ),
    adapter_example_written: checkResult(
      "adapter_example_written",
      existsSync(adapterExamplePath) ? "pass" : "fail",
      existsSync(adapterExamplePath)
        ? "Adapter example config exists."
        : "Adapter example config is missing."
    )
  };
};

const scoreDimensionApplicability = (input: {
  dimension: NonNullable<LoopRubric["score_dimensions"]>[number];
  contractArtifact: RoundContractArtifact;
  loadedAdapter?: LoadedAdapterContract;
}): boolean => {
  if (
    input.dimension.skip_in_negotiation_modes?.includes(
      input.contractArtifact.negotiation_mode
    )
  ) {
    return false;
  }

  if (input.dimension.requires_adapter && !input.loadedAdapter) {
    return false;
  }

  const expectedTargetSurfaces =
    input.loadedAdapter?.verification_profile?.profile.expected_target_surfaces ?? [];
  if (
    input.dimension.requires_target_surfaces?.length &&
    !input.dimension.requires_target_surfaces.some((surface) =>
      expectedTargetSurfaces.includes(surface)
    )
  ) {
    return false;
  }

  if (input.dimension.required_core_probe_modes?.length) {
    const profileProbeModes = new Set(
      input.loadedAdapter?.verification_profile?.profile.core_probes?.map((probe) => probe.mode) ?? []
    );
    if (
      !input.dimension.required_core_probe_modes.some((mode) => profileProbeModes.has(mode))
    ) {
      return false;
    }
  }

  return true;
};

const buildDimensionScores = (input: {
  rubric: LoopRubric;
  checkResults: RoundCheckResult[];
  staticCheckLookup: Partial<Record<string, RoundCheckResult>>;
  coreProbeResults: CoreVerificationProbeExecution[];
  contractArtifact: RoundContractArtifact;
  loadedAdapter?: LoadedAdapterContract;
}): EvalScoreDimension[] => {
  const dimensions = input.rubric.score_dimensions ?? [];
  const checkLookup = new Map(input.checkResults.map((result) => [result.check_id, result]));
  return dimensions.map((dimension) => {
    const applicable = scoreDimensionApplicability({
      dimension,
      contractArtifact: input.contractArtifact,
      loadedAdapter: input.loadedAdapter
    });
    const contributingChecks = (dimension.check_ids ?? [])
      .map((checkId) => checkLookup.get(checkId) ?? input.staticCheckLookup[checkId])
      .filter((result): result is RoundCheckResult => Boolean(result));
    const contributingProbes = input.coreProbeResults.filter((probe) => {
      if ((probe.role ?? "supporting") !== "release_gate") {
        return false;
      }
      if (!dimension.required_core_probe_modes?.length) {
        return false;
      }
      return dimension.required_core_probe_modes.includes(probe.mode);
    });
    const totalItems = contributingChecks.length + contributingProbes.length;
    const passedItems =
      contributingChecks.filter((result) => result.status === "pass").length +
      contributingProbes.filter((probe) => probe.ok).length;
    const score =
      !applicable
        ? 1
        : totalItems === 0
          ? 0
          : strictPartialCreditScore(passedItems, totalItems);
    const passed = !applicable || score + 0.0005 >= dimension.minimum_score;
    const detail = !applicable
      ? "Not applicable for the current adapter or target surfaces."
      : totalItems === 0
        ? "No contributing checks or release-gate probes were available for this dimension."
        : `${passedItems}/${totalItems} contributing checks and probes passed; strict partial-credit score is ${score.toFixed(3)}.`;

    return {
      dimension_id: dimension.dimension_id,
      label: dimension.label,
      ...(dimension.description ? { description: dimension.description } : {}),
      weight: dimension.weight ?? 1,
      minimum_score: dimension.minimum_score,
      applicable,
      passed,
      score,
      contributing_check_ids: contributingChecks.map((result) => result.check_id),
      contributing_probe_ids: contributingProbes.map((probe) => probe.probe_id),
      detail
    };
  });
};

const targetSignalBlockingFailures = (input: {
  rubric: LoopRubric;
  dimensionScores: EvalScoreDimension[];
}): EvalScoreDimension[] => {
  const dimensionLookup = new Map(
    (input.rubric.score_dimensions ?? []).map((dimension) => [
      dimension.dimension_id,
      dimension
    ])
  );

  return input.dimensionScores.filter((dimension) => {
    if (!dimension.applicable || dimension.passed) {
      return false;
    }

    return (
      dimensionLookup.get(dimension.dimension_id)?.blocks_target_signal ?? true
    );
  });
};

export const buildEvalReport = (input: {
  round: number;
  rubric: LoopRubric;
  contractArtifact: RoundContractArtifact;
  contractReviewArtifact: ContractReviewArtifact;
  contractAgreementArtifact: ContractAgreementArtifact;
  artifacts: RoundArtifacts;
  plannerBriefPath: string;
  planPath: string;
  loadedAdapter?: LoadedAdapterContract;
  adapterExecutions: AdapterCapabilityExecution[];
  coreProbeResults: CoreVerificationProbeExecution[];
  targetManifest?: TargetManifest;
  previousPatchTargetCheckIds: string[];
  previousPatchRequestAddressed: boolean;
}): EvalReport => {
  const evaluationCheckIds =
    input.contractAgreementArtifact.acceptance_checks.length > 0
      ? input.contractAgreementArtifact.acceptance_checks
      : input.contractArtifact.acceptance_checks;
  const thresholdAcceptanceCheckIds = evaluationCheckIds.filter(
    (checkId) => checkId !== "target_signal_thresholds_met"
  );
  const adapterResults = input.adapterExecutions.map((execution) =>
    checkResult(
      `adapter_${execution.capability}`,
      execution.result.ok ? "pass" : "fail",
      execution.result.summary
    )
  );
  const adapterResultCheckIds = new Set(adapterResults.map((result) => result.check_id));
  const failedAdapterResults = adapterResults.filter(isFailingCheck);
  const criticalAdapterFailures = new Set([
    "adapter_prepare_target",
    "adapter_run_target",
    "adapter_run_checks",
    "adapter_grade_round"
  ]);
  const lookup = staticCheckLookup({
    contractArtifact: input.contractArtifact,
    contractReviewArtifact: input.contractReviewArtifact,
    contractAgreementArtifact: input.contractAgreementArtifact,
    artifacts: input.artifacts,
    plannerBriefPath: input.plannerBriefPath,
    planPath: input.planPath,
    previousPatchTargetCheckIds: input.previousPatchTargetCheckIds,
    previousPatchRequestAddressed: input.previousPatchRequestAddressed
  });

  const actionablePreviousPatchTargetCheckIds = input.previousPatchTargetCheckIds.filter(
    (checkId) => !nonCarryForwardDerivedChecks.has(checkId)
  );

  lookup.adapter_claims_are_honest = adapterHonestyCheck({
    loadedAdapter: input.loadedAdapter,
    adapterExecutions: input.adapterExecutions
  });
  lookup.proof_provenance_is_attested = proofProvenanceAttestationCheck({
    loadedAdapter: input.loadedAdapter,
    adapterExecutions: input.adapterExecutions
  });
  lookup.live_verification_present = liveVerificationPresentCheck({
    loadedAdapter: input.loadedAdapter,
    adapterExecutions: input.adapterExecutions,
    coreProbeResults: input.coreProbeResults,
    targetManifest: input.targetManifest
  });
  lookup.independent_target_probe_present = independentTargetProbeCheck({
    loadedAdapter: input.loadedAdapter,
    coreProbeResults: input.coreProbeResults,
    targetManifest: input.targetManifest
  });
  lookup.proof_boundary_is_independent = proofBoundaryIndependenceCheck({
    loadedAdapter: input.loadedAdapter,
    adapterExecutions: input.adapterExecutions
  });
  lookup.adapter_evidence_is_meaningful = adapterMeaningfulEvidenceCheck({
    loadedAdapter: input.loadedAdapter,
    adapterExecutions: input.adapterExecutions
  });
  lookup.adapter_criteria_are_grounded = adapterCriteriaGroundingCheck({
    loadedAdapter: input.loadedAdapter,
    adapterExecutions: input.adapterExecutions
  });
  const verificationProfileEvaluation = evaluateVerificationProfile({
    loadedAdapter: input.loadedAdapter,
    adapterExecutions: input.adapterExecutions
  });
  lookup.adapter_criteria_match_profile = verificationProfileEvaluation.profileCheck;
  lookup.adapter_execution_healthy = checkResult(
    "adapter_execution_healthy",
    input.loadedAdapter
      ? failedAdapterResults.length === 0
        ? "pass"
        : "fail"
      : "fail",
    input.loadedAdapter
      ? failedAdapterResults.length === 0
        ? "Every adapter capability completed without failure."
        : `Adapter capability failures remain: ${failedAdapterResults.map((result) => result.check_id).join(", ")}.`
      : "No adapter is attached, so adapter execution health cannot be proven."
  );
  const gradeRoundExecution = successfulGradeRoundExecutionFor(input.adapterExecutions);
  const browserSurfaceExpected = expectedTargetSurfacesFor(input.loadedAdapter).has("browser");
  const subjectiveMetricResults = gradeRoundExecution?.result.subjective_metric_results ?? [];
  const requiredSubjectiveMetricResults = subjectiveMetricResults.filter(
    (metric) => metric.required !== false
  );
  const failedRequiredSubjectiveMetrics = requiredSubjectiveMetricResults.filter(
    (metric) => metric.status === "fail"
  );
  const gradeRoundEvidencePaths = unique([
    ...(gradeRoundExecution?.verified_evidence_paths ?? []),
    ...(gradeRoundExecution?.result.evidence_paths ?? [])
  ]);
  const visualEvidencePresent = unique([
    ...gradeRoundEvidencePaths,
    ...input.coreProbeResults.flatMap((probe) => probe.evidence_paths)
  ]).some(isVisualEvidencePath);
  const prototypeBaselinePresent = gradeRoundExecution?.result.metadata?.prototype_baseline_present === true;
  const prototypeDeltaMetric = subjectiveMetricResults.find(
    (metric) => metric.metric_id === "prototype_delta"
  );
  const prototypeDeltaRequired = browserSurfaceExpected && input.round >= 2;
  const prototypeDeltaPassed =
    !prototypeDeltaRequired
      ? true
      : prototypeDeltaMetric?.status === "pass";
  lookup.subjective_quality_present = checkResult(
    "subjective_quality_present",
    !browserSurfaceExpected
      ? "not_applicable"
      : subjectiveMetricResults.length > 0
        ? "pass"
        : "fail",
    !browserSurfaceExpected
      ? "Subjective quality evidence is not required for non-browser targets."
      : subjectiveMetricResults.length > 0
        ? `grade_round reported ${subjectiveMetricResults.length} subjective product-quality metric result(s).`
        : "Browser release quality requires subjective metric results, but grade_round did not report any."
  );
  lookup.subjective_thresholds_met = checkResult(
    "subjective_thresholds_met",
    !browserSurfaceExpected
      ? "not_applicable"
      : subjectiveMetricResults.length === 0
        ? "fail"
        : failedRequiredSubjectiveMetrics.length === 0
          ? "pass"
          : "fail",
    !browserSurfaceExpected
      ? "Subjective threshold gating is not required for non-browser targets."
      : subjectiveMetricResults.length === 0
        ? "Required browser subjective thresholds could not be evaluated."
        : failedRequiredSubjectiveMetrics.length === 0
          ? "Every required subjective metric cleared its configured threshold."
          : `Required subjective metrics remain below threshold: ${failedRequiredSubjectiveMetrics.map((metric) => metric.metric_id).join(", ")}.`
  );
  lookup.visual_evidence_present = checkResult(
    "visual_evidence_present",
    !browserSurfaceExpected
      ? "not_applicable"
      : visualEvidencePresent
        ? "pass"
        : "fail",
    !browserSurfaceExpected
      ? "Rendered browser evidence is not required for non-browser targets."
      : visualEvidencePresent
        ? "Rendered browser evidence is attached via screenshots or traces."
        : "Browser release quality requires rendered screenshots or traces, but none were attached."
  );
  lookup.prototype_baseline_present = checkResult(
    "prototype_baseline_present",
    !browserSurfaceExpected
      ? "not_applicable"
      : input.round < 2
        ? "pass"
        : prototypeBaselinePresent
          ? "pass"
          : "fail",
    !browserSurfaceExpected
      ? "Prototype baseline comparison is not required for non-browser targets."
      : input.round < 2
        ? "Prototype baseline capture is optional on the first browser round."
        : prototypeBaselinePresent
          ? "A persisted baseline screenshot is available for prototype-to-release comparison."
          : "Browser rounds after the baseline capture must keep a persisted prototype screenshot for delta judging."
  );
  lookup.prototype_delta_present = checkResult(
    "prototype_delta_present",
    !browserSurfaceExpected
      ? "not_applicable"
      : !prototypeDeltaRequired
        ? "pass"
        : prototypeDeltaPassed
          ? "pass"
          : "fail",
    !browserSurfaceExpected
      ? "Prototype delta scoring is not required for non-browser targets."
      : !prototypeDeltaRequired
        ? "Prototype delta scoring is deferred until a follow-up browser round exists."
        : prototypeDeltaMetric
          ? prototypeDeltaMetric.status === "pass"
            ? "The current browser surface materially improves beyond the stored baseline."
            : "The current result is not yet materially beyond the initial prototype in layout, hierarchy, workflow visibility, or state expression."
          : "Browser rounds after the baseline capture must score prototype_delta explicitly."
  );

  const preReleaseAcceptanceResults = unique([
    ...thresholdAcceptanceCheckIds.filter((checkId) => checkId !== "release_blockers_recorded"),
    "adapter_claims_are_honest",
    "proof_provenance_is_attested",
    "live_verification_present",
    "independent_target_probe_present",
    "proof_boundary_is_independent",
    "adapter_evidence_is_meaningful",
    "adapter_criteria_are_grounded",
    "adapter_criteria_match_profile",
    ...(browserSurfaceExpected
      ? [
          "subjective_quality_present",
          "subjective_thresholds_met",
          "visual_evidence_present",
          "prototype_baseline_present",
          "prototype_delta_present"
        ]
      : [])
  ])
    .map(
      (checkId) =>
        lookup[checkId] ??
        checkResult(checkId, "fail", `No evaluator rule is defined for check '${checkId}'.`)
    );

  const failedPreReleaseAcceptanceResults = preReleaseAcceptanceResults.filter(
    isFailingCheck
  );
  const releaseBlockerDetails = unique([
    ...input.contractReviewArtifact.required_changes,
    ...failedPreReleaseAcceptanceResults.map((result) => result.detail),
    ...failedAdapterResults.map((result) => result.detail)
  ]);

  lookup.release_blockers_recorded = checkResult(
    "release_blockers_recorded",
    failedPreReleaseAcceptanceResults.length > 0 ||
      input.contractAgreementArtifact.status === "blocked" ||
      failedAdapterResults.length > 0
      ? releaseBlockerDetails.length > 0
        ? "pass"
        : "fail"
      : "pass",
    failedPreReleaseAcceptanceResults.length > 0 ||
      input.contractAgreementArtifact.status === "blocked" ||
      failedAdapterResults.length > 0
      ? "Release blockers were captured from failed checks, adapter failures, or blocked negotiation."
      : "No release blockers were necessary because the round contract passed."
  );

  const previousPatchResolved =
    actionablePreviousPatchTargetCheckIds.length === 0
      ? input.previousPatchTargetCheckIds.length === 0 || input.previousPatchRequestAddressed
      : actionablePreviousPatchTargetCheckIds.every((checkId) => {
          const targetResult =
            lookup[checkId] ??
            checkResult(checkId, "fail", `No evaluator rule is defined for carried check '${checkId}'.`);
          return isPassingCheck(targetResult);
        });

  lookup.previous_patch_request_resolved = checkResult(
    "previous_patch_request_resolved",
    previousPatchResolved ? "pass" : "fail",
    actionablePreviousPatchTargetCheckIds.length === 0
      ? "No previous patch request required resolution."
      : previousPatchResolved
        ? `Every carried check now passes: ${actionablePreviousPatchTargetCheckIds.join(", ")}.`
        : `At least one carried check is still unresolved: ${actionablePreviousPatchTargetCheckIds.join(", ")}.`
  );

  const acceptanceResultsWithoutThresholdCarry = thresholdAcceptanceCheckIds.map(
    (checkId) =>
      lookup[checkId] ??
      checkResult(checkId, "fail", `No evaluator rule is defined for check '${checkId}'.`)
  );

  let check_results = unique([
    ...acceptanceResultsWithoutThresholdCarry.map((result) => result.check_id),
    "release_blockers_recorded",
    "previous_patch_request_addressed",
    "previous_patch_request_resolved",
    ...Array.from(proofEvaluatorChecks),
    "target_signal_thresholds_met",
    ...adapterResults.map((result) => result.check_id)
  ]).map((checkId) => {
    if (lookup[checkId]) {
      return lookup[checkId];
    }

    if (checkId.startsWith("adapter_")) {
      return (
        adapterResults.find((result) => result.check_id === checkId) ??
        checkResult(checkId, "fail", `Adapter result '${checkId}' is missing.`)
      );
    }

    return checkResult(checkId, "fail", `No evaluator rule is defined for check '${checkId}'.`);
  });

  const externalGrade =
    gradeRoundExecution?.result.score !== undefined ? gradeRoundExecution.result.score : undefined;
  const criterionResultsForScoring = verificationProfileEvaluation.criterionChecks.length > 0
    ? verificationProfileEvaluation.criterionChecks
    : input.loadedAdapter
      ? (
          gradeRoundExecution?.verified_criteria_results.length
            ? gradeRoundExecution.verified_criteria_results
            :
          input.adapterExecutions
            .filter((execution) => execution.capability === "run_checks" && execution.result.ok)
            .flatMap((execution) => execution.verified_criteria_results)
        ).map((criterion) =>
          checkResult(
            criterion.criterion_id,
            criterion.status,
            criterion.summary
          )
        )
      : [];
  const criterionPassRate = input.loadedAdapter
    ? scoreFromResults(criterionResultsForScoring, { strictPartialCredit: true })
    : 0;
  const thresholdVerdictScore = input.loadedAdapter
    ? gradeRoundExecution?.result.threshold_verdict === "pass" &&
      verificationProfileEvaluation.hardFailedCriterionIds.length === 0
      ? 1
      : 0
    : 0;
  const evidence_paths = unique(
    [
      ...input.adapterExecutions.flatMap((execution) => execution.verified_evidence_paths),
      ...input.coreProbeResults.flatMap((result) => result.evidence_paths)
    ]
  );
  const adapterVerdict = gradeRoundExecution?.result.overall_verdict;
  const hasCriticalAdapterFailure = failedAdapterResults.some((result) =>
    criticalAdapterFailures.has(result.check_id)
  );

  let overall_verdict: RoundVerdict =
    input.contractAgreementArtifact.status === "blocked" || input.contractReviewArtifact.decision === "revise"
      ? "hold"
      : adapterVerdict === "hold" || hasCriticalAdapterFailure
        ? "hold"
        : failedPreReleaseAcceptanceResults.length > 0 ||
            adapterVerdict === "revise" ||
            failedAdapterResults.length > 0
          ? "revise"
          : "advance";

  let contractCompleted =
    overall_verdict === "advance" &&
    acceptanceResultsWithoutThresholdCarry.every(isSatisfiedCheck);
  const controlPlaneResults = check_results.filter(
    (result) =>
      !proofEvaluatorChecks.has(result.check_id) &&
      !adapterResultCheckIds.has(result.check_id) &&
      !nonScoringDerivedChecks.has(result.check_id)
  );
  const proofResults = input.loadedAdapter
    ? unique([
        ...Array.from(proofEvaluatorChecks),
        ...adapterResults.map((result) => result.check_id)
      ]).map(
        (checkId) =>
          lookup[checkId] ??
          adapterResults.find((result) => result.check_id === checkId) ??
          checkResult(checkId, "fail", `No evaluator rule is defined for proof check '${checkId}'.`)
      )
    : [];
  const skepticalProofResults = input.loadedAdapter
    ? Array.from(proofEvaluatorChecks).map(
        (checkId) =>
          lookup[checkId] ??
          checkResult(checkId, "fail", `No evaluator rule is defined for skeptical proof check '${checkId}'.`)
      )
    : [];
  const control_plane_score = scoreFromResults(controlPlaneResults);
  const proofPassRate = input.loadedAdapter
    ? scoreFromResults(proofResults, { strictPartialCredit: true })
    : 0;
  const skepticalProofPassRate = input.loadedAdapter
    ? scoreFromResults(skepticalProofResults, { strictPartialCredit: true })
    : 0;
  const skepticalProofFailed = skepticalProofResults.some(isFailingCheck);
  const hasProofExecution = input.adapterExecutions.some(
    (execution) =>
      execution.result.ok &&
      (execution.capability === "capture_evidence" ||
        execution.capability === "run_checks" ||
        execution.capability === "grade_round")
  );
  const proofScoreWeights = proofScoreWeightsFor(input.loadedAdapter);
  const raw_proof_score =
    input.loadedAdapter
      ? !hasProofExecution
        ? 0
        : proofPassRate * proofScoreWeights.proof_pass_rate +
          criterionPassRate * proofScoreWeights.criterion_pass_rate +
          thresholdVerdictScore * proofScoreWeights.threshold_verdict +
          (externalGrade ?? 0) * proofScoreWeights.external_grade
      : 0;
  const proof_score = Number(
    (
      input.loadedAdapter
        ? skepticalProofFailed
          ? Math.min(raw_proof_score, skepticalProofPassRate * 0.6)
          : raw_proof_score
        : 0
    ).toFixed(3)
  );
  const releaseScoreWeights = releaseScoreWeightsFor(input.loadedAdapter);
  let release_score = Number(
    (
      input.loadedAdapter
        ? control_plane_score * releaseScoreWeights.control_plane_score +
          proof_score * releaseScoreWeights.proof_score
        : control_plane_score * releaseScoreWeights.control_plane_score
    ).toFixed(3)
  );
  const releaseScoreCapDetails: string[] = [];
  if (browserSurfaceExpected && subjectiveMetricResults.length === 0) {
    release_score = Math.min(release_score, 0.59);
    releaseScoreCapDetails.push(
      "Release score is capped at 0.590 because browser release quality did not report any subjective metrics."
    );
  }
  if (browserSurfaceExpected && !visualEvidencePresent) {
    release_score = Math.min(release_score, 0.59);
    releaseScoreCapDetails.push(
      "Release score is capped at 0.590 because no rendered browser screenshots or traces were attached."
    );
  }
  if (browserSurfaceExpected && failedRequiredSubjectiveMetrics.length > 0) {
    release_score = Math.min(release_score, 0.79);
    releaseScoreCapDetails.push(
      `Release score is capped at 0.790 because required subjective metrics still fail: ${failedRequiredSubjectiveMetrics.map((metric) => metric.metric_id).join(", ")}.`
    );
  }
  if (browserSurfaceExpected && prototypeDeltaRequired && !prototypeDeltaPassed) {
    release_score = Math.min(release_score, 0.84);
    releaseScoreCapDetails.push(
      "Release score is capped at 0.840 because the current browser surface does not yet materially improve beyond the stored baseline."
    );
  }
  release_score = Number(release_score.toFixed(3));
  const coreOwnedEvaluatorProfileAttached =
    !input.loadedAdapter || input.loadedAdapter.verification_profile_source === "core";
  const threshold_results: ReleaseThresholdResults = {
    contract_completed: contractCompleted,
    minimum_control_plane_score_met:
      control_plane_score + 0.0005 >= input.rubric.minimum_control_plane_score,
    minimum_proof_score_met:
      proof_score + 0.0005 >= input.rubric.minimum_proof_score,
    minimum_release_score_met:
      release_score + 0.0005 >= input.rubric.target_total_score,
    adapter_required_met:
      input.rubric.target_signal_requires_adapter ? Boolean(input.loadedAdapter) : true,
    grade_score_required_met:
      input.rubric.target_signal_requires_grade_score
        ? externalGrade !== undefined &&
          (!browserSurfaceExpected || subjectiveMetricResults.length > 0)
        : true,
    core_probe_required_met:
      !input.loadedAdapter
        ? true
        : !coreOwnedEvaluatorProfileAttached
          ? false
          : (input.loadedAdapter.verification_profile?.profile
                .target_reached_requires_core_probes ?? true)
            ? lookup.independent_target_probe_present?.status === "pass"
            : true,
    dimension_thresholds_met: true,
    target_reached_eligible: false
  };
  threshold_results.target_reached_eligible =
    threshold_results.contract_completed &&
    threshold_results.minimum_control_plane_score_met &&
    threshold_results.minimum_proof_score_met &&
    threshold_results.minimum_release_score_met &&
    threshold_results.adapter_required_met &&
    threshold_results.grade_score_required_met &&
    threshold_results.core_probe_required_met &&
    threshold_results.dimension_thresholds_met;
  const thresholdGapDetailsBase = unique(
    [
      !threshold_results.adapter_required_met
        ? "Target-reached signaling requires an attached adapter."
        : undefined,
      !threshold_results.grade_score_required_met
        ? browserSurfaceExpected
          ? "Target-reached signaling requires a numeric grade_round score with browser subjective quality results."
          : "Target-reached signaling requires a numeric grade_round score."
        : undefined,
      !threshold_results.core_probe_required_met
        ? lookup.independent_target_probe_present?.detail
        : undefined,
      lookup.proof_provenance_is_attested?.status === "fail"
        ? lookup.proof_provenance_is_attested.detail
        : undefined,
      lookup.live_verification_present?.status === "fail"
        ? lookup.live_verification_present.detail
        : undefined,
      !threshold_results.minimum_control_plane_score_met
        ? `Control-plane score ${control_plane_score.toFixed(3)} is below the minimum ${input.rubric.minimum_control_plane_score.toFixed(3)}.`
        : undefined,
      !threshold_results.minimum_proof_score_met
        ? `Proof score ${proof_score.toFixed(3)} is below the minimum ${input.rubric.minimum_proof_score.toFixed(3)}.`
        : undefined,
      !threshold_results.minimum_release_score_met
        ? `Release score ${release_score.toFixed(3)} is below the target ${input.rubric.target_total_score.toFixed(3)}.`
        : undefined,
      ...releaseScoreCapDetails
    ].filter((detail): detail is string => Boolean(detail))
  );
  const recomputeDimensionThresholds = (): {
    dimension_scores: EvalScoreDimension[];
    failedDimensionScores: EvalScoreDimension[];
    thresholdGapDetails: string[];
  } => {
    const dimension_scores = buildDimensionScores({
      rubric: input.rubric,
      checkResults: check_results,
      staticCheckLookup: lookup,
      coreProbeResults: input.coreProbeResults,
      contractArtifact: input.contractArtifact,
      loadedAdapter: input.loadedAdapter
    });
    const failedDimensionScores = targetSignalBlockingFailures({
      rubric: input.rubric,
      dimensionScores: dimension_scores
    });
    threshold_results.dimension_thresholds_met = failedDimensionScores.length === 0;
    const dimensionGapDetails = failedDimensionScores.map(
      (dimension) =>
        `Dimension '${dimension.label}' scored ${dimension.score.toFixed(3)} below the minimum ${dimension.minimum_score.toFixed(3)}. ${dimension.detail}`
    );
    const thresholdGapDetails = unique([
      ...thresholdGapDetailsBase,
      ...dimensionGapDetails
    ]);
    threshold_results.target_reached_eligible =
      threshold_results.contract_completed &&
      threshold_results.minimum_control_plane_score_met &&
      threshold_results.minimum_proof_score_met &&
      threshold_results.minimum_release_score_met &&
      threshold_results.adapter_required_met &&
      threshold_results.grade_score_required_met &&
      threshold_results.core_probe_required_met &&
      threshold_results.dimension_thresholds_met;
    return {
      dimension_scores,
      failedDimensionScores,
      thresholdGapDetails
    };
  };

  let {
    dimension_scores,
    failedDimensionScores,
    thresholdGapDetails
  } = recomputeDimensionThresholds();

  lookup.target_signal_thresholds_met = checkResult(
    "target_signal_thresholds_met",
    !input.loadedAdapter
      ? "not_applicable"
      : contractCompleted && thresholdGapDetails.length === 0
        ? "pass"
      : "fail",
    !input.loadedAdapter
      ? "Target signal thresholds are not applicable without an attached adapter."
      : contractCompleted && thresholdGapDetails.length === 0
        ? "Terminal proof and release thresholds are satisfied."
        : thresholdGapDetails.length > 0
          ? `Terminal proof and release thresholds remain open: ${thresholdGapDetails.join(" ")}`
          : "Round contract is not complete yet, so target signaling thresholds are not ready."
  );
  check_results = check_results.map((result) =>
    result.check_id === "target_signal_thresholds_met"
      ? lookup.target_signal_thresholds_met
      : result
  );
  const recomputedPreviousPatchResolved =
    actionablePreviousPatchTargetCheckIds.length === 0
      ? input.previousPatchTargetCheckIds.length === 0 || input.previousPatchRequestAddressed
      : actionablePreviousPatchTargetCheckIds.every((checkId) => {
          const targetResult =
            lookup[checkId] ??
            checkResult(checkId, "fail", `No evaluator rule is defined for carried check '${checkId}'.`);
          return isPassingCheck(targetResult);
        });
  lookup.previous_patch_request_resolved = checkResult(
    "previous_patch_request_resolved",
    recomputedPreviousPatchResolved ? "pass" : "fail",
    actionablePreviousPatchTargetCheckIds.length === 0
      ? "No previous patch request required resolution."
      : recomputedPreviousPatchResolved
        ? `Every carried check now passes: ${actionablePreviousPatchTargetCheckIds.join(", ")}.`
        : `At least one carried check is still unresolved: ${actionablePreviousPatchTargetCheckIds.join(", ")}.`
  );
  check_results = check_results.map((result) =>
    result.check_id === "previous_patch_request_resolved"
      ? lookup.previous_patch_request_resolved
      : result
  );
  ({
    dimension_scores,
    failedDimensionScores,
    thresholdGapDetails
  } = recomputeDimensionThresholds());
  lookup.target_signal_thresholds_met = checkResult(
    "target_signal_thresholds_met",
    !input.loadedAdapter
      ? "not_applicable"
      : contractCompleted && thresholdGapDetails.length === 0
        ? "pass"
      : "fail",
    !input.loadedAdapter
      ? "Target signal thresholds are not applicable without an attached adapter."
      : contractCompleted && thresholdGapDetails.length === 0
        ? "Terminal proof and release thresholds are satisfied."
        : thresholdGapDetails.length > 0
          ? `Terminal proof and release thresholds remain open: ${thresholdGapDetails.join(" ")}`
          : "Round contract is not complete yet, so target signaling thresholds are not ready."
  );
  check_results = check_results.map((result) =>
    result.check_id === "target_signal_thresholds_met"
      ? lookup.target_signal_thresholds_met
      : result
  );
  if (overall_verdict === "advance" && failedDimensionScores.length > 0) {
    overall_verdict = "revise";
  }
  const acceptanceResults = evaluationCheckIds.map(
    (checkId) =>
      lookup[checkId] ??
      checkResult(checkId, "fail", `No evaluator rule is defined for check '${checkId}'.`)
  );
  const failedAcceptanceResults = acceptanceResults.filter(isFailingCheck);
  if (overall_verdict === "advance" && failedAcceptanceResults.length > 0) {
    overall_verdict = "revise";
  }
  contractCompleted =
    overall_verdict === "advance" &&
    acceptanceResults.every(isSatisfiedCheck);
  threshold_results.contract_completed = contractCompleted;
  threshold_results.target_reached_eligible =
    threshold_results.contract_completed &&
    threshold_results.minimum_control_plane_score_met &&
    threshold_results.minimum_proof_score_met &&
    threshold_results.minimum_release_score_met &&
    threshold_results.adapter_required_met &&
    threshold_results.grade_score_required_met &&
    threshold_results.core_probe_required_met &&
    threshold_results.dimension_thresholds_met;
  if (failedAcceptanceResults.length > 0 || failedAdapterResults.length > 0 || thresholdGapDetails.length > 0) {
    lookup.release_blockers_recorded = checkResult(
      "release_blockers_recorded",
      "pass",
      thresholdGapDetails.length > 0
        ? "Release blockers were captured from failed checks, adapter failures, or unmet target thresholds."
        : "Release blockers were captured from failed checks, adapter failures, or blocked negotiation."
    );
    check_results = check_results.map((result) =>
      result.check_id === "release_blockers_recorded"
        ? lookup.release_blockers_recorded
        : result
    );
  }
  if (contractCompleted && thresholdGapDetails.length > 0) {
    lookup.release_blockers_recorded = checkResult(
      "release_blockers_recorded",
      "pass",
      "Release blockers were captured from failed checks, adapter failures, or unmet terminal thresholds."
    );
    check_results = check_results.map((result) =>
      result.check_id === "release_blockers_recorded"
        ? lookup.release_blockers_recorded
        : result
    );
  }
  const total_score = release_score;
  const resolved_check_ids = check_results
    .filter(isPassingCheck)
    .map((result) => result.check_id);
  const unresolved_check_ids = check_results
    .filter(isFailingCheck)
    .map((result) => result.check_id);

  return {
    generated_at: new Date().toISOString(),
    round: input.round,
    total_score,
    control_plane_score,
    proof_score,
    release_score,
    overall_verdict,
    strengths: check_results
      .filter(isPassingCheck)
      .map((result) => result.detail)
      .slice(0, 8),
    blockers: unique([
      ...releaseBlockerDetails,
      ...thresholdGapDetails,
      ...check_results
        .filter(isFailingCheck)
        .map((result) => result.detail)
    ]).slice(0, 8),
    next_actions:
      input.contractReviewArtifact.decision === "revise"
        ? input.contractReviewArtifact.required_changes.slice(0, 8)
        : failedAcceptanceResults.length > 0
          ? failedAcceptanceResults
              .map((result) => `Close '${result.check_id}': ${result.detail}`)
              .slice(0, 8)
        : failedAdapterResults.length > 0
            ? failedAdapterResults
                .map((result) => `Repair '${result.check_id}': ${result.detail}`)
                .slice(0, 8)
          : thresholdGapDetails.length > 0
            ? thresholdGapDetails
                .map((detail) => `Do not claim target_reached yet: ${detail}`)
                .slice(0, 8)
          : [
              "No further remediation is required; record terminal completion and stop the run."
          ],
    evidence_paths,
    threshold_gap_details: thresholdGapDetails,
    check_results,
    resolved_check_ids,
    unresolved_check_ids,
    adapter_attached: Boolean(input.loadedAdapter),
    threshold_results,
    dimension_scores,
    adapter_results: input.adapterExecutions,
    core_probe_results: input.coreProbeResults
  };
};
