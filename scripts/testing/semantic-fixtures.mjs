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

export const cleanSemanticValidationRuntimeState = async () => {
  await stopSemanticTargetServers();
  if (!(await pathExists(runtimeFixtureRoot))) {
    return [];
  }
  const runtimeDirectories = await walkDirectories(
    runtimeFixtureRoot,
    (name) => name === "target-state" || name === ".reference-state"
  );
  await Promise.all(
    runtimeDirectories.map((path) => rm(path, { recursive: true, force: true }))
  );
  return runtimeDirectories;
};

export const ensureSemanticValidationFixtures = async ({ clean = false } = {}) => {
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

  await mkdir(runtimeFixtureRoot, { recursive: true });
  await cp(sourceFixtureRoot, runtimeFixtureRoot, {
    recursive: true,
    force: true
  });

  if (clean) {
    await cleanSemanticValidationRuntimeState();
  }

  return runtimeFixtureRoot;
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await ensureSemanticValidationFixtures({
    clean: process.argv.includes("--clean")
  });
  console.log(
    `[semantic-fixtures] ready: ${runtimeFixtureRoot} from ${sourceFixtureRoot}`
  );
}
