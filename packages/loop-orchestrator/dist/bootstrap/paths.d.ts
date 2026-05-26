import type { BootstrapArtifactPaths } from "../bootstrap.js";
export interface BootstrapArtifactPathInput {
    rootDirectory: string;
    runDirectory?: string;
}
export declare const createBootstrapArtifactPaths: (input: string | BootstrapArtifactPathInput) => BootstrapArtifactPaths;
//# sourceMappingURL=paths.d.ts.map