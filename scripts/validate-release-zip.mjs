import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const runCommand = async (command, args, options = {}) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      shell: options.shell ?? false,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });

const copyPath = async (source, destination) => {
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, {
    recursive: true,
    force: true,
    preserveTimestamps: true
  });
};

const requiredReleasePaths = [
  "package.json",
  "package-lock.json",
  "scripts/loop-intent.mjs",
  "scripts/loop-discover.mjs",
  "scripts/lib/front-door-build.mjs",
  "packages/loop-orchestrator/dist",
  ".agents",
  ".codex",
  ".codex-plugin"
];

const main = async () => {
  const distIntent = join(
    repoRoot,
    "packages",
    "loop-orchestrator",
    "dist",
    "intent-gate-cli.js"
  );
  const distDiscover = join(
    repoRoot,
    "packages",
    "loop-orchestrator",
    "dist",
    "front-door-session-cli.js"
  );

  assert.ok(existsSync(distIntent), "packages/loop-orchestrator/dist is missing.");
  assert.ok(existsSync(distDiscover), "front-door session dist CLI is missing.");

  await mkdir(join(repoRoot, ".tmp"), { recursive: true });
  const tempRoot = await mkdtemp(join(repoRoot, ".tmp", "release-zip-"));
  const releaseRoot = join(tempRoot, "release-root");

  try {
    for (const relativePath of requiredReleasePaths) {
      const source = join(repoRoot, relativePath);
      if (existsSync(source)) {
        await copyPath(source, join(releaseRoot, relativePath));
      }
    }

    await mkdir(join(releaseRoot, ".tmp"), { recursive: true });
    await writeFile(join(releaseRoot, ".tmp", ".gitkeep"), "", "utf8");

    const intentResult = await runCommand(
      process.execPath,
      ["scripts/loop-intent.mjs", "--json", "가계부 앱 만들어줘"],
      {
        cwd: releaseRoot,
        env: {
          ...process.env,
          npm_config_ignore_scripts: "true"
        },
        shell: false
      }
    );
    assert.equal(
      intentResult.code,
      0,
      `release loop-intent failed.\nSTDOUT:\n${intentResult.stdout}\nSTDERR:\n${intentResult.stderr}`
    );
    assert.doesNotMatch(
      intentResult.stderr,
      /Missing packages\/loop-orchestrator\/dist|TypeScript is not installed/i
    );
    const intentJson = JSON.parse(intentResult.stdout);
    assert.equal(intentJson.intent, "product_build");

    const sessionsDirectory = join(tempRoot, "sessions");
    const discoverResult = await runCommand(
      process.execPath,
      [
        "scripts/loop-discover.mjs",
        "--thread-id",
        "release-ko-budget",
        "--message",
        "가계부 앱 만들어줘",
        "--json"
      ],
      {
        cwd: releaseRoot,
        env: {
          ...process.env,
          HARNESS_FRONT_DOOR_SESSIONS_DIRECTORY: sessionsDirectory,
          npm_config_ignore_scripts: "true"
        },
        shell: false
      }
    );
    assert.equal(
      discoverResult.code,
      0,
      `release loop-discover failed.\nSTDOUT:\n${discoverResult.stdout}\nSTDERR:\n${discoverResult.stderr}`
    );
    assert.doesNotMatch(
      discoverResult.stderr,
      /Missing packages\/loop-orchestrator\/dist|TypeScript is not installed/i
    );
    const discoverJson = JSON.parse(discoverResult.stdout);
    assert.equal(discoverJson.status, "ask_product_questions");
    assert.equal(discoverJson.intake.product_title, "가계부 앱");

    const packageJson = JSON.parse(
      await readFile(join(releaseRoot, "package.json"), "utf8")
    );
    assert.ok(packageJson.scripts["loop:intent"]);
    assert.ok(packageJson.scripts["loop:discover"]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

await main();
console.log("validate:release-zip passed");
