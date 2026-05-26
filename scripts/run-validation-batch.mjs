import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { stopProcessTree } from "./process-tree.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const validationTimeoutMs = () => {
  const parsed = Number(process.env.HARNESS_VALIDATION_TIMEOUT_MS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 300000;
};

const npmInvocationFor = (scriptName) => {
  if (process.env.npm_execpath) {
    return {
      command: process.execPath,
      args: [process.env.npm_execpath, "run", scriptName, "--silent"],
      shell: false
    };
  }

  return {
    command: "npm",
    args: ["run", scriptName, "--silent"],
    shell: process.platform === "win32"
  };
};

const suites = {
  fast: [
    "validate:intent-gate",
    "validate:intake-gate",
    "validate:front-door-session",
    "validate:transport-mode",
    "validate:security-guards",
    "validate:score-policy",
    "validate:readiness-doctor",
    "validate:evaluation-policy",
    "validate:strictness-policy",
    "validate:scorecard-output",
    "validate:loop-scorecards",
    "validate:default-scorecard-policy",
    "validate:adaptive-intake",
    "validate:non-web-target",
    "validate:non-web-front-door-adapter-plan",
    "validate:cli-front-door-product-detection",
    "validate:fast-exits",
    "validate:loop-prepare",
    "validate:loop-continue",
    "validate:durable-memory"
  ],
  process: [
    "validate:codex-timeout",
    "validate:supervisor-timeout-prevention"
  ],
  app: [
    "validate:intent-gate",
    "validate:intake-gate",
    "validate:front-door-session",
    "validate:transport-mode",
    "validate:generated-verification-contract",
    "validate:generated-adapter-run-local",
    "validate:prepared-session-consumption-boundary"
  ],
  "product-front-door": [
    "validate:intent-gate",
    "validate:intake-gate",
    "validate:front-door-session",
    "validate:generated-verification-contract",
    "validate:release-zip",
    "validate:cli-front-door",
    "validate:cli-front-door-product-detection",
    "validate:non-web-front-door-adapter-plan",
    "validate:loop-prepare",
    "validate:generated-adapter-run-local",
    "validate:prepared-session-consumption-boundary"
  ],
  core: [
    "validate:intent-gate",
    "validate:intake-gate",
    "validate:front-door-session",
    "validate:lifecycle-api",
    "validate:transport-mode",
    "validate:security-guards",
    "validate:score-policy",
    "validate:quality-lift",
    "validate:loop-prepare",
    "validate:prepared-session-consumption-boundary",
    "validate:canonical-foreground-worker",
    "validate:loop-continue",
    "validate:no-foreground-handoff-language",
    "validate:durable-memory",
    "validate:baseline-validity"
  ],
  smoke: [
    "validate:intent-gate",
    "validate:intake-gate",
    "validate:resume-smoke",
    "validate:attached-resume-smoke"
  ],
  external: [
    "validate:reference-adapter:check",
    "smoke:reference-adapter"
  ],
  "external-adapter": [
    "validate:reference-adapter:check",
    "smoke:reference-adapter"
  ],
  productization: [
    "validate:readiness-doctor",
    "validate:evaluation-policy",
    "validate:strictness-policy",
    "validate:scorecard-output",
    "validate:loop-scorecards",
    "validate:scorecard-e2e-prepared-run",
    "validate:default-scorecard-policy",
    "validate:adaptive-intake",
    "validate:non-web-target",
    "validate:non-web-front-door-adapter-plan",
    "validate:cli-front-door-product-detection",
    "validate:fast-exits",
    "validate:non-web-e2e"
  ]
};

const suiteName = process.argv[2] ?? "core";
const suite = suites[suiteName];
const stateIsolatedSuites = new Set(["app", "core", "fast", "product-front-door", "smoke"]);
let batchEnv = process.env;

if (!suite) {
  console.error(`Unknown suite: ${suiteName}`);
  process.exit(1);
}

const createBatchEnvironment = async () => {
  const env = { ...process.env };
  if (
    !stateIsolatedSuites.has(suiteName) ||
    (env.HARNESS_RUNS_DIRECTORY && env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY)
  ) {
    return { env };
  }

  await mkdir(join(repoRoot, ".tmp"), { recursive: true });
  const tempRoot = await mkdtemp(
    join(repoRoot, ".tmp", `validation-batch-${suiteName}-`)
  );
  env.HARNESS_RUNS_DIRECTORY ??= join(tempRoot, "runs");
  env.HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY ??= join(
    tempRoot,
    "front-door-sessions"
  );
  return { env, tempRoot };
};

const runScript = async (scriptName) =>
  new Promise((resolvePromise, rejectPromise) => {
    const timeoutMs = validationTimeoutMs();
    let timedOut = false;
    const invocation = npmInvocationFor(scriptName);
    const child = spawn(invocation.command, invocation.args, {
      stdio: "inherit",
      shell: invocation.shell,
      detached: process.platform !== "win32",
      windowsHide: true,
      env: batchEnv
    });
    const timer = setTimeout(() => {
      timedOut = true;
      void stopProcessTree(child.pid ?? -1);
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        console.error(
          `Validation script '${scriptName}' timed out after ${timeoutMs} ms.`
        );
        resolvePromise(124);
        return;
      }
      resolvePromise(code ?? 1);
    });
  });

const { env, tempRoot } = await createBatchEnvironment();
batchEnv = env;

try {
  for (const scriptName of suite) {
    const code = await runScript(scriptName);
    if (code !== 0) {
      process.exitCode = code;
      break;
    }
  }
} finally {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}
