import { join } from "node:path";

import type { BootstrapArtifactPaths } from "../bootstrap.js";

export const createBootstrapArtifactPaths = (
  rootDirectory: string
): BootstrapArtifactPaths => {
  const generatedAdapterRoot = join(rootDirectory, ".generated", "codex-adapter");
  return {
    rootDirectory,
    ideaPath: join(rootDirectory, "IDEA.md"),
    intakePath: join(rootDirectory, "intake.json"),
    featureListPath: join(rootDirectory, "feature_list.generated.json"),
    progressPath: join(rootDirectory, "progress.md"),
    progressLogPath: join(rootDirectory, "progress.jsonl"),
    doneWhenPath: join(rootDirectory, "done_when.md"),
    initScriptPath: join(rootDirectory, "init.sh"),
    adapterPath: join(rootDirectory, "adapter.generated.json"),
    generatedRubricPath: join(rootDirectory, "rubric.generated.json"),
    generatedVerificationProfilePath: join(
      rootDirectory,
      "verification-profile.generated.json"
    ),
    generatedAdapterRoot,
    generatedScriptsRoot: join(generatedAdapterRoot, "scripts"),
    generatedRuntimeConfigPath: join(generatedAdapterRoot, "runtime-config.json"),
    generatedAdapterRelativePath: "./.generated/codex-adapter"
  };
};
