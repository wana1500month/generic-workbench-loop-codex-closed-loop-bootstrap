import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { stopProcessTree } from "./process-tree.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const commandTimeoutMs = Number.parseInt(
  process.env.HARNESS_SOURCE_REPRO_COMMAND_TIMEOUT_MS ?? "900000",
  10
);

const runCommand = async (command, args, options = {}) =>
  new Promise((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      shell: options.shell ?? false,
      windowsHide: true
    });
    const timer =
      commandTimeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            void stopProcessTree(child.pid ?? -1);
          }, commandTimeoutMs)
        : undefined;

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (options.silent !== true) {
        process.stdout.write(text);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (options.silent !== true) {
        process.stderr.write(text);
      }
    });
    child.on("error", (error) => {
      if (timer) {
        clearTimeout(timer);
      }
      resolvePromise({
        code: 1,
        stdout,
        stderr: `${stderr}${error.message}`
      });
    });
    child.on("close", (code) => {
      if (timer) {
        clearTimeout(timer);
      }
      resolvePromise({
        code: timedOut ? 124 : code ?? 1,
        stdout,
        stderr: timedOut
          ? `${stderr}\nCommand timed out after ${commandTimeoutMs}ms: ${command} ${args.join(" ")}\n`
          : stderr
      });
    });
  });

const npmCandidates = () => {
  const candidates = [];
  const addCliPath = (cliPath) => {
    if (cliPath && existsSync(cliPath)) {
      candidates.push({
        command: process.execPath,
        prefixArgs: [cliPath],
        shell: false
      });
    }
  };

  addCliPath(process.env.HARNESS_NPM_CLI);
  addCliPath(process.env.npm_execpath);
  if (process.platform === "win32") {
    addCliPath(join("C:\\", "Program Files", "nodejs", "node_modules", "npm", "bin", "npm-cli.js"));
  }
  candidates.push({
    command: "npm",
    prefixArgs: [],
    shell: process.platform === "win32"
  });
  return candidates;
};

const npmMajorVersion = (stdout) => {
  const match = stdout.trim().match(/^(\d+)\./);
  return match ? Number.parseInt(match[1], 10) : 0;
};

let cachedNpmInvocation;

const npmInvocation = async (args) => {
  if (cachedNpmInvocation) {
    return {
      ...cachedNpmInvocation,
      args: [...cachedNpmInvocation.prefixArgs, ...args]
    };
  }

  const rejected = [];
  for (const candidate of npmCandidates()) {
    const versionResult = await runCommand(
      candidate.command,
      [...candidate.prefixArgs, "--version"],
      {
        cwd: repoRoot,
        shell: candidate.shell,
        silent: true
      }
    );
    const major = versionResult.code === 0 ? npmMajorVersion(versionResult.stdout) : 0;
    if (major >= 7) {
      cachedNpmInvocation = candidate;
      return {
        ...candidate,
        args: [...candidate.prefixArgs, ...args]
      };
    }
    rejected.push(
      `${candidate.command} ${candidate.prefixArgs.join(" ")} -> ${versionResult.stdout.trim() || versionResult.stderr.trim() || `exit ${versionResult.code}`}`
    );
  }

  throw new Error(
    [
      "Could not find an npm executable new enough for source archive reproduction.",
      "`npm ci` requires npm 5.7+; this validator requires npm 7+.",
      `Rejected candidates: ${rejected.join("; ")}`
    ].join(" ")
  );
};

const runNpm = async (cwd, args, options = {}) => {
  const invocation = await npmInvocation(args);
  const label = `npm ${args.join(" ")}`;
  process.stderr.write(`[source-archive-repro] ${label}\n`);
  const result = await runCommand(invocation.command, invocation.args, {
    cwd,
    env: options.env ?? process.env,
    shell: invocation.shell
  });
  if (result.code !== 0) {
    throw new Error(`${label} failed with ${result.code}.\n${result.stdout}\n${result.stderr}`);
  }
};

const normalizePath = (path) => path.replaceAll("\\", "/");

const exportIgnorePatterns = async () => {
  const attributesPath = join(repoRoot, ".gitattributes");
  if (!existsSync(attributesPath)) {
    return [];
  }
  const lines = (await readFile(attributesPath, "utf8")).split(/\r?\n/);
  return lines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && /\bexport-ignore\b/.test(line))
    .map((line) => line.split(/\s+/)[0])
    .filter(Boolean);
};

const patternMatches = (pattern, relativePath) => {
  const normalizedPattern = normalizePath(pattern).replace(/^\/+/, "");
  const directoryPattern = normalizedPattern.endsWith("/");
  const base = directoryPattern ? normalizedPattern.slice(0, -1) : normalizedPattern;
  if (!base) {
    return false;
  }
  if (directoryPattern) {
    return relativePath === base || relativePath.startsWith(`${base}/`);
  }
  return relativePath === base || relativePath.startsWith(`${base}/`);
};

const explicitIgnore = (relativePath) =>
  relativePath === ".git" ||
  relativePath.startsWith(".git/") ||
  relativePath === "node_modules" ||
  relativePath.startsWith("node_modules/") ||
  relativePath.endsWith(".tsbuildinfo");

const shouldInclude = (relativePath, patterns) =>
  !explicitIgnore(relativePath) &&
  !patterns.some((pattern) => patternMatches(pattern, relativePath));

const walkFiles = async (root, prefix = "") => {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (explicitIgnore(relativePath)) {
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

const candidateFiles = async () => {
  const result = await runCommand(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { silent: true }
  );
  if (result.code === 0 && result.stdout.trim()) {
    return result.stdout.split("\0").filter(Boolean).map(normalizePath);
  }
  return walkFiles(repoRoot);
};

const copySourceArchiveCandidate = async (destinationRoot) => {
  const patterns = await exportIgnorePatterns();
  const files = (await candidateFiles())
    .map(normalizePath)
    .filter((path) => shouldInclude(path, patterns))
    .sort();

  for (const relativePath of files) {
    const source = join(repoRoot, relativePath);
    if (!existsSync(source) || !(await stat(source)).isFile()) {
      continue;
    }
    const destination = join(destinationRoot, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { force: true });
  }

  return files;
};

const hashDirectory = async (root) => {
  const files = (await walkFiles(root)).sort();
  const hash = createHash("sha256");
  for (const relativePath of files) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await readFile(join(root, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex").toUpperCase();
};

const assertPath = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

const removeTreeBestEffort = async (path) => {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (error?.code !== "EBUSY" && error?.code !== "EPERM") {
        throw error;
      }
      await sleep(250 * (attempt + 1));
    }
  }
  if (lastError) {
    process.stderr.write(
      `[source-archive-repro] warning: could not remove ${path}: ${lastError.message}\n`
    );
  }
};

const main = async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "codex-source-archive-repro-"));
  const sourceRoot = join(tempRoot, "generic-workbench-loop-codex-closed-loop-bootstrap");
  try {
    await mkdir(sourceRoot, { recursive: true });
    const files = await copySourceArchiveCandidate(sourceRoot);
    const sourceHash = await hashDirectory(sourceRoot);
    process.stderr.write(
      `[source-archive-repro] staged ${files.length} files, sha256=${sourceHash}\n`
    );

    assertPath(
      existsSync(join(sourceRoot, "SOURCE_ARCHIVE_NOT_CODEX_APP_INSTALL.md")),
      "source archive marker is missing"
    );
    assertPath(
      existsSync(
        join(
          sourceRoot,
          "scripts",
          "testing",
          "fixtures",
          "semantic-validation",
          "patch-only-success",
          "adapter.json"
        )
      ),
      "semantic validation source fixtures are missing from source archive candidate"
    );
    assertPath(
      !existsSync(join(sourceRoot, ".tmp", "semantic-validation")),
      "source archive candidate must not include .tmp/semantic-validation"
    );
    assertPath(
      !existsSync(join(sourceRoot, "packages", "loop-orchestrator", "dist")),
      "source archive candidate must not include compiled dist"
    );
    assertPath(
      !files.some((file) => file.endsWith(".tsbuildinfo")),
      "source archive candidate must not include TypeScript incremental build metadata"
    );
    assertPath(
      !existsSync(join(sourceRoot, "CODEX_APP_INSTALL.md")),
      "source archive candidate must not include install ZIP marker"
    );

    await runNpm(sourceRoot, ["ci"]);
    await runNpm(sourceRoot, ["run", "build"], {
      env: {
        ...process.env,
        HARNESS_FORCE_TYPESCRIPT_BUILD: "1"
      }
    });
    await runNpm(sourceRoot, ["test"]);
    await runNpm(sourceRoot, ["run", "validate:smoke-clean"]);
    await runNpm(sourceRoot, ["run", "validate:release"]);

    process.stdout.write(
      `[validate-source-archive-repro] complete sha256=${sourceHash}\n`
    );
  } finally {
    if (process.env.HARNESS_KEEP_SOURCE_ARCHIVE_REPRO !== "1") {
      await removeTreeBestEffort(tempRoot);
    } else {
      process.stderr.write(`[source-archive-repro] kept ${tempRoot}\n`);
    }
  }
};

main().catch((error) => {
  console.error("Source archive reproducibility validation failed.");
  console.error(error);
  process.exitCode = 1;
});
