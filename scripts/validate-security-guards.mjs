import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const {
  execCommand,
  normalizeVerificationProfile,
  validateAdapterCapabilityResult
} = await import("../packages/loop-orchestrator/dist/adapter-runtime/shared.js");
const { executeCoreVerificationProbes } = await import(
  "../packages/loop-orchestrator/dist/core-verifier.js"
);
const { validateTargetUrlPolicy } = await import(
  "../packages/loop-orchestrator/dist/target-url-policy.js"
);
const { resolvedAdapterTargetRoot } = await import(
  "../packages/loop-orchestrator/dist/adapter-paths.js"
);

const workspace = join(repoRoot, ".tmp", `security-guards-${process.pid}`);
const runDirectory = join(workspace, "run");
const roundDirectory = join(runDirectory, "round-001");
const targetRoot = join(workspace, "target");
const adapterRoot = join(workspace, "adapter");
const outsideRoot = join(workspace, "outside");

await Promise.all([
  mkdir(roundDirectory, { recursive: true }),
  mkdir(targetRoot, { recursive: true }),
  mkdir(adapterRoot, { recursive: true }),
  mkdir(join(outsideRoot, ".codex"), { recursive: true })
]);

const validEvidencePath = join(roundDirectory, "valid-evidence.txt");
await writeFile(
  validEvidencePath,
  "This is sufficient text evidence for the security guard validation.\n",
  "utf8"
);
const secretPath = join(outsideRoot, ".codex", "auth.json");
await writeFile(secretPath, '{"token":"do-not-read"}\n', "utf8");
const outsideEvidencePath = join(outsideRoot, "public.txt");
await writeFile(
  outsideEvidencePath,
  "This text is outside the allowed evidence roots and must not resolve.\n",
  "utf8"
);

const validationBase = {
  providerId: "validator",
  providerRole: "verifier",
  baseDirectory: adapterRoot,
  cwd: adapterRoot,
  targetRoot,
  runDirectory,
  roundDirectory
};

const validEvidence = await validateAdapterCapabilityResult({
  ...validationBase,
  capability: "capture_evidence",
  rawResult: {
    capability: "capture_evidence",
    ok: true,
    summary: "valid evidence",
    findings: [],
    evidence_paths: ["valid-evidence.txt"],
    evidence_items: [
      {
        path: "valid-evidence.txt",
        kind: "text",
        description: "A valid round-local evidence file."
      }
    ]
  }
});

assert.equal(validEvidence.validation_errors.length, 0);
assert.equal(validEvidence.verified_evidence.length, 1);

const secretEvidence = await validateAdapterCapabilityResult({
  ...validationBase,
  capability: "capture_evidence",
  rawResult: {
    capability: "capture_evidence",
    ok: true,
    summary: "secret evidence must not resolve",
    findings: [],
    evidence_paths: [secretPath],
    evidence_items: [
      {
        path: secretPath,
        kind: "json",
        description: "A credential-looking path outside the evidence roots."
      }
    ]
  }
});

assert.equal(secretEvidence.verified_evidence.length, 0);
assert.ok(
  secretEvidence.validation_errors.some((entry) =>
    entry.includes("referenced missing evidence paths")
  )
);

const outsideEvidence = await validateAdapterCapabilityResult({
  ...validationBase,
  capability: "capture_evidence",
  rawResult: {
    capability: "capture_evidence",
    ok: true,
    summary: "outside evidence must not resolve",
    findings: [],
    evidence_paths: [outsideEvidencePath],
    evidence_items: [
      {
        path: outsideEvidencePath,
        kind: "text",
        description: "A non-secret path outside the evidence roots."
      }
    ]
  }
});

assert.equal(outsideEvidence.verified_evidence.length, 0);
assert.ok(
  outsideEvidence.validation_errors.some((entry) =>
    entry.includes("referenced missing evidence paths")
  )
);

const metadataUrl = "http://169.254.169.254/latest/meta-data/";
assert.equal(validateTargetUrlPolicy(metadataUrl).ok, false);
assert.equal(validateTargetUrlPolicy("http://127.0.0.1:3000/health").ok, true);

const manifestValidation = await validateAdapterCapabilityResult({
  ...validationBase,
  capability: "run_target",
  rawResult: {
    capability: "run_target",
    ok: true,
    summary: "metadata target must be rejected",
    findings: [],
    evidence_paths: [],
    target_manifest: {
      health_url: metadataUrl
    }
  }
});

assert.ok(
  manifestValidation.validation_errors.some((entry) =>
    entry.includes("disallowed target_manifest.health_url")
  )
);

const previousExternalTargetRoot = process.env.HARNESS_ALLOW_EXTERNAL_TARGET_ROOT;
const externalAdapterRoot = await mkdtemp(join(tmpdir(), "harness-external-target-"));
const externalLoadedAdapter = {
  base_directory: externalAdapterRoot,
  contract_path: join(externalAdapterRoot, "adapter.json"),
  contract: {
    adapter_id: "external-target-root-guard",
    label: "External Target Root Guard",
    contract_version: "1",
    target_root: ".",
    capabilities: {}
  }
};
delete process.env.HARNESS_ALLOW_EXTERNAL_TARGET_ROOT;
assert.throws(
  () => resolvedAdapterTargetRoot(externalLoadedAdapter),
  /External adapter target_root is blocked by default/
);
process.env.HARNESS_ALLOW_EXTERNAL_TARGET_ROOT = "1";
assert.equal(resolvedAdapterTargetRoot(externalLoadedAdapter), externalAdapterRoot);
if (previousExternalTargetRoot === undefined) {
  delete process.env.HARNESS_ALLOW_EXTERNAL_TARGET_ROOT;
} else {
  process.env.HARNESS_ALLOW_EXTERNAL_TARGET_ROOT = previousExternalTargetRoot;
}

const shellMarkerPath = join(workspace, "shell-redirection-marker.txt");
const directNoShell = await execCommand({
  command: `node -e "process.stdout.write('ok')" > "${shellMarkerPath}"`,
  cwd: repoRoot,
  timeoutMs: 5000,
  env: process.env
});
assert.equal(directNoShell.stdout, "ok");
await assert.rejects(access(shellMarkerPath));

const explicitShell = await execCommand({
  command: `node -e "process.stdout.write('shell-ok')" > "${shellMarkerPath}"`,
  cwd: repoRoot,
  timeoutMs: 5000,
  env: process.env,
  shell: process.platform === "win32" ? "cmd" : "sh"
});
assert.equal(explicitShell.code, 0);
assert.equal((await readFile(shellMarkerPath, "utf8")).trim(), "shell-ok");

const coreShellMarkerPath = join(workspace, "core-shell-redirection-marker.txt");
const coreProbeProfile = normalizeVerificationProfile(
  {
    profile_id: "core-probe-direct-spawn-guard",
    label: "Core Probe Direct Spawn Guard",
    criteria: [],
    target_reached_requires_core_probes: false,
    core_probes: [
      {
        probe_id: "core-direct-args",
        label: "Core direct args",
        mode: "shell_command",
        role: "supporting",
        target: process.execPath,
        args: [
          "-e",
          "process.stdout.write('core-ok')",
          ">",
          coreShellMarkerPath
        ],
        expected_value: "core-ok",
        timeout_ms: 5000
      }
    ]
  },
  "core-probe-direct-spawn-guard.profile.json"
);
const coreProbeExecutions = await executeCoreVerificationProbes({
  loadedAdapter: {
    base_directory: adapterRoot,
    contract_path: join(adapterRoot, "adapter.json"),
    contract: {
      adapter_id: "core-probe-direct-spawn-guard",
      label: "Core Probe Direct Spawn Guard",
      contract_version: "1",
      target_root: ".",
      capabilities: {}
    },
    verification_profile: {
      profile_path: "core-probe-direct-spawn-guard.profile.json",
      profile: coreProbeProfile
    }
  },
  runDirectory,
  roundDirectory
});
assert.equal(coreProbeExecutions.length, 1);
assert.equal(coreProbeExecutions[0].ok, true);
await assert.rejects(access(coreShellMarkerPath));

const previousOutputCap = process.env.HARNESS_COMMAND_OUTPUT_MAX_BYTES;
process.env.HARNESS_COMMAND_OUTPUT_MAX_BYTES = "16";
const capped = await execCommand({
  command: process.execPath,
  args: ["-e", "process.stdout.write('x'.repeat(1024))"],
  cwd: repoRoot,
  timeoutMs: 5000,
  env: process.env
});
if (previousOutputCap === undefined) {
  delete process.env.HARNESS_COMMAND_OUTPUT_MAX_BYTES;
} else {
  process.env.HARNESS_COMMAND_OUTPUT_MAX_BYTES = previousOutputCap;
}

assert.equal(capped.outputLimitExceeded, true);
assert.equal(capped.outputLimitBytes, 16);

console.log("security guards validation passed");
