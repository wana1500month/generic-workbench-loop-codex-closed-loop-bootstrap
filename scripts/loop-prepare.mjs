import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { needsBuild, runCommand } from "./lib/front-door-build.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distEntryPath = resolve(
  repoRoot,
  "packages",
  "loop-orchestrator",
  "dist",
  "prepare-session-cli.js"
);
const watchPaths = [
  resolve(repoRoot, "packages", "loop-orchestrator", "src"),
  resolve(repoRoot, "packages", "loop-orchestrator", "tsconfig.json"),
  resolve(repoRoot, "tsconfig.json"),
  resolve(repoRoot, "package.json")
];
const prepareCliImport =
  "process.argv=[process.argv[0],'./packages/loop-orchestrator/dist/prepare-session-cli.js',...process.argv.slice(1)]; await import('./packages/loop-orchestrator/dist/prepare-session-cli.js')";
const exitAfterFlush = (code) => {
  process.exitCode = code;
  setImmediate(() => process.exit(code));
};
const buildExitCode = needsBuild(distEntryPath, watchPaths)
  ? await runCommand(repoRoot, "npm", ["run", "build", "--silent"], {
      shell: process.platform === "win32"
    })
  : 0;

if (buildExitCode !== 0) {
  exitAfterFlush(buildExitCode);
} else {
  const cliExitCode = await runCommand(repoRoot, process.execPath, [
    "--input-type=module",
    "--eval",
    prepareCliImport,
    "--",
    ...process.argv.slice(2)
  ]);
  exitAfterFlush(cliExitCode);
}
