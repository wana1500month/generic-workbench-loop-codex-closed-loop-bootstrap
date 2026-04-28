import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseRoot = join(repoRoot, ".tmp", "release");
const stageRoot = join(releaseRoot, "generic-codex-workbench");
const zipPath = join(releaseRoot, "generic-codex-workbench.zip");
const requiredPackageFiles = [
  "scripts/validate-release-product-start.mjs"
];
const commandTimeoutMs = Number.parseInt(
  process.env.HARNESS_RELEASE_COMMAND_TIMEOUT_MS ?? "300000",
  10
);

const logStep = (message) => {
  process.stderr.write(`[release:zip] ${message}\n`);
};

const runCommand = async (command, args, options = {}) =>
  new Promise((resolvePromise) => {
    const timeoutMs = options.timeoutMs ?? commandTimeoutMs;
    let timedOut = false;
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      shell: options.shell ?? false,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timer =
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            stderr += `\nCommand timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}\n`;
            child.kill();
          }, timeoutMs)
        : undefined;
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (timer) {
        clearTimeout(timer);
      }
      resolvePromise({ code: 1, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (code) => {
      if (timer) {
        clearTimeout(timer);
      }
      resolvePromise({ code: timedOut ? 1 : code ?? 1, stdout, stderr });
    });
  });

const ignoredPackagePath = (relativePath) =>
  relativePath === ".git" ||
  relativePath.startsWith(".git/") ||
  relativePath === "node_modules" ||
  relativePath.startsWith("node_modules/") ||
  relativePath === ".tmp" ||
  relativePath.startsWith(".tmp/") ||
  relativePath === "VALIDATION_STATUS.md" ||
  relativePath.startsWith("evals/runs/");

const walkFiles = async (root, prefix = "") => {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (ignoredPackagePath(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, relativePath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
};

const trackedFiles = async () => {
  logStep("Collecting package file list.");
  const result = await runCommand("git", ["ls-files", "-z"]);
  if (result.code === 0 && result.stdout.trim().length > 0) {
    const files = result.stdout.split("\0").filter(Boolean);
    logStep(`Using git tracked file list (${files.length} files).`);
    return files;
  }

  const files = await walkFiles(repoRoot);
  logStep(`git ls-files unavailable; using filesystem walk (${files.length} files).`);
  return files;
};

const shouldPackageTrackedFile = (relativePath) =>
  !ignoredPackagePath(relativePath);

const copyPath = async (source, destination) => {
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, {
    recursive: true,
    force: true,
    preserveTimestamps: true
  });
};

const assertExists = async (path, message) => {
  try {
    await access(path, constants.F_OK);
  } catch {
    throw new Error(message);
  }
};

const createZip = async () => {
  const zipResult = await runCommand("zip", ["-qr", zipPath, "."], {
    cwd: stageRoot,
    shell: process.platform === "win32",
    timeoutMs: commandTimeoutMs
  });
  if (zipResult.code === 0) {
    return;
  }

  if (process.platform === "win32") {
    const psResult = await runCommand(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Compress-Archive -Path * -DestinationPath $env:HARNESS_RELEASE_ZIP -Force"
      ],
      {
        cwd: stageRoot,
        env: { ...process.env, HARNESS_RELEASE_ZIP: zipPath },
        shell: false,
        timeoutMs: commandTimeoutMs
      }
    );
    if (psResult.code === 0) {
      return;
    }
    throw new Error(
      `Failed to create release zip.\nzip stderr:\n${zipResult.stderr}\nPowerShell stderr:\n${psResult.stderr}`
    );
  }

  throw new Error(`zip command failed:\n${zipResult.stderr}`);
};

const main = async () => {
  const distRoot = join(repoRoot, "packages", "loop-orchestrator", "dist");
  logStep("Checking compiled dist.");
  await assertExists(
    join(distRoot, "intent-gate-cli.js"),
    "packages/loop-orchestrator/dist is missing. Run npm run build before packaging."
  );

  logStep("Preparing release stage.");
  await rm(stageRoot, { recursive: true, force: true });
  await rm(zipPath, { force: true });
  await mkdir(stageRoot, { recursive: true });

  const files = await trackedFiles();
  logStep(`Copying package files into stage (${files.length} candidates).`);
  for (const relativePath of files) {
    if (!shouldPackageTrackedFile(relativePath)) {
      continue;
    }
    await copyPath(join(repoRoot, relativePath), join(stageRoot, relativePath));
  }
  logStep("Copying required release-only files.");
  for (const relativePath of requiredPackageFiles) {
    await assertExists(
      join(repoRoot, relativePath),
      `required release file is missing: ${relativePath}`
    );
    await copyPath(join(repoRoot, relativePath), join(stageRoot, relativePath));
  }

  logStep("Copying compiled loop-orchestrator dist.");
  await copyPath(distRoot, join(stageRoot, "packages", "loop-orchestrator", "dist"));
  await chmod(join(stageRoot, "init.sh"), 0o755);
  logStep("Creating release ZIP.");
  await createZip();

  logStep(`Release ZIP ready: ${zipPath}`);
  process.stdout.write(
    [
      "",
      "INSTALL THIS ZIP IN CODEX APP:",
      zipPath,
      "",
      "DO NOT INSTALL A SOURCE ZIP.",
      ""
    ].join("\n")
  );
};

await main();
