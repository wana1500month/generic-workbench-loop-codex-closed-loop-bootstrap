import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { join } from "node:path";

import {
  cleanupTempRoot,
  createBootstrapFixture,
  createTempRoot,
  ensureBuild,
  readJsonFile,
  repoRoot
} from "./testing/bootstrap-validator-helpers.mjs";
import {
  extractRunDirectory,
  readSummary,
  runLoop
} from "./validation-utils.mjs";

const listen = async (server) =>
  new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectPromise);
      resolvePromise(server.address());
    });
  });

const closeServer = async (server) =>
  new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => {
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise();
    });
  });

console.log("[validate-adapter-migration-generated-runtime] bootstrap generated adapter drift");
await ensureBuild();

const tempRoot = await createTempRoot("validate-adapter-migration-generated-runtime");
let server;

try {
  server = createServer((request, response) => {
    if (request.url?.startsWith("/healthz")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ready" }));
      return;
    }

    if (request.url?.startsWith("/api/")) {
      const normalizedPath = request.url.replace(/\?.*$/, "");
      const isErrorPath =
        normalizedPath.includes("error") || normalizedPath.includes("invalid");
      response.writeHead(isErrorPath ? 400 : 200, {
        "content-type": "application/json"
      });
      response.end(
        JSON.stringify({
          status: "ready",
          error: isErrorPath ? "handled" : undefined
        })
      );
      return;
    }

    response.writeHead(200, { "content-type": "text/html" });
    response.end("<div data-testid='app-shell'>generated-runtime-drift</div>");
  });
  const address = await listen(server);
  if (!address || typeof address === "string") {
    throw new Error("Generated runtime migration validator did not receive a TCP port.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const fixture = await createBootstrapFixture(tempRoot, {
    title: "Generated Runtime Drift",
    summary: "Validate generated-local runtime-surface adapter migration.",
    targetFamily: "api-service",
    readyUrl: `${baseUrl}/api/`,
    appUrl: undefined,
    healthUrl: undefined,
    apiBaseUrl: undefined,
    checkCommand: "",
    qualityBar: ["The generated adapter should keep publishing the API base surface."]
  });
  const execution = await runLoop(
    [
      "--adapter",
      fixture.paths.adapterPath,
      "--rubric",
      fixture.paths.generatedRubricPath,
      "--evaluator-profile",
      fixture.paths.generatedVerificationProfilePath,
      "--max-rounds",
      "2"
    ],
    {
      silent: true,
      env: {
        PATH: `${process.env.PATH ?? ""}`,
        HARNESS_CODEX_BIN: process.execPath,
        HARNESS_CODEX_BIN_ARGS: JSON.stringify([
          join(repoRoot, "scripts", "testing", "fake-codex.mjs")
        ])
      }
    }
  );
  if (execution.code !== 0) {
    throw new Error(
      `Generated runtime migration fixture failed.\nSTDOUT:\n${execution.stdout}\nSTDERR:\n${execution.stderr}`
    );
  }

  const runDirectory = extractRunDirectory(execution.stdout);
  const summary = await readSummary(runDirectory);
  const roundOne = summary.round_history?.[0];
  const roundTwo = summary.round_history?.[1];
  assert.equal(
    typeof roundOne?.adapter_drift_report_path,
    "string",
    "Round one should persist adapter drift evidence."
  );
  assert.equal(
    typeof roundTwo?.adapter_migration_proposal_path,
    "string",
    "Recontract round should persist adapter-migration-proposal.json."
  );
  assert.equal(
    typeof roundTwo?.adapter_migration_applied_path,
    "string",
    "Recontract round should persist adapter-migration-applied.json."
  );
  assert.equal(
    summary.adapter_migration_applied_path,
    roundTwo.adapter_migration_applied_path,
    "Run summary should surface the latest applied adapter migration artifact."
  );
  assert.equal(
    typeof summary.resume_migration_path,
    "string",
    "Adapter migration autoapply should write resume-migration.json."
  );

  const [
    roundOneDriftReport,
    roundOnePatchRequest,
    roundTwoContract,
    proposal,
    applied,
    resumeMigration,
    runtimeConfig,
    adapterContract
  ] = await Promise.all([
    readJsonFile(roundOne.adapter_drift_report_path),
    readJsonFile(roundOne.patch_request_path),
    readJsonFile(roundTwo.contract_path),
    readJsonFile(roundTwo.adapter_migration_proposal_path),
    readJsonFile(roundTwo.adapter_migration_applied_path),
    readJsonFile(summary.resume_migration_path),
    readJsonFile(fixture.paths.generatedRuntimeConfigPath),
    readJsonFile(fixture.paths.adapterPath)
  ]);

  assert.equal(roundOneDriftReport.kind, "runtime");
  assert(
    roundOneDriftReport.missing_target_manifest_keys.includes("api_base_url"),
    "Round one drift should identify the missing api_base_url surface."
  );
  assert.equal(roundOnePatchRequest.next_action, "recontract_adapter");

  assert.equal(proposal.adapter_origin, "generated_local");
  assert.equal(proposal.migration_class, "runtime_surface_patch");
  assert.equal(proposal.apply_mode, "same_run_in_place");
  assert.equal(proposal.same_run_eligible, true);
  assert.equal(proposal.autoapply_eligible, true);
  assert.equal(proposal.requires_operator_acceptance, false);
  assert.equal(
    proposal.proposed_runtime_config_patch?.api_base_url,
    `${baseUrl}/api/`,
    "Proposal should repair api_base_url from ready_url for generated-local runtime drift."
  );

  assert.equal(applied.proposal_id, proposal.proposal_id);
  assert.equal(applied.apply_mode, "same_run_in_place");
  assert.equal(applied.same_run_authorized, true);
  assert.equal(roundTwoContract.recontract_mode, true);
  assert.deepEqual(roundTwoContract.adapter_only_paths, [
    "adapter.generated.json",
    ".generated/codex-adapter/runtime-config.json",
    ".generated/codex-adapter/scripts"
  ]);
  for (const changedFile of applied.changed_files) {
    const normalizedChangedFile = String(changedFile).replace(/\\/g, "/");
    assert(
      normalizedChangedFile.endsWith("adapter.generated.json") ||
        normalizedChangedFile.endsWith(
          ".generated/codex-adapter/runtime-config.json"
        ),
      `Changed file '${changedFile}' should stay inside the adapter-only recontract scope.`
    );
  }
  assert.notEqual(
    applied.old_identity.adapter_contract_sha256,
    applied.new_identity.adapter_contract_sha256,
    "Applying the generated adapter migration should change the adapter contract fingerprint."
  );
  assert.equal(
    applied.new_identity.adapter_contract_sha256,
    summary.adapter_contract_sha256,
    "Run summary should surface the migrated adapter fingerprint."
  );

  assert.equal(runtimeConfig.api_base_url, `${baseUrl}/api/`);
  assert(
    Array.isArray(adapterContract.notes) &&
      adapterContract.notes.some((note) =>
        String(note).includes(`Applied runtime-surface migration ${proposal.proposal_id}`)
      ),
    "Generated adapter contract should record the applied migration note."
  );
  assert.equal(resumeMigration.authorized_adapter_migration, true);
  assert.equal(
    resumeMigration.adapter_migration_proposal_path,
    roundTwo.adapter_migration_proposal_path
  );
  assert.equal(
    resumeMigration.new_identity.adapter_contract_sha256,
    summary.adapter_contract_sha256
  );
  assert(
    (summary.runtime_events ?? []).some((event) => event.code === "adapter.migration_applied"),
    "Run summary should record adapter.migration_applied."
  );

  console.log("[validate-adapter-migration-generated-runtime] complete");
} finally {
  if (server) {
    await closeServer(server);
  }
  await cleanupTempRoot(tempRoot);
}
