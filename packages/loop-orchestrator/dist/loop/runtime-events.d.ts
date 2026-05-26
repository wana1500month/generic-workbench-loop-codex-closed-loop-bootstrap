import type { RuntimeEvent, RuntimeEventCode } from "../types.js";
export declare const normalizeRuntimeWarnings: (warnings: readonly string[]) => string[];
export declare const ephemeralRuntimeEventCodes: Set<RuntimeEventCode>;
export declare const buildRuntimeEvent: (code: RuntimeEventCode, message: string, metadata?: RuntimeEvent["metadata"]) => RuntimeEvent;
export declare const mergeRuntimeEvents: (events: readonly RuntimeEvent[]) => RuntimeEvent[];
//# sourceMappingURL=runtime-events.d.ts.map