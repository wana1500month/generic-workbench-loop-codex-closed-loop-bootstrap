import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const zipArgIndex = args.indexOf("--zip");
const zipEqualsArg = args.find((arg) => arg.startsWith("--zip="));
const positionalZipArg = args.find(
  (arg) => !arg.startsWith("-") && /\.zip$/i.test(arg)
);
const zipPath =
  zipArgIndex >= 0 && args[zipArgIndex + 1]
    ? resolve(repoRoot, args[zipArgIndex + 1])
    : zipEqualsArg
      ? resolve(repoRoot, zipEqualsArg.slice("--zip=".length))
      : positionalZipArg
        ? resolve(repoRoot, positionalZipArg)
        : join(repoRoot, ".tmp", "release", "generic-codex-workbench-CODEX-APP-INSTALL.zip");

const buildToolPattern =
  /TypeScript is not installed|npm ci|npx -p typescript|npm run build/i;

const nodeOnlyPath = dirname(process.execPath);

const runCommand = async (command, commandArgs, options = {}) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      shell: options.shell ?? false,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });

const extractZip = async (sourceZip, destination) => {
  await mkdir(destination, { recursive: true });
  if (process.platform === "win32") {
    const result = await runCommand(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Expand-Archive -Path $env:HARNESS_RELEASE_ZIP -DestinationPath $env:HARNESS_RELEASE_ROOT -Force"
      ],
      {
        env: {
          ...process.env,
          HARNESS_RELEASE_ZIP: sourceZip,
          HARNESS_RELEASE_ROOT: destination
        },
        shell: false
      }
    );
    assert.equal(
      result.code,
      0,
      `release zip extraction failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
    );
    return;
  }

  const unzipResult = await runCommand("unzip", ["-q", sourceZip, "-d", destination]);
  assert.equal(
    unzipResult.code,
    0,
    `release zip extraction failed.\nSTDOUT:\n${unzipResult.stdout}\nSTDERR:\n${unzipResult.stderr}`
  );
};

const readJsonFile = async (path) =>
  JSON.parse(await readFile(path, "utf8"));

const assertNoBuildAttempt = (result, label) => {
  assert.doesNotMatch(
    result.stderr,
    buildToolPattern,
    `${label} attempted to rebuild instead of using bundled dist.\nSTDERR:\n${result.stderr}`
  );
};

const parseJsonStdout = (result, label) => {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `${label} did not print JSON.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}\n${error}`
    );
  }
};

const resolveReleasePath = (releaseRoot, path) =>
  isAbsolute(path) ? path : resolve(releaseRoot, path);

const extractRunDirectory = (releaseRoot, stdout) => {
  const match = stdout.match(/Run created:\s+(.+)/);
  if (match) {
    return resolveReleasePath(releaseRoot, match[1].trim());
  }
  try {
    const parsed = JSON.parse(stdout);
    if (typeof parsed.run_directory === "string") {
      return resolveReleasePath(releaseRoot, parsed.run_directory);
    }
  } catch {}
  throw new Error(`Could not find run directory in output.\n${stdout}`);
};

const runReleaseNode = async (releaseRoot, commandArgs, env) =>
  runCommand(process.execPath, commandArgs, {
    cwd: releaseRoot,
    env,
    shell: false
  });

const main = async () => {
  assert.ok(existsSync(zipPath), `release zip not found: ${zipPath}`);

  await mkdir(join(repoRoot, ".tmp"), { recursive: true });
  const tempRoot = await mkdtemp(join(repoRoot, ".tmp", "release-product-start-"));
  let releaseRoot = join(tempRoot, "release-root");

  try {
    await extractZip(zipPath, releaseRoot);
    const nestedRoot = join(releaseRoot, "generic-codex-workbench");
    if (existsSync(join(nestedRoot, "package.json"))) {
      releaseRoot = nestedRoot;
    }

    assert.ok(
      existsSync(join(releaseRoot, "packages", "loop-orchestrator", "dist", "cli.js")),
      "release image is missing packages/loop-orchestrator/dist/cli.js"
    );
    assert.ok(
      !existsSync(join(releaseRoot, "node_modules")),
      "release image must not include node_modules"
    );

    const sessionsDirectory = join(tempRoot, "front-door-sessions");
    const releaseEnv = {
      ...process.env,
      PATH: nodeOnlyPath,
      Path: nodeOnlyPath,
      npm_config_ignore_scripts: "true",
      HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY: sessionsDirectory
    };
    for (const key of [
      "CODEX_THREAD_ID",
      "HARNESS_THREAD_BINDING_STATE",
      "HARNESS_LAUNCH_ORIGIN",
      "HARNESS_SURFACE_OWNER",
      "HARNESS_ENTRYPOINT",
      "HARNESS_APP_VISIBILITY"
    ]) {
      delete releaseEnv[key];
    }

    const firstDiscovery = await runReleaseNode(
      releaseRoot,
      [
        "scripts/loop-discover.mjs",
        "--message",
        "가계부 앱 만들어줘",
        "--json"
      ],
      releaseEnv
    );
    assert.equal(
      firstDiscovery.code,
      0,
      `release first discovery failed.\nSTDOUT:\n${firstDiscovery.stdout}\nSTDERR:\n${firstDiscovery.stderr}`
    );
    assertNoBuildAttempt(firstDiscovery, "release first discovery");

    const secondDiscovery = await runReleaseNode(
      releaseRoot,
      [
        "scripts/loop-discover.mjs",
        "--message",
        [
          "개인 사용자용.",
          "수입/지출 기록, 카테고리 관리, 월별 통계.",
          "거래 추가/삭제와 통계 확인이 가능하면 성공."
        ].join("\n"),
        "--json"
      ],
      releaseEnv
    );
    assert.equal(
      secondDiscovery.code,
      0,
      `release second discovery failed.\nSTDOUT:\n${secondDiscovery.stdout}\nSTDERR:\n${secondDiscovery.stderr}`
    );
    assertNoBuildAttempt(secondDiscovery, "release second discovery");

    const thirdDiscovery = await runReleaseNode(
      releaseRoot,
      [
        "scripts/loop-discover.mjs",
        "--message",
        "새 프로젝트로 진행해.",
        "--json"
      ],
      releaseEnv
    );
    assert.equal(
      thirdDiscovery.code,
      0,
      `release third discovery failed.\nSTDOUT:\n${thirdDiscovery.stdout}\nSTDERR:\n${thirdDiscovery.stderr}`
    );
    assertNoBuildAttempt(thirdDiscovery, "release third discovery");
    const adapterDiscovery = parseJsonStdout(thirdDiscovery, "release third discovery");
    assert.equal(adapterDiscovery.status, "ask_adapter_questions");

    const fourthDiscovery = await runReleaseNode(
      releaseRoot,
      [
        "scripts/loop-discover.mjs",
        "--message",
        [
          "Verify with browser.",
          "수입/지출 기록 -> 거래를 추가하면 목록과 월별 합계가 바뀐다.",
          "카테고리 관리 -> 카테고리를 만들고 거래에 지정할 수 있다.",
          "월별 통계 -> 월별 수입/지출/잔액이 표시된다."
        ].join("\n"),
        "--json"
      ],
      releaseEnv
    );
    assert.equal(
      fourthDiscovery.code,
      0,
      `release fourth discovery failed.\nSTDOUT:\n${fourthDiscovery.stdout}\nSTDERR:\n${fourthDiscovery.stderr}`
    );
    assertNoBuildAttempt(fourthDiscovery, "release fourth discovery");
    const readyDiscovery = parseJsonStdout(fourthDiscovery, "release fourth discovery");
    assert.equal(readyDiscovery.status, "ready_for_prepare");
    assert.equal(readyDiscovery.intake.product_title, "가계부 앱");
    assert.equal(readyDiscovery.intake.target_root, "./apps/가계부-앱");

    const frontDoorSessionPath = resolveReleasePath(
      releaseRoot,
      readyDiscovery.front_door_session_path
    );
    const prepareResult = await runReleaseNode(
      releaseRoot,
      [
        "scripts/loop-prepare.mjs",
        "--front-door-session",
        frontDoorSessionPath,
        "--json"
      ],
      releaseEnv
    );
    assert.equal(
      prepareResult.code,
      0,
      `release prepare failed.\nSTDOUT:\n${prepareResult.stdout}\nSTDERR:\n${prepareResult.stderr}`
    );
    assertNoBuildAttempt(prepareResult, "release prepare");
    const prepared = parseJsonStdout(prepareResult, "release prepare");
    const preparedRunDirectory = resolveReleasePath(releaseRoot, prepared.run_directory);
    assert.ok(
      existsSync(resolveReleasePath(releaseRoot, prepared.adapter_plan_path)),
      "release prepare did not expose adapter_plan_path"
    );
    assert.ok(
      existsSync(resolveReleasePath(releaseRoot, prepared.adapter_review_task_path)),
      "release prepare did not expose adapter_review_task_path"
    );

    const readyMarker = await readJsonFile(
      join(releaseRoot, "evals", "runs", "ready-to-start-session.json")
    );
    assert.equal(readyMarker.run_directory, preparedRunDirectory);
    assert.equal(readyMarker.binding_state, "unbound");
    assert.equal(readyMarker.thread_id, undefined);

    const startEnv = {
      ...releaseEnv,
      CODEX_THREAD_ID: "release-product-start-thread",
      HARNESS_LAUNCH_ORIGIN: "codex-app-thread",
      HARNESS_THREAD_BINDING_STATE: "bound",
      HARNESS_SURFACE_OWNER: "stock-codex-thread",
      HARNESS_ENTRYPOINT: "skill",
      HARNESS_APP_VISIBILITY: "visible-in-stock-app"
    };
    const startResult = await runReleaseNode(
      releaseRoot,
      [
        "scripts/loop-runner.mjs",
        "--single",
        "--controller-mode",
        "attached",
        "--transport",
        "current-thread",
        "--json"
      ],
      startEnv
    );
    assert.equal(
      startResult.code,
      0,
      `release loop start failed.\nSTDOUT:\n${startResult.stdout}\nSTDERR:\n${startResult.stderr}`
    );
    assertNoBuildAttempt(startResult, "release loop start");
    const startedRunDirectory = extractRunDirectory(releaseRoot, startResult.stdout);
    assert.equal(startedRunDirectory, preparedRunDirectory);

    const sessionStatus = await readJsonFile(
      join(startedRunDirectory, "runtime", "session-status.json")
    );
    assert.equal(sessionStatus.session_binding.binding_state, "bound");
    assert.equal(
      sessionStatus.session_binding.thread_id,
      "release-product-start-thread"
    );

    const plan = await readJsonFile(join(startedRunDirectory, "plan.json"));
    assert.equal(plan.plan_kind, "product_build");
    assert.equal(plan.product_title, "가계부 앱");
    assert.match(plan.north_star, /가계부 앱/);
    assert.doesNotMatch(
      plan.north_star,
      /generic harness mechanics/i,
      JSON.stringify(plan, null, 2)
    );

    const attachedPromptPath = join(
      startedRunDirectory,
      "round-001",
      "runtime",
      "attached-generator-prompt.md"
    );
    const roundContractPath = join(
      startedRunDirectory,
      "round-001",
      "round-contract.json"
    );

    for (
      let hop = 0;
      hop < 8 && (!existsSync(attachedPromptPath) || !existsSync(roundContractPath));
      hop += 1
    ) {
      const summary = await readJsonFile(join(startedRunDirectory, "summary.json"));
      assert.match(
        summary.stop_reason ?? "",
        /awaiting_codex_checkpoint|awaiting_current_thread_handoff/
      );
      const operatorSurface = await readJsonFile(summary.operator_surface_path);
      assert.ok(
        typeof operatorSurface.active_response_path === "string",
        JSON.stringify(operatorSurface, null, 2)
      );
      await writeFile(
        operatorSurface.active_response_path,
        `${JSON.stringify({ checkpoint_id: operatorSurface.checkpoint_id }, null, 2)}\n`,
        "utf8"
      );

      const resumeResult = await runReleaseNode(
        releaseRoot,
        [
          "scripts/loop-runner.mjs",
          "--resume-run",
          startedRunDirectory,
          "--controller-mode",
          "attached",
          "--transport",
          "current-thread",
          "--single"
        ],
        startEnv
      );
      assert.equal(
        resumeResult.code,
        0,
        `release loop resume failed.\nSTDOUT:\n${resumeResult.stdout}\nSTDERR:\n${resumeResult.stderr}`
      );
      assertNoBuildAttempt(resumeResult, "release loop resume");
    }

    assert.ok(existsSync(roundContractPath), "release start did not write round-contract.json");
    const roundContract = await readJsonFile(roundContractPath);
    assert.equal(roundContract.schema_version, "2026-05-08");
    assert.equal(roundContract.artifact_type, "round_contract");
    assert.match(roundContract.run_id, /^run-/);
    assert.equal(roundContract.producer, "loop-orchestrator");
    assert.equal(typeof roundContract.created_at, "string");
    assert.match(roundContract.objective, /가계부 앱|runtime\/build-brief\.json/);
    assert.doesNotMatch(
      roundContract.objective,
      /Build against the planner spec/i,
      JSON.stringify(roundContract, null, 2)
    );
    assert.ok(existsSync(attachedPromptPath), "release start did not write attached generator prompt");
    const attachedPrompt = await readFile(attachedPromptPath, "utf8");
    assert.match(attachedPrompt, /가계부 앱/);
    assert.match(attachedPrompt, /수입\/지출 기록/);
    assert.match(attachedPrompt, /Required release-gate selectors/);
    assert.match(attachedPrompt, /\[data-testid='feature-1-action'\]/);
    assert.doesNotMatch(attachedPrompt, /planner_context_surface_reserved/);
    assert.doesNotMatch(attachedPrompt, /packages\/loop-orchestrator\/src/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

await main();
console.log("validate:release-product-start passed");
