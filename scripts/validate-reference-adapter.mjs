import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  assertRoundStopReason,
  assertRuntimeEventCode,
  extractRunDirectory,
  latestRoundSummary,
  readResumeDecisionArtifact,
  readJsonFile,
  readSummary,
  runLoop
} from "./validation-utils.mjs";
import { scaffoldReferenceAdapter } from "./reference-adapter-template.mjs";

const argv = process.argv.slice(2);
const checkOnly = argv.includes("--check");
const smokeOnly = argv.includes("--smoke");
const canonicalMode = argv.includes("--canonical");
const forceReopenTerminal = argv.includes("--force-reopen-terminal");
const requireTargetReached = !argv.includes("--no-require-target-reached");
const requireProof = !argv.includes("--no-require-proof");
const requireAdapterHealth = !argv.includes("--no-require-adapter-health");
const templateFlagIndex = argv.findIndex((value) => value === "--template");
const canonicalTemplate =
  templateFlagIndex >= 0 ? argv[templateFlagIndex + 1] : "canonical-api";

const canonicalTemplateConfig = {
  "canonical-api": {
    targetFamily: "api-service",
    expectedRoundCount: 1,
    expectedNegotiationModes: ["full_negotiation"]
  },
  "canonical-api-patch-only": {
    targetFamily: "api-service",
    expectedRoundCount: 2,
    expectedNegotiationModes: ["full_negotiation", "patch_only"]
  },
  "canonical-api-recontract": {
    targetFamily: "api-service",
    expectedRoundCount: 3,
    expectedNegotiationModes: ["full_negotiation", "patch_only", "recontract"]
  },
  "canonical-crud": {
    targetFamily: "crud-api",
    expectedRoundCount: 1,
    expectedNegotiationModes: ["full_negotiation"]
  },
  "canonical-crud-patch-only": {
    targetFamily: "crud-api",
    expectedRoundCount: 2,
    expectedNegotiationModes: ["full_negotiation", "patch_only"]
  },
  "canonical-crud-recontract": {
    targetFamily: "crud-api",
    expectedRoundCount: 3,
    expectedNegotiationModes: ["full_negotiation", "patch_only", "recontract"]
  },
  "canonical-chat": {
    targetFamily: "chat-agent",
    expectedRoundCount: 1,
    expectedNegotiationModes: ["full_negotiation"]
  },
  "canonical-chat-patch-only": {
    targetFamily: "chat-agent",
    expectedRoundCount: 2,
    expectedNegotiationModes: ["full_negotiation", "patch_only"]
  },
  "canonical-chat-recontract": {
    targetFamily: "chat-agent",
    expectedRoundCount: 3,
    expectedNegotiationModes: ["full_negotiation", "patch_only", "recontract"]
  }
};

const setupChecklist = () =>
  [
    "1. Export REFERENCE_ADAPTER_CONTRACT with the absolute or repo-relative path to the companion adapter.json.",
    "2. Export either REFERENCE_TARGET_FAMILY or REFERENCE_EVALUATOR_PROFILE.",
    "3. Run `npm run validate:reference-adapter:check` for wiring preflight.",
    "4. Run `npm run validate:reference-adapter` for strict validation, or `npm run smoke:reference-adapter` for a wiring-only smoke.",
    "5. If you do not have a companion repo yet, bootstrap one with `npm run reference-adapter:scaffold -- <output-dir> [--template canonical-api|canonical-api-patch-only|canonical-api-recontract|canonical-crud|canonical-crud-patch-only|canonical-crud-recontract|canonical-chat|canonical-chat-patch-only|canonical-chat-recontract|placeholder]`.",
    "6. Install the companion-repo CI workflow with `npm run reference-adapter:install-ci -- <companion-repo-dir> --adapter adapter.json --target-family <family>` when you want the external repo to validate itself in CI.",
    "7. For a fully reproducible local reference, run one of the canonical validator scripts for single-round, patch-only, or recontract convergence."
  ].join("\n");

const failSetup = (message) => {
  console.error(`${message}\n\nReference adapter setup checklist:\n${setupChecklist()}`);
  process.exit(1);
};

const failRun = (message, details) => {
  console.error(details ? `${message}\n\n${details}` : message);
  process.exit(1);
};

const ensureFileExists = async (path, label) => {
  try {
    await access(resolve(path));
  } catch {
    failSetup(`${label} does not exist: ${path}`);
  }
};

const assertAdapterContractShape = async (path) => {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(resolve(path), "utf8"));
  } catch {
    failSetup(`REFERENCE_ADAPTER_CONTRACT is not valid JSON: ${path}`);
  }

  const requiredExecutorCapabilities = ["prepare_target", "apply_change", "run_target"];
  const requiredVerifierCapabilities = ["capture_evidence", "run_checks", "grade_round"];
  const missingExecutorCapabilities = requiredExecutorCapabilities.filter(
    (capability) => !parsed.capabilities?.[capability]?.command
  );
  if (missingExecutorCapabilities.length > 0) {
    failSetup(
      `REFERENCE_ADAPTER_CONTRACT is missing executor capabilities: ${missingExecutorCapabilities.join(", ")}.`
    );
  }
  const missingVerifierCapabilities = requiredVerifierCapabilities.filter(
    (capability) => !parsed.verification_provider?.capabilities?.[capability]?.command
  );
  if (missingVerifierCapabilities.length > 0) {
    failSetup(
      `REFERENCE_ADAPTER_CONTRACT is missing verification_provider capabilities: ${missingVerifierCapabilities.join(", ")}.`
    );
  }
};

const strictValidateSummary = async (summary, runDirectory, expected) => {
  if (!summary.adapter_attached) {
    failRun("Reference adapter validation requires an attached adapter.");
  }

  const latest = latestRoundSummary(summary);
  if (!latest) {
    failRun("Reference adapter validation expected at least one recorded round.");
  }
  if (expected) {
    if (summary.round_count !== expected.expectedRoundCount) {
      failRun(
        "Reference adapter validation observed an unexpected round count for the selected canonical template.",
        `run=${runDirectory}\nexpected_round_count=${expected.expectedRoundCount}\nactual_round_count=${summary.round_count}`
      );
    }
    const actualModes = (summary.round_history ?? []).map(
      (round) => round.negotiation_mode
    );
    const expectedModes = expected.expectedNegotiationModes;
    if (
      actualModes.length !== expectedModes.length ||
      actualModes.some((mode, index) => mode !== expectedModes[index])
    ) {
      failRun(
        "Reference adapter validation observed unexpected negotiation modes for the selected canonical template.",
        `run=${runDirectory}\nexpected=${expectedModes.join(" -> ")}\nactual=${actualModes.join(" -> ")}`
      );
    }
    if (expected.expectedRoundCount === 1) {
      assertRuntimeEventCode(summary, "resume.noop_terminal");
    } else {
      assertRuntimeEventCode(summary, "resume.continued");
    }
  }
  if (summary.stop_reason && latest.round_stop_reason !== summary.stop_reason) {
    failRun(
      "Reference adapter validation expected the latest round stop reason to match the run stop reason.",
      `run=${runDirectory}\nsummary_stop_reason=${summary.stop_reason}\nlatest_round_stop_reason=${latest.round_stop_reason ?? "missing"}`
    );
  }

  if (summary.stop_reason === "max_rounds_reached") {
    failRun(
      "Reference adapter validation failed because the run exhausted its remediation budget.",
      `run=${runDirectory}\nstop_reason=${summary.stop_reason}\nproof_score=${summary.proof_score}`
    );
  }

  if (summary.stop_reason === "adapter_contract_invalid") {
    failRun(
      "Reference adapter validation failed because the adapter contract was statically invalid.",
      `run=${runDirectory}\nstop_reason=${summary.stop_reason}`
    );
  }

  if (requireTargetReached) {
    if (summary.stop_reason !== "target_reached") {
      failRun(
        "Reference adapter validation expected stop_reason 'target_reached'.",
        `run=${runDirectory}\nstop_reason=${summary.stop_reason ?? "none"}`
      );
    }
    if (!summary.threshold_results?.target_reached_eligible) {
      failRun(
        "Reference adapter validation expected target_reached_eligible = true.",
        `run=${runDirectory}\nthreshold_results=${JSON.stringify(summary.threshold_results, null, 2)}`
      );
    }
  }

  if (requireProof && !(summary.proof_score > 0)) {
    failRun(
      "Reference adapter validation expected proof_score > 0.",
      `run=${runDirectory}\nproof_score=${summary.proof_score}`
    );
  }

  if (requireAdapterHealth) {
    const requiredResolvedChecks = [
      "adapter_claims_are_honest",
      "proof_boundary_is_independent",
      "proof_provenance_is_attested",
      "live_verification_present",
      "adapter_evidence_is_meaningful",
      "adapter_criteria_are_grounded",
      "adapter_criteria_match_profile",
      "independent_target_probe_present",
      "target_signal_thresholds_met"
    ];
    const missingChecks = requiredResolvedChecks.filter(
      (checkId) => !latest.resolved_check_ids.includes(checkId)
    );
    if (missingChecks.length > 0) {
      failRun(
        "Reference adapter validation expected the latest round to resolve core proof and adapter health checks.",
        `run=${runDirectory}\nmissing_checks=${missingChecks.join(", ")}`
      );
    }
  }

  const evalReport = await readJsonFile(latest.eval_report_path);
  const proofCapabilities = ["capture_evidence", "run_checks", "grade_round"];
  const missingProofCapabilities = proofCapabilities.filter((capability) => {
    const execution = evalReport.adapter_results?.find(
      (item) => item.capability === capability
    );
    return !execution || execution.result?.ok !== true;
  });
  if (missingProofCapabilities.length > 0) {
    failRun(
      "Reference adapter validation expected successful proof capability executions.",
      `run=${runDirectory}\nmissing_or_failed=${missingProofCapabilities.join(", ")}`
    );
  }
};

const printSummary = (summary) => {
  console.log(
    `[validate-reference-adapter] stop_reason=${summary.stop_reason} rounds=${summary.round_count} proof_score=${summary.proof_score}`
  );
};

let adapterPath = process.env.REFERENCE_ADAPTER_CONTRACT;
let evaluatorProfilePath = process.env.REFERENCE_EVALUATOR_PROFILE;
let targetFamily = process.env.REFERENCE_TARGET_FAMILY;
const expectedCanonicalConfig = canonicalMode
  ? canonicalTemplateConfig[canonicalTemplate]
  : undefined;

if (canonicalMode) {
  const canonicalDirectory = await mkdtemp(
    join(tmpdir(), "codex-reference-adapter-")
  );
  await scaffoldReferenceAdapter({
    outputDirectory: canonicalDirectory,
    template: canonicalTemplate
  });
  adapterPath = join(canonicalDirectory, "adapter.json");
  targetFamily = expectedCanonicalConfig?.targetFamily;
  evaluatorProfilePath = undefined;
  console.log(
    `[validate-reference-adapter] canonical companion (${canonicalTemplate}) scaffolded at ${canonicalDirectory}`
  );
}

if (canonicalMode && !targetFamily) {
  failSetup(
    `Unsupported canonical template '${canonicalTemplate}'. Expected one of ${Object.keys(
      canonicalTemplateConfig
    ).join(", ")}.`
  );
}

if (!adapterPath) {
  failSetup(
    "REFERENCE_ADAPTER_CONTRACT is required. Point it at the companion-repo adapter contract."
  );
}
if (!evaluatorProfilePath && !targetFamily) {
  failSetup(
    "Set either REFERENCE_EVALUATOR_PROFILE or REFERENCE_TARGET_FAMILY for the companion adapter validation."
  );
}
await ensureFileExists(adapterPath, "REFERENCE_ADAPTER_CONTRACT");
await assertAdapterContractShape(adapterPath);
if (evaluatorProfilePath) {
  await ensureFileExists(evaluatorProfilePath, "REFERENCE_EVALUATOR_PROFILE");
}

if (checkOnly) {
  console.log("[validate-reference-adapter] preflight passed");
  process.exit(0);
}

console.log(
  `[validate-reference-adapter] ${smokeOnly ? "seed wiring smoke" : "seed strict validation"}`
);
const seedArgs = [
  "--single",
  "--adapter",
  adapterPath,
  ...(targetFamily ? ["--target-family", targetFamily] : []),
  ...(evaluatorProfilePath ? ["--evaluator-profile", evaluatorProfilePath] : [])
];
const seedResult = await runLoop(seedArgs, {
  env: {
    REFERENCE_ADAPTER_CONTRACT: adapterPath
  }
});
if (seedResult.code !== 0) {
  failRun("Reference adapter seed run failed.", seedResult.stderr || seedResult.stdout);
}

const runDirectory = extractRunDirectory(seedResult.stdout);
const seedSummary = await readSummary(runDirectory);
console.log("[validate-reference-adapter] resume persisted run");
const resumeArgs = [
  "--resume-run",
  runDirectory,
  "--max-rounds",
  process.env.REFERENCE_MAX_ROUNDS ?? "3",
  ...(forceReopenTerminal ? ["--force-reopen-terminal"] : []),
  ...(targetFamily ? ["--target-family", targetFamily] : []),
  ...(evaluatorProfilePath ? ["--evaluator-profile", evaluatorProfilePath] : [])
];
const resumeResult = await runLoop(resumeArgs, {
  env: {
    REFERENCE_ADAPTER_CONTRACT: adapterPath
  }
});
if (resumeResult.code !== 0) {
  failRun("Reference adapter resume run failed.", resumeResult.stderr || resumeResult.stdout);
}

const summary = await readSummary(runDirectory);
printSummary(summary);

if (
  !forceReopenTerminal &&
  ["target_reached", "contract_completed", "environment_blocked", "adapter_contract_invalid"].includes(
    seedSummary.stop_reason ?? ""
  )
) {
  if (summary.round_count !== seedSummary.round_count) {
    failRun(
      "Reference adapter validation expected terminal resume to stay closed by default.",
      `run=${runDirectory}\nseed_round_count=${seedSummary.round_count}\nresume_round_count=${summary.round_count}`
    );
  }
  assertRuntimeEventCode(summary, "resume.noop_terminal");
  assertRoundStopReason(
    latestRoundSummary(summary),
    latestRoundSummary(seedSummary)?.round_stop_reason ?? seedSummary.stop_reason,
    "reference adapter terminal resume round"
  );
  const resumeDecision = await readResumeDecisionArtifact(summary);
  if (resumeDecision.decision !== "noop_terminal") {
    failRun(
      "Reference adapter validation expected terminal resume to persist a noop resume decision.",
      `run=${runDirectory}\ndecision=${resumeDecision.decision}`
    );
  }
}

if (!smokeOnly) {
  await strictValidateSummary(summary, runDirectory, expectedCanonicalConfig);
  console.log("[validate-reference-adapter] strict validation passed");
}
