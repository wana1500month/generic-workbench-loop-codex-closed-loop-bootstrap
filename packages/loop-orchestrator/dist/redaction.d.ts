export type RedactionResult = {
    text: string;
    redacted: boolean;
    count: number;
    policy_version: "adapter-redaction-v1";
};
export declare const redactionPolicyVersion: "adapter-redaction-v1";
export declare const redactText: (output: string, sensitiveValues: readonly string[]) => RedactionResult;
export declare const redactJsonValue: (value: unknown, sensitiveValues: readonly string[]) => {
    value: unknown;
    count: number;
};
//# sourceMappingURL=redaction.d.ts.map