import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const cliArgs = process.argv.slice(2);

export const parseGitHubRepository = (remoteUrl) => {
  const normalized = remoteUrl.trim();
  const sshMatch = normalized.match(/^git@github\.com:(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return sshMatch[1];
  }
  const httpsMatch = normalized.match(
    /^https?:\/\/github\.com\/(.+?)(?:\.git)?$/
  );
  if (httpsMatch) {
    return httpsMatch[1];
  }
  return undefined;
};

export const valueFromGit = (args) => {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return undefined;
  }
};

const valueForFlag = (args, flag, fallback) => {
  const index = args.findIndex((value) => value === flag);
  return index >= 0 ? args[index + 1] : fallback;
};

export const installReferenceAdapterCi = async (input) => {
  const outputDirectory = resolve(input.outputDirectory);
  const adapterPath = input.adapterPath ?? "adapter.json";
  const targetFamily = input.targetFamily ?? "";
  const evaluatorProfile = input.evaluatorProfile ?? "";
  const derivedHarnessRepo = parseGitHubRepository(
    valueFromGit(["config", "--get", "remote.origin.url"]) ?? ""
  );
  const derivedHarnessRef = valueFromGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  const harnessRepo = input.harnessRepo ?? derivedHarnessRepo;
  const harnessRef =
    input.harnessRef ??
    (derivedHarnessRef && derivedHarnessRef !== "HEAD" ? derivedHarnessRef : "main");
  const workflowName =
    input.workflowName ?? "harness-reference-adapter.yml";

  if (!targetFamily && !evaluatorProfile) {
    throw new Error(
      "Provide either targetFamily or evaluatorProfile so the installed workflow can run strict validation."
    );
  }

  if (!harnessRepo) {
    throw new Error(
      "Could not derive the harness GitHub repository from the current git remote. Re-run with harnessRepo."
    );
  }

  const workflowPath = resolve(
    outputDirectory,
    ".github",
    "workflows",
    workflowName
  );
  await mkdir(dirname(workflowPath), { recursive: true });

  const envLines = [
    `          REFERENCE_ADAPTER_CONTRACT: \${{ github.workspace }}/${adapterPath.replace(/\\/g, "/")}`
  ];
  if (targetFamily) {
    envLines.push(`          REFERENCE_TARGET_FAMILY: ${targetFamily}`);
  }
  if (evaluatorProfile) {
    envLines.push(
      `          REFERENCE_EVALUATOR_PROFILE: \${{ github.workspace }}/${evaluatorProfile.replace(/\\/g, "/")}`
    );
  }

  const workflow = `name: Harness Reference Adapter

on:
  workflow_dispatch:
  pull_request:
  push:
    branches:
      - main

jobs:
  harness-reference-adapter:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/checkout@v4
        with:
          repository: ${harnessRepo}
          ref: ${harnessRef}
          path: harness

      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
          cache-dependency-path: harness/package-lock.json

      - name: Install harness dependencies
        working-directory: harness
        run: npm ci

      - name: Build harness
        working-directory: harness
        run: npm run build

      - name: Preflight reference adapter wiring
        working-directory: harness
        env:
${envLines.join("\n")}
        run: npm run validate:reference-adapter:check

      - name: Strict reference adapter validation
        working-directory: harness
        env:
${envLines.join("\n")}
        run: npm run validate:reference-adapter

      - name: Upload harness run artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: harness-reference-adapter-runs
          path: harness/evals/runs/**
`;

  await writeFile(workflowPath, workflow, "utf8");
  return {
    workflowPath,
    harnessRepo,
    harnessRef,
    adapterPath,
    targetFamily,
    evaluatorProfile,
    workflowName
  };
};

const isCli =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const outputDirectory = cliArgs.find((value) => !value.startsWith("--"));
  if (!outputDirectory) {
    console.error(
      "Usage: node ./scripts/install-reference-adapter-ci.mjs <companion-repo-dir> [--adapter adapter.json] [--target-family api-service] [--evaluator-profile path] [--harness-repo owner/repo] [--harness-ref main]"
    );
    process.exit(1);
  }

  try {
    const result = await installReferenceAdapterCi({
      outputDirectory,
      adapterPath: valueForFlag(cliArgs, "--adapter", "adapter.json"),
      targetFamily: valueForFlag(cliArgs, "--target-family", ""),
      evaluatorProfile: valueForFlag(cliArgs, "--evaluator-profile", ""),
      harnessRepo: valueForFlag(cliArgs, "--harness-repo", undefined),
      harnessRef: valueForFlag(cliArgs, "--harness-ref", undefined),
      workflowName: valueForFlag(
        cliArgs,
        "--workflow-name",
        "harness-reference-adapter.yml"
      )
    });
    console.log(
      `[reference-adapter:install-ci] wrote workflow to ${result.workflowPath}`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
