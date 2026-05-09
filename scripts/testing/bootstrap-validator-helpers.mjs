import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export const runCommand = async (command, args, options = {}) =>
  new Promise((resolvePromise, rejectPromise) => {
    const commandText = String(command).toLowerCase();
    const defaultShell =
      process.platform === "win32" &&
      (commandText === "npm" ||
        commandText.endsWith(".cmd") ||
        commandText.endsWith(".bat"));
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      shell: options.shell ?? defaultShell,
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

export const ensureBuild = async () => {
  const result = await runCommand(process.execPath, [
    "./scripts/build-workspace.mjs"
  ]);
  if (result.code !== 0) {
    throw new Error(`build failed:\n${result.stdout}\n${result.stderr}`);
  }
};

export const createTempRoot = async (name) => {
  const baseDirectory = join(repoRoot, ".tmp");
  await mkdir(baseDirectory, { recursive: true });
  return mkdtemp(join(baseDirectory, `${name}-`));
};

export const cleanupTempRoot = async (path) => {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (error?.code !== "EBUSY" && error?.code !== "EPERM") {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  if (lastError) {
    throw lastError;
  }
};

export const createFakeCodexBin = async (tempRoot) => {
  const binDirectory = join(tempRoot, "fake-bin");
  await mkdir(binDirectory, { recursive: true });
  const fakeCodexPath = join(repoRoot, "scripts", "testing", "fake-codex.mjs");
  const wrapperPath = join(binDirectory, "codex.cmd");
  await writeFile(
    wrapperPath,
    `@echo off\r\nnode "${fakeCodexPath}" %*\r\n`,
    "utf8"
  );
  return binDirectory;
};

export const importDist = async (modulePath) =>
  import(new URL(`../../packages/loop-orchestrator/dist/${modulePath}`, import.meta.url));

export const writeJsonFile = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
};

export const readJsonFile = async (path) =>
  JSON.parse(await readFile(path, "utf8"));

export const createBootstrapFixture = async (tempRoot, answerOverrides = {}) => {
  const workspaceRoot = join(tempRoot, "workspace");
  const targetRoot = join(tempRoot, "target-app");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(targetRoot, { recursive: true });

  const { createBootstrapArtifactPaths, scaffoldBootstrapArtifacts } =
    await importDist("bootstrap.js");

  const paths = createBootstrapArtifactPaths(workspaceRoot);
  const answers = {
    title: "Validator App",
    summary: "A fixture app for validating the bootstrap-generated adapter.",
    targetUsers: ["tester"],
    coreFeatures: ["basic flow"],
    referenceApps: [],
    finishLine: "basic flow works end to end",
    targetFamily: "browser-app",
    goalLevel: "usable",
    targetScore: 0.9,
    maxRounds: 2,
    targetRoot,
    projectMode: "new",
    frameworkHint: "Vite + React",
    packageManager: "npm",
    runCommand: "npm run dev",
    checkCommand: "npm test",
    readyUrl: "http://127.0.0.1:3000/",
    appUrl: "http://127.0.0.1:3000/",
    verificationSurfaces: ["browser"],
    workflowChecks: [],
    constraints: [],
    qualityBar: ["basic flow works end to end"],
    notes: "validator fixture",
    ...answerOverrides
  };
  if ("appUrl" in answerOverrides && answerOverrides.appUrl === undefined) {
    delete answers.appUrl;
  }
  if ("healthUrl" in answerOverrides && answerOverrides.healthUrl === undefined) {
    delete answers.healthUrl;
  }
  if ("apiBaseUrl" in answerOverrides && answerOverrides.apiBaseUrl === undefined) {
    delete answers.apiBaseUrl;
  }

  await scaffoldBootstrapArtifacts(answers, paths);

  const runDirectory = join(tempRoot, "run");
  const roundDirectory = join(runDirectory, "round-001");
  const adapterDirectory = join(roundDirectory, "adapter");
  const runtimeDirectory = join(runDirectory, "runtime");
  await mkdir(adapterDirectory, { recursive: true });
  await mkdir(runtimeDirectory, { recursive: true });

  const inputPath = join(adapterDirectory, "apply_change-input.json");
  const outputPath = join(adapterDirectory, "apply_change-result.json");
  await writeFile(inputPath, JSON.stringify({ round: 1 }, null, 2) + "\n", "utf8");

  return {
    paths,
    workspaceRoot,
    targetRoot,
    runDirectory,
    roundDirectory,
    adapterDirectory,
    runtimeDirectory,
    inputPath,
    outputPath,
    applyChangeScriptPath: join(paths.generatedScriptsRoot, "apply-change.mjs"),
    runChecksScriptPath: join(paths.generatedScriptsRoot, "run-checks.mjs"),
    gradeRoundScriptPath: join(paths.generatedScriptsRoot, "grade-round.mjs"),
    sessionRegistryPath: join(runtimeDirectory, "codex-sessions.json")
  };
};

export const applyChangeEnv = (fixture, envOverrides = {}) => ({
  ...process.env,
  HARNESS_ROUND_DIRECTORY: fixture.roundDirectory,
  HARNESS_RUN_DIRECTORY: fixture.runDirectory,
  HARNESS_RUNTIME_DIRECTORY: fixture.runtimeDirectory,
  HARNESS_CODEX_SESSION_REGISTRY_PATH: fixture.sessionRegistryPath,
  HARNESS_INPUT_PATH: fixture.inputPath,
  HARNESS_OUTPUT_PATH: fixture.outputPath,
  HARNESS_TARGET_ROOT: fixture.targetRoot,
  ...envOverrides
});
