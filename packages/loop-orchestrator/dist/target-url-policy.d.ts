export interface TargetUrlPolicyResult {
    ok: boolean;
    url?: string;
    reason?: string;
}
export declare const validateTargetUrlPolicy: (value: string) => TargetUrlPolicyResult;
export declare const assertAllowedTargetUrl: (value: string, context: string) => string;
//# sourceMappingURL=target-url-policy.d.ts.map