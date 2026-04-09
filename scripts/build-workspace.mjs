import { spawn } from "node:child_process";

const runCommand = async (command, args, options = {}) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
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

const main = async () => {
  const primaryExitCode = await runCommand(
    "npx",
    ["tsc", "-b", "--pretty", "false"],
    { shell: process.platform === "win32" }
  );

  if (primaryExitCode === 0) {
    return;
  }

  const fallbackExitCode = await runCommand(
    "npx",
    ["-p", "typescript@5.8.3", "tsc", "-b", "--force", "--pretty", "false"],
    { shell: process.platform === "win32" }
  );

  process.exitCode = fallbackExitCode;
};

await main();
