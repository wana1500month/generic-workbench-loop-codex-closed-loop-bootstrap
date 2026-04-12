---
name: attached-loop
description: Keep stock Codex on the current thread as the attached harness controller without nested codex exec calls.
---

# attached-loop

Use this skill when the operator wants stock Codex to behave like the active loop controller instead of launching detached child Codex sessions.
Pair it with `--controller-mode attached --transport current-thread`.
Do not use this skill as a proxy for the `app-server` transport.

## Goal

Keep the current Codex thread attached to the run as an active same-thread worker while still honoring the harness protocol artifacts and controller state machine.

## Rules

- Do not spawn nested `codex exec` or `codex exec resume`.
- Treat the current Codex thread as the controller and generator surface.
- Treat this as the stock Codex current-thread mainline, not an App Server thread/turn implementation.
- Remember that `controller_mode` and `transport_mode` are separate: this skill is for `transport_mode = current-thread`, while `transport_mode = app-server` is a separate live transport surface.
- Keep shell usage phase-local and short-lived.
- Update persisted protocol artifacts before and after each phase boundary.
- Prefer repairing from `runtime/live-state.json`, `runtime/round-phase.json`, and committed `round_summary.json` files instead of guessing from chat history.
- Be explicit when attached mode must refuse a path that would require detached child Codex execution.
- Do not claim continuous monitoring unless a real background automation owns the task.
- Read `runtime/current-thread-protocol.md` when it exists and treat it as the operator checklist for the active run.
- When `runtime/attached-generator-prompt.md` exists, complete that generator task on the current thread and write `runtime/attached-generator-response.json` before resuming `pre_verification`.
- Treat `runtime/operator-surface.json` and `loop:status --json` as the control contract for continuation.
- `attention_required = codex` is not a user stop boundary. Consume the checkpoint on the same thread and continue.
- Only stop to the user when `attention_required` is `human` or `external`, or when the run is terminal.

## Expected flow

1. Restore run state from persisted artifacts if `--resume-run` is in play.
2. Read `runtime/operator-surface.json` or `npm run loop:status -- --run-dir <run> --json`.
3. If the run is terminal, summarize the result and stop.
4. If `attention_required` is `human`, ask the user the blocking question and stop.
5. If `attention_required` is `external`, explain the environment block and stop.
6. If `attention_required` is `codex`, read `active_prompt_path`, consume the checkpoint on the same thread, write `active_response_path`, run `npm run loop:resume -- --run-dir <run> --json` or the equivalent persisted resume surface, and repeat without replying to the user in between.
7. Stop honestly when the current thread cannot stay attached or when detached controller behavior is required.

## Manual protocol

1. Restore the active round from `summary.json`, `runtime/live-state.json`, and `runtime/round-phase.json`.
2. Read the latest `round-contract.json`, `patch-request.json`, and `runtime/operator-surface.json` before acting.
3. If `attention_required = codex`, complete the active checkpoint immediately instead of stopping at a phase boundary.
4. After each checkpoint or phase completion, write the updated protocol artifacts before moving on.
5. If `runtime/attached-generator-prompt.md` exists, finish that task first and write `runtime/attached-generator-response.json` with the summary and changed files.
6. Continue looping until the run reaches `attention_required = human`, `attention_required = external`, or a terminal state.
7. If a step would require nested Codex execution, fail closed and leave a persisted note instead of bypassing the transport policy.
8. Do not emit an intermediate user-visible response while `attention_required = codex`.
