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
npm run loop:start:codex
npm run loop:start:bg -- --max-rounds 3
npm run loop:start:manual
npm run loop:status -- --run-dir evals/runs/run-###
npm run loop:resume -- --run-dir evals/runs/run-###
npm run loop:stop -- --run-dir evals/runs/run-###
```

## Canonical examples

- `루프 시작` -> `npm run loop:start:codex`
- `루프 시작 가능하냐?` -> stay in `run_control` and default the eventual start surface to `loop:start:codex`
- `현재 루프 상태` -> `npm run loop:status -- --run-dir evals/runs/run-###` when a concrete run exists, otherwise inspect the active operator surface first
- `run-179 상태 보여줘` -> `npm run loop:status -- --run-dir evals/runs/run-179`
- `모든 루프 정지` -> `npm run loop:stop -- --all`
- `모든 루프 정지하고 왜 타임아웃 나는지 원인 상세하게 규명` -> stop first, then inspect timeout root cause from persisted runtime and adapter artifacts
- `백그라운드로 루프 시작` -> `npm run loop:start:bg -- --max-rounds 3`

## Hard rules

- In the Codex app, default `start` to `npm run loop:start:codex`.
- Only use `loop:start:bg` when the operator explicitly asks for detached or background supervision.
- Treat `loop:start:manual` as an intentional shell-owned downgrade, not the default attached start path.
- Do not claim continuous monitoring unless a real background supervisor or automation owns that task.
- If the request is about deciding whether an existing persisted run should reopen, hold, continue, or close, switch to `run-resume`.
