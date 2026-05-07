import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const supportedTemplates = [
  "canonical-api",
  "canonical-api-patch-only",
  "canonical-api-recontract",
  "canonical-crud",
  "canonical-crud-patch-only",
  "canonical-crud-recontract",
  "canonical-chat",
  "canonical-chat-patch-only",
  "canonical-chat-recontract",
  "placeholder"
];

const canonicalApiExecutorSource = `import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";

const capability = process.argv[2] ?? process.env.HARNESS_CAPABILITY;
const inputPath = process.env.HARNESS_INPUT_PATH;
const outputPath = process.env.HARNESS_OUTPUT_PATH;
const targetRoot = resolve(process.env.HARNESS_TARGET_ROOT ?? process.cwd());
const packet = JSON.parse(await readFile(inputPath, "utf8"));
const stateDir = join(targetRoot, ".reference-state");
const manifestPath = join(stateDir, "target-manifest.json");
const runLogPath = join(stateDir, \`\${capability}.log\`);

const waitForFile = async (path, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
  }
  throw new Error(\`Timed out waiting for file: \${path}\`);
};

const writeResult = async (result) => {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, \`\${JSON.stringify(result, null, 2)}\\n\`, "utf8");
};

await mkdir(stateDir, { recursive: true });

switch (capability) {
  case "prepare_target": {
    await writeFile(
      join(stateDir, "items.json"),
      JSON.stringify(
        [
          {
            id: "smoke-item-1",
            title: "Smoke Item",
            status: "persisted"
          }
        ],
        null,
        2
      ),
      "utf8"
    );
    await writeFile(
      runLogPath,
      [
        "prepare_target",
        \`run_directory=\${packet.run_directory}\`,
        \`round_directory=\${packet.round_directory}\`,
        "seeded canonical API reference state"
      ].join("\\n"),
      "utf8"
    );
    await writeResult({
      capability,
      ok: true,
      summary: "Prepared the canonical API companion target state.",
      findings: [],
      evidence_paths: [runLogPath]
    });
    break;
  }
  case "apply_change": {
    await writeFile(
      runLogPath,
      [
        "apply_change",
        \`round=\${packet.round}\`,
        "No-op apply step for the canonical API companion target."
      ].join("\\n"),
      "utf8"
    );
    await writeResult({
      capability,
      ok: true,
      summary: "Applied the canonical no-op change step.",
      findings: [],
      evidence_paths: [runLogPath]
    });
    break;
  }
  case "run_target": {
    await rm(manifestPath, { force: true });
    const serverPath = join(targetRoot, "target-server.mjs");
    const child = spawn(process.execPath, [serverPath, stateDir, manifestPath], {
      cwd: targetRoot,
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
    const targetManifest = await waitForFile(manifestPath, 5000);
    await writeFile(
      runLogPath,
      [
        "run_target",
        \`health_url=\${targetManifest.health_url}\`,
        \`api_base_url=\${targetManifest.api_base_url}\`,
        "started canonical API companion target"
      ].join("\\n"),
      "utf8"
    );
    await writeResult({
      capability,
      ok: true,
      summary: "Started the canonical API companion target.",
      findings: [],
      evidence_paths: [runLogPath],
      target_manifest: targetManifest
    });
    break;
  }
  default:
    throw new Error(\`Unsupported executor capability: \${capability}\`);
}
`;

const canonicalApiServerSource = `import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname } from "node:path";

const stateDir = process.argv[2];
const manifestPath = process.argv[3];

if (!stateDir || !manifestPath) {
  console.error("Usage: node ./target-server.mjs <state-dir> <manifest-path>");
  process.exit(1);
}

const latestItem = {
  id: "smoke-item-1",
  title: "Smoke Item",
  status: "persisted"
};

let shutdownTimer;
const inactivityWindowMs = 30000;
const refreshShutdown = () => {
  clearTimeout(shutdownTimer);
  shutdownTimer = setTimeout(() => {
    server.close(() => process.exit(0));
  }, inactivityWindowMs);
};

const server = createServer((req, res) => {
  refreshShutdown();

  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "ready" }));
    return;
  }

  if (req.url === "/api/items/latest") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(latestItem));
    return;
  }

  if (req.url === "/api/items/invalid") {
    res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "invalid_title", status: "rejected" }));
    return;
  }

  if (req.url === "/api/items/summary") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "consistent" }));
    return;
  }

  if (req.url === "/api/items/idempotent") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "idempotent" }));
    return;
  }

  if (req.url === "/api/items/stale") {
    res.writeHead(409, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "stale_write", status: "stale_rejected" }));
    return;
  }

  if (req.url === "/api/items/pagination") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "stable" }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(0, "127.0.0.1", async () => {
  refreshShutdown();
  const address = server.address();
  if (!address || typeof address === "string") {
    console.error("Failed to resolve canonical reference adapter server address.");
    process.exit(1);
  }

  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        health_url: \`http://127.0.0.1:\${address.port}/healthz\`,
        api_base_url: \`http://127.0.0.1:\${address.port}/api/\`
      },
      null,
      2
    ),
    "utf8"
  );
});
`;

const canonicalApiVerifierSource = `import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const capability = process.argv[2] ?? process.env.HARNESS_CAPABILITY;
const inputPath = process.env.HARNESS_INPUT_PATH;
const outputPath = process.env.HARNESS_OUTPUT_PATH;
const packet = JSON.parse(await readFile(inputPath, "utf8"));
const proofDir = join(packet.round_directory, "reference-adapter-proof");
const targetRoot = resolve(process.env.HARNESS_TARGET_ROOT ?? process.cwd());
const stateDir = join(targetRoot, ".reference-state");
const manifestPath = join(stateDir, "target-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
await mkdir(proofDir, { recursive: true });

const readJson = async (url) => {
  const response = await fetch(url);
  const text = await response.text();
  return {
    status: response.status,
    body: JSON.parse(text)
  };
};

const writeJson = async (path, value) => {
  await writeFile(path, \`\${JSON.stringify(value, null, 2)}\\n\`, "utf8");
};

const writeResult = async (result) => {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, \`\${JSON.stringify(result, null, 2)}\\n\`, "utf8");
};

const capturePath = join(proofDir, "capture_evidence.json");
const captureLogPath = join(proofDir, "capture_evidence-live.log");
const captureWitnessPath = join(proofDir, "capture_evidence-witness.json");
const checksPath = join(proofDir, "run_checks.json");
const checksLogPath = join(proofDir, "run_checks-live.log");
const checksWitnessPath = join(proofDir, "run_checks-witness.json");
const gradePath = join(proofDir, "grade_round.json");
const gradeLogPath = join(proofDir, "grade_round-live.log");
const gradeWitnessPath = join(proofDir, "grade_round-witness.json");
const roundBehaviorPath = join(targetRoot, "round-behavior.json");
const roundBehavior = JSON.parse(
  await readFile(roundBehaviorPath, "utf8").catch(() =>
    JSON.stringify({ failing_rounds: [], failing_criteria: [] })
  )
);
const activeRoundFailures = new Set(
  (roundBehavior.failing_rounds ?? []).includes(packet.round)
    ? roundBehavior.failing_criteria ?? []
    : []
);
const configuredGradeScore =
  typeof roundBehavior.grade_score === "number" && Number.isFinite(roundBehavior.grade_score)
    ? Math.max(0, Math.min(1, roundBehavior.grade_score))
    : undefined;
const criterionStatus = (criterionId, condition) =>
  activeRoundFailures.has(criterionId) ? "fail" : condition ? "pass" : "fail";
const criterionObservedValue = (
  criterionId,
  condition,
  passValue,
  failValue = "missing"
) =>
  activeRoundFailures.has(criterionId) ? failValue : condition ? passValue : failValue;
const gradeScore = configuredGradeScore ?? (activeRoundFailures.size > 0 ? 0.1 : 0.98);
const gradeOverallVerdict = activeRoundFailures.size > 0 ? "revise" : "advance";
const gradeThresholdVerdict = activeRoundFailures.size > 0 ? "fail" : "pass";
const gradeBlockingCriterionIds = Array.from(activeRoundFailures);

const writeWitness = async (path, payload) => {
  await writeJson(path, {
    witness_id: \`\${process.env.HARNESS_PROVIDER_ID}-\${capability}-round-\${packet.round}\`,
    provider_id: process.env.HARNESS_PROVIDER_ID,
    provider_role: process.env.HARNESS_PROVIDER_ROLE,
    capability,
    mode: "api",
    target_root: targetRoot,
    target_reference: "canonical-api-companion",
    ...payload
  });
};

if (capability === "capture_evidence") {
  const health = await readJson(manifest.health_url);
  await writeJson(capturePath, {
    capability,
    round: packet.round,
    health
  });
  await writeFile(
    captureLogPath,
    [
      \`provider=\${process.env.HARNESS_PROVIDER_ID}\`,
      "action=fetch /healthz",
      \`status=\${health.status}\`,
      \`body=\${JSON.stringify(health.body)}\`
    ].join("\\n"),
    "utf8"
  );
  await writeWitness(captureWitnessPath, {
    interaction_log_path: captureLogPath,
    assertion_ids: ["item_persists"],
    steps: [
      {
        action: "fetch health endpoint",
        outcome: "pass",
        artifact_paths: [captureLogPath, capturePath]
      },
      {
        action: "confirm canonical API companion is ready for downstream checks",
        outcome: "pass",
        artifact_paths: [capturePath]
      }
    ]
  });
  await writeResult({
    capability,
    ok: true,
    summary: "Captured live health evidence from the canonical API companion target.",
    findings: [],
    evidence_paths: [capturePath, captureLogPath, captureWitnessPath],
    evidence_items: [
      {
        path: capturePath,
        kind: "json",
        description: "Captured health response for the canonical API companion target."
      },
      {
        path: captureLogPath,
        kind: "interaction-log",
        description: "Live verifier log for the canonical API companion target.",
        supports_check_ids: ["live_verification_present"],
        supports_criterion_ids: ["item_persists"]
      },
      {
        path: captureWitnessPath,
        kind: "verification-witness",
        description: "Structured witness for the canonical API companion target.",
        supports_check_ids: ["live_verification_present"],
        supports_criterion_ids: ["item_persists"]
      }
    ]
  });
} else if (capability === "run_checks") {
  const [latestItem, invalidItem, summary, idempotentWrite, staleWrite, pagination] = await Promise.all([
    readJson(new URL("items/latest", manifest.api_base_url).toString()),
    readJson(new URL("items/invalid", manifest.api_base_url).toString()),
    readJson(new URL("items/summary", manifest.api_base_url).toString()),
    readJson(new URL("items/idempotent", manifest.api_base_url).toString()),
    readJson(new URL("items/stale", manifest.api_base_url).toString()),
    readJson(new URL("items/pagination", manifest.api_base_url).toString())
  ]);
  await writeJson(checksPath, {
    capability,
    round: packet.round,
    latestItem,
    invalidItem,
    summary,
    idempotentWrite,
    staleWrite,
    pagination
  });
  await writeFile(
    checksLogPath,
    [
      \`provider=\${process.env.HARNESS_PROVIDER_ID}\`,
      "action=fetch /api/items/latest",
      "action=fetch /api/items/invalid",
      "action=fetch /api/items/summary",
      "action=fetch /api/items/idempotent",
      "action=fetch /api/items/stale",
      "action=fetch /api/items/pagination",
      \`latest_status=\${latestItem.status}\`,
      \`invalid_status=\${invalidItem.status}\`,
      \`summary_status=\${summary.status}\`,
      \`idempotent_status=\${idempotentWrite.status}\`,
      \`stale_status=\${staleWrite.status}\`,
      \`pagination_status=\${pagination.status}\`
    ].join("\\n"),
    "utf8"
  );
  await writeWitness(checksWitnessPath, {
    interaction_log_path: checksLogPath,
    assertion_ids: [
      "item_persists",
      "invalid_item_rejected",
      "collection_consistent",
      "idempotent_write_safe",
      "stale_write_rejected",
      "pagination_consistent"
    ],
    steps: [
      {
        action: "fetch canonical API workflow endpoints",
        outcome: "pass",
        artifact_paths: [checksLogPath, checksPath]
      },
      {
        action: "confirm persistence, rejection, consistency, idempotency, stale-write protection, and pagination expectations",
        outcome: "pass",
        artifact_paths: [checksLogPath, checksPath]
      }
    ]
  });
  await writeResult({
    capability,
    ok: true,
    summary: "Verified canonical API persistence, invalid-path rejection, collection consistency, idempotent writes, stale-write protection, and pagination stability.",
    findings: [],
    evidence_paths: [
      checksPath,
      checksLogPath,
      checksWitnessPath,
      capturePath,
      captureLogPath,
      captureWitnessPath
    ],
    evidence_items: [
      {
        path: checksPath,
        kind: "json",
        description: "Structured run_checks output for the canonical API companion target.",
        supports_check_ids: ["adapter_execution_healthy", "adapter_evidence_is_meaningful"],
        supports_criterion_ids: [
          "item_persists",
          "invalid_item_rejected",
          "collection_consistent",
          "idempotent_write_safe",
          "stale_write_rejected",
          "pagination_consistent"
        ]
      },
      {
        path: checksLogPath,
        kind: "interaction-log",
        description: "Live verifier log for canonical API checks.",
        supports_check_ids: ["live_verification_present"],
        supports_criterion_ids: [
          "item_persists",
          "invalid_item_rejected",
          "collection_consistent",
          "idempotent_write_safe",
          "stale_write_rejected",
          "pagination_consistent"
        ]
      },
      {
        path: checksWitnessPath,
        kind: "verification-witness",
        description: "Structured witness for canonical API checks.",
        supports_check_ids: ["live_verification_present"],
        supports_criterion_ids: [
          "item_persists",
          "invalid_item_rejected",
          "collection_consistent",
          "idempotent_write_safe",
          "stale_write_rejected",
          "pagination_consistent"
        ]
      },
      {
        path: capturePath,
        kind: "json",
        description: "Upstream capture evidence reused by run_checks."
      },
      {
        path: captureLogPath,
        kind: "interaction-log",
        description: "Upstream live verifier log reused by run_checks.",
        supports_check_ids: ["live_verification_present"],
        supports_criterion_ids: ["item_persists"]
      },
      {
        path: captureWitnessPath,
        kind: "verification-witness",
        description: "Upstream structured witness reused by run_checks.",
        supports_check_ids: ["live_verification_present"],
        supports_criterion_ids: ["item_persists"]
      }
    ],
    criteria_results: [
      {
        criterion_id: "item_persists",
        assertion_id: "item_persists",
        status: criterionStatus("item_persists", latestItem.body.title === "Smoke Item"),
        summary: "The canonical API still returns the persisted smoke item.",
        hard: true,
        threshold: "Latest item must remain persisted through the API.",
        observed_value: criterionObservedValue(
          "item_persists",
          latestItem.body.title === "Smoke Item",
          "persisted"
        ),
        evidence_paths: [checksPath, checksLogPath]
      },
      {
        criterion_id: "invalid_item_rejected",
        assertion_id: "invalid_item_rejected",
        status: criterionStatus(
          "invalid_item_rejected",
          invalidItem.status === 400 && invalidItem.body.error === "invalid_title"
        ),
        summary: "The invalid API path returns the expected structured rejection.",
        hard: true,
        threshold: "Invalid item path must be rejected explicitly.",
        observed_value: criterionObservedValue(
          "invalid_item_rejected",
          invalidItem.status === 400 && invalidItem.body.error === "invalid_title",
          "rejected"
        ),
        evidence_paths: [checksPath, checksLogPath]
      },
      {
        criterion_id: "collection_consistent",
        assertion_id: "collection_consistent",
        status: criterionStatus(
          "collection_consistent",
          summary.body.status === "consistent"
        ),
        summary: "The canonical API summary remains internally consistent.",
        hard: true,
        threshold: "Collection summary must remain internally consistent.",
        observed_value: criterionObservedValue(
          "collection_consistent",
          summary.body.status === "consistent",
          "consistent"
        ),
        evidence_paths: [checksPath, checksLogPath]
      },
      {
        criterion_id: "idempotent_write_safe",
        assertion_id: "idempotent_write_safe",
        status: criterionStatus(
          "idempotent_write_safe",
          idempotentWrite.body.status === "idempotent"
        ),
        summary: "The repeated write path remains idempotent through the canonical API.",
        hard: true,
        threshold: "Repeated writes must remain idempotent.",
        observed_value: criterionObservedValue(
          "idempotent_write_safe",
          idempotentWrite.body.status === "idempotent",
          "idempotent"
        ),
        evidence_paths: [checksPath, checksLogPath]
      },
      {
        criterion_id: "stale_write_rejected",
        assertion_id: "stale_write_rejected",
        status: criterionStatus(
          "stale_write_rejected",
          staleWrite.status === 409 && staleWrite.body.status === "stale_rejected"
        ),
        summary: "Stale-write attempts are rejected explicitly through the canonical API.",
        hard: true,
        threshold: "Stale writes must be rejected instead of silently overwriting newer state.",
        observed_value: criterionObservedValue(
          "stale_write_rejected",
          staleWrite.status === 409 && staleWrite.body.status === "stale_rejected",
          "stale_rejected"
        ),
        evidence_paths: [checksPath, checksLogPath]
      },
      {
        criterion_id: "pagination_consistent",
        assertion_id: "pagination_consistent",
        status: criterionStatus(
          "pagination_consistent",
          pagination.body.status === "stable"
        ),
        summary: "Paginated API reads stay stable across repeated requests.",
        hard: true,
        threshold: "Pagination results must remain stable across repeated reads.",
        observed_value: criterionObservedValue(
          "pagination_consistent",
          pagination.body.status === "stable",
          "stable"
        ),
        evidence_paths: [checksPath, checksLogPath]
      }
    ]
  });
} else if (capability === "grade_round") {
  const [latestItem] = await Promise.all([
    readJson(new URL("items/latest", manifest.api_base_url).toString())
  ]);
  await writeJson(gradePath, {
    capability,
    round: packet.round,
    score: gradeScore,
    latestItem
  });
  await writeFile(
    gradeLogPath,
    [
      \`provider=\${process.env.HARNESS_PROVIDER_ID}\`,
      "action=grade canonical API round",
      \`latest_item_title=\${latestItem.body.title}\`,
      \`verdict=\${gradeOverallVerdict}\`
    ].join("\\n"),
    "utf8"
  );
  await writeWitness(gradeWitnessPath, {
    interaction_log_path: gradeLogPath,
    assertion_ids: ["item_persists", "invalid_item_rejected", "collection_consistent"],
    steps: [
      {
        action: "grade canonical API round from run_checks evidence",
        outcome: "pass",
        artifact_paths: [gradeLogPath, gradePath, checksPath]
      },
      {
        action: "confirm grade output stays grounded in captured verifier artifacts",
        outcome: "pass",
        artifact_paths: [gradePath, checksPath, capturePath]
      }
    ]
  });
  await writeResult({
    capability,
    ok: true,
    summary: \`Graded the canonical API companion round with verdict '\${gradeOverallVerdict}'.\`,
    findings: [],
    evidence_paths: [
      gradePath,
      gradeLogPath,
      gradeWitnessPath,
      checksPath,
      checksLogPath,
      checksWitnessPath,
      capturePath,
      captureLogPath,
      captureWitnessPath
    ],
    evidence_items: [
      {
        path: gradePath,
        kind: "report",
        description: "Grade summary for the canonical API companion round.",
        derived_from_capabilities: ["run_checks", "capture_evidence"],
        derived_from_evidence_paths: [
          checksPath,
          checksLogPath,
          checksWitnessPath,
          capturePath,
          captureLogPath,
          captureWitnessPath
        ]
      },
      {
        path: gradeLogPath,
        kind: "interaction-log",
        description: "Live verifier log for the canonical API grade step.",
        supports_check_ids: ["live_verification_present"],
        supports_criterion_ids: ["item_persists"]
      },
      {
        path: gradeWitnessPath,
        kind: "verification-witness",
        description: "Structured witness for the canonical API grade step.",
        supports_check_ids: ["live_verification_present"],
        supports_criterion_ids: ["item_persists"]
      },
      {
        path: checksPath,
        kind: "json",
        description: "Upstream run_checks evidence referenced by grade_round."
      },
      {
        path: checksLogPath,
        kind: "interaction-log",
        description: "Upstream run_checks verifier log referenced by grade_round.",
        supports_check_ids: ["live_verification_present"],
        supports_criterion_ids: [
          "item_persists",
          "invalid_item_rejected",
          "collection_consistent",
          "idempotent_write_safe",
          "stale_write_rejected",
          "pagination_consistent"
        ]
      },
      {
        path: checksWitnessPath,
        kind: "verification-witness",
        description: "Upstream run_checks structured witness referenced by grade_round.",
        supports_check_ids: ["live_verification_present"],
        supports_criterion_ids: [
          "item_persists",
          "invalid_item_rejected",
          "collection_consistent",
          "idempotent_write_safe",
          "stale_write_rejected",
          "pagination_consistent"
        ]
      },
      {
        path: capturePath,
        kind: "json",
        description: "Upstream capture_evidence output referenced by grade_round."
      },
      {
        path: captureLogPath,
        kind: "interaction-log",
        description: "Upstream capture_evidence verifier log referenced by grade_round.",
        supports_check_ids: ["live_verification_present"],
        supports_criterion_ids: ["item_persists"]
      },
      {
        path: captureWitnessPath,
        kind: "verification-witness",
        description: "Upstream capture_evidence structured witness referenced by grade_round.",
        supports_check_ids: ["live_verification_present"],
        supports_criterion_ids: ["item_persists"]
      }
    ],
    criteria_results: [
      {
        criterion_id: "item_persists",
        assertion_id: "item_persists",
        status: criterionStatus("item_persists", latestItem.body.title === "Smoke Item"),
        summary: "grade_round confirms the persisted item assertion stayed green.",
        hard: true,
        threshold: "The persisted item assertion must remain green before release.",
        observed_value: criterionObservedValue(
          "item_persists",
          latestItem.body.title === "Smoke Item",
          "persisted"
        ),
        evidence_paths: [checksPath, checksLogPath]
      }
    ],
    score: gradeScore,
    overall_verdict: gradeOverallVerdict,
    threshold_verdict: gradeThresholdVerdict,
    blocking_criterion_ids: gradeBlockingCriterionIds
  });
} else {
  throw new Error(\`Unsupported verifier capability: \${capability}\`);
}
`;

const canonicalApiReadme = [
  "# Canonical API Companion Adapter",
  "",
  "This scaffold is a boringly reproducible external companion adapter for the harness core.",
  "It spins up a tiny API target outside the harness repository, then drives prepare/apply/run/capture/check/grade through the adapter contract boundary.",
  "",
  "## Use",
  "",
  "1. Export `REFERENCE_ADAPTER_CONTRACT` to this directory's `adapter.json`.",
  "2. Export `REFERENCE_TARGET_FAMILY=api-service`.",
  "3. Run `npm run validate:reference-adapter:check` from the harness repo.",
  "4. Run `npm run validate:reference-adapter` for the strict validator.",
  "5. Optionally run `npm run smoke:reference-adapter` for a wiring-only smoke."
].join("\n");

const replaceInTemplateFile = (source, replacements) =>
  replacements.reduce(
    (current, [searchValue, replaceValue]) => current.replaceAll(searchValue, replaceValue),
    source
  );

const withVariantNotes = (readme, notes) => `${readme}\n\n## Variant\n\n${notes.join("\n")}`;
const roundBehaviorFile = (failingRounds, failingCriteria) => ({
  failing_rounds: failingRounds,
  failing_criteria: failingCriteria
});
const emptyRoundBehavior = roundBehaviorFile([], []);
const patchOnlyRoundBehavior = (criterionId) => roundBehaviorFile([1], [criterionId]);
const recontractRoundBehavior = (criterionId) =>
  roundBehaviorFile([1, 2], [criterionId]);

const canonicalCrudReadme = [
  "# Canonical CRUD Companion Adapter",
  "",
  "This scaffold is a boringly reproducible external companion adapter for the harness core.",
  "It spins up a tiny CRUD API target outside the harness repository, then drives prepare/apply/run/capture/check/grade through the adapter contract boundary.",
  "",
  "## Use",
  "",
  "1. Export `REFERENCE_ADAPTER_CONTRACT` to this directory's `adapter.json`.",
  "2. Export `REFERENCE_TARGET_FAMILY=crud-api`.",
  "3. Run `npm run validate:reference-adapter:check` from the harness repo.",
  "4. Run `npm run validate:reference-adapter` for the strict validator.",
  "5. Optionally run `npm run smoke:reference-adapter` for a wiring-only smoke."
].join("\n");

const canonicalChatExecutorSource = `import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";

const capability = process.argv[2] ?? process.env.HARNESS_CAPABILITY;
const inputPath = process.env.HARNESS_INPUT_PATH;
const outputPath = process.env.HARNESS_OUTPUT_PATH;
const targetRoot = resolve(process.env.HARNESS_TARGET_ROOT ?? process.cwd());
const packet = JSON.parse(await readFile(inputPath, "utf8"));
const stateDir = join(targetRoot, ".reference-state");
const manifestPath = join(stateDir, "target-manifest.json");
const runLogPath = join(stateDir, \`\${capability}.log\`);

const waitForFile = async (path, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
  }
  throw new Error(\`Timed out waiting for file: \${path}\`);
};

const writeResult = async (result) => {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, \`\${JSON.stringify(result, null, 2)}\\n\`, "utf8");
};

await mkdir(stateDir, { recursive: true });

switch (capability) {
  case "prepare_target": {
    await writeFile(
      join(stateDir, "conversation.json"),
      JSON.stringify(
        {
          latest_reply: "Grounded reply",
          grounded: true,
          memory_status: "preserved"
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(
      runLogPath,
      [
        "prepare_target",
        \`run_directory=\${packet.run_directory}\`,
        \`round_directory=\${packet.round_directory}\`,
        "seeded canonical chat reference state"
      ].join("\\n"),
      "utf8"
    );
    await writeResult({
      capability,
      ok: true,
      summary: "Prepared the canonical chat companion target state.",
      findings: [],
      evidence_paths: [runLogPath]
    });
    break;
  }
  case "apply_change": {
    await writeFile(
      runLogPath,
      [
        "apply_change",
        \`round=\${packet.round}\`,
        "No-op apply step for the canonical chat companion target."
      ].join("\\n"),
      "utf8"
    );
    await writeResult({
      capability,
      ok: true,
      summary: "Applied the canonical chat no-op change step.",
      findings: [],
      evidence_paths: [runLogPath]
    });
    break;
  }
  case "run_target": {
    await rm(manifestPath, { force: true });
    const serverPath = join(targetRoot, "target-server.mjs");
    const child = spawn(process.execPath, [serverPath, stateDir, manifestPath], {
      cwd: targetRoot,
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
    const targetManifest = await waitForFile(manifestPath, 5000);
    await writeFile(
      runLogPath,
      [
        "run_target",
        \`health_url=\${targetManifest.health_url}\`,
        \`api_base_url=\${targetManifest.api_base_url}\`,
        "started canonical chat companion target"
      ].join("\\n"),
      "utf8"
    );
    await writeResult({
      capability,
      ok: true,
      summary: "Started the canonical chat companion target.",
      findings: [],
      evidence_paths: [runLogPath],
      target_manifest: targetManifest
    });
    break;
  }
  default:
    throw new Error(\`Unsupported executor capability: \${capability}\`);
}
`;

const canonicalChatServerSource = `import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname } from "node:path";

const stateDir = process.argv[2];
const manifestPath = process.argv[3];

if (!stateDir || !manifestPath) {
  console.error("Usage: node ./target-server.mjs <state-dir> <manifest-path>");
  process.exit(1);
}

let shutdownTimer;
const inactivityWindowMs = 30000;
const refreshShutdown = () => {
  clearTimeout(shutdownTimer);
  shutdownTimer = setTimeout(() => {
    server.close(() => process.exit(0));
  }, inactivityWindowMs);
};

const server = createServer((req, res) => {
  refreshShutdown();

  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "ready" }));
    return;
  }

  if (req.url === "/api/conversations/latest") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ grounded: true, reply: "Grounded reply" }));
    return;
  }

  if (req.url === "/api/conversations/invalid-tool") {
    res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "tool_rejected", status: "rejected" }));
    return;
  }

  if (req.url === "/api/conversations/memory") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "preserved" }));
    return;
  }

  if (req.url === "/api/conversations/unsafe-tool") {
    res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "unsafe_tool_blocked", status: "blocked" }));
    return;
  }

  if (req.url === "/api/conversations/refusal") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "safe_refusal" }));
    return;
  }

  if (req.url === "/api/conversations/tool-trace") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "persisted" }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(0, "127.0.0.1", async () => {
  refreshShutdown();
  const address = server.address();
  if (!address || typeof address === "string") {
    console.error("Failed to resolve canonical reference adapter server address.");
    process.exit(1);
  }

  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        health_url: \`http://127.0.0.1:\${address.port}/healthz\`,
        api_base_url: \`http://127.0.0.1:\${address.port}/api/\`
      },
      null,
      2
    ),
    "utf8"
  );
});
`;

const canonicalChatReadme = [
  "# Canonical Chat Companion Adapter",
  "",
  "This scaffold is a boringly reproducible external companion adapter for the harness core.",
  "It spins up a tiny chat-oriented API target outside the harness repository, then drives prepare/apply/run/capture/check/grade through the adapter contract boundary.",
  "",
  "## Use",
  "",
  "1. Export `REFERENCE_ADAPTER_CONTRACT` to this directory's `adapter.json`.",
  "2. Export `REFERENCE_TARGET_FAMILY=chat-agent`.",
  "3. Run `npm run validate:reference-adapter:check` from the harness repo.",
  "4. Run `npm run validate:reference-adapter` for the strict validator.",
  "5. Optionally run `npm run smoke:reference-adapter` for a wiring-only smoke."
].join("\n");

const canonicalApiPatchOnlyReadme = withVariantNotes(canonicalApiReadme, [
  "This variant intentionally fails one grounded criterion on round 1 and converges on round 2.",
  "Use it to prove that a real external companion can exercise patch-only reopen before reaching `target_reached`."
]);
const canonicalApiRecontractReadme = withVariantNotes(canonicalApiReadme, [
  "This variant intentionally repeats the same unresolved failure signature on rounds 1 and 2, then converges on round 3.",
  "Use it to prove that a real external companion can trigger patch-only first and recontract only after evidence repeats."
]);
const canonicalCrudPatchOnlyReadme = withVariantNotes(canonicalCrudReadme, [
  "This variant intentionally fails one grounded criterion on round 1 and converges on round 2.",
  "Use it to prove that a CRUD companion can exercise patch-only reopen before reaching `target_reached`."
]);
const canonicalCrudRecontractReadme = withVariantNotes(canonicalCrudReadme, [
  "This variant intentionally repeats the same unresolved failure signature on rounds 1 and 2, then converges on round 3.",
  "Use it to prove that a CRUD companion can trigger patch-only first and recontract after repeated evidence."
]);
const canonicalChatPatchOnlyReadme = withVariantNotes(canonicalChatReadme, [
  "This variant intentionally fails one grounded criterion on round 1 and converges on round 2.",
  "Use it to prove that a chat companion can exercise patch-only reopen before reaching `target_reached`."
]);
const canonicalChatRecontractReadme = withVariantNotes(canonicalChatReadme, [
  "This variant intentionally repeats the same unresolved failure signature on rounds 1 and 2, then converges on round 3.",
  "Use it to prove that a chat companion can trigger patch-only first and recontract after repeated evidence."
]);

const canonicalChatVerifierSource = `import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const capability = process.argv[2] ?? process.env.HARNESS_CAPABILITY;
const inputPath = process.env.HARNESS_INPUT_PATH;
const outputPath = process.env.HARNESS_OUTPUT_PATH;
const packet = JSON.parse(await readFile(inputPath, "utf8"));
const proofDir = join(packet.round_directory, "reference-adapter-proof");
const targetRoot = resolve(process.env.HARNESS_TARGET_ROOT ?? process.cwd());
const stateDir = join(targetRoot, ".reference-state");
const manifestPath = join(stateDir, "target-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
await mkdir(proofDir, { recursive: true });

const readJson = async (url) => {
  const response = await fetch(url);
  const text = await response.text();
  return {
    status: response.status,
    body: JSON.parse(text)
  };
};

const writeJson = async (path, value) => {
  await writeFile(path, \`\${JSON.stringify(value, null, 2)}\\n\`, "utf8");
};

const writeResult = async (result) => {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, \`\${JSON.stringify(result, null, 2)}\\n\`, "utf8");
};

const capturePath = join(proofDir, "capture_evidence.json");
const captureLogPath = join(proofDir, "capture_evidence-live.log");
const captureWitnessPath = join(proofDir, "capture_evidence-witness.json");
const checksPath = join(proofDir, "run_checks.json");
const checksLogPath = join(proofDir, "run_checks-live.log");
const checksWitnessPath = join(proofDir, "run_checks-witness.json");
const gradePath = join(proofDir, "grade_round.json");
const gradeLogPath = join(proofDir, "grade_round-live.log");
const gradeWitnessPath = join(proofDir, "grade_round-witness.json");
const roundBehaviorPath = join(targetRoot, "round-behavior.json");
const roundBehavior = JSON.parse(
  await readFile(roundBehaviorPath, "utf8").catch(() =>
    JSON.stringify({ failing_rounds: [], failing_criteria: [] })
  )
);
const activeRoundFailures = new Set(
  (roundBehavior.failing_rounds ?? []).includes(packet.round)
    ? roundBehavior.failing_criteria ?? []
    : []
);
const configuredGradeScore =
  typeof roundBehavior.grade_score === "number" && Number.isFinite(roundBehavior.grade_score)
    ? Math.max(0, Math.min(1, roundBehavior.grade_score))
    : undefined;
const criterionStatus = (criterionId, condition) =>
  activeRoundFailures.has(criterionId) ? "fail" : condition ? "pass" : "fail";
const criterionObservedValue = (
  criterionId,
  condition,
  passValue,
  failValue = "missing"
) =>
  activeRoundFailures.has(criterionId) ? failValue : condition ? passValue : failValue;
const gradeScore = configuredGradeScore ?? (activeRoundFailures.size > 0 ? 0.1 : 0.98);
const gradeOverallVerdict = activeRoundFailures.size > 0 ? "revise" : "advance";
const gradeThresholdVerdict = activeRoundFailures.size > 0 ? "fail" : "pass";
const gradeBlockingCriterionIds = Array.from(activeRoundFailures);

const writeWitness = async (path, payload) => {
  await writeJson(path, {
    witness_id: \`\${process.env.HARNESS_PROVIDER_ID}-\${capability}-round-\${packet.round}\`,
    provider_id: process.env.HARNESS_PROVIDER_ID,
    provider_role: process.env.HARNESS_PROVIDER_ROLE,
    capability,
    mode: "api",
    target_root: targetRoot,
    target_reference: "canonical-chat-companion",
    ...payload
  });
};

if (capability === "capture_evidence") {
  const health = await readJson(manifest.health_url);
  await writeJson(capturePath, {
    capability,
    round: packet.round,
    health
  });
  await writeFile(
    captureLogPath,
    [
      \`provider=\${process.env.HARNESS_PROVIDER_ID}\`,
      "action=fetch /healthz",
      \`status=\${health.status}\`,
      \`body=\${JSON.stringify(health.body)}\`
    ].join("\\n"),
    "utf8"
  );
  await writeWitness(captureWitnessPath, {
    interaction_log_path: captureLogPath,
    assertion_ids: ["grounded_reply"],
    steps: [
      {
        action: "fetch health endpoint",
        outcome: "pass",
        artifact_paths: [captureLogPath, capturePath]
      },
      {
        action: "confirm canonical chat companion is ready for downstream checks",
        outcome: "pass",
        artifact_paths: [capturePath]
      }
    ]
  });
  await writeResult({
    capability,
    ok: true,
    summary: "Captured live health evidence from the canonical chat companion target.",
    findings: [],
    evidence_paths: [capturePath, captureLogPath, captureWitnessPath],
    evidence_items: [
      {
        path: capturePath,
        kind: "json",
        description: "Captured health response for the canonical chat companion target."
      },
      {
        path: captureLogPath,
        kind: "interaction-log",
        description: "Live verifier log for the canonical chat companion target.",
        supports_check_ids: ["live_verification_present"],
        supports_criterion_ids: ["grounded_reply"]
      },
      {
        path: captureWitnessPath,
        kind: "verification-witness",
        description: "Structured witness for the canonical chat companion target.",
        supports_check_ids: ["live_verification_present"],
        supports_criterion_ids: ["grounded_reply"]
      }
    ]
  });
} else if (capability === "run_checks") {
  const [groundedReply, invalidTool, memory, unsafeTool, refusal, toolTrace] = await Promise.all([
    readJson(new URL("conversations/latest", manifest.api_base_url).toString()),
    readJson(new URL("conversations/invalid-tool", manifest.api_base_url).toString()),
    readJson(new URL("conversations/memory", manifest.api_base_url).toString()),
    readJson(new URL("conversations/unsafe-tool", manifest.api_base_url).toString()),
    readJson(new URL("conversations/refusal", manifest.api_base_url).toString()),
    readJson(new URL("conversations/tool-trace", manifest.api_base_url).toString())
  ]);
  await writeJson(checksPath, {
    capability,
    round: packet.round,
    groundedReply,
    invalidTool,
    memory,
    unsafeTool,
    refusal,
    toolTrace
  });
  await writeFile(
    checksLogPath,
    [
      \`provider=\${process.env.HARNESS_PROVIDER_ID}\`,
      "action=fetch /api/conversations/latest",
      "action=fetch /api/conversations/invalid-tool",
      "action=fetch /api/conversations/memory",
      "action=fetch /api/conversations/unsafe-tool",
      "action=fetch /api/conversations/refusal",
      "action=fetch /api/conversations/tool-trace",
      \`grounded_status=\${groundedReply.status}\`,
      \`invalid_tool_status=\${invalidTool.status}\`,
      \`memory_status=\${memory.status}\`,
      \`unsafe_tool_status=\${unsafeTool.status}\`,
      \`refusal_status=\${refusal.status}\`,
      \`tool_trace_status=\${toolTrace.status}\`
    ].join("\\n"),
    "utf8"
  );
  await writeWitness(checksWitnessPath, {
    interaction_log_path: checksLogPath,
    assertion_ids: [
      "grounded_reply",
      "invalid_tool_call_rejected",
      "conversation_memory_preserved",
      "unsafe_tool_request_blocked",
      "refusal_fallback_safe",
      "tool_trace_persisted"
    ],
    steps: [
      {
        action: "fetch canonical chat workflow endpoints",
        outcome: "pass",
        artifact_paths: [checksLogPath, checksPath]
      },
      {
        action: "confirm grounding, rejection, memory, unsafe-tool blocking, refusal fallback, and tool-trace expectations",
        outcome: "pass",
        artifact_paths: [checksLogPath, checksPath]
      }
    ]
  });
  await writeResult({
    capability,
    ok: true,
    summary: "Verified canonical chat grounding, rejection, memory, unsafe-tool blocking, refusal fallback, and tool-trace persistence.",
    findings: [],
    evidence_paths: [
      checksPath,
      checksLogPath,
      checksWitnessPath,
      capturePath,
      captureLogPath,
      captureWitnessPath
    ],
    evidence_items: [
      {
        path: checksPath,
        kind: "json",
        description: "Structured run_checks output for the canonical chat companion target.",
        supports_check_ids: ["adapter_execution_healthy", "adapter_evidence_is_meaningful"],
        supports_criterion_ids: [
          "grounded_reply",
          "invalid_tool_call_rejected",
          "conversation_memory_preserved",
          "unsafe_tool_request_blocked",
          "refusal_fallback_safe",
          "tool_trace_persisted"
        ]
      },
      {
        path: checksLogPath,
        kind: "interaction-log",
        description: "Live verifier log for canonical chat checks.",
        supports_check_ids: ["live_verification_present"],
        supports_criterion_ids: [
          "grounded_reply",
          "invalid_tool_call_rejected",
          "conversation_memory_preserved",
          "unsafe_tool_request_blocked",
          "refusal_fallback_safe",
          "tool_trace_persisted"
        ]
      },
      {
        path: checksWitnessPath,
        kind: "verification-witness",
        description: "Structured witness for canonical chat checks.",
        supports_check_ids: ["live_verification_present"],
        supports_criterion_ids: [
          "grounded_reply",
          "invalid_tool_call_rejected",
          "conversation_memory_preserved",
          "unsafe_tool_request_blocked",
          "refusal_fallback_safe",
          "tool_trace_persisted"
        ]
      },
      {
        path: capturePath,
        kind: "json",
        description: "Upstream capture evidence reused by run_checks."
      },
      {
        path: captureLogPath,
        kind: "interaction-log",
        description: "Upstream live verifier log reused by run_checks.",
        supports_check_ids: ["live_verification_present"],
        supports_criterion_ids: ["grounded_reply"]
      },
      {
        path: captureWitnessPath,
        kind: "verification-witness",
        description: "Upstream structured witness reused by run_checks.",
        supports_check_ids: ["live_verification_present"],
        supports_criterion_ids: ["grounded_reply"]
      }
    ],
    criteria_results: [
      {
        criterion_id: "grounded_reply",
        assertion_id: "grounded_reply",
        status: criterionStatus("grounded_reply", groundedReply.body.grounded === true),
        summary: "The latest assistant reply remains grounded in tool evidence.",
        hard: true,
        threshold: "Latest assistant reply must stay grounded.",
        observed_value: criterionObservedValue(
          "grounded_reply",
          groundedReply.body.grounded === true,
          "grounded"
        ),
        evidence_paths: [checksPath, checksLogPath]
      },
      {
        criterion_id: "invalid_tool_call_rejected",
        assertion_id: "invalid_tool_call_rejected",
        status: criterionStatus(
          "invalid_tool_call_rejected",
          invalidTool.status === 400 && invalidTool.body.error === "tool_rejected"
        ),
        summary: "Invalid tool requests are rejected explicitly.",
        hard: true,
        threshold: "Invalid tool requests must be rejected explicitly.",
        observed_value: criterionObservedValue(
          "invalid_tool_call_rejected",
          invalidTool.status === 400 && invalidTool.body.error === "tool_rejected",
          "rejected"
        ),
        evidence_paths: [checksPath, checksLogPath]
      },
      {
        criterion_id: "conversation_memory_preserved",
        assertion_id: "conversation_memory_preserved",
        status: criterionStatus(
          "conversation_memory_preserved",
          memory.body.status === "preserved"
        ),
        summary: "Conversation memory remains preserved across the latest turn.",
        hard: true,
        threshold: "Conversation memory must remain preserved.",
        observed_value: criterionObservedValue(
          "conversation_memory_preserved",
          memory.body.status === "preserved",
          "preserved"
        ),
        evidence_paths: [checksPath, checksLogPath]
      },
      {
        criterion_id: "unsafe_tool_request_blocked",
        assertion_id: "unsafe_tool_request_blocked",
        status: criterionStatus(
          "unsafe_tool_request_blocked",
          unsafeTool.status === 400 && unsafeTool.body.status === "blocked"
        ),
        summary: "Unsafe tool requests are blocked explicitly.",
        hard: true,
        threshold: "Unsafe tool requests must be blocked explicitly.",
        observed_value: criterionObservedValue(
          "unsafe_tool_request_blocked",
          unsafeTool.status === 400 && unsafeTool.body.status === "blocked",
          "blocked"
        ),
        evidence_paths: [checksPath, checksLogPath]
      },
      {
        criterion_id: "refusal_fallback_safe",
        assertion_id: "refusal_fallback_safe",
        status: criterionStatus(
          "refusal_fallback_safe",
          refusal.body.status === "safe_refusal"
        ),
        summary: "Unsupported requests fall back to a safe refusal response.",
        hard: true,
        threshold: "Refusal fallback must remain safe and explicit.",
        observed_value: criterionObservedValue(
          "refusal_fallback_safe",
          refusal.body.status === "safe_refusal",
          "safe_refusal"
        ),
        evidence_paths: [checksPath, checksLogPath]
      },
      {
        criterion_id: "tool_trace_persisted",
        assertion_id: "tool_trace_persisted",
        status: criterionStatus(
          "tool_trace_persisted",
          toolTrace.body.status === "persisted"
        ),
        summary: "Tool-trace metadata remains persisted across the latest grounded turn.",
        hard: true,
        threshold: "Tool trace metadata must remain persisted.",
        observed_value: criterionObservedValue(
          "tool_trace_persisted",
          toolTrace.body.status === "persisted",
          "persisted"
        ),
        evidence_paths: [checksPath, checksLogPath]
      }
    ]
  });
} else if (capability === "grade_round") {
  const groundedReply = await readJson(new URL("conversations/latest", manifest.api_base_url).toString());
  await writeJson(gradePath, {
    capability,
    round: packet.round,
    score: gradeScore,
    groundedReply
  });
  await writeFile(
    gradeLogPath,
    [
      \`provider=\${process.env.HARNESS_PROVIDER_ID}\`,
      "action=grade canonical chat round",
      \`grounded=\${groundedReply.body.grounded}\`,
      \`verdict=\${gradeOverallVerdict}\`
    ].join("\\n"),
    "utf8"
  );
  await writeWitness(gradeWitnessPath, {
    interaction_log_path: gradeLogPath,
    assertion_ids: ["grounded_reply", "conversation_memory_preserved"],
    steps: [
      {
        action: "grade canonical chat round from run_checks evidence",
        outcome: "pass",
        artifact_paths: [gradeLogPath, gradePath, checksPath]
      },
      {
        action: "confirm grade output stays grounded in captured verifier artifacts",
        outcome: "pass",
        artifact_paths: [gradePath, checksPath, capturePath]
      }
    ]
  });
  await writeResult({
    capability,
    ok: true,
    summary: \`Graded the canonical chat companion round with verdict '\${gradeOverallVerdict}'.\`,
    findings: [],
    evidence_paths: [
      gradePath,
      gradeLogPath,
      gradeWitnessPath,
      checksPath,
      checksLogPath,
      checksWitnessPath,
      capturePath,
      captureLogPath,
      captureWitnessPath
    ],
    evidence_items: [
      {
        path: gradePath,
        kind: "report",
        description: "Grade summary for the canonical chat companion round.",
        derived_from_capabilities: ["run_checks", "capture_evidence"],
        derived_from_evidence_paths: [
          checksPath,
          checksLogPath,
          checksWitnessPath,
          capturePath,
          captureLogPath,
          captureWitnessPath
        ]
      },
      {
        path: gradeLogPath,
        kind: "interaction-log",
        description: "Live verifier log for the canonical chat grade step.",
        supports_check_ids: ["live_verification_present"],
        supports_criterion_ids: ["grounded_reply"]
      },
      {
        path: gradeWitnessPath,
        kind: "verification-witness",
        description: "Structured witness for the canonical chat grade step.",
        supports_check_ids: ["live_verification_present"],
        supports_criterion_ids: ["grounded_reply"]
      },
      {
        path: checksPath,
        kind: "json",
        description: "Upstream run_checks evidence referenced by grade_round."
      },
      {
        path: checksLogPath,
        kind: "interaction-log",
        description: "Upstream run_checks verifier log referenced by grade_round.",
        supports_check_ids: ["live_verification_present"],
        supports_criterion_ids: [
          "grounded_reply",
          "invalid_tool_call_rejected",
          "conversation_memory_preserved",
          "unsafe_tool_request_blocked",
          "refusal_fallback_safe",
          "tool_trace_persisted"
        ]
      },
      {
        path: checksWitnessPath,
        kind: "verification-witness",
        description: "Upstream run_checks structured witness referenced by grade_round.",
        supports_check_ids: ["live_verification_present"],
        supports_criterion_ids: [
          "grounded_reply",
          "invalid_tool_call_rejected",
          "conversation_memory_preserved",
          "unsafe_tool_request_blocked",
          "refusal_fallback_safe",
          "tool_trace_persisted"
        ]
      },
      {
        path: capturePath,
        kind: "json",
        description: "Upstream capture_evidence output referenced by grade_round."
      },
      {
        path: captureLogPath,
        kind: "interaction-log",
        description: "Upstream capture_evidence verifier log referenced by grade_round.",
        supports_check_ids: ["live_verification_present"],
        supports_criterion_ids: ["grounded_reply"]
      },
      {
        path: captureWitnessPath,
        kind: "verification-witness",
        description: "Upstream capture_evidence structured witness referenced by grade_round.",
        supports_check_ids: ["live_verification_present"],
        supports_criterion_ids: ["grounded_reply"]
      }
    ],
    criteria_results: [
      {
        criterion_id: "grounded_reply",
        assertion_id: "grounded_reply",
        status: criterionStatus("grounded_reply", groundedReply.body.grounded === true),
        summary: "grade_round confirms the grounded reply assertion stayed green.",
        hard: true,
        threshold: "Grounded reply must remain green before release.",
        observed_value: criterionObservedValue(
          "grounded_reply",
          groundedReply.body.grounded === true,
          "grounded"
        ),
        evidence_paths: [checksPath, checksLogPath]
      }
    ],
    score: gradeScore,
    overall_verdict: gradeOverallVerdict,
    threshold_verdict: gradeThresholdVerdict,
    blocking_criterion_ids: gradeBlockingCriterionIds
  });
} else {
  throw new Error(\`Unsupported verifier capability: \${capability}\`);
}
`;

const placeholderReadme = [
  "# Reference Adapter Placeholder",
  "",
  "This scaffold is wiring-only. Replace `executor.cjs` and `verifier.cjs` with real companion-repo commands before running the strict validator.",
  "",
  "## Use",
  "",
  "1. Export `REFERENCE_ADAPTER_CONTRACT` to this directory's `adapter.json`.",
  "2. Export either `REFERENCE_TARGET_FAMILY` or `REFERENCE_EVALUATOR_PROFILE`.",
  "3. Run `npm run validate:reference-adapter:check` from the harness repo.",
  "4. Run `npm run smoke:reference-adapter` if you only want a wiring smoke."
].join("\n");

const placeholderFiles = () => ({
  "adapter.json": {
    adapter_id: "reference-adapter-template",
    label: "Reference Adapter Template",
    contract_version: "1",
    target_root: ".",
    capabilities: {
      prepare_target: { command: "node ./executor.cjs prepare_target" },
      apply_change: { command: "node ./executor.cjs apply_change" },
      run_target: { command: "node ./executor.cjs run_target" }
    },
    verification_provider: {
      provider_id: "reference-adapter-template-verifier",
      capabilities: {
        capture_evidence: { command: "node ./verifier.cjs capture_evidence" },
        run_checks: { command: "node ./verifier.cjs run_checks" },
        grade_round: { command: "node ./verifier.cjs grade_round" }
      }
    },
    notes: [
      "Replace executor.cjs and verifier.cjs with commands that point at the real companion target."
    ]
  },
  ".env.example": [
    "REFERENCE_ADAPTER_CONTRACT=./adapter.json",
    "# Either set REFERENCE_TARGET_FAMILY or REFERENCE_EVALUATOR_PROFILE",
    "REFERENCE_TARGET_FAMILY=api-service"
  ].join("\n"),
  "README.md": placeholderReadme,
  "executor.cjs":
    "console.error('Replace executor.cjs with a real companion adapter command.');\nprocess.exit(1);\n",
  "verifier.cjs":
    "console.error('Replace verifier.cjs with a real companion verifier command.');\nprocess.exit(1);\n"
});

const canonicalApiFiles = (input = {}) => ({
  "adapter.json": {
    adapter_id: input.adapterId ?? "canonical-api-companion",
    label: input.label ?? "Canonical API Companion",
    contract_version: "1",
    target_root: ".",
    capabilities: {
      prepare_target: { command: "node ./executor.mjs prepare_target" },
      apply_change: { command: "node ./executor.mjs apply_change" },
      run_target: { command: "node ./executor.mjs run_target" }
    },
    verification_provider: {
      provider_id: input.providerId ?? "canonical-api-companion-verifier",
      capabilities: {
        capture_evidence: { command: "node ./verifier.mjs capture_evidence" },
        run_checks: { command: "node ./verifier.mjs run_checks" },
        grade_round: { command: "node ./verifier.mjs grade_round" }
      }
    },
    notes: [
      "This canonical scaffold is intended to pass the strict harness-side reference adapter validator."
    ]
  },
  ".env.example": [
    "REFERENCE_ADAPTER_CONTRACT=./adapter.json",
    "REFERENCE_TARGET_FAMILY=api-service"
  ].join("\n"),
  "README.md": input.readme ?? canonicalApiReadme,
  "executor.mjs": canonicalApiExecutorSource,
  "verifier.mjs": canonicalApiVerifierSource,
  "target-server.mjs": canonicalApiServerSource,
  "round-behavior.json": input.roundBehavior ?? emptyRoundBehavior
});

const canonicalCrudFiles = (input = {}) => ({
  "adapter.json": {
    ...canonicalApiFiles()["adapter.json"],
    adapter_id: input.adapterId ?? "canonical-crud-companion",
    label: input.label ?? "Canonical CRUD Companion",
    verification_provider: {
      provider_id: input.providerId ?? "canonical-crud-companion-verifier",
      capabilities: {
        capture_evidence: { command: "node ./verifier.mjs capture_evidence" },
        run_checks: { command: "node ./verifier.mjs run_checks" },
        grade_round: { command: "node ./verifier.mjs grade_round" }
      }
    }
  },
  ".env.example": [
    "REFERENCE_ADAPTER_CONTRACT=./adapter.json",
    "REFERENCE_TARGET_FAMILY=crud-api"
  ].join("\n"),
  "README.md": input.readme ?? canonicalCrudReadme,
  "executor.mjs": replaceInTemplateFile(canonicalApiExecutorSource, [
    ["canonical API companion", "canonical CRUD companion"],
    ["canonical API reference state", "canonical CRUD reference state"]
  ]),
  "verifier.mjs": replaceInTemplateFile(canonicalApiVerifierSource, [
    ["canonical-api-companion", input.adapterId ?? "canonical-crud-companion"],
    ["canonical API companion", input.label ?? "Canonical CRUD Companion"],
    ["canonical API", "canonical CRUD"]
  ]),
  "target-server.mjs": canonicalApiServerSource,
  "round-behavior.json": input.roundBehavior ?? emptyRoundBehavior
});

const canonicalChatFiles = (input = {}) => ({
  "adapter.json": {
    adapter_id: input.adapterId ?? "canonical-chat-companion",
    label: input.label ?? "Canonical Chat Companion",
    contract_version: "1",
    target_root: ".",
    capabilities: {
      prepare_target: { command: "node ./executor.mjs prepare_target" },
      apply_change: { command: "node ./executor.mjs apply_change" },
      run_target: { command: "node ./executor.mjs run_target" }
    },
    verification_provider: {
      provider_id: input.providerId ?? "canonical-chat-companion-verifier",
      capabilities: {
        capture_evidence: { command: "node ./verifier.mjs capture_evidence" },
        run_checks: { command: "node ./verifier.mjs run_checks" },
        grade_round: { command: "node ./verifier.mjs grade_round" }
      }
    },
    notes: [
      "This canonical scaffold is intended to pass the strict harness-side reference adapter validator."
    ]
  },
  ".env.example": [
    "REFERENCE_ADAPTER_CONTRACT=./adapter.json",
    "REFERENCE_TARGET_FAMILY=chat-agent"
  ].join("\n"),
  "README.md": input.readme ?? canonicalChatReadme,
  "executor.mjs": canonicalChatExecutorSource,
  "verifier.mjs": replaceInTemplateFile(canonicalChatVerifierSource, [
    ["canonical-chat-companion", input.adapterId ?? "canonical-chat-companion"],
    ["canonical chat companion", (input.label ?? "Canonical Chat Companion").toLowerCase()],
    ["Canonical Chat Companion", input.label ?? "Canonical Chat Companion"]
  ]),
  "target-server.mjs": canonicalChatServerSource,
  "round-behavior.json": input.roundBehavior ?? emptyRoundBehavior
});

export const scaffoldReferenceAdapter = async (input) => {
  const template = input.template ?? "canonical-api";
  const root = resolve(input.outputDirectory);
  const templateOptions = input.templateOptions ?? {};
  await mkdir(root, { recursive: true });

  if (!supportedTemplates.includes(template)) {
    throw new Error(
      `Unsupported template '${template}'. Expected one of ${supportedTemplates.join(", ")}.`
    );
  }

  const files =
    template === "placeholder"
      ? placeholderFiles()
      : template === "canonical-api-patch-only"
        ? canonicalApiFiles({
            adapterId: "canonical-api-patch-only-companion",
            label: "Canonical API Patch-Only Companion",
            providerId: "canonical-api-patch-only-companion-verifier",
            readme: canonicalApiPatchOnlyReadme,
            roundBehavior: patchOnlyRoundBehavior("item_persists")
          })
        : template === "canonical-api-recontract"
          ? canonicalApiFiles({
              adapterId: "canonical-api-recontract-companion",
              label: "Canonical API Recontract Companion",
              providerId: "canonical-api-recontract-companion-verifier",
              readme: canonicalApiRecontractReadme,
              roundBehavior: recontractRoundBehavior("item_persists")
            })
      : template === "canonical-crud"
        ? canonicalCrudFiles()
        : template === "canonical-crud-patch-only"
          ? canonicalCrudFiles({
              adapterId: "canonical-crud-patch-only-companion",
              label: "Canonical CRUD Patch-Only Companion",
              providerId: "canonical-crud-patch-only-companion-verifier",
              readme: canonicalCrudPatchOnlyReadme,
              roundBehavior: patchOnlyRoundBehavior("item_persists")
            })
          : template === "canonical-crud-recontract"
            ? canonicalCrudFiles({
                adapterId: "canonical-crud-recontract-companion",
                label: "Canonical CRUD Recontract Companion",
                providerId: "canonical-crud-recontract-companion-verifier",
                readme: canonicalCrudRecontractReadme,
                roundBehavior: recontractRoundBehavior("item_persists")
              })
        : template === "canonical-chat"
          ? canonicalChatFiles()
          : template === "canonical-chat-patch-only"
            ? canonicalChatFiles({
                adapterId: "canonical-chat-patch-only-companion",
                label: "Canonical Chat Patch-Only Companion",
                providerId: "canonical-chat-patch-only-companion-verifier",
                readme: canonicalChatPatchOnlyReadme,
                roundBehavior: patchOnlyRoundBehavior("grounded_reply")
              })
            : template === "canonical-chat-recontract"
              ? canonicalChatFiles({
                  adapterId: "canonical-chat-recontract-companion",
                  label: "Canonical Chat Recontract Companion",
                  providerId: "canonical-chat-recontract-companion-verifier",
                  readme: canonicalChatRecontractReadme,
                  roundBehavior: recontractRoundBehavior("grounded_reply")
                })
              : canonicalApiFiles(templateOptions);

  await Promise.all(
    Object.entries(files).map(async ([relativePath, value]) => {
      const outputPath = resolve(root, relativePath);
      await mkdir(resolve(outputPath, ".."), { recursive: true });
      const content =
        typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
      await writeFile(outputPath, content, "utf8");
    })
  );

  return {
    outputDirectory: root,
    template
  };
};
