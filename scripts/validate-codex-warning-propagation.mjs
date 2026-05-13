import { mkdir, readdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runsDirectory = join(repoRoot, "evals", "runs");

const listRunDirectories = async () => {
  await mkdir(runsDirectory, { recursive: true });
  return (await readdir(runsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^run-\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
};

const runCommand = async (command, args, env = process.env) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env,
      shell: process.platform === "win32"
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });

const main = async () => {
  const before = await listRunDirectories();
  const execution = await runCommand("npm", ["run", "loop:single"], {
    ...process.env,
    HARNESS_DISABLE_CODEX_AGENTS: "1"
  });

  const after = await listRunDirectories();
  const createdRunFromOutput = /Run created:\s+evals[\\/]+runs[\\/]+(run-\d+)/i.exec(
    execution.stdout
  )?.[1];
  const createdRun =
    createdRunFromOutput && after.includes(createdRunFromOutput)
      ? createdRunFromOutput
      : after.find((entry) => !before.includes(entry)) ?? after[after.length - 1];
  if (!createdRun) {
    if (execution.code !== 0) {
      throw new Error("loop:single failed while validating Codex warning propagation.");
    }
    throw new Error("Could not determine which run directory was created.");
  }

  const summaryPath = join(runsDirectory, createdRun, "summary.json");
  const summary = JSON.parse(await readFile(summaryPath, "utf8"));
  const warnings = Array.isArray(summary.runtime_warnings) ? summary.runtime_warnings : [];
  const hasCodexWarning = warnings.some(
    (warning) =>
      typeof warning === "string" && warning.startsWith("Codex ")
  );

  if (!hasCodexWarning) {
    throw new Error(
      `Expected runtime_warnings in ${summaryPath} to include a Codex fallback warning, but got: ${JSON.stringify(warnings)}`
    );
  }

  console.log(`Validated Codex warning propagation in ${createdRun}.`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
