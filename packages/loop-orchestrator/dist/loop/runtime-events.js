const unique = (values) => [...new Set(values)];
export const normalizeRuntimeWarnings = (warnings) => unique(warnings
    .map((warning) => warning.trim())
    .filter((warning) => warning.length > 0));
export const ephemeralRuntimeEventCodes = new Set([
    "run.resumed_from_history",
    "resume.migration_override",
    "resume.partial_init_rebuild",
    "resume.noop_terminal",
    "resume.reopened_terminal",
    "resume.continued",
    "validation.environment_lane_hint"
]);
export const buildRuntimeEvent = (code, message, metadata) => ({
    code,
    message,
    created_at: new Date().toISOString(),
    ...(metadata ? { metadata } : {})
});
export const mergeRuntimeEvents = (events) => Array.from(events.reduce((map, event) => map.set(`${event.code}:${JSON.stringify(event.metadata ?? {})}`, event), new Map()).values());
//# sourceMappingURL=runtime-events.js.map