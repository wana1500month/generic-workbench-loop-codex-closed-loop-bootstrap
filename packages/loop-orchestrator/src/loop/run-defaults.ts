import { join } from "node:path";

import { repoRoot } from "../file-system.js";
import type { AdapterCapabilityName } from "../types.js";

export const defaultRubricPath = join(
  repoRoot,
  "evals",
  "rubrics",
  "generic-harness-rubric.json"
);

export const preVerificationCapabilities: AdapterCapabilityName[] = [
  "prepare_target",
  "apply_change",
  "run_target",
  "capture_evidence"
];

export const postVerificationCapabilities: AdapterCapabilityName[] = [
  "run_checks",
  "grade_round"
];
