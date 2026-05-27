import { join } from "node:path";
import { repoRoot } from "../file-system.js";
export const defaultRubricPath = join(repoRoot, "evals", "rubrics", "generic-harness-rubric.json");
export const preVerificationCapabilities = [
    "prepare_target",
    "apply_change",
    "run_target",
    "capture_evidence"
];
export const postVerificationCapabilities = [
    "run_checks",
    "grade_round"
];
//# sourceMappingURL=run-defaults.js.map