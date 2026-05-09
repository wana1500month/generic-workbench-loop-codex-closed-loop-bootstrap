---
name: loop-control
description: Start, inspect, resume, or stop harness runs from the correct Codex app surface.
---

# Loop Control

Use this skill when the lane is `run_control`.

## Workflow

1. Classify the control action first: `start`, `status`, `resume`, or `stop`.
2. Prefer the Codex app foreground surface by default.
3. Use the matching command surface:

```bash
npm run loop:start:codex -- --json
npm run loop:start:codex -- --json --run-id run-###
npm run loop:start:bg -- --max-rounds 3
npm run loop:start:manual -- --json
npm run loop:status -- --run-dir evals/runs/run-### --json
npm run loop:resume -- --run-dir evals/runs/run-### --json
npm run loop:continue -- --run-dir evals/runs/run-### --json
npm run loop:stop -- --run-dir evals/runs/run-### 
```

## Canonical examples

- `루프 시작` -> `npm run loop:start:codex -- --json`
- `루프 시작 가능하냐?` -> stay in `run_control` and default the eventual start surface to `loop:start:codex`
- `현재 루프 상태` -> `npm run loop:status -- --run-dir evals/runs/run-### --json` when a concrete run exists, otherwise inspect the active operator surface first
- `run-179 상태 보여줘` -> `npm run loop:status -- --run-dir evals/runs/run-179 --json`
- `run-179 이어가` -> `npm run loop:resume -- --run-dir evals/runs/run-179 --json`, then keep the same-thread autocontinue chain inside `$loop-control`
- `모든 루프 정지` -> `npm run loop:stop -- --all`
- `모든 루프 정지하고 왜 타임아웃 나는지 원인 상세하게 규명` -> stop first, then inspect timeout root cause from persisted runtime and adapter artifacts
- `백그라운드로 루프 시작` -> `npm run loop:start:bg -- --max-rounds 3`

## Hard rules

- In the Codex app, default `start` to `npm run loop:start:codex -- --json`.
- If the active operator surface exposes a prepared `run_id`, pass it with `--run-id <run-id>` so start consumes that run even when other prepared sessions exist.
- In the Codex app, `start` is not complete when `loop:start:codex -- --json` returns.
- In the Codex app, `start` and `resume` own the same-thread autocontinue chain.
- `loop-control` is the operator-facing gate that moves a session from `ready_to_start` into `running`.
- When a thread-bound `ready_to_start` session already exists, `loop:start:codex` should consume that prepared session instead of allocating a fresh run.
- Do not let `app-builder-loop` auto-start heavy implementation after prepare; once the session says `ready_to_start`, the generated adapter plan/review task should already be visible, and loop-control must wait for an explicit `루프 시작` or `start loop`.
- After `npm run loop:start:codex -- --json` or `npm run loop:resume -- --run-dir <run> --json` succeeds, inspect the returned operator surface immediately.
- If `attention_required = codex`, do not answer the user yet. Keep control inside `$loop-control` by calling `npm run loop:continue -- --run-dir <run> --json` until the run reaches a user-visible boundary.
- Treat `ui_visibility = internal_checkpoint` and `foreground_owner = codex` as the machine-readable form of that same rule; only `ui_visibility = user_boundary` is eligible for a user-facing reply.
- In the Codex app, `start` and `resume` mean machine-readable foreground entry plus immediate same-thread continuation through `loop:continue`; do not stop after the first Codex-owned checkpoint.
- Only use `loop:start:bg` when the operator explicitly asks for detached or background supervision.
- Treat `loop:start:manual` as an intentional shell-owned downgrade, not the default attached start path.
- Do not claim continuous monitoring unless a real background supervisor or automation owns that task.
- If the request is about deciding whether an existing persisted run should reopen, hold, continue, or close, switch to `run-resume`.
- When `loop:status --json` or `runtime/operator-surface.json` reports `attention_required = codex`, the next foreground action stays inside `$loop-control`; use `$attached-loop` only to recover an already-existing foreground run after interruption.
- Only emit a user-visible reply after the run reaches `attention_required = human`, `attention_required = external`, or a terminal state.
- Do not describe a Codex-owned checkpoint as "waiting for input" or "handoff pending" to the user.
