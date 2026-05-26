import type { TargetFamily, ValidationLane } from "./types.js";
export interface TargetFamilySelection {
    target_family: TargetFamily;
    profile_path: string;
    validation_lane: ValidationLane;
}
export declare const resolveTargetFamilySelection: (targetFamily?: string) => TargetFamilySelection | undefined;
export declare const supportedTargetFamilies: () => TargetFamilySelection[];
//# sourceMappingURL=profile-selection.d.ts.map