import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  cleanupTempRoot,
  createTempRoot,
  importDist,
  readJsonFile,
  writeJsonFile
} from "./testing/bootstrap-validator-helpers.mjs";

const withEnv = async (overrides, fn) => {
  const previous = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    process.env[key] = overrides[key];
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

const assertBlocker = (report, code) => {
  assert.ok(
    report.blockers.some((blocker) => blocker.code === code),
    `expected blocker ${code}, got ${report.blockers.map((blocker) => blocker.code).join(", ")}`
  );
};

const buildFrontDoorSession = ({ targetRoot }) => ({
  session_id: "front-door-readiness",
  thread_id: "thread-readiness",
  lane: "product_build",
  source_request: "Build an existing browser app and verify it in the browser.",
  phase: "ready_for_prepare",
  intake: {
    product_title: "Existing Browser App",
    product_summary: "An existing browser app used to validate readiness blockers.",
    target_users: ["operator"],
    core_features: ["open the dashboard"],
    finish_line: "The dashboard opens and the primary workflow is visible.",
    target_family: "browser-app",
    target_score: 0.9,
    max_rounds: 2,
    target_root: targetRoot,
    project_mode: "existing",
    run_command: "npm run dev",
    verification_surfaces: ["browser"],
    workflow_checks: [
      {
        workflow: "open the dashboard",
        surface: "browser",
        expected_result: "Dashboard content is visible."
      }
    ]
  },
  missing_product_fields: [],
  missing_execution_fields: [],
  missing_adapter_fields: [],
  asked_question_ids: [],
  last_question_ids: [],
  last_question_batch: [],
  defaults_accepted: [],
  unresolved_conflicts: [],
  turn_count: 3,
  created_at: "2026-05-26T00:00:00.000Z",
  updated_at: "2026-05-26T00:00:00.000Z"
});

const main = async () => {
  const tempRoot = await createTempRoot("validate-readiness-doctor");
  const runsDirectory = join(tempRoot, "runs");
  const workspaceRoot = join(tempRoot, "workspace");
  const targetRoot = join(tempRoot, "target-app");

  try {
    await Promise.all([
      mkdir(workspaceRoot, { recursive: true }),
      mkdir(targetRoot, { recursive: true })
    ]);
    const [{ buildReadinessReport }, prepareSessionModule] = await Promise.all([
      importDist("readiness-doctor.js"),
      importDist("prepare-session.js")
    ]);
    const {
      prepareSessionRun,
      findLatestPreparedRunAwaitingStart,
      readyToStartMarkerPathForRun
    } = prepareSessionModule;

    const readyBrowser = await buildReadinessReport({
      runId: "ready-browser",
      runDirectory: join(runsDirectory, "ready-browser"),
      isProductBuild: true,
      sourceIntake: {
        target_root: targetRoot,
        project_mode: "existing",
        target_family: "browser-app",
        run_command: "npm run dev",
        ready_url: "http://127.0.0.1:3000/",
        verification_surfaces: ["browser"],
        core_features: ["open the dashboard"]
      }
    });
    assert.equal(readyBrowser.ready, true);
    assert.equal(readyBrowser.status, "ready_to_start");

    const missingCommand = await buildReadinessReport({
      runId: "missing-command",
      runDirectory: join(runsDirectory, "missing-command"),
      isProductBuild: true,
      sourceIntake: {
        target_root: targetRoot,
        project_mode: "existing",
        target_family: "generic-core",
        verification_surfaces: ["cli"],
        core_features: ["parse a log file"]
      }
    });
    assert.equal(missingCommand.ready, false);
    assertBlocker(missingCommand, "RUN_COMMAND_MISSING");

    const missingVisualEvidence = await buildReadinessReport({
      runId: "missing-visual-evidence",
      runDirectory: join(runsDirectory, "missing-visual-evidence"),
      isProductBuild: true,
      sourceIntake: {
        target_root: targetRoot,
        project_mode: "existing",
        target_family: "generic-core",
        run_command: "node ./bin/tool.js sample.log",
        verification_surfaces: ["cli"],
        core_features: ["parse a log file"],
        custom_quality_metrics: [
          {
            metric_id: "design.cleanliness",
            label: "깔끔함",
            description: "화면 정렬과 여백이 좋아야 한다.",
            minimum_score_out_of_ten: 9,
            required: true
          }
        ]
      }
    });
    assert.equal(missingVisualEvidence.ready, false);
    assertBlocker(missingVisualEvidence, "CUSTOM_DIMENSION_EVIDENCE_MISSING");

    const readyCli = await buildReadinessReport({
      runId: "ready-cli",
      runDirectory: join(runsDirectory, "ready-cli"),
      isProductBuild: true,
      sourceIntake: {
        target_root: targetRoot,
        project_mode: "existing",
        target_family: "generic-core",
        run_command: "node ./bin/tool.js sample.log",
        verification_surfaces: ["cli", "file"],
        core_features: ["parse a log file"]
      }
    });
    assert.equal(readyCli.ready, true);
    assert.equal(readyCli.status, "ready_to_start");

    const ideaPath = join(workspaceRoot, "IDEA.md");
    const frontDoorSessionPath = join(workspaceRoot, "front-door-session.json");
    await writeFile(
      ideaPath,
      [
        "# Existing Browser App",
        "",
        "An existing browser app used to validate readiness blockers."
      ].join("\n"),
      "utf8"
    );
    await writeJsonFile(frontDoorSessionPath, buildFrontDoorSession({ targetRoot }));

    const prepared = await withEnv(
      {
        HARNESS_RUNS_DIRECTORY: runsDirectory,
        CODEX_THREAD_ID: "thread-readiness",
        HARNESS_THREAD_BINDING_STATE: "bound",
        HARNESS_LAUNCH_ORIGIN: "codex-app-thread",
        HARNESS_SURFACE_OWNER: "stock-codex-thread",
        HARNESS_ENTRYPOINT: "skill",
        HARNESS_APP_VISIBILITY: "visible-in-stock-app"
      },
      () =>
        prepareSessionRun({
          ideaPath,
          frontDoorSessionPath,
          transportMode: "current-thread",
          controllerMode: "attached"
        })
    );

    const [readinessReport, sessionStatus, operatorSurface, frontDoorSession] =
      await Promise.all([
        readJsonFile(prepared.readinessReportPath),
        readJsonFile(prepared.sessionStatusPath),
        readJsonFile(prepared.operatorSurfacePath),
        readJsonFile(frontDoorSessionPath)
      ]);

    assert.equal(prepared.readiness.ready, false);
    assert.equal(readinessReport.ready, false);
    assert.equal(readinessReport.status, "prepared_with_blockers");
    assertBlocker(readinessReport, "READY_URL_MISSING");
    assert.equal(sessionStatus.session_status, "prepared_with_blockers");
    assert.equal(sessionStatus.readiness, "blocked");
    assert.equal(sessionStatus.next_attention, "human");
    assert.equal(operatorSurface.session.session_status, "prepared_with_blockers");
    assert.match(operatorSurface.next_action, /readiness doctor/i);
    assert.equal(frontDoorSession.phase, "prepared_with_blockers");
    assert.equal(
      existsSync(readyToStartMarkerPathForRun(runsDirectory, prepared.runId)),
      false
    );

    const preparedRun = await findLatestPreparedRunAwaitingStart(
      runsDirectory,
      "thread-readiness",
      {
        runId: prepared.runId,
        allowAssumedForeground: true
      }
    );
    assert.equal(preparedRun, undefined);
  } finally {
    await cleanupTempRoot(tempRoot);
  }
};

await main();
console.log("validate:readiness-doctor passed");
