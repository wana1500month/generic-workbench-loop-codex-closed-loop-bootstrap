import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const {
  execCommand,
  validateAdapterCapabilityResult
} = await import("../packages/loop-orchestrator/dist/adapter-runtime/shared.js");
const { validateTargetUrlPolicy } = await import(
  "../packages/loop-orchestrator/dist/target-url-policy.js"
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
