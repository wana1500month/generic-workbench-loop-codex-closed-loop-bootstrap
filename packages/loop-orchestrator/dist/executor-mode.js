export const defaultExecutorMode = "harness";
export const executorModes = [
    "harness",
    "subagents-experimental"
];
export const isExecutorMode = (value) => typeof value === "string" &&
    executorModes.includes(value);
//# sourceMappingURL=executor-mode.js.map