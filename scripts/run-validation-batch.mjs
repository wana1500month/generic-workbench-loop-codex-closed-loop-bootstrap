import { spawn } from "node:child_process";

const suites = {
  "product-front-door": [
    "validate:intent-gate",
    "validate:intake-gate",
    "validate:cli-front-door",
    "validate:loop-prepare"
  ],
  core: [
    "validate:intent-gate",
    "validate:intake-gate",
    "validate:lifecycle-api",
    "validate:transport-mode",
    "validate:score-policy",
    "validate:loop-prepare",
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
    const child = spawn("npm", ["run", scriptName, "--silent"], {
      stdio: "inherit",
      shell: process.platform === "win32",
      windowsHide: true
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise(code ?? 1);
    });
  });

for (const scriptName of suite) {
  const code = await runScript(scriptName);
  if (code !== 0) {
    process.exit(code);
  }
}
