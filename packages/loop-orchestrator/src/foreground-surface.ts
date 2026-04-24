import type {
  OperatorAttentionRequired,
  OperatorForegroundOwner,
  OperatorUiVisibility,
  SessionAttention
} from "./types.js";

type ForegroundAttention = OperatorAttentionRequired | SessionAttention;

export const uiVisibilityForAttention = (
  attention: ForegroundAttention | undefined
): OperatorUiVisibility =>
  attention === "codex" ? "internal_checkpoint" : "user_boundary";

export const foregroundOwnerForAttention = (
  attention: ForegroundAttention | undefined
): OperatorForegroundOwner => {
  if (attention === "codex") {
    return "codex";
  }
  if (attention === "external") {
    return "external";
  }
  return "human";
};
