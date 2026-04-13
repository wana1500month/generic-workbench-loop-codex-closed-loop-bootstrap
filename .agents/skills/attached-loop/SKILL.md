---
name: attached-loop
description: Recover or re-enter an existing Codex-owned current-thread run after the foreground thread was interrupted.
---

# attached-loop

Use this skill when a foreground current-thread run already exists and the operator needs to recover the same-thread worker after an interruption.
Do not use this skill as the canonical next step for a fresh `루프 시작`; `$loop-control` owns the normal start and resume chain.
Do not use this skill as a proxy for the `app-server` transport.

## Goal

Recover an existing Codex-owned current-thread run without spawning nested `codex exec` sessions.

## Rules

- Do not spawn nested `codex exec` or `codex exec resume`.
- Treat this as a recovery or re-entry surface for `transport_mode = current-thread`.
- Keep shell usage phase-local and short-lived.
- Prefer repairing from `runtime/live-state.json`, `runtime/round-phase.json`, `runtime/operator-surface.json`, and committed `round_summary.json` files instead of guessing from chat history.
- Read `runtime/current-thread-protocol.md` when it exists and treat it as the operator checklist for the active run.
- Use `npm run loop:continue -- --run-dir <run> --json` as the machine contract for deciding whether the run is at a Codex checkpoint, a human stop, an external block, or a terminal state.
- Treat `attention_required = codex` as an internal same-thread checkpoint, not a user-facing pause.
- Only stop to the user when `attention_required` is `human` or `external`, when the run is terminal, or when same-thread recovery cannot safely continue.

## Expected flow

1. Restore run state from persisted artifacts for the target run.
2. Call `npm run loop:continue -- --run-dir <run> --json`.
3. If the state is `terminal`, summarize the result and stop.
4. If the state is `human_stop`, ask the blocking question and stop.
5. If the state is `external_stop`, explain the environment block and stop.
6. If the state is `codex_checkpoint`, read `active_prompt_path`, complete the checkpoint on the same thread, write `active_response_path` with the matching `checkpoint_id`, then call `loop:continue` again.
7. Do not emit an intermediate user-visible response while the run remains on `codex_checkpoint`.

## Manual protocol

1. Restore the active round from `summary.json`, `runtime/live-state.json`, and `runtime/round-phase.json`.
2. Read the latest `round-contract.json`, `patch-request.json`, and `runtime/operator-surface.json` before acting.
3. When `loop:continue --json` returns `codex_checkpoint`, complete the active checkpoint immediately instead of stopping at a phase boundary.
4. After each checkpoint, write the updated response artifact before continuing.
5. If a step would require nested Codex execution, fail closed and leave a persisted note instead of bypassing the transport policy.
