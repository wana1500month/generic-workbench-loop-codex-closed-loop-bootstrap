import { join } from "node:path";
import { repoRoot } from "./file-system.js";
const targetFamilyMap = new Map([
    [
        "generic-core",
        {
            target_family: "generic-core",
            profile_path: join(repoRoot, "evals", "verification-profiles", "generic-core.profile.json"),
            validation_lane: "deterministic_semantic"
        }
    ],
    [
        "generic",
        {
            target_family: "generic-core",
            profile_path: join(repoRoot, "evals", "verification-profiles", "generic-core.profile.json"),
            validation_lane: "deterministic_semantic"
        }
    ],
    [
        "no-target",
        {
            target_family: "generic-core",
            profile_path: join(repoRoot, "evals", "verification-profiles", "generic-core.profile.json"),
            validation_lane: "deterministic_semantic"
        }
    ],
    [
        "api-service",
        {
            target_family: "api-service",
            profile_path: join(repoRoot, "evals", "verification-profiles", "api-service.profile.json"),
            validation_lane: "deterministic_semantic"
        }
    ],
    [
        "api",
        {
            target_family: "api-service",
            profile_path: join(repoRoot, "evals", "verification-profiles", "api-service.profile.json"),
            validation_lane: "deterministic_semantic"
        }
    ],
    [
        "crud-api",
        {
            target_family: "crud-api",
            profile_path: join(repoRoot, "evals", "verification-profiles", "crud-service.profile.json"),
            validation_lane: "deterministic_semantic"
        }
    ],
    [
        "crud-service",
        {
            target_family: "crud-api",
            profile_path: join(repoRoot, "evals", "verification-profiles", "crud-service.profile.json"),
            validation_lane: "deterministic_semantic"
        }
    ],
    [
        "chat-agent",
        {
            target_family: "chat-agent",
            profile_path: join(repoRoot, "evals", "verification-profiles", "chat-agent.profile.json"),
            validation_lane: "deterministic_semantic"
        }
    ],
    [
        "cli-tool",
        {
            target_family: "cli-tool",
            profile_path: join(repoRoot, "evals", "verification-profiles", "cli-tool.profile.json"),
            validation_lane: "deterministic_semantic"
        }
    ],
    [
        "cli",
        {
            target_family: "cli-tool",
            profile_path: join(repoRoot, "evals", "verification-profiles", "cli-tool.profile.json"),
            validation_lane: "deterministic_semantic"
        }
    ],
    [
        "command-artifact",
        {
            target_family: "command-artifact",
            profile_path: join(repoRoot, "evals", "verification-profiles", "command-artifact.profile.json"),
            validation_lane: "deterministic_semantic"
        }
    ],
    [
        "command",
        {
            target_family: "command-artifact",
            profile_path: join(repoRoot, "evals", "verification-profiles", "command-artifact.profile.json"),
            validation_lane: "deterministic_semantic"
        }
    ],
    [
        "browser-app",
        {
            target_family: "browser-app",
            profile_path: join(repoRoot, "evals", "verification-profiles", "browser-app.profile.json"),
            validation_lane: "environment_integration"
        }
    ],
    [
        "browser",
        {
            target_family: "browser-app",
            profile_path: join(repoRoot, "evals", "verification-profiles", "browser-app.profile.json"),
            validation_lane: "environment_integration"
        }
    ],
    [
        "browser-editor",
        {
            target_family: "browser-editor",
            profile_path: join(repoRoot, "evals", "verification-profiles", "editor-app.profile.json"),
            validation_lane: "environment_integration"
        }
    ],
    [
        "editor-app",
        {
            target_family: "browser-editor",
            profile_path: join(repoRoot, "evals", "verification-profiles", "editor-app.profile.json"),
            validation_lane: "environment_integration"
        }
    ],
    [
        "fullstack-app",
        {
            target_family: "fullstack-app",
            profile_path: join(repoRoot, "evals", "verification-profiles", "fullstack-app.profile.json"),
            validation_lane: "environment_integration"
        }
    ],
    [
        "fullstack",
        {
            target_family: "fullstack-app",
            profile_path: join(repoRoot, "evals", "verification-profiles", "fullstack-app.profile.json"),
            validation_lane: "environment_integration"
        }
    ],
    [
        "dashboard",
        {
            target_family: "dashboard",
            profile_path: join(repoRoot, "evals", "verification-profiles", "dashboard.profile.json"),
            validation_lane: "environment_integration"
        }
    ]
]);
export const resolveTargetFamilySelection = (targetFamily) => {
    if (!targetFamily?.trim()) {
        return undefined;
    }
    return targetFamilyMap.get(targetFamily.trim().toLowerCase());
};
export const supportedTargetFamilies = () => {
    const seen = new Set();
    const selections = [];
    for (const selection of targetFamilyMap.values()) {
        if (seen.has(selection.target_family)) {
            continue;
        }
        seen.add(selection.target_family);
        selections.push(selection);
    }
    return selections;
};
//# sourceMappingURL=profile-selection.js.map