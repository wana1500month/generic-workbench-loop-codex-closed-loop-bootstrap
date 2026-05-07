import { isAbsolute, relative, resolve } from "node:path";

import { repoRoot } from "./file-system.js";
import type { LoadedAdapterContract } from "./types.js";

const isPathInside = (root: string, candidate: string): boolean => {
  const rootPath = process.platform === "win32" ? root.toLowerCase() : root;
  const candidatePath = process.platform === "win32" ? candidate.toLowerCase() : candidate;
  const relationship = relative(rootPath, candidatePath);
  return relationship === "" || (!relationship.startsWith("..") && !isAbsolute(relationship));
};

export const externalAdapterTargetRootAllowed = (): boolean =>
  ["1", "true", "yes"].includes(
    (process.env.HARNESS_ALLOW_EXTERNAL_TARGET_ROOT ?? "").trim().toLowerCase()
  );

export const resolvedAdapterTargetRoot = (
  loadedAdapter: LoadedAdapterContract
): string => {
  const targetRoot = resolve(
    loadedAdapter.base_directory,
    loadedAdapter.contract.target_root
  );
  if (!isPathInside(repoRoot, targetRoot) && !externalAdapterTargetRootAllowed()) {
    throw new Error(
      [
        `External adapter target_root is blocked by default: ${targetRoot}`,
        "Set HARNESS_ALLOW_EXTERNAL_TARGET_ROOT=1 or pass --allow-external-target-root only when this adapter is trusted to operate outside the harness repository."
      ].join(" ")
    );
  }
  return targetRoot;
};
