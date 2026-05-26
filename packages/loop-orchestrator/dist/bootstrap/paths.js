import { join } from "node:path";
export const createBootstrapArtifactPaths = (input) => {
    const rootDirectory = typeof input === "string" ? input : input.rootDirectory;
    const runDirectory = typeof input === "string" ? undefined : input.runDirectory;
    const generatedRoot = runDirectory
        ? join(runDirectory, "generated-adapter")
        : rootDirectory;
    const generatedAdapterRoot = runDirectory
        ? join(generatedRoot, "codex-adapter")
        : join(rootDirectory, ".generated", "codex-adapter");
    return {
        rootDirectory,
        ideaPath: join(rootDirectory, "IDEA.md"),
        intakePath: join(rootDirectory, "intake.json"),
        featureListPath: join(rootDirectory, "feature_list.generated.json"),
        progressPath: join(rootDirectory, "progress.md"),
        progressLogPath: join(rootDirectory, "progress.jsonl"),
        doneWhenPath: join(rootDirectory, "done_when.md"),
        initScriptPath: join(rootDirectory, "init.sh"),
        adapterPath: join(generatedRoot, "adapter.generated.json"),
        adapterPlanPath: join(generatedRoot, "adapter-plan.generated.json"),
        adapterPlanMarkdownPath: join(generatedRoot, "adapter-plan.generated.md"),
        adapterReviewTaskPath: join(generatedAdapterRoot, "adapter-review-task.md"),
        adapterReviewResponsePath: join(generatedAdapterRoot, "adapter-review-response.json"),
        generatedRubricPath: join(generatedRoot, "rubric.generated.json"),
        generatedVerificationProfilePath: join(generatedRoot, "verification-profile.generated.json"),
        generatedAdapterRoot,
        generatedScriptsRoot: join(generatedAdapterRoot, "scripts"),
        generatedRuntimeConfigPath: join(generatedAdapterRoot, "runtime-config.json"),
        generatedAdapterRelativePath: runDirectory
            ? "./codex-adapter"
            : "./.generated/codex-adapter"
    };
};
//# sourceMappingURL=paths.js.map