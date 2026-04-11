import { resolve } from "node:path";

import type { LoadedAdapterContract } from "./types.js";

export const resolvedAdapterTargetRoot = (
  loadedAdapter: LoadedAdapterContract
): string => resolve(loadedAdapter.base_directory, loadedAdapter.contract.target_root);
