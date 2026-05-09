import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const zipArgIndex = args.indexOf("--zip");
const zipEqualsArg = args.find((arg) => arg.startsWith("--zip="));
const positionalZipArg = args.find(
  (arg) => !arg.startsWith("-") && /\.zip$/i.test(arg)
);
const zipPath =
  zipArgIndex >= 0 && args[zipArgIndex + 1]
    ? resolve(repoRoot, args[zipArgIndex + 1])
    : zipEqualsArg
      ? resolve(repoRoot, zipEqualsArg.slice("--zip=".length))
      : positionalZipArg
        ? resolve(repoRoot, positionalZipArg)
    : undefined;

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

const extractZip = async (sourceZip, destination) => {
  await mkdir(destination, { recursive: true });
  if (process.platform === "win32") {
    const result = await runCommand(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Expand-Archive -Path $env:HARNESS_RELEASE_ZIP -DestinationPath $env:HARNESS_RELEASE_ROOT -Force"
      ],
      {
        env: {
          ...process.env,
          HARNESS_RELEASE_ZIP: sourceZip,
          HARNESS_RELEASE_ROOT: destination
        },
        shell: false
      }
    );
    assert.equal(
      result.code,
      0,
      `release zip extraction failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
    );
    return;
  }

  const unzipResult = await runCommand("unzip", ["-q", sourceZip, "-d", destination]);
  assert.equal(
    unzipResult.code,
    0,
    `release zip extraction failed.\nSTDOUT:\n${unzipResult.stdout}\nSTDERR:\n${unzipResult.stderr}`
  );
};

const requiredReleasePaths = [
  "package.json",
  "package-lock.json",
  "scripts/loop-intent.mjs",
  "scripts/loop-discover.mjs",
  "scripts/loop-intake.mjs",
  "scripts/loop-prepare.mjs",
  "scripts/loop-runner.mjs",
  "scripts/lib/front-door-build.mjs",
  "scripts/package-release.mjs",
  "scripts/validate-release-product-start.mjs",
  "init.sh",
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

  if (!zipPath) {
    assert.ok(existsSync(distIntent), "packages/loop-orchestrator/dist is missing.");
    assert.ok(existsSync(distDiscover), "front-door session dist CLI is missing.");
  }

  await mkdir(join(repoRoot, ".tmp"), { recursive: true });
  const tempRoot = await mkdtemp(join(repoRoot, ".tmp", "release-zip-"));
  let releaseRoot = join(tempRoot, "release-root");

  try {
    if (zipPath) {
      assert.ok(existsSync(zipPath), `release zip not found: ${zipPath}`);
      await extractZip(zipPath, releaseRoot);
      const nestedRoot = join(releaseRoot, "generic-codex-workbench");
      if (existsSync(join(nestedRoot, "package.json"))) {
        releaseRoot = nestedRoot;
      }
    } else {
      for (const relativePath of requiredReleasePaths) {
        const source = join(repoRoot, relativePath);
        if (existsSync(source)) {
          await copyPath(source, join(releaseRoot, relativePath));
        }
      }
      await chmod(join(releaseRoot, "init.sh"), 0o755).catch(() => undefined);
    }

    assert.ok(
      existsSync(join(releaseRoot, "packages", "loop-orchestrator", "dist", "intent-gate-cli.js")),
      "release image is missing packages/loop-orchestrator/dist/intent-gate-cli.js"
    );
    assert.ok(
      existsSync(join(releaseRoot, "packages", "loop-orchestrator", "dist", "front-door-session-cli.js")),
      "release image is missing packages/loop-orchestrator/dist/front-door-session-cli.js"
    );
    assert.ok(
      existsSync(join(releaseRoot, "packages", "loop-orchestrator", "dist", "bootstrap", "generated-adapter.js")),
      "release image is missing packages/loop-orchestrator/dist/bootstrap/generated-adapter.js"
    );
    assert.ok(
      existsSync(join(releaseRoot, "scripts", "validate-release-product-start.mjs")),
      "release image is missing scripts/validate-release-product-start.mjs"
    );
    assert.ok(
      !existsSync(join(releaseRoot, "node_modules")),
      "release image must not include node_modules"
    );
    assert.ok(
      !existsSync(join(releaseRoot, ".tmp")),
      "release image must not include .tmp"
    );
    assert.ok(
      !existsSync(join(releaseRoot, "packages", "loop-orchestrator", "tsconfig.tsbuildinfo")),
      "release image must not include TypeScript incremental build metadata"
    );
    assert.ok(
      !existsSync(join(releaseRoot, "evals", "runs")),
      "release image must not include run state"
    );
    assert.ok(
      !existsSync(join(releaseRoot, "evals", "front-door-sessions")),
      "release image must not include front-door session state"
    );
    if (zipPath) {
      assert.ok(
        existsSync(join(releaseRoot, "CODEX_APP_INSTALL.md")),
        "release image is missing CODEX_APP_INSTALL.md"
      );
      assert.ok(
        existsSync(join(releaseRoot, "release-manifest.json")),
        "release image is missing release-manifest.json"
      );
      assert.ok(
        !existsSync(join(releaseRoot, "SOURCE_ARCHIVE_NOT_CODEX_APP_INSTALL.md")),
        "release image must not include source-archive marker"
      );
      const releaseManifest = JSON.parse(
        await readFile(join(releaseRoot, "release-manifest.json"), "utf8")
      );
      assert.equal(releaseManifest.artifact_type, "codex_app_install_zip");
      assert.equal(releaseManifest.includes_dist, true);
      assert.equal(releaseManifest.source_archive, false);
    }
    if (process.platform !== "win32") {
      const initStats = await stat(join(releaseRoot, "init.sh"));
      assert.ok(initStats.mode & 0o111, "release init.sh must be executable");
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

    const startHelpResult = await runCommand(
      process.execPath,
      ["scripts/loop-runner.mjs", "--help"],
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
      startHelpResult.code,
      0,
      `release loop-runner help failed.\nSTDOUT:\n${startHelpResult.stdout}\nSTDERR:\n${startHelpResult.stderr}`
    );
    assert.doesNotMatch(
      startHelpResult.stderr,
      /TypeScript is not installed|npm ci|npx -p typescript|npm run build/i
    );

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
