export const uiVisibilityForAttention = (attention) => attention === "codex" ? "internal_checkpoint" : "user_boundary";
export const foregroundOwnerForAttention = (attention) => {
    if (attention === "codex") {
        return "codex";
    }
    if (attention === "external") {
        return "external";
    }
    return "human";
};
//# sourceMappingURL=foreground-surface.js.map