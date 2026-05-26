import type { OperatorAttentionRequired, OperatorForegroundOwner, OperatorUiVisibility, SessionAttention } from "./types.js";
type ForegroundAttention = OperatorAttentionRequired | SessionAttention;
export declare const uiVisibilityForAttention: (attention: ForegroundAttention | undefined) => OperatorUiVisibility;
export declare const foregroundOwnerForAttention: (attention: ForegroundAttention | undefined) => OperatorForegroundOwner;
export {};
//# sourceMappingURL=foreground-surface.d.ts.map