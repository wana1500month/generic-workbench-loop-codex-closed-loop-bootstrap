import { join, relative } from "node:path";

import { repoRoot, writeText } from "./file-system.js";
import { resolveOperatorSurfaceContext } from "./operator-surface.js";
import type {
  ControllerMode,
  ControllerPhaseStatus,
  ControllerRoundPhase,
  LoopRunSummary,
  TransportMode
} from "./types.js";

const rel = (path: string | undefined): string =>
  path ? relative(repoRoot, path) : "unavailable";

export const transportProtocolPathForRun = (
  runDirectory: string,
  transportMode: TransportMode
): string => join(runDirectory, "runtime", `${transportMode}-protocol.md`);

export const writeTransportProtocol = async (input: {
  runDirectory: string;
  transportMode: TransportMode;
  summary: Pick<
    LoopRunSummary,
    | "run_id"
    | "controller_mode"
    | "transport_mode"
    | "transport_state_path"
    | "resume_identity_path"
    | "runtime_round_phase_path"
  >;
  controllerMode?: ControllerMode;
  activeRound?: number;
  activePhase?: ControllerRoundPhase;
  activeStatus?: ControllerPhaseStatus;
  latestPatchRequestPath?: string;
  latestRoundContractPath?: string;
  notes?: string[];
}): Promise<string> => {
  const path = transportProtocolPathForRun(input.runDirectory, input.transportMode);
  const context = resolveOperatorSurfaceContext({
    controllerMode: input.controllerMode ?? input.summary.controller_mode ?? "detached",
    transportMode: input.transportMode
  });

  const common = `# Transport Protocol

## Run

- Run id: ${input.summary.run_id}
- Controller mode: ${input.summary.controller_mode ?? "detached"}
- Transport mode: ${input.summary.transport_mode ?? input.transportMode}
- Transport state: ${rel(input.summary.transport_state_path)}
- Resume identity: ${rel(input.summary.resume_identity_path)}
- Runtime round phase: ${rel(input.summary.runtime_round_phase_path)}
- Active round: ${input.activeRound ?? "none"}
- Active phase: ${input.activePhase ?? "none"}
- Active status: ${input.activeStatus ?? "none"}
- Latest round contract: ${rel(input.latestRoundContractPath)}
- Latest patch request: ${rel(input.latestPatchRequestPath)}

## Notes

${(input.notes ?? []).length > 0 ? input.notes!.map((note) => `- ${note}`).join("\n") : "- none"}
`;

  const modeSpecific =
    input.transportMode === "current-thread"
      ? context.presentationMode === "foreground-thread"
        ? `## Current-Thread Rules

1. Stay on the current Codex thread. This run is bound to the stock foreground-thread operator surface. Do not call nested \`codex exec\` or \`codex exec resume\`.
2. Treat current-thread enhancement artifacts as durable same-thread checkpoints. Update persisted protocol artifacts before and after each controller phase.
3. Keep shell usage short-lived and local to the current phase.
4. Treat \`round-contract.json\`, \`patch-request.json\`, and \`runtime/round-phase.json\` as authoritative over chat memory.
5. When a current-thread enhancement artifact is active, the controller pauses honestly with \`stop_reason = "awaiting_codex_checkpoint"\`, but that boundary is a Codex-owned checkpoint rather than a human stop. A Codex-owned checkpoint is not a user-facing pause boundary. \`$loop-control\` should keep the same-thread autocontinue chain moving by consuming the active \`*-prompt.md\` file and writing the matching \`*-response.json\` on the same thread before resuming. Use \`$attached-loop\` only when a foreground current-thread run must be recovered after interruption.
6. When the bootstrap generator surface is active, treat \`runtime/attached-generator-prompt.md\` / \`runtime/attached-generator-response.json\` as the same kind of Codex-owned checkpoint on this thread.
7. If the route would require child Codex execution, fail closed and leave a persisted note instead of faking attached behavior.

## Same-Thread Loop

1. Restore the latest run state from persisted artifacts.
2. Read the active round contract and latest patch request.
3. Consume Codex-owned checkpoints automatically on the same thread until the run reaches \`attention_required = human\`, \`attention_required = external\`, or a terminal state.
4. Re-open the next phase from files, not from chat assumptions.
`
        : `## Current-Thread Rules

1. This run is using current-thread as a manual protocol rather than a bound stock Codex thread. Do not call nested \`codex exec\` or \`codex exec resume\`.
2. Treat the persisted runtime artifacts as the source of truth and keep work phase-local.
3. Use the same shell or explicitly reattach from a Codex thread before continuing the active phase.
4. Treat \`round-contract.json\`, \`patch-request.json\`, and \`runtime/round-phase.json\` as authoritative over chat memory.
5. Current-thread enhancement artifacts are still durable checkpoints. If no bound Codex thread is available, the operator must manually complete the active \`*-prompt.md\` file and write the matching \`*-response.json\` before resuming.
6. When the bootstrap generator surface is active, complete \`runtime/attached-generator-prompt.md\` and write \`runtime/attached-generator-response.json\` before resuming pre_verification.
7. If the route would require child Codex execution, fail closed and leave a persisted note instead of faking attached behavior.

## Manual Phase Loop

1. Restore the latest run state from persisted artifacts.
2. Read the active round contract and latest patch request.
3. Complete only the active phase, then checkpoint.
4. Re-open the next phase from files, not from chat assumptions.
`
      : `## App Server Rules

1. Treat App Server as an embedded background-automation surface. The live thread and turn belong to the App Server transport state, not to the stock Codex UI thread.
2. Resume the persisted \`thread_id\` when available, read thread state before opening a new turn, and keep \`thread/name/set\` aligned with the run label.
3. Use \`turn/steer\` only for active phase updates on the current thread; use dedicated task turns for attached generator work.
4. Keep \`transport-state.json\` aligned with thread lifecycle, runtime status, active flags, \`turn_id\`, and event cursor.
5. Attached generator task turns must honor the persisted task cwd, writable roots, timeout budget, and \`runtime/attached-generator-response.json\`.
6. Keep the controller state machine authoritative for file mutation, checkpointing, and pause or resume policy.
`;

  await writeText(path, `${common}\n${modeSpecific}\n`);
  return path;
};
