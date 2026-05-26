import type { ExecutorMode, LoopRunSummary, TransportMode, ValidationLane } from "./types.js";
export declare const resumeIdentityVersion = 4;
export interface ResumeIdentityState {
    resume_identity_version: number;
    adapter_attached: boolean;
    evaluator_bundle_attached: boolean;
    adapter_contract_path?: string;
    adapter_contract_sha256?: string;
    evaluator_profile_path?: string;
    evaluator_bundle_sha256?: string;
    rubric_sha256?: string;
    executor_mode?: ExecutorMode;
    transport_mode?: TransportMode;
    target_family?: LoopRunSummary["target_family"];
    validation_lane?: ValidationLane;
}
export declare const resumeIdentityArtifactPath: (runDirectory: string) => string;
export declare const loadResumeIdentityArtifact: (runDirectory: string) => Promise<ResumeIdentityState | undefined>;
export declare const buildResumeIdentityState: (input: {
    adapterContractPath?: string;
    evaluatorProfilePath?: string;
    rubricPath?: string;
    executorMode?: ExecutorMode;
    transportMode?: TransportMode;
    targetFamily?: LoopRunSummary["target_family"];
    validationLane?: ValidationLane;
}) => Promise<ResumeIdentityState>;
export declare const resumeIdentityFingerprint: (identity: ResumeIdentityState) => string;
export declare const summaryResumeIdentity: (summary?: LoopRunSummary) => ResumeIdentityState;
export declare const compareResumeIdentity: (input: {
    current: ResumeIdentityState;
    previous: ResumeIdentityState;
}) => string[];
//# sourceMappingURL=resume-identity.d.ts.map