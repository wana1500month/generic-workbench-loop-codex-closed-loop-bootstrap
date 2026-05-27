import { spawn } from "node:child_process";

import { stopProcessTree } from "./process-tree.mjs";
import {
  listSemanticTargetServers,
  repoRoot,
  stopSemanticTargetServers
} from "./semantic-target-processes.mjs";
import {
  cleanSemanticValidationRuntimeState,
  ensureSemanticValidationFixtures
} from "./testing/semantic-fixtures.mjs";

const timeoutMs = () => {
  const parsed = Number(process.env.HARNESS_SEMANTIC_CLEANUP_TIMEOUT_MS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 900000;
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

const runNpmScript = async (scriptName) =>
  new Promise((resolvePromise, rejectPromise) => {
    const invocation = npmInvocationFor(scriptName);
    const child = spawn(invocation.command, invocation.args, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: invocation.shell,
      detached: process.platform !== "win32",
      windowsHide: true,
      env: process.env
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void stopProcessTree(child.pid ?? -1);
    }, timeoutMs());
    child.on("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise(timedOut ? 124 : code ?? 1);
    });
  });

const assertNoSemanticTargetServers = async (label) => {
  const processes = await listSemanticTargetServers();
  if (processes.length === 0) {
    return;
  }
  const details = processes
    .map((processInfo) => `${processInfo.pid}: ${processInfo.commandLine}`)
    .join("\n");
  throw new Error(
    `Expected no semantic target-server.cjs processes ${label}, found:\n${details}`
  );
};

const validations = [
  "validate:quality-lift",
  "validate:productization",
  "validate:smoke-clean"
];

await ensureSemanticValidationFixtures({ clean: true });
const staleProcesses = await stopSemanticTargetServers();
if (staleProcesses.length > 0) {
  console.log(
    `[validate-semantic-target-server-cleanup] stopped stale target servers: ${staleProcesses
      .map((processInfo) => processInfo.pid)
      .join(", ")}`
  );
}
await cleanSemanticValidationRuntimeState();
await assertNoSemanticTargetServers("before cleanup validation");

for (const scriptName of validations) {
  console.log(`[validate-semantic-target-server-cleanup] running ${scriptName}`);
  const code = await runNpmScript(scriptName);
  if (code !== 0) {
    throw new Error(`${scriptName} failed with exit code ${code}`);
  }
  await assertNoSemanticTargetServers(`after ${scriptName}`);
}

console.log("[validate-semantic-target-server-cleanup] complete");
