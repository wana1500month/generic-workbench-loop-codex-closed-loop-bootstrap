---
name: attached-loop
description: Keep stock Codex on the current thread as the attached harness controller without nested codex exec calls.
---

# attached-loop

Use this skill when the operator wants stock Codex to behave like the active loop controller instead of launching detached child Codex sessions.
Pair it with `--controller-mode attached --transport current-thread`.
Do not use this skill as a proxy for the `app-server` transport.

## Goal

Keep the current Codex thread attached to the run while still honoring the harness protocol artifacts and controller state machine.

## Rules

- Do not spawn nested `codex exec` or `codex exec resume`.
- Treat the current Codex thread as the controller and generator surface.
- Treat this as the stock Codex current-thread mainline, not an App Server thread/turn implementation.
- Remember that `controller_mode` and `transport_mode` are separate: this skill is for `transport_mode = current-thread`, while `transport_mode = app-server` is a separate future transport surface.
- Keep shell usage phase-local and short-lived.
- Update persisted protocol artifacts before and after each phase boundary.
- Prefer repairing from `runtime/live-state.json`, `runtime/round-phase.json`, and committed `round_summary.json` files instead of guessing from chat history.
- Be explicit when attached mode must refuse a path that would require detached child Codex execution.
- Read `runtime/current-thread-protocol.md` when it exists and treat it as the operator checklist for the active run.

## Expected flow

1. Restore run state from persisted artifacts if `--resume-run` is in play.
2. Open or repair the current round by phase, not by a long opaque subprocess.
3. Write negotiation artifacts before mutation.
4. Run verification and evaluation through persisted snapshots.
5. Checkpoint `summary.json` and `current_best.json` after each committed round.
6. Stop honestly when the current thread cannot stay attached or when detached controller behavior is required.

## Manual protocol

1. Restore the active round from `summary.json`, `runtime/live-state.json`, and `runtime/round-phase.json`.
2. Read the latest `round-contract.json` and `patch-request.json` before acting.
3. Complete only one controller phase at a time.
4. After each phase, write the updated protocol artifacts before moving on.
5. If a step would require nested Codex execution, fail closed and leave a persisted note instead of bypassing the transport policy.
