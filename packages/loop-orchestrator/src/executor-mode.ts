import type { ExecutorMode } from "./types.js";

export const defaultExecutorMode: ExecutorMode = "harness";

export const executorModes = [
  "harness",
  "subagents-experimental"
] as const satisfies readonly ExecutorMode[];

export const isExecutorMode = (value: string | undefined): value is ExecutorMode =>
  typeof value === "string" &&
  (executorModes as readonly string[]).includes(value);

