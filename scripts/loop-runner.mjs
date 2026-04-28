import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  latestModifiedTimeMs,
  prepareFrontDoorDist,
  runCommand,
  runPinnedTypeScriptBuild
} from "./lib/front-door-build.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmExecutable = "npm";
const cliDistDirectory = resolve(repoRoot, "packages", "loop-orchestrator", "dist");
const cliEntryPath = resolve(cliDistDirectory, "cli.js");
const readOnlyCliWatchPaths = [
  resolve(repoRoot, "packages", "loop-orchestrator", "src"),
  resolve(repoRoot, "packages", "loop-orchestrator", "tsconfig.json"),
  resolve(repoRoot, "tsconfig.json")
];
const runnerCliImport =
  "process.argv=[process.argv[0],'./packages/loop-orchestrator/dist/cli.js',...process.argv.slice(1)]; await import('./packages/loop-orchestrator/dist/cli.js')";

const parsePositiveNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const parseTargetScore = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : undefined;
};

const classifyJsonConfigPath = (value) => {
  if (typeof value !== "string" || !value.toLowerCase().endsWith(".json")) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(resolve(repoRoot, value), "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      if (
        "rubric_id" in parsed ||
        "target_total_score" in parsed ||
        "required_artifacts" in parsed
      ) {
        return "rubric";
      }

      if ("profile_id" in parsed || "criteria" in parsed || "core_probes" in parsed) {
        return "evaluator-profile";
      }
    }
  } catch {}

  return undefined;
};

const readNpmConfigValue = (keys, options = {}) => {
  for (const key of keys) {
    const value = process.env[`npm_config_${key}`];
    if (typeof value === "string" && value.trim().length > 0) {
      const trimmedValue = value.trim();
      if (!options.allowBooleanMarkers && (trimmedValue === "true" || trimmedValue === "false")) {
        continue;
      }
      return trimmedValue;
    }
  }

  return undefined;
};

const runBuild = async () => {
  const primaryExitCode = await runCommand(
    repoRoot,
    npmExecutable,
    ["run", "build", "--silent"],
    { shell: process.platform === "win32" }
  );
  if (primaryExitCode === 0) {
    return 0;
  }

  // Retry with the pinned compiler when the host TypeScript binary exits abnormally.
  // Keep the fallback pinned so init/build/recovery all share the same compiler version.
  return runPinnedTypeScriptBuild(repoRoot, ["--force"]);
};

const readOnlyFrontDoorNeedsBuild = () => {
  if (!existsSync(cliEntryPath)) {
    return true;
  }

  const distMtimeMs = latestModifiedTimeMs(cliEntryPath);
  const latestWatchMtimeMs = readOnlyCliWatchPaths.reduce(
    (latest, targetPath) => Math.max(latest, latestModifiedTimeMs(targetPath)),
    0
  );
  return latestWatchMtimeMs > distMtimeMs;
};

const shouldForceBuild = () =>
  process.env.HARNESS_FORCE_BUILD === "1" ||
  process.env.HARNESS_DEV_REBUILD === "1";

const prepareRuntimeDist = async () =>
  shouldForceBuild()
    ? runBuild()
    : prepareFrontDoorDist(repoRoot, cliEntryPath, readOnlyCliWatchPaths);

const rawArgs = process.argv.slice(2);
const readOnlyCliFrontDoorCommands = new Set([
  "help",
  "--help",
  "-h",
  "status"
]);
const mutatingCliFrontDoorCommands = new Set(["resume", "phase"]);
if (rawArgs.includes("--supervised")) {
  const delegatedArgs = rawArgs.filter((value) => value !== "--supervised");
  const exitCode = await runCommand(
    repoRoot,
    process.execPath,
    ["./scripts/loop-supervisor.mjs", ...delegatedArgs],
    { shell: false }
  );
  process.exitCode = exitCode;
  process.exit();
}
if (
  rawArgs.length > 0 &&
  (readOnlyCliFrontDoorCommands.has(rawArgs[0]) ||
    mutatingCliFrontDoorCommands.has(rawArgs[0]))
) {
  const buildExitCode =
    readOnlyCliFrontDoorCommands.has(rawArgs[0]) && !readOnlyFrontDoorNeedsBuild()
      ? 0
      : await prepareRuntimeDist();
  if (buildExitCode !== 0) {
    process.exitCode = buildExitCode;
  } else {
    const cliExitCode = await runCommand(repoRoot, process.execPath, [
      "--input-type=module",
      "--eval",
      runnerCliImport,
      "--",
      ...rawArgs
    ]);
    process.exitCode = cliExitCode;
  }
  process.exit();
}
let modeSingle = false;
let adapterPath = readNpmConfigValue(["adapter"]);
let rubricPath = readNpmConfigValue(["rubric"]);
let evaluatorProfilePath = readNpmConfigValue(["evaluator_profile", "evaluatorprofile"]);
let targetFamily = readNpmConfigValue(["target_family", "targetfamily"]);
let resumeRunPath = readNpmConfigValue(["resume_run", "resumerun"]);
let allowResumeMigration = readNpmConfigValue(
  ["allow_resume_migration", "allowresumemigration"],
  { allowBooleanMarkers: true }
) === "true";
let forceReopenTerminal = readNpmConfigValue(
  ["force_reopen_terminal", "forcereopenterminal"],
  { allowBooleanMarkers: true }
) === "true";
let controllerMode = readNpmConfigValue(["controller_mode", "controllermode"]);
let transportMode = readNpmConfigValue(["transport"]);
let repairOnly = readNpmConfigValue(["repair"], { allowBooleanMarkers: true }) === "true";
let resumePhase = readNpmConfigValue(["resume_phase", "resumephase"]);
let maxRounds = parsePositiveNumber(
  readNpmConfigValue(["max_rounds", "maxrounds", "max_iterations", "maxiterations"])
);
let targetScore = parseTargetScore(readNpmConfigValue(["target_score", "targetscore"]));

const passthroughArgs = [];
const positionalArgs = [];

for (let index = 0; index < rawArgs.length; index += 1) {
  const value = rawArgs[index];

  if (value === "--single") {
    modeSingle = true;
    continue;
  }

  if (value === "--adapter") {
    adapterPath = rawArgs[index + 1] ?? adapterPath;
    index += 1;
    continue;
  }

  if (value === "--rubric") {
    rubricPath = rawArgs[index + 1] ?? rubricPath;
    index += 1;
    continue;
  }

  if (value === "--evaluator-profile") {
    evaluatorProfilePath = rawArgs[index + 1] ?? evaluatorProfilePath;
    index += 1;
    continue;
  }

  if (value === "--target-family") {
    targetFamily = rawArgs[index + 1] ?? targetFamily;
    index += 1;
    continue;
  }

  if (value === "--resume-run") {
    resumeRunPath = rawArgs[index + 1] ?? resumeRunPath;
    index += 1;
    continue;
  }

  if (value === "--allow-resume-migration") {
    allowResumeMigration = true;
    continue;
  }

  if (value === "--force-reopen-terminal") {
    forceReopenTerminal = true;
    continue;
  }

  if (value === "--controller-mode") {
    controllerMode = rawArgs[index + 1] ?? controllerMode;
    index += 1;
    continue;
  }

  if (value === "--transport") {
    transportMode = rawArgs[index + 1] ?? transportMode;
    index += 1;
    continue;
  }

  if (value === "--repair") {
    repairOnly = true;
    continue;
  }

  if (value === "--resume-phase") {
    resumePhase = rawArgs[index + 1] ?? resumePhase;
    index += 1;
    continue;
  }

  if (value === "--max-rounds" || value === "--max-iterations") {
    maxRounds = parsePositiveNumber(rawArgs[index + 1]) ?? maxRounds;
    index += 1;
    continue;
  }

  if (value === "--target-score") {
    targetScore = parseTargetScore(rawArgs[index + 1]) ?? targetScore;
    index += 1;
    continue;
  }

  if (value.startsWith("--")) {
    passthroughArgs.push(value);
    const nextValue = rawArgs[index + 1];
    if (nextValue && !nextValue.startsWith("--")) {
      passthroughArgs.push(nextValue);
      index += 1;
    }
    continue;
  }

  positionalArgs.push(value);
}

const consumeMirroredPositional = (expectedValue, parser = (value) => value) => {
  if (expectedValue === undefined || positionalArgs.length === 0) {
    return;
  }

  const parsed = parser(positionalArgs[0]);
  if (parsed !== undefined && parsed === expectedValue) {
    positionalArgs.shift();
  }
};

consumeMirroredPositional(adapterPath);
consumeMirroredPositional(rubricPath);
consumeMirroredPositional(evaluatorProfilePath);
consumeMirroredPositional(targetFamily);
consumeMirroredPositional(resumeRunPath);
consumeMirroredPositional(maxRounds, parsePositiveNumber);
consumeMirroredPositional(targetScore, parseTargetScore);

if (!adapterPath && positionalArgs[0] && !Number.isFinite(Number(positionalArgs[0]))) {
  adapterPath = positionalArgs.shift();
}

while (positionalArgs[0] && !Number.isFinite(Number(positionalArgs[0]))) {
  const candidate = positionalArgs[0];
  const classification = classifyJsonConfigPath(candidate);

  if (classification === "rubric" && !rubricPath) {
    rubricPath = positionalArgs.shift();
    continue;
  }

  if (classification === "evaluator-profile" && !evaluatorProfilePath) {
    evaluatorProfilePath = positionalArgs.shift();
    continue;
  }

  if (!rubricPath) {
    rubricPath = positionalArgs.shift();
    continue;
  }

  if (!evaluatorProfilePath) {
    evaluatorProfilePath = positionalArgs.shift();
    continue;
  }

  break;
}

if (maxRounds === undefined) {
  const parsedMaxRounds = parsePositiveNumber(positionalArgs[0]);
  if (parsedMaxRounds !== undefined) {
    maxRounds = parsedMaxRounds;
    positionalArgs.shift();
  }
}

if (targetScore === undefined) {
  const parsedTargetScore = parseTargetScore(positionalArgs[0]);
  if (parsedTargetScore !== undefined) {
    targetScore = parsedTargetScore;
    positionalArgs.shift();
  }
}

const normalizedCliArgs = [
  ...(modeSingle ? ["--single"] : []),
  ...(adapterPath ? ["--adapter", adapterPath] : []),
  ...(rubricPath ? ["--rubric", rubricPath] : []),
  ...(evaluatorProfilePath ? ["--evaluator-profile", evaluatorProfilePath] : []),
  ...(targetFamily ? ["--target-family", targetFamily] : []),
  ...(resumeRunPath ? ["--resume-run", resumeRunPath] : []),
  ...(allowResumeMigration ? ["--allow-resume-migration"] : []),
  ...(forceReopenTerminal ? ["--force-reopen-terminal"] : []),
  ...(controllerMode ? ["--controller-mode", controllerMode] : []),
  ...(transportMode ? ["--transport", transportMode] : []),
  ...(repairOnly ? ["--repair"] : []),
  ...(resumePhase ? ["--resume-phase", resumePhase] : []),
  ...(maxRounds !== undefined ? ["--max-rounds", String(maxRounds)] : []),
  ...(targetScore !== undefined ? ["--target-score", String(targetScore)] : []),
  ...passthroughArgs,
  ...positionalArgs
];

const buildExitCode = await prepareRuntimeDist();
if (buildExitCode !== 0) {
  process.exitCode = buildExitCode;
} else {
  const cliExitCode = await runCommand(repoRoot, process.execPath, [
    "--input-type=module",
    "--eval",
    runnerCliImport,
    "--",
    ...normalizedCliArgs
  ]);
  process.exitCode = cliExitCode;
}
