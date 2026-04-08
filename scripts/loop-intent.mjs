import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmExecutable = "npm";
const intentCliImport =
  "process.argv=[process.argv[0],'./packages/loop-orchestrator/dist/intent-gate-cli.js',...process.argv.slice(1)]; await import('./packages/loop-orchestrator/dist/intent-gate-cli.js')";

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

const buildExitCode = await runCommand(npmExecutable, ["run", "build", "--silent"], {
  shell: process.platform === "win32"
});

if (buildExitCode !== 0) {
  process.exitCode = buildExitCode;
} else {
  const cliExitCode = await runCommand(process.execPath, [
    "--input-type=module",
    "--eval",
    intentCliImport,
    "--",
    ...process.argv.slice(2)
  ]);
  process.exitCode = cliExitCode;
}
