export const redactionPolicyVersion = "adapter-redaction-v1";
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tokenPatterns = [
    /\b(?:(?:sk|sess)[-_][A-Za-z0-9_-]{12,}|(?:ghp|github_pat)_[A-Za-z0-9_]{12,})\b/g,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\bBearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}\b/g
];
export const redactText = (output, sensitiveValues) => {
    let text = output;
    let count = 0;
    for (const value of sensitiveValues) {
        const normalized = value.trim();
        if (normalized.length < 8) {
            continue;
        }
        text = text.replace(new RegExp(escapeRegExp(normalized), "g"), () => {
            count += 1;
            return "[REDACTED]";
        });
    }
    for (const pattern of tokenPatterns) {
        text = text.replace(pattern, (match) => {
            count += 1;
            if (match.startsWith("Bearer ")) {
                return "Bearer [REDACTED]";
            }
            return "[REDACTED]";
        });
    }
    return {
        text,
        redacted: count > 0,
        count,
        policy_version: redactionPolicyVersion
    };
};
export const redactJsonValue = (value, sensitiveValues) => {
    if (typeof value === "string") {
        const redacted = redactText(value, sensitiveValues);
        return { value: redacted.text, count: redacted.count };
    }
    if (Array.isArray(value)) {
        let count = 0;
        const items = value.map((item) => {
            const result = redactJsonValue(item, sensitiveValues);
            count += result.count;
            return result.value;
        });
        return { value: items, count };
    }
    if (value && typeof value === "object") {
        let count = 0;
        const output = {};
        for (const [key, child] of Object.entries(value)) {
            const result = redactJsonValue(child, sensitiveValues);
            count += result.count;
            output[key] = result.value;
        }
        return { value: output, count };
    }
    return { value, count: 0 };
};
//# sourceMappingURL=redaction.js.map