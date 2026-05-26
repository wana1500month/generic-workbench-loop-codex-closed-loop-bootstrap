import { dirname, join, resolve } from "node:path";
import { repoRoot } from "../file-system.js";
import { resolveTargetFamilySelection } from "../profile-selection.js";
const genericCoreProfilePath = join(repoRoot, "evals", "verification-profiles", "generic-core.profile.json");
export const resolveEvaluatorBundleSelection = (input) => {
    const runtimeWarnings = [];
    const targetFamilySelection = input.explicitEvaluatorProfilePath
        ? undefined
        : resolveTargetFamilySelection(input.explicitTargetFamily);
    if (input.explicitTargetFamily &&
        !input.explicitEvaluatorProfilePath &&
        !targetFamilySelection) {
        throw new Error(`Unknown target family '${input.explicitTargetFamily}'.`);
    }
    if (input.explicitEvaluatorProfilePath && input.explicitTargetFamily) {
        runtimeWarnings.push(`Ignoring target family '${input.explicitTargetFamily}' because an explicit evaluator profile path was provided.`);
    }
    const useGenericCoreDefault = input.preferGenericCoreDefault &&
        !input.explicitEvaluatorProfilePath &&
        !input.explicitTargetFamily &&
        !input.preparedEvaluatorProfilePath &&
        !input.preparedTargetFamily &&
        !input.preparedValidationLane &&
        !input.summaryEvaluatorProfilePath &&
        !input.summaryTargetFamily &&
        !input.summaryValidationLane;
    const evaluatorProfilePath = input.explicitEvaluatorProfilePath
        ? resolve(input.explicitEvaluatorProfilePath)
        : targetFamilySelection?.profile_path
            ? resolve(targetFamilySelection.profile_path)
            : input.preparedEvaluatorProfilePath
                ? resolve(input.preparedEvaluatorProfilePath)
                : useGenericCoreDefault
                    ? genericCoreProfilePath
                    : input.summaryEvaluatorProfilePath
                        ? resolve(input.summaryEvaluatorProfilePath)
                        : input.rubric?.evaluator_profile_path && input.rubricPath
                            ? resolve(dirname(input.rubricPath), input.rubric.evaluator_profile_path)
                            : undefined;
    return {
        evaluatorProfilePath,
        targetFamily: targetFamilySelection?.target_family ??
            input.preparedTargetFamily ??
            (useGenericCoreDefault ? "generic-core" : undefined) ??
            input.summaryTargetFamily,
        validationLane: targetFamilySelection?.validation_lane ??
            input.preparedValidationLane ??
            (useGenericCoreDefault ? "deterministic_semantic" : undefined) ??
            input.summaryValidationLane,
        runtimeWarnings
    };
};
//# sourceMappingURL=evaluator-bundle.js.map