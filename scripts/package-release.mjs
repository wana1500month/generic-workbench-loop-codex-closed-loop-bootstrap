import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseRoot = join(repoRoot, ".tmp", "release");
const stageRoot = join(releaseRoot, "generic-codex-workbench");
const zipPath = join(releaseRoot, "generic-codex-workbench.zip");

const runCommand = async (command, args, options = {}) =>
  new Promise((resolvePromise) => {
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
    child.on("error", (error) => {
      resolvePromise({ code: 1, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });

const ignoredPackagePath = (relativePath) =>
  relativePath === ".git" ||
  relativePath.startsWith(".git/") ||
  relativePath === "node_modules" ||
  relativePath.startsWith("node_modules/") ||
  relativePath === ".tmp" ||
  relativePath.startsWith(".tmp/") ||
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
  const result = await runCommand("git", ["ls-files", "-z"]);
  if (result.code === 0 && result.stdout.trim().length > 0) {
    return result.stdout.split("\0").filter(Boolean);
  }

  return walkFiles(repoRoot);
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
    shell: process.platform === "win32"
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
        shell: false
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
  await assertExists(
    join(distRoot, "intent-gate-cli.js"),
    "packages/loop-orchestrator/dist is missing. Run npm run build before packaging."
  );

  await rm(stageRoot, { recursive: true, force: true });
  await rm(zipPath, { force: true });
  await mkdir(stageRoot, { recursive: true });

  for (const relativePath of await trackedFiles()) {
    if (!shouldPackageTrackedFile(relativePath)) {
      continue;
    }
    await copyPath(join(repoRoot, relativePath), join(stageRoot, relativePath));
  }

  await copyPath(distRoot, join(stageRoot, "packages", "loop-orchestrator", "dist"));
  await chmod(join(stageRoot, "init.sh"), 0o755);
  await createZip();

  process.stdout.write(`${zipPath}\n`);
};

await main();
