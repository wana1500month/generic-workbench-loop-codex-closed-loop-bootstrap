import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const delegateScript = resolve(
  repoRoot,
  ".agents/skills/harness-closeout/scripts/summarize-run.mjs"
);

const child = spawn(process.execPath, [delegateScript, ...process.argv.slice(2)], {
  cwd: repoRoot,
  env: process.env,
  stdio: "inherit"
});

child.on("error", (error) => {
  console.error("Closeout summary failed.");
  console.error(error);
  process.exitCode = 1;
});

child.on("close", (code) => {
  process.exitCode = code ?? 1;
});
