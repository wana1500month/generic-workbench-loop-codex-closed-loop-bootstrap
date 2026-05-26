import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  cleanupTempRoot,
  createTempRoot,
  ensureBuild,
  importDist
} from "./bootstrap-validator-helpers.mjs";

const baseEvalReport = {
  generated_at: "2026-05-26T00:00:00.000Z",
  round: 1,
  total_score: 0.94,
  control_plane_score: 0.95,
  proof_score: 0.94,
  release_score: 0.94,
  overall_verdict: "advance",
  strengths: [],
  blockers: [],
  next_actions: [],
  evidence_paths: ["round-001/evidence/result.log"],
  threshold_gap_details: [],
  check_results: [],
  resolved_check_ids: [],
  unresolved_check_ids: [],
  adapter_attached: true,
  threshold_results: {
    contract_completed: true,
    minimum_control_plane_score_met: true,
    minimum_proof_score_met: true,
    minimum_release_score_met: true,
    adapter_required_met: true,
    grade_score_required_met: true,
    core_probe_required_met: true,
    dimension_thresholds_met: true,
    target_reached_eligible: true
  },
  dimension_scores: [],
  adapter_results: [],
  core_probe_results: []
};

export const projectKindFixtures = [
  {
    name: "cli",
    request: "Build a CLI log analyzer",
    projectKind: "cli_tool",
    targetFamily: "cli-tool",
    evidenceSurfaces: ["cli", "file", "test"],
    expectedQuestions: ["CLI", "representative commands", "stdout/file outputs"],
    coreFeature: "parse a log file and print a stable summary",
    runCommand: "node ./bin/log-analyzer.js sample.log",
    checkCommand: "npm test",
    commandFirst: true
  },
  {
    name: "library",
    request: "Build an npm package that parses URL slugs",
    projectKind: "library_package",
    targetFamily: "command-artifact",
    evidenceSurfaces: ["package_import", "test", "file"],
    expectedQuestions: ["package", "public functions", "install/import/use"],
    coreFeature: "parse URL slugs through a public API",
    checkCommand: "npm test",
    commandFirst: true
  },
  {
    name: "agent-workflow",
    request: "Build an agent workflow",
    projectKind: "agent_workflow",
    targetFamily: "chat-agent",
    evidenceSurfaces: ["agent_conversation", "file", "test"],
    expectedQuestions: ["agent", "representative input prompts", "good response"],
    coreFeature: "triage a support ticket from a prompt",
    checkCommand: "npm test",
    commandFirst: true
  },
  {
    name: "document-artifact",
    request: "Build a Markdown report artifact generator",
    projectKind: "document_artifact",
    targetFamily: "command-artifact",
    evidenceSurfaces: ["document", "file", "manual_review"],
    expectedQuestions: ["read or approve", "document format", "included or excluded"],
    coreFeature: "generate a structured Markdown report",
    checkCommand: "npm test",
    commandFirst: true
  },
  {
    name: "data-pipeline",
    request: "Build a CSV data pipeline",
    projectKind: "data_pipeline",
    targetFamily: "command-artifact",
    evidenceSurfaces: ["cli", "file", "test"],
    expectedQuestions: ["pipeline", "input sources", "bad-row"],
    coreFeature: "transform a CSV input into a summary file",
    runCommand: "node ./bin/pipeline.js sample.csv",
    checkCommand: "npm test",
    commandFirst: true
  },
  {
    name: "automation",
    request: "Build a scheduled cleanup automation tool",
    projectKind: "automation",
    targetFamily: "command-artifact",
    evidenceSurfaces: ["shell", "file", "test"],
    expectedQuestions: ["automation", "trigger", "failure or alert"],
    coreFeature: "run scheduled cleanup and write a result log",
    checkCommand: "npm test",
    commandFirst: true
  },
  {
    name: "browser-ui",
    request: "Build a browser dashboard app with monthly budget tracking",
    projectKind: "browser_ui",
    targetFamily: "dashboard",
    evidenceSurfaces: ["browser", "screenshot", "test"],
    expectedQuestions: ["primary user", "core workflows", "good enough"],
    coreFeature: "view monthly budget totals in the browser",
    runCommand: "npm run dev -- --host 127.0.0.1 --port 3000 --strictPort",
    checkCommand: "npm test",
    readyUrl: "http://127.0.0.1:3000/",
    appUrl: "http://127.0.0.1:3000/"
  },
  {
    name: "api-service",
    request: "Build an API service that handles invoice lookups",
    projectKind: "api_service",
    targetFamily: "api-service",
    evidenceSurfaces: ["api", "test", "file"],
    expectedQuestions: ["primary user", "core workflows", "good enough"],
    coreFeature: "look up an invoice through an API endpoint",
    runCommand: "npm run start",
    checkCommand: "npm test",
    readyUrl: "http://127.0.0.1:3000/health",
    apiBaseUrl: "http://127.0.0.1:3000"
  },
  {
    name: "ko-cli",
    request: "\u0043\u004C\u0049 \uB85C\uADF8 \uBD84\uC11D\uAE30 \uB9CC\uB4E4\uC5B4\uC918",
    projectKind: "cli_tool",
    targetFamily: "cli-tool",
    evidenceSurfaces: ["cli", "file", "test"],
    expectedQuestions: ["\uB300\uD45C \uC2E4\uD589", "stdout/\uD30C\uC77C"],
    coreFeature: "parse a log file and print a stable summary",
    runCommand: "node ./bin/log-analyzer.js sample.log",
    checkCommand: "npm test",
    commandFirst: true
  },
  {
    name: "ko-library",
    request:
      "\u0054\u0079\u0070\u0065\u0053\u0063\u0072\u0069\u0070\u0074 \uB77C\uC774\uBE0C\uB7EC\uB9AC \uD328\uD0A4\uC9C0\uB97C \uB9CC\uB4E4\uC5B4\uC918",
    projectKind: "library_package",
    targetFamily: "command-artifact",
    evidenceSurfaces: ["package_import", "test", "file"],
    expectedQuestions: [
      "\uD568\uC218/\uD074\uB798\uC2A4",
      "\uC124\uCE58/import/\uC0AC\uC6A9"
    ],
    coreFeature: "publish a TypeScript package API",
    checkCommand: "npm test",
    commandFirst: true
  },
  {
    name: "ko-agent-workflow",
    request:
      "\uC5D0\uC774\uC804\uD2B8 \uC6CC\uD06C\uD50C\uB85C \uD3C9\uAC00 \uB3C4\uAD6C\uB97C \uB9CC\uB4E4\uC5B4\uC918",
    projectKind: "agent_workflow",
    targetFamily: "chat-agent",
    evidenceSurfaces: ["agent_conversation", "file", "test"],
    expectedQuestions: [
      "\uC5D0\uC774\uC804\uD2B8",
      "\uB300\uD45C \uC785\uB825",
      "\uC88B\uC740 \uC751\uB2F5"
    ],
    coreFeature: "evaluate an agent workflow from sample prompts",
    checkCommand: "npm test",
    commandFirst: true
  },
  {
    name: "ko-document-artifact",
    request:
      "\u004D\u0061\u0072\u006B\u0064\u006F\u0077\u006E \uBCF4\uACE0\uC11C \uC0B0\uCD9C\uBB3C \uC0DD\uC131\uAE30\uB97C \uB9CC\uB4E4\uC5B4\uC918",
    projectKind: "document_artifact",
    targetFamily: "command-artifact",
    evidenceSurfaces: ["document", "file", "manual_review"],
    expectedQuestions: [
      "\uCD5C\uC885 \uC0B0\uCD9C\uBB3C",
      "\uD3EC\uD568/\uC81C\uC678"
    ],
    coreFeature: "generate a structured Markdown report",
    checkCommand: "npm test",
    commandFirst: true
  },
  {
    name: "ko-document-generator",
    request:
      "\uBB38\uC11C \uC0B0\uCD9C\uBB3C \uC0DD\uC131\uAE30\uB97C \uB9CC\uB4E4\uC5B4\uC918",
    projectKind: "document_artifact",
    targetFamily: "command-artifact",
    evidenceSurfaces: ["document", "file", "manual_review"],
    expectedQuestions: [
      "\uCD5C\uC885 \uC0B0\uCD9C\uBB3C",
      "\uD3EC\uD568/\uC81C\uC678"
    ],
    coreFeature: "generate a document artifact",
    checkCommand: "npm test",
    commandFirst: true
  },
  {
    name: "ko-install-guide-generator",
    request:
      "\uC124\uCE58 \uAC00\uC774\uB4DC \uBB38\uC11C \uC0DD\uC131\uAE30\uB97C \uB9CC\uB4E4\uC5B4\uC918",
    projectKind: "document_artifact",
    targetFamily: "command-artifact",
    evidenceSurfaces: ["document", "file", "manual_review"],
    expectedQuestions: [
      "\uCD5C\uC885 \uC0B0\uCD9C\uBB3C",
      "\uD3EC\uD568/\uC81C\uC678"
    ],
    coreFeature: "generate an installation guide document",
    checkCommand: "npm test",
    commandFirst: true
  },
  {
    name: "ko-data-pipeline-tool",
    request:
      "\u0043\u0053\u0056 \uB370\uC774\uD130 \uD30C\uC774\uD504\uB77C\uC778 \uB3C4\uAD6C\uB97C \uB9CC\uB4E4\uC5B4\uC918",
    projectKind: "data_pipeline",
    targetFamily: "command-artifact",
    evidenceSurfaces: ["cli", "file", "test"],
    expectedQuestions: [
      "\uC785\uB825 \uC18C\uC2A4",
      "bad-row"
    ],
    coreFeature: "transform a CSV input into a summary file",
    runCommand: "node ./bin/pipeline.js sample.csv",
    checkCommand: "npm test",
    commandFirst: true
  },
  {
    name: "ko-data-pipeline-generator",
    request:
      "\uB370\uC774\uD130 \uD30C\uC774\uD504\uB77C\uC778 \uC0DD\uC131\uAE30 \uB9CC\uB4E4\uC5B4\uC918",
    projectKind: "data_pipeline",
    targetFamily: "command-artifact",
    evidenceSurfaces: ["cli", "file", "test"],
    expectedQuestions: [
      "\uC785\uB825 \uC18C\uC2A4",
      "bad-row"
    ],
    coreFeature: "generate a data pipeline command",
    runCommand: "node ./bin/pipeline.js sample.csv",
    checkCommand: "npm test",
    commandFirst: true
  },
  {
    name: "ko-automation",
    request:
      "\uC815\uAE30 \uC815\uB9AC \uC790\uB3D9\uD654 \uB3C4\uAD6C\uB97C \uB9CC\uB4E4\uC5B4\uC918",
    projectKind: "automation",
    targetFamily: "command-artifact",
    evidenceSurfaces: ["shell", "file", "test"],
    expectedQuestions: [
      "\uC790\uB3D9\uD654",
      "\uD2B8\uB9AC\uAC70",
      "\uC2E4\uD328/\uC54C\uB9BC"
    ],
    coreFeature: "run scheduled cleanup and write a result log",
    checkCommand: "npm test",
    commandFirst: true
  }
];

export const koreanProjectKindFixtureNames = projectKindFixtures
  .filter((fixture) => fixture.name.startsWith("ko-"))
  .map((fixture) => fixture.name);

const lower = (value) => value.toLowerCase();

const assertNoBrowserRuntime = (plan, label) => {
  assert.ok(plan, `${label}: adapter plan should exist`);
  assert.ok(!plan.verification_surfaces.includes("browser"), label);
  assert.ok(!plan.verification_surfaces.includes("screenshot"), label);
  assert.equal(plan.runtime_strategy.ready_url, undefined, label);
  assert.equal(plan.runtime_strategy.app_url, undefined, label);
  assert.equal(plan.runtime_strategy.api_base_url, undefined, label);
  assert.equal(plan.runtime_strategy.health_url, undefined, label);
  assert.ok(
    plan.runtime_strategy.run_command || plan.runtime_strategy.check_command,
    `${label}: command-first runtime should expose a command`
  );
};

const assertQuestionCoverage = (fixture, questions) => {
  const joinedQuestions = lower(questions.join("\n"));
  for (const expected of fixture.expectedQuestions) {
    assert.ok(
      joinedQuestions.includes(lower(expected)),
      `${fixture.name}: expected question text to include '${expected}'.\n${questions.join("\n")}`
    );
  }
};

export const validateProjectKindFixture = async (fixtureName) => {
  await ensureBuild();
  const fixtures = fixtureName
    ? projectKindFixtures.filter((fixture) => fixture.name === fixtureName)
    : projectKindFixtures;
  assert.ok(fixtures.length > 0, `Unknown project-kind fixture '${fixtureName}'.`);

  const tempRoot = await createTempRoot(
    fixtureName
      ? `validate-${fixtureName}-front-door-questions`
      : "validate-project-kind-fixtures"
  );
  const previousEnv = {
    HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY:
      process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY
  };
  process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY = join(tempRoot, "sessions");

  try {
    const [
      { evaluateIntakeRequest },
      { evaluateLoopIntent },
      { runFrontDoorDiscoveryTurn },
      { buildReadinessReport },
      { buildEvaluationPolicy, buildRoundScorecard }
    ] = await Promise.all([
      importDist("intake-gate.js"),
      importDist("intent-gate.js"),
      importDist("front-door-session.js"),
      importDist("readiness-doctor.js"),
      importDist("evaluation-policy.js")
    ]);

    for (const fixture of fixtures) {
      const intakeDetection = evaluateIntakeRequest(fixture.request);
      assert.equal(
        intakeDetection.is_product_build_request,
        true,
        fixture.name
      );
      const intent = evaluateLoopIntent(fixture.request);
      assert.equal(intent.intent, "product_build", fixture.name);

      const turn = await runFrontDoorDiscoveryTurn({
        threadId: `project-kind-${fixture.name}`,
        message: fixture.request
      });
      assert.equal(turn.status, "ask_product_questions", fixture.name);
      assert.equal(turn.intake.project_kind, fixture.projectKind, fixture.name);
      assert.equal(turn.intake.target_family, fixture.targetFamily, fixture.name);
      assert.deepEqual(
        turn.intake.evidence_surfaces,
        fixture.evidenceSurfaces,
        fixture.name
      );
      assertQuestionCoverage(fixture, turn.questions);
      if (fixture.commandFirst) {
        assertNoBrowserRuntime(turn.intake.adapter_plan, fixture.name);
      }

      const targetRoot = join(tempRoot, fixture.name, "target");
      await mkdir(targetRoot, { recursive: true });
      const sourceIntake = {
        ...turn.intake,
        target_root: targetRoot,
        project_mode: "existing",
        core_features: [fixture.coreFeature],
        run_command: fixture.runCommand,
        check_command: fixture.checkCommand,
        ready_url: fixture.readyUrl,
        app_url: fixture.appUrl,
        api_base_url: fixture.apiBaseUrl
      };
      const readiness = await buildReadinessReport({
        runId: `project-kind-${fixture.name}`,
        runDirectory: join(tempRoot, fixture.name, "run"),
        isProductBuild: true,
        sourceIntake
      });
      assert.equal(readiness.ready, true, JSON.stringify(readiness, null, 2));
      assert.equal(
        readiness.blockers.some((blocker) => blocker.code === "READY_URL_MISSING"),
        false,
        fixture.name
      );

      const policy = buildEvaluationPolicy({ intake: sourceIntake });
      assert.equal(policy.project_kind, fixture.projectKind, fixture.name);
      for (const surface of fixture.evidenceSurfaces) {
        assert.ok(policy.evidence_surfaces.includes(surface), fixture.name);
      }
      const scorecard = buildRoundScorecard({
        policy,
        evalReport: {
          ...baseEvalReport,
          evidence_paths: fixture.evidenceSurfaces.map(
            (surface) => `round-001/evidence/${surface}.log`
          )
        }
      });
      assert.equal(scorecard.round, 1, fixture.name);
      assert.equal(scorecard.target_total_score, policy.target_total_score);
      assert.ok(scorecard.dimension_scores.length >= 2, fixture.name);
    }
  } finally {
    if (previousEnv.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY === undefined) {
      delete process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY;
    } else {
      process.env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY =
        previousEnv.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY;
    }
    await cleanupTempRoot(tempRoot);
  }
};
