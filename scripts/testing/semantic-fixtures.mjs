import { access, cp, mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { stopSemanticTargetServers } from "../semantic-target-processes.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sourceFixtureRoot = join(
  repoRoot,
  "scripts",
  "testing",
  "fixtures",
  "semantic-validation"
);
const runtimeFixtureRoot = join(repoRoot, ".tmp", "semantic-validation");

const requiredFixturePaths = [
  "adapter.cjs",
  "executor.cjs",
  "verifier.cjs",
  "target-server.cjs",
  "cli-success/adapter.json",
  "patch-only-success/adapter.json",
  "patch-recontract/adapter.json",
  "contradictory/adapter.json",
  "verification-profile-cli.json",
  "verification-profile-api-only.json"
];

const pathExists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const walkDirectories = async (root, predicate) => {
  const matches = [];
  const visit = async (directory) => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const path = join(directory, entry.name);
      if (predicate(entry.name, path)) {
        matches.push(path);
        continue;
      }
      await visit(path);
    }
  };
  await visit(root);
  return matches;
};

const removeRuntimeRoot = async (root) => {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (error?.code !== "EBUSY" && error?.code !== "EPERM") {
        throw error;
      }
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, 250 * (attempt + 1))
      );
    }
  }
  if (lastError) {
    throw lastError;
  }
};

export const cleanSemanticValidationRuntimeState = async ({
  runtimeRoot = runtimeFixtureRoot
} = {}) => {
  await stopSemanticTargetServers();
  if (!(await pathExists(runtimeRoot))) {
    return [];
  }
  const runtimeDirectories = await walkDirectories(
    runtimeRoot,
    (name) => name === "target-state" || name === ".reference-state"
  );
  await Promise.all(
    runtimeDirectories.map((path) => rm(path, { recursive: true, force: true }))
  );
  return runtimeDirectories;
};

export const ensureSemanticValidationFixtures = async ({
  clean = false,
  runtimeRoot = runtimeFixtureRoot
} = {}) => {
  const missing = [];
  for (const relativePath of requiredFixturePaths) {
    const absolutePath = join(sourceFixtureRoot, relativePath);
    if (!(await pathExists(absolutePath))) {
      missing.push(relativePath);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      [
        "Semantic validation source fixtures are missing from the checkout.",
        `Expected tracked fixtures under ${sourceFixtureRoot}.`,
        `Missing: ${missing.join(", ")}`
      ].join(" ")
    );
  }

  if (clean) {
    if (resolve(runtimeRoot) === resolve(runtimeFixtureRoot)) {
      await stopSemanticTargetServers();
    }
    await removeRuntimeRoot(runtimeRoot);
  }

  await mkdir(runtimeRoot, { recursive: true });
  await cp(sourceFixtureRoot, runtimeRoot, {
    recursive: true,
    force: true
  });

  return runtimeRoot;
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await ensureSemanticValidationFixtures({
    clean: process.argv.includes("--clean")
  });
  console.log(
    `[semantic-fixtures] ready: ${runtimeFixtureRoot} from ${sourceFixtureRoot}`
  );
}
