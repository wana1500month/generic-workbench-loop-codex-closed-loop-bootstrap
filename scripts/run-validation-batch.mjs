import { spawn } from "node:child_process";

import { stopProcessTree } from "./process-tree.mjs";

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
  "product-front-door": [
    "validate:intent-gate",
    "validate:intake-gate",
    "validate:front-door-session",
    "validate:release-zip",
    "validate:cli-front-door",
    "validate:loop-prepare",
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
  ]
};

const suiteName = process.argv[2] ?? "core";
const suite = suites[suiteName];

if (!suite) {
  console.error(`Unknown suite: ${suiteName}`);
  process.exit(1);
}

const runScript = async (scriptName) =>
  new Promise((resolvePromise, rejectPromise) => {
    const timeoutMs = validationTimeoutMs();
    let timedOut = false;
    const invocation = npmInvocationFor(scriptName);
    const child = spawn(invocation.command, invocation.args, {
      stdio: "inherit",
      shell: invocation.shell,
      detached: process.platform !== "win32",
      windowsHide: true
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

for (const scriptName of suite) {
  const code = await runScript(scriptName);
  if (code !== 0) {
    process.exit(code);
  }
}
