import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmExecutable = "npm";
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

const runCommand = async (command, args, options = {}) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      shell: options.shell ?? false
    });

    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise(code ?? 1);
    });
  });

const runBuild = async () => {
  const primaryExitCode = await runCommand(npmExecutable, ["run", "build", "--silent"], {
    shell: process.platform === "win32"
  });
  if (primaryExitCode === 0) {
    return 0;
  }

  // Retry with the pinned compiler when the host TypeScript binary exits abnormally.
  return runCommand(
    "npx",
    ["-p", "typescript@5.8.3", "tsc", "-b", "--force", "--pretty", "false"],
    { shell: process.platform === "win32" }
  );
};

const rawArgs = process.argv.slice(2);
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
  ...(maxRounds !== undefined ? ["--max-rounds", String(maxRounds)] : []),
  ...(targetScore !== undefined ? ["--target-score", String(targetScore)] : []),
  ...passthroughArgs,
  ...positionalArgs
];

const buildExitCode = await runBuild();
if (buildExitCode !== 0) {
  process.exitCode = buildExitCode;
} else {
  const cliExitCode = await runCommand(process.execPath, [
    "--input-type=module",
    "--eval",
    runnerCliImport,
    "--",
    ...normalizedCliArgs
  ]);
  process.exitCode = cliExitCode;
}
