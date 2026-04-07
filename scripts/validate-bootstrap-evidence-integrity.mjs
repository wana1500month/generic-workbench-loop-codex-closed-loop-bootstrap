import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  applyChangeEnv,
  cleanupTempRoot,
  createBootstrapFixture,
  createTempRoot,
  ensureBuild,
  readJsonFile,
  repoRoot,
  runCommand,
  writeJsonFile
} from "./testing/bootstrap-validator-helpers.mjs";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const runApplyChange = async (fixture, env) =>
  runCommand(process.execPath, [fixture.applyChangeScriptPath], {
    cwd: fixture.workspaceRoot,
    env,
    shell: false
  });

const assertEvidencePathsExist = (fixture, evidencePaths) => {
  for (const relativePath of evidencePaths) {
    const absolutePath = join(fixture.roundDirectory, relativePath);
    assert(existsSync(absolutePath), `missing evidence path: ${absolutePath}`);
  }
};

const main = async () => {
  await ensureBuild();
  const tempRoot = await createTempRoot("validate-bootstrap-evidence");

  try {
    const fakeCodexPath = join(repoRoot, "scripts", "testing", "fake-codex.mjs");

    const disabledFixture = await createBootstrapFixture(join(tempRoot, "disabled"));
    await runApplyChange(
      disabledFixture,
      applyChangeEnv(disabledFixture, {
        HARNESS_DISABLE_CODEX_AGENTS: "1",
        HARNESS_CODEX_BIN: process.execPath,
        HARNESS_CODEX_BIN_ARGS: JSON.stringify([fakeCodexPath])
      })
    );
    const disabledResult = await readJsonFile(disabledFixture.outputPath);
    const disabledMetadata = JSON.parse(
      await readFile(
        join(disabledFixture.roundDirectory, "artifacts", "generator-metadata.json"),
        "utf8"
      )
    );
    assert(disabledMetadata.response_written === false, "disabled response_written must be false");
    assertEvidencePathsExist(disabledFixture, disabledResult.evidence_paths);
    assert(
      !disabledResult.evidence_paths.some((path) => path.endsWith("generator-response.json")),
      "disabled run must not advertise a missing response artifact"
    );

    const unavailableFixture = await createBootstrapFixture(join(tempRoot, "unavailable"));
    await runApplyChange(
      unavailableFixture,
      applyChangeEnv(unavailableFixture, {
        HARNESS_CODEX_BIN: join(tempRoot, "missing-codex.exe")
      })
    );
    const unavailableResult = await readJsonFile(unavailableFixture.outputPath);
    const unavailableMetadata = JSON.parse(
      await readFile(
        join(unavailableFixture.roundDirectory, "artifacts", "generator-metadata.json"),
        "utf8"
      )
    );
    assert(
      unavailableMetadata.response_written === false,
      "unavailable response_written must be false"
    );
    assertEvidencePathsExist(unavailableFixture, unavailableResult.evidence_paths);
    assert(
      !unavailableResult.evidence_paths.some((path) => path.endsWith("generator-response.json")),
      "unavailable run must not advertise a missing response artifact"
    );

    const missingResponseFixture = await createBootstrapFixture(join(tempRoot, "missing-response"));
    await runApplyChange(
      missingResponseFixture,
      applyChangeEnv(missingResponseFixture, {
        HARNESS_CODEX_BIN: process.execPath,
        HARNESS_CODEX_BIN_ARGS: JSON.stringify([fakeCodexPath]),
        FAKE_CODEX_MODE: "missing-response"
      })
    );
    const missingResponseResult = await readJsonFile(missingResponseFixture.outputPath);
    const missingResponseMetadata = JSON.parse(
      await readFile(
        join(missingResponseFixture.roundDirectory, "artifacts", "generator-metadata.json"),
        "utf8"
      )
    );
    assert(
      missingResponseMetadata.response_written === false,
      "missing-response response_written must be false"
    );
    assertEvidencePathsExist(missingResponseFixture, missingResponseResult.evidence_paths);
    assert(
      !missingResponseResult.evidence_paths.some((path) => path.endsWith("generator-response.json")),
      "missing-response run must not advertise a missing response artifact"
    );

    const successFixture = await createBootstrapFixture(join(tempRoot, "success"));
    const recordPath = join(tempRoot, "success-record.json");
    const previousRoundDirectory = join(successFixture.runDirectory, "round-000");
    const roundContractPath = join(successFixture.roundDirectory, "round-contract.json");
    const contractAgreementPath = join(
      successFixture.roundDirectory,
      "contract-agreement.json"
    );
    const generatorPlanPath = join(
      successFixture.roundDirectory,
      "generator-plan.json"
    );
    const patchRequestPath = join(previousRoundDirectory, "patch-request.json");
    const qualityCritiquePath = join(
      previousRoundDirectory,
      "quality-critique.json"
    );
    const evalReportPath = join(previousRoundDirectory, "eval_report.json");
    await writeJsonFile(roundContractPath, {
      objective: "Close the blocking target-signal gap without widening scope.",
      attempt_kind: "remediation",
      negotiation_mode: "patch_only",
      acceptance_checks: ["target_signal_thresholds_met", "api_release_gate_green"],
      carry_over_check_ids: ["target_signal_thresholds_met"],
      non_goals: ["Do not add unrelated dashboard features."]
    });
    await writeJsonFile(contractAgreementPath, {
      acceptance_checks: ["target_signal_thresholds_met", "api_release_gate_green"],
      release_gate_probe_ids: ["validator-app-finish-line-api"],
      required_live_verification_modes: ["api"],
      notes: ["Keep proof grounded in release-gate evidence."]
    });
    await writeJsonFile(generatorPlanPath, {
      implementation_intent:
        "Use tight remediation to close the release blocker and keep passing signals stable.",
      remediation_strategy: "tighten",
      target_check_ids: ["target_signal_thresholds_met"],
      quality_focus: ["Restore the failing API finish-line assertion."],
      must_preserve: ["Keep the passing release signals stable."],
      out_of_scope: ["Do not add unrelated dashboard work."]
    });
    await writeJsonFile(patchRequestPath, {
      next_action: "revise",
      remediation_strategy: "tighten",
      must_fix: [
        {
          id: "fix-target-signal",
          why: "Target signal is still below the configured threshold.",
          expected_change:
            "Close the explicit review blocker without widening scope.",
          target_check_ids: ["target_signal_thresholds_met"]
        }
      ],
      must_preserve: ["Keep the passing release signals stable."],
      forbidden_scope_expansion: ["Do not widen into unrelated dashboard work."]
    });
    await writeJsonFile(qualityCritiquePath, {
      remediation_strategy: "tighten",
      quality_focus: ["target_signal_thresholds_met"],
      preserve_signals: ["Keep the passing release signals stable."],
      findings: [
        {
          summary: "The patch-only round missed the target signal threshold.",
          expected_change:
            "Raise the release signal without reopening unrelated surface area.",
          category: "proof_signal",
          severity: "high",
          target_check_ids: ["target_signal_thresholds_met"]
        }
      ]
    });
    await writeJsonFile(evalReportPath, {
      release_score: 0.78,
      blockers: ["release signal still below target"],
      threshold_gap_details: ["target_signal_thresholds_met remains false"],
      unresolved_check_ids: ["target_signal_thresholds_met"]
    });
    await writeJsonFile(successFixture.inputPath, {
      round: 1,
      round_contract_path: roundContractPath,
      contract_agreement_path: contractAgreementPath,
      generator_plan_path: generatorPlanPath,
      patch_request_path: patchRequestPath
    });
    const successRun = await runApplyChange(
      successFixture,
      applyChangeEnv(successFixture, {
        HARNESS_CODEX_BIN: process.execPath,
        HARNESS_CODEX_BIN_ARGS: JSON.stringify([fakeCodexPath]),
        FAKE_CODEX_MODE: "success",
        FAKE_CODEX_RECORD_PATH: recordPath,
        FAKE_CODEX_RESPONSE: "{\"status\":\"ok\"}"
      })
    );
    assert(successRun.code === 0, "successful fake-codex run should exit zero");
    const successResult = await readJsonFile(successFixture.outputPath);
    const successMetadata = JSON.parse(
      await readFile(
        join(successFixture.roundDirectory, "artifacts", "generator-metadata.json"),
        "utf8"
      )
    );
    assert(successMetadata.response_written === true, "success response_written must be true");
    assertEvidencePathsExist(successFixture, successResult.evidence_paths);
    assert(
      successResult.evidence_paths.some((path) => path.endsWith("generator-response.json")),
      "successful run should include response artifact evidence"
    );
    assert(
      successResult.evidence_paths.some((path) => path.endsWith("generator-remediation-brief.json")),
      "successful run should include the remediation brief artifact"
    );
    assert(
      successResult.evidence_paths.some((path) => path.endsWith("generator-prompt.md")),
      "successful run should include the generator prompt artifact"
    );
    const successRecord = await readJsonFile(recordPath);
    const successInvocation = successRecord[0];
    assert(
      Array.isArray(successInvocation.argv) &&
        successInvocation.argv.filter((entry) => entry === "--add-dir").length >= 2,
      "apply_change should grant Codex access to remediation artifact directories"
    );
    assert(
      typeof successInvocation.stdin === "string" &&
        successInvocation.stdin.includes("Close the explicit review blocker without widening scope."),
      "generator prompt should inline patch request remediation instructions"
    );
    assert(
      successInvocation.stdin.includes("Keep the passing release signals stable."),
      "generator prompt should inline must-preserve guidance"
    );
    assert(
      successInvocation.stdin.includes("Do not widen into unrelated dashboard work."),
      "generator prompt should inline forbidden scope expansion guidance"
    );
    assert(
      successInvocation.stdin.includes("The patch-only round missed the target signal threshold."),
      "generator prompt should inline quality critique findings"
    );
    assert(
      successInvocation.stdin.includes("target_signal_thresholds_met remains false"),
      "generator prompt should inline eval threshold-gap details"
    );

    console.log("Validated bootstrap Codex evidence integrity.");
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
