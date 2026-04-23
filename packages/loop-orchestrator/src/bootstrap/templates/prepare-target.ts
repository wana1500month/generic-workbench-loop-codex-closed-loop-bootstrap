export const prepareTargetTemplate = (): string => `import { mkdir } from "node:fs/promises";

import { finalize, readConfig, runtimePaths, writeArtifact } from "./runtime-helpers.mjs";

const main = async () => {
  const config = await readConfig();
  await mkdir(runtimePaths.targetRoot, { recursive: true });
  const notePath = await writeArtifact(
    "prepare-target.md",
    [
      "# Prepare Target",
      "",
      "Target root: " + runtimePaths.targetRoot,
      "Project mode: " + config.project_mode,
      "Framework hint: " + config.framework_hint
    ].join("\\n")
  );

  await finalize({
    capability: "prepare_target",
    ok: true,
    summary: "Prepared target root at " + runtimePaths.targetRoot + ".",
    findings: [],
    evidence_paths: [notePath]
  });
};

main().catch(async (error) => {
  await finalize({
    capability: "prepare_target",
    ok: false,
    summary: "prepare_target failed.",
    findings: [error instanceof Error ? error.message : String(error)],
    evidence_paths: []
  });
  process.exitCode = 1;
});
`;

